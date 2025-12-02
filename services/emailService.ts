
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
        // đổi từ url-safe sang base64 chuẩn
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }

        // nếu là browser → dùng atob
        if (typeof window !== 'undefined' && typeof window.atob === 'function') {
            const binary = window.atob(base64);
            // chuyển binary -> utf8
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const decoder = new TextDecoder('utf-8');
            return decoder.decode(bytes);
        }

        // nếu là node
        // @ts-ignore
        if (typeof Buffer !== 'undefined') {
            // @ts-ignore
            return Buffer.from(base64, 'base64').toString('utf-8');
        }

        // fallback rất cũ
        return base64;
    } catch (e) {
        console.error("Base64 decode failed:", e, "Input:", str);
        return "";
    }
};


/**
 * Unwrap kiểu quoted-printable đơn giản giống Python
 */
const qpSoftBreak = /=\r?\n/g;
const qpUnwrapHtml = (s: string): string => {
    if (!s) return "";
    s = s.replace(qpSoftBreak, "");
    s = s.replace(/=3D/g, "=");
    return s;
};

/**
 * Unescape HTML đơn giản (Node)
 */
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

/**
 * Strip HTML -> text giống bản Python
 */
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

/**
 * LẤY HTML GỐC từ Gmail payload (giống _extract_html_from_payload bên Python)
 */
