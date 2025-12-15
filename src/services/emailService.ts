// emailService.ts
import { Account, Record } from '../api/_lib/types';
import { Rule, RULES, parseMessage } from './rules';
import { getMicrosoftToken, getGoogleAccessToken } from './authService';
import { updateAccountsInFirebase, deleteRecordsByEmailId, addRecord } from './firebaseService';

/**
 * Giải mã base64 url-safe của Gmail
 */
const urlSafeBase64Decode = (str: string): string => {
    if (!str) return "";
    try {
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }

        if (typeof window !== 'undefined' && typeof window.atob === 'function') {
            const binary = window.atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const decoder = new TextDecoder('utf-8');
            return decoder.decode(bytes);
        }

        // @ts-ignore
        if (typeof Buffer !== 'undefined') {
            // @ts-ignore
            return Buffer.from(base64, 'base64').toString('utf-8');
        }

        return base64;
    } catch (e) {
        console.error("Base64 decode failed:", e, "Input:", str);
        return "";
    }
};


const qpSoftBreak = /=\r?\n/g;
const qpUnwrapHtml = (s: string): string => {
    if (!s) return "";
    s = s.replace(qpSoftBreak, "");
    s = s.replace(/=3D/g, "=");
    return s;
};

const htmlUnescape = (s: string): string => {
    if (!s) return "";
    return s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"');
};

const stripHtmlToText = (htmlSrc: string): string => {
    if (!htmlSrc) return "";
    let txt = qpUnwrapHtml(htmlSrc);
    txt = htmlUnescape(txt);
    txt = txt.replace(/<br\s*\/?>/gi, "\n");
    txt = txt.replace(/<\/p\s*>/gi, "\n\n");
    txt = txt.replace(/<[^>]+>/g, " ");
    txt = txt.replace(/[ \t]+\n/g, "\n");
    txt = txt.replace(/\n{3,}/g, "\n\n");
    txt = txt.replace(/[ \t]{2,}/g, " ");
    return txt.trim();
};

const getHtmlFromGmailPayload = (payload: any): string => {
    if (!payload) return "";

    if (payload.body?.data && !payload.parts) {
        if ((payload.mimeType || '').toLowerCase() === 'text/html') {
            return urlSafeBase64Decode(payload.body.data);
        }
        return "";
    }

    const stack = payload.parts ? [...payload.parts] : [];
    const htmlParts: string[] = [];

    while (stack.length > 0) {
        const part = stack.shift();
        if (!part) continue;

        if (part.parts && part.parts.length) {
            stack.push(...part.parts);
            continue;
        }

        const mt = (part.mimeType || '').toLowerCase();
        const data = part.body?.data;
        if (!data) continue;

        if (mt.startsWith('text/html')) {
            const html = urlSafeBase64Decode(data);
            if (html.trim()) htmlParts.push(html);
        }
    }

    return htmlParts.join('\n');
};

const getPlainTextFromGmailPayload = (payload: any): string => {
    if (!payload) return "";
    if (payload.body?.data && !payload.parts) {
        if (payload.mimeType === 'text/plain') return urlSafeBase64Decode(payload.body.data);
        if (payload.mimeType === 'text/html') {
            return stripHtmlToText(urlSafeBase64Decode(payload.body.data));
        }
        return "";
    }
    let plainText = "";
    const stack = payload.parts ? [...payload.parts] : [];
    while (stack.length > 0) {
        const part = stack.shift();
        if (!part) continue;
        if (part.parts) {
            stack.push(...part.parts);
        } else if (part.mimeType?.toLowerCase() === 'text/plain' && part.body?.data) {
            plainText += urlSafeBase64Decode(part.body.data) + "\n";
        }
    }
    if (plainText.trim()) return plainText.trim();
    const htmlPart = (payload.parts || []).find((p: any) => p.mimeType === 'text/html' && p.body?.data);
    if (htmlPart) {
        const htmlText = urlSafeBase64Decode(htmlPart.body.data);
        return stripHtmlToText(htmlText);
    }
    return "";
};

const createGmailFetcher = (account: Account) => {
    let currentTokenPromise: Promise<string> | null = null;

    const getFreshToken = (isRetry = false): Promise<string> => {
        if (!currentTokenPromise || isRetry) {
            currentTokenPromise = getGoogleAccessToken(account, { forceRefresh: isRetry });
        }
        return currentTokenPromise;
    };

    const authorizedFetch = async (url: string, isRetry: boolean = false): Promise<Response> => {
        try {
            const accessToken = await getFreshToken(isRetry);
            const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });

            if (response.status === 401 && !isRetry) {
                console.warn(`Gmail token may have expired for ${account.email}. Retrying with a fresh token.`);
                return authorizedFetch(url, true);
            }
            if (response.ok || isRetry) {
                currentTokenPromise = null;
            }
            return response;
        } catch (error) {
            currentTokenPromise = null;
            console.error(`Error during authorized fetch for ${account.email}:`, error);
            throw error;
        }
    };
    return authorizedFetch;
}