const getHtmlFromGmailPayload = (payload: any): string => {
    if (!payload) return "";

    // mail không multipart
    if (payload.body?.data && !payload.parts) {
        if ((payload.mimeType || '').toLowerCase() === 'text/html') {
            return urlSafeBase64Decode(payload.body.data);
        }
        return "";
    }

    // multipart/*
    const stack = payload.parts ? [...payload.parts] : [];
    const htmlParts: string[] = [];

    while (stack.length > 0) {
        const part = stack.shift();
        if (!part) continue;

        if (part.parts && part.parts.length) {
            // multipart con
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

/**
 * LẤY PLAIN TEXT (cũ) — vẫn giữ để fallback
 */
const getPlainTextFromGmailPayload = (payload: any): string => {
    if (!payload) return "";
    if (payload.body?.data && !payload.parts) {
        if (payload.mimeType === 'text/plain') return urlSafeBase64Decode(payload.body.data);
        if (payload.mimeType === 'text/html') {
            // bản cũ: convert html -> text
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
    // fallback HTML
    const htmlPart = (payload.parts || []).find((p: any) => p.mimeType === 'text/html' && p.body?.data);
    if (htmlPart) {
        const htmlText = urlSafeBase64Decode(htmlPart.body.data);
        return stripHtmlToText(htmlText);
    }
    return "";
};

// Hàm helper để tạo authorized fetcher cho Gmail
const createGmailFetcher = (account: Account) => {
    // This promise helps prevent race conditions where multiple API calls
    // might try to fetch a new token simultaneously.
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
                // The next call will be a retry, forcing a new token fetch from the backend.
                return authorizedFetch(url, true);
            }
            // If the request succeeds or is a failed retry, clear the promise
            // so the next non-retry request doesn't use a potentially stale token.
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
    const MAX_MESSAGES_TO_FETCH_PER_RULE = 500;

    do {
        if (fetchedCount >= MAX_MESSAGES_TO_FETCH_PER_RULE) {
            console.warn(`Reached fetch limit (${MAX_MESSAGES_TO_FETCH_PER_RULE}) for rule "${rule.name}".`);
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
            if (fetchedCount >= MAX_MESSAGES_TO_FETCH_PER_RULE) break;
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
                    fetchedCount++;
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
        `https://graph.microsoft.com/v1.0/me/messages?$filter=${filter}&$select=id,receivedDateTime,subject,bodyPreview,body,from&$orderby=receivedDateTime desc&$top=100`;

    let fetchedCount = 0;
    const MAX_MESSAGES_TO_FETCH_PER_RULE = 500;

    while (url) {
        if (fetchedCount >= MAX_MESSAGES_TO_FETCH_PER_RULE) {
            console.warn(`Reached fetch limit for rule "${rule.name}" and account ${account.email}.`);
            break;
        }
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (response.status === 401) throw new Error(`Authentication failed for ${account.email}.`);
        if (!response.ok) throw new Error(`MS Graph API error: Status ${response.status}.`);

        const data = await response.json();
        const messages = data.value || [];
        if (messages.length === 0) break;

        for (const message of messages) {
            if (fetchedCount >= MAX_MESSAGES_TO_FETCH_PER_RULE) break;
            try {
                // IMPORTANT: Use raw content (HTML) if available, otherwise fallback.
                // Do NOT strip HTML here, as parsing rules might rely on HTML tags (e.g. Etsy).
                const body = message.body?.content || '';
                
                const parsedData = parseMessage(rule, message.subject || '', message.bodyPreview || '', body);
                if (parsedData) {
                    records.push({
                        ...parsedData,
                        email_id: message.id,
                        dt_local: new Date(message.receivedDateTime).toISOString(),
                    });
                    fetchedCount++;
                }
            } catch (e) {
                console.error(`Failed to process Outlook message ${message.id}`, e);
            }
        }
        url = data['@odata.nextLink'];
    }

    return records;
}

// UPDATE: Hàm mới để kiểm tra sự tồn tại của email một cách nhanh chóng.
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
                const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=${filter}&$select=id&$top=1`;
                
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
    return false; // Không tìm thấy email nào khớp với bất kỳ rule nào
};

/**
 * Sets up the Gmail webhook (watch) for a single account.
 * This should be called once on app load and once when a new account is added.
 */
// FIX: Added teamId parameter to correctly call updateAccountsInFirebase which requires it.
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
                 // Save historyId to DB for webhook to use as a starting point
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
    let allRecords: Record[] = [];
    setStatus(`Starting sync for ${accounts.length} account(s)...`);

    const results = await Promise.allSettled(accounts.map(async (account) => {
        let accountRecords: Record[] = [];

        let syncFromDate: string;
        const syncRunToDate = overrideDateRange?.to || new Date().toISOString();

        if (overrideDateRange) {
            syncFromDate = overrideDateRange.from;
        } else if (account.last_synced_at) {
            syncFromDate = account.last_synced_at;
            setStatus(`[${account.email}] Syncing new data since ${new Date(syncFromDate).toLocaleString()}...`);
        } else {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            syncFromDate = sevenDaysAgo.toISOString();
            setStatus(`[${account.email}] New account. Syncing last 7 days...`);
        }

        const accountDateRange = { from: syncFromDate, to: syncRunToDate };

        for (const rule of RULES) {
            try {
                setStatus(`[${account.email}] Applying rule: ${rule.name}...`);
                let fetchedRecords: Partial<Record>[] = [];
                if (account.provider === 'gmail') {
                    fetchedRecords = await fetchGmailMessages(account, rule, accountDateRange);
                } else if (account.provider === 'outlook') {
                    fetchedRecords = await fetchOutlookMessages(account, rule, accountDateRange);
                }
                const completeRecords = fetchedRecords.map(r => ({
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
                accountRecords.push(...completeRecords);
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error: any) {
                const errorMsg = error.message || "Unknown error";
                setStatus(`ERROR on rule "${rule.name}" for ${account.email}: ${errorMsg.substring(0, 100)}...`);
                if (errorMsg.includes("Authentication failed")) {
                    throw new Error(`Authentication failed for ${account.email}. Please re-authenticate.`);
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        return accountRecords;
    }));

    let totalFetched = 0;
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            allRecords.push(...result.value);
            totalFetched += result.value.length;
        } else {
            const accountEmail = accounts[index]?.email || 'unknown account';
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
            setStatus(`Failed to process account ${accountEmail}: ${reason}`);
            console.error(`Failed to process account ${accountEmail}:`, result.reason);
        }
    });

    allRecords.sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());
    setStatus(`Sync process finished. Total valid records fetched: ${totalFetched}.`);
    return allRecords;
};

// --- New Function: Resync a single record ---
export const reprocessRecord = async (teamId: string, account: Account, record: Record): Promise<Record | null> => {
    if (!record.email_id) throw new Error("Record has no email_id");

    let body = "";
    let subject = "";
    let snippet = "";
    let internalDate = record.dt_local; // Fallback

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
        // internalDate is ms string
        if (msgData.internalDate) internalDate = new Date(parseInt(msgData.internalDate)).toISOString();

    } else if (account.provider === 'outlook') {
        const token = await getMicrosoftToken(account);
        const url = `https://graph.microsoft.com/v1.0/me/messages/${record.email_id}?$select=subject,bodyPreview,body,receivedDateTime`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Outlook API error: ${res.statusText}`);
        const msgData = await res.json();
        
        subject = msgData.subject || '';
        snippet = msgData.bodyPreview || '';
        // For re-processing, we prefer raw body to support rules like Etsy that parse HTML structure
        body = msgData.body?.content || '';
        
        if (msgData.receivedDateTime) internalDate = new Date(msgData.receivedDateTime).toISOString();
    }

    // Re-parse
    let parsedData: Partial<Record> | null = null;
    
    // Try specific rule first if known
    const sourceRule = RULES.find(r => r.name === record.source);
    if (sourceRule) {
        parsedData = parseMessage(sourceRule, subject, snippet, body);
    }
    
    // If not found or failed, try all rules
    if (!parsedData) {
        for (const rule of RULES) {
            parsedData = parseMessage(rule, subject, snippet, body);
            if (parsedData) break;
        }
    }

    // WIPE & REPLACE LOGIC
    // 1. Luôn xóa TẤT CẢ record có cùng email_id (để dọn sạch rác/duplicate do lỗi cũ)
    await deleteRecordsByEmailId(teamId, record.email_id);

    // 2. Nếu parse thành công, tạo lại 1 record chuẩn
    if (parsedData) {
        const newRecordData: Record = {
            ...record,
            ...parsedData,
            dt_local: internalDate, // Update timestamp just in case
        };
        
        // Ensure email_id is preserved, id is removed to allow generation of new one
        newRecordData.email_id = record.email_id;
        delete newRecordData.id;

        // Add as new record
        const savedRecord = await addRecord(teamId, newRecordData);
        
        return savedRecord;
    }

    // 3. Nếu parse thất bại (null), nghĩa là email này không còn hợp lệ (do rule chặt chẽ hơn).
    // Ta đã xóa nó ở bước 1, nên chỉ cần trả về null.
    return null;
};