async function fetchGmailMessages(account: Account, rule: Rule, dateRange: { from: string, to: string }): Promise<Partial<Record>[]> {
    const authorizedFetch = createGmailFetcher(account);

    const records: Partial<Record>[] = [];
    let pageToken: string | undefined = undefined;

    const fromTimestamp = Math.floor(new Date(dateRange.from).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(dateRange.to).getTime() / 1000);
    const query = `${rule.query} after:${fromTimestamp} before:${toTimestamp}`;

    let fetchedCount = 0;
    // --- GIỚI HẠN ĐỘNG ---
    // Nếu là help/case thì giới hạn 100 tin, còn lại 2000
    const LIMIT = (rule.kind === 'help' || rule.kind === 'case') ? 100 : 2000;

    do {
        // Kiểm tra giới hạn trước khi gọi API list
        if (fetchedCount >= LIMIT) {
            console.warn(`Reached fetch limit (${LIMIT}) for rule "${rule.name}".`);
            break;
        }

        const listUrl = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
        listUrl.searchParams.append('q', query);
        listUrl.searchParams.append('maxResults', '100');
        if (pageToken) listUrl.searchParams.append('pageToken', pageToken);

        const listResponse = await authorizedFetch(listUrl.toString());

        if (!listResponse.ok) {
            const errorText = await listResponse.text();
            throw new Error(`Gmail API error (list): Status ${listResponse.status}. Body: ${errorText}`);
        }

        const listData = await listResponse.json();
        const messages = listData.messages || [];
        if (messages.length === 0) break;

        for (const messageHeader of messages) {
            // Kiểm tra giới hạn trong vòng lặp
            if (fetchedCount >= LIMIT) break;

            try {
                const msgUrl =
                    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageHeader.id}` +
                    `?format=full&fields=id,internalDate,snippet,payload(headers,mimeType,parts(mimeType,body(data),parts(*)),body(data))`;

                const msgResponse = await authorizedFetch(msgUrl);
                if (!msgResponse.ok) {
                    console.warn(`Skipping Gmail message ${messageHeader.id} due to API error: ${msgResponse.status}`);
                    continue;
                }
                const msgData = await msgResponse.json();

                // --- QUAN TRỌNG: Tăng biến đếm ngay sau khi lấy được tin nhắn ---
                fetchedCount++;

                const subject =
                    msgData.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '';

                const htmlBody = getHtmlFromGmailPayload(msgData.payload);
                const plainBody = getPlainTextFromGmailPayload(msgData.payload);
                const bodyForParsing = htmlBody || plainBody || '';

                const parsedData = parseMessage(
                    rule,
                    subject,
                    msgData.snippet || '',
                    bodyForParsing
                );

                if (parsedData) {
                    records.push({
                        ...parsedData,
                        email_id: msgData.id,
                        dt_local: new Date(parseInt(msgData.internalDate)).toISOString(),
                    });
                    // KHÔNG tăng fetchedCount ở đây nữa
                }
            } catch (e: any) {
                if (e.message?.includes("Authentication failed")) throw e;
                console.error(`Failed to process Gmail message ${messageHeader.id}:`, e);
            }
        }
        pageToken = listData.nextPageToken;
    } while (pageToken);

    return records;
}

async function fetchOutlookMessages(account: Account, rule: Rule, dateRange: { from: string, to: string }): Promise<Partial<Record>[]> {
    let accessToken: string;
    try {
        accessToken = await getMicrosoftToken(account);
    } catch (tokenError) {
        console.error(`MSAL Token error for ${account.email}:`, tokenError);
        throw tokenError;
    }
    const records: Partial<Record>[] = [];

    const fromISO = new Date(dateRange.from).toISOString();
    const toISO = new Date(dateRange.to).toISOString();

    const subjectQuery = rule.query.match(/subject:"([^"]+)"/i)?.[1] || '';
    if (!subjectQuery && !rule.query.includes('from:')) {
        console.warn(`Rule "${rule.name}" for Outlook has insufficient query filters. Skipping.`);
        return [];
    }
    let filterParts = [`receivedDateTime ge ${fromISO}`, `receivedDateTime lt ${toISO}`];
    if (subjectQuery) filterParts.push(`contains(subject, '${subjectQuery.replace(/'/g, "''")}')`);
    const fromQueryMatch = rule.query.match(/from:([\w@.-]+)/i);
    if (fromQueryMatch?.[1]) filterParts.push(`startsWith(from/emailAddress/address, '${fromQueryMatch[1]}')`);
    const filter = filterParts.join(' and ');

    let url: string | undefined =
        `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$select=id,receivedDateTime,subject,bodyPreview,body,from&$orderby=receivedDateTime desc&$top=100`;

    let fetchedCount = 0;
    // --- GIỚI HẠN ĐỘNG ---
    const LIMIT = (rule.kind === 'help' || rule.kind === 'case') ? 100 : 2000;

    while (url) {
        // Kiểm tra giới hạn trước khi gọi API list
        if (fetchedCount >= LIMIT) {
            console.warn(`Reached fetch limit (${LIMIT}) for rule "${rule.name}" and account ${account.email}.`);
            break;
        }
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (response.status === 401) throw new Error(`Authentication failed for ${account.email}.`);
        if (!response.ok) throw new Error(`MS Graph API error: Status ${response.status}.`);

        const data = await response.json();
        const messages = data.value || [];
        if (messages.length === 0) break;

        for (const message of messages) {
            // Kiểm tra giới hạn trong vòng lặp
            if (fetchedCount >= LIMIT) break;

            // --- QUAN TRỌNG: Tăng biến đếm ngay lập tức ---
            fetchedCount++;

            try {
                const body = message.body?.content || '';
                const parsedData = parseMessage(rule, message.subject || '', message.bodyPreview || '', body);
                if (parsedData) {
                    records.push({
                        ...parsedData,
                        email_id: message.id,
                        dt_local: new Date(message.receivedDateTime).toISOString(),
                    });
                    // KHÔNG tăng fetchedCount ở đây nữa
                }
            } catch (e) {
                console.error(`Failed to process Outlook message ${message.id}`, e);
            }
        }
        url = data['@odata.nextLink'];
    }

    return records;
}

export const checkEmailsExistInRange = async (account: Account, dateRange: { from: string, to: string }): Promise<boolean> => {
    for (const rule of RULES) {
        try {
            if (account.provider === 'gmail') {
                const authorizedFetch = createGmailFetcher(account);
                const fromTimestamp = Math.floor(new Date(dateRange.from).getTime() / 1000);
                const toTimestamp = Math.floor(new Date(dateRange.to).getTime() / 1000);
                const query = `${rule.query} after:${fromTimestamp} before:${toTimestamp}`;

                const listUrl = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
                listUrl.searchParams.append('q', query);
                listUrl.searchParams.append('maxResults', '1'); // Chỉ cần 1 mail là đủ

                const listResponse = await authorizedFetch(listUrl.toString());
                if (listResponse.ok) {
                    const listData = await listResponse.json();
                    if (listData.messages && listData.messages.length > 0) {
                        return true; // Tìm thấy, trả về true ngay
                    }
                }
            } else if (account.provider === 'outlook') {
                const accessToken = await getMicrosoftToken(account);
                const fromISO = new Date(dateRange.from).toISOString();
                const toISO = new Date(dateRange.to).toISOString();

                const subjectQuery = rule.query.match(/subject:"([^"]+)"/i)?.[1] || '';
                if (!subjectQuery && !rule.query.includes('from:')) continue;

                let filterParts = [`receivedDateTime ge ${fromISO}`, `receivedDateTime lt ${toISO}`];
                if (subjectQuery) filterParts.push(`contains(subject, '${subjectQuery.replace(/'/g, "''")}')`);
                const fromQueryMatch = rule.query.match(/from:([\w@.-]+)/i);
                if (fromQueryMatch?.[1]) filterParts.push(`startsWith(from/emailAddress/address, '${fromQueryMatch[1]}')`);

                const filter = filterParts.join(' and ');
                const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`;
                const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                if (response.ok) {
                    const data = await response.json();
                    if (data.value && data.value.length > 0) {
                        return true; // Tìm thấy, trả về true ngay
                    }
                }
            }
        } catch (error) {
            console.error(`Error checking emails for rule "${rule.name}" for ${account.email}:`, error);
        }
    }
    return false;
};

export const setupGmailWatch = async (teamId: string, account: Account): Promise<void> => {
    if (account.provider !== 'gmail') {
        return;
    }
    try {
        const accessToken = await getGoogleAccessToken(account);

        const watchResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                topicName: 'projects/future-snowfall-467017-q2/topics/gmail-push',
                labelIds: ['INBOX'],
                labelFilterAction: 'INCLUDE',
            }),
        });

        if (!watchResponse.ok) {
            const errorData = await watchResponse.json();
            console.error(`Failed to set .watch() for ${account.email}:`, errorData);
        } else {
            const data = await watchResponse.json();
            const historyId = data.historyId;
            if (historyId) {
                await updateAccountsInFirebase(teamId, [{
                    id: account.id,
                    lastKnownHistoryId: historyId
                }]);
            }
        }
    } catch (watchError) {
        console.error(`An exception occurred while setting .watch() for ${account.email}:`, watchError);
    }
};

export const fetchAllRecords = async (
    accounts: Account[],
    setStatus: (status: string) => void,
    overrideDateRange?: { from: string, to: string }
): Promise<Record[]> => {
    setStatus(`Starting sync for ${accounts.length} account(s)...`);

    const accountPromises = accounts.map(async (account) => {
        let syncFromDate: string;
        const syncRunToDate = overrideDateRange?.to || new Date().toISOString();

        if (overrideDateRange) {
            syncFromDate = overrideDateRange.from;
        } else if (account.last_synced_at) {
            syncFromDate = account.last_synced_at;
            setStatus(`[${account.email}] Syncing new data...`);
        } else {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            syncFromDate = sevenDaysAgo.toISOString();
            setStatus(`[${account.email}] New account. Syncing last 7 days...`);
        }

        const accountDateRange = { from: syncFromDate, to: syncRunToDate };

        try {
            const rulePromises = RULES.map(async (rule) => {
                let fetchedRecords: Partial<Record>[] = [];
                if (account.provider === 'gmail') {
                    fetchedRecords = await fetchGmailMessages(account, rule, accountDateRange);
                } else if (account.provider === 'outlook') {
                    fetchedRecords = await fetchOutlookMessages(account, rule, accountDateRange);
                }
                
                // Map records and add source right away
                return fetchedRecords.map(r => ({
                    ...(r as Partial<Record>),
                    account: account.email,
                    source: rule.name,
                    amount: r.amount ?? 0,
                    order_id: r.order_id ?? null,
                    currency: r.currency ?? null,
                    kind: r.kind ?? (rule.kind || 'order'),
                    dt_local: r.dt_local || new Date().toISOString(),
                    email_id: r.email_id ?? undefined,
                } as Record));
            });

            const resultsFromRules = await Promise.all(rulePromises);
            return resultsFromRules.flat();

        } catch (error: any) {
            const errorMsg = error.message || "Unknown error";
            setStatus(`Failed [${account.email}]: ${errorMsg.substring(0, 50)}...`);
            console.error(`Failed to process account ${account.email}:`, error);
            return []; // Return empty array for this failed account
        }
    });

    const allRecordsArrays = await Promise.all(accountPromises);
    const allRecords = allRecordsArrays.flat();
    
    const totalFetched = allRecords.length;

    allRecords.sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());
    setStatus(`Sync process finished. Total: ${totalFetched}.`);
    return allRecords;
};

export const reprocessRecord = async (teamId: string, account: Account, record: Record): Promise<Record | null> => {
    if (!record.email_id) throw new Error("Record has no email_id");

    let body = "";
    let subject = "";
    let snippet = "";
    let internalDate = record.dt_local;

    if (account.provider === 'gmail') {
        const authorizedFetch = createGmailFetcher(account);
        const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${record.email_id}?format=full`;
        const res = await authorizedFetch(msgUrl);
        if (!res.ok) throw new Error(`Gmail API error: ${res.statusText}`);
        const msgData = await res.json();

        subject = msgData.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '';
        snippet = msgData.snippet || '';
        const htmlBody = getHtmlFromGmailPayload(msgData.payload);
        const plainBody = getPlainTextFromGmailPayload(msgData.payload);
        body = htmlBody || plainBody || '';
        if (msgData.internalDate) internalDate = new Date(parseInt(msgData.internalDate)).toISOString();

    } else if (account.provider === 'outlook') {
        const token = await getMicrosoftToken(account);
        const url = `https://graph.microsoft.com/v1.0/me/messages/${record.email_id}?$select=subject,bodyPreview,body,receivedDateTime`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Outlook API error: ${res.statusText}`);
        const msgData = await res.json();

        subject = msgData.subject || '';
        snippet = msgData.bodyPreview || '';
        body = msgData.body?.content || '';

        if (msgData.receivedDateTime) internalDate = new Date(msgData.receivedDateTime).toISOString();
    }

    let parsedData: Partial<Record> | null = null;

    const sourceRule = RULES.find(r => r.name === record.source);
    if (sourceRule) {
        parsedData = parseMessage(sourceRule, subject, snippet, body);
    }

    if (!parsedData) {
        for (const rule of RULES) {
            parsedData = parseMessage(rule, subject, snippet, body);
            if (parsedData) break;
        }
    }

    await deleteRecordsByEmailId(teamId, record.email_id);

    if (parsedData) {
        const newRecordData: Record = {
            ...record,
            ...parsedData,
            dt_local: internalDate,
        };

        newRecordData.email_id = record.email_id;
        delete newRecordData.id;

        const savedRecord = await addRecord(teamId, newRecordData);

        return savedRecord;
    }

    return null;
};