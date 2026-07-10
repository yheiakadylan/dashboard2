/// <reference types="chrome" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, setPersistence, indexedDBLocalPersistence, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, doc, updateDoc, getDocs } from 'firebase/firestore';
import { createEtsyReviewSync, ETSY_REVIEW_ALARM } from './reviews/reviewSync';

const DEFAULT_APP_URL = 'https://dashboardvikcom.vercel.app';
const EXTENSION_API_PATH = '/api/extension-shop-health';
const TASK_ENRICHMENT_API_URL = 'https://vikcomltd.xyz/api/tasks/update-with-reuse';
const INVALID_SKU_VALUES = new Set(['']);
const STALE_PROCESSING_JOB_MS = 5 * 60 * 1000;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// FIX: Service Worker must use indexedDBLocalPersistence because 'window' is not available
setPersistence(auth, indexedDBLocalPersistence).catch(err => {
    console.error("Persistence failed in Background:", err);
});


let isProcessing = false;
let processedCount = 0;
let rateLimitUntil = 0;
let isEtsyLoggedOut = false;

// Queue mechanism (runs in memory, flushed only if SW entirely sleeps when idle)
const localQueue: any[] = [];

const etsyReviewSync = createEtsyReviewSync({
    db,
    ensureAuth,
    sleep,
    markEtsyLoggedOut: () => { isEtsyLoggedOut = true; },
    setRateLimitUntil: (timestamp: number) => { rateLimitUntil = timestamp; }
});
let isReviewSyncProcessing = false;

interface ExtractedItem {
    sku: string;
    title: string;
    quantity: number;
    variations: { name: string; value: string }[] | string;
    transaction_id?: string;
    customerFiles?: string[];
    listingId?: string;
}

interface FetchSKUResult {
    extractedItems: ExtractedItem[] | string;
    customerFiles: string[];
    shippingPhone?: string;
}

interface TaskSyncPayload {
    taskId: string;
    sku: string;
    variant1?: string;
    variant2?: string;
    customerFiles: string[];
    listingId?: string;
    transactionId?: string;
}


chrome.runtime.onInstalled.addListener(() => {
    maintainOffscreen();
    etsyReviewSync.scheduleNextEtsyReviewCron().catch((err: any) => console.error('[Reviews] Failed to schedule on install:', err));
});

chrome.runtime.onStartup.addListener(() => {
    maintainOffscreen();
    etsyReviewSync.scheduleNextEtsyReviewCron().catch((err: any) => console.error('[Reviews] Failed to schedule on startup:', err));
    // Vớt lại job pending sau khi SW thức dậy (localQueue bị xóa khi Chrome terminate)
    scanPendingJobs();
});

// Alarm every 30s: keep offscreen alive, scan for missed jobs, send heartbeat
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name === 'keepAlive') {
        maintainOffscreen();
        scanPendingJobs();
        reportHeartbeat();
    } else if (alarm.name === ETSY_REVIEW_ALARM) {
        startReviewTask('cron', () => etsyReviewSync.runEtsyReviewCronJob());
    }
});

async function reportHeartbeat() {
    try {
        const { teamId, account, etsy_review_sync_status } = (await chrome.storage.local.get(['teamId', 'account', 'etsy_review_sync_status'])) as { teamId?: string; account?: string; etsy_review_sync_status?: any };
        if (!teamId || !account) return;

        const isAuthenticated = await ensureAuth();
        if (!isAuthenticated) return;

        const normalizedEmail = account.trim().toLowerCase();

        const accountsRef = collection(db, 'user', teamId, 'accounts');
        const q = query(accountsRef, where('email', '==', normalizedEmail));
        const snap = await getDocs(q);

        if (!snap.empty) {
            const accDoc = snap.docs[0];
            const status = isEtsyLoggedOut ? 'error' : (isProcessing ? 'processing' : 'idle');

            await updateDoc(doc(db, 'user', teamId, 'accounts', accDoc.id), {
                'worker_status': {
                    status,
                    last_heartbeat: new Date().toISOString(),
                    last_error: isEtsyLoggedOut ? 'Etsy Session Expired' : '',
                    pending_count: localQueue.length,
                    version: chrome.runtime.getManifest().version,
                    review_status: etsy_review_sync_status || null
                }
            });
        } else {
            console.warn(`[Heartbeat] No account found for ${normalizedEmail}`);
        }
    } catch (err) {
        console.error("[Heartbeat] Error:", err);
    }
}



async function setupOffscreenDocument(path: string) {
    if ('offscreen' in chrome && 'getContexts' in chrome.runtime) {
        const existingContexts = await (chrome.runtime as any).getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL(path)]
        });

        if (existingContexts.length > 0) return;

        try {
            await chrome.offscreen.createDocument({
                url: path,
                reasons: [chrome.offscreen.Reason.DOM_PARSER],
                justification: 'Keep Firebase websocket open to receive real-time updates'
            });
        } catch (err) {
            console.error("Failed to create offscreen document", err);
        }
    }
}

let creating: Promise<void> | null = null;
async function maintainOffscreen() {
    if (creating) {
        await creating;
    } else {
        const path = 'offscreen.html';
        const existingContexts = await (chrome.runtime as any).getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL(path)]
        });

        if (existingContexts.length > 0) return;

        creating = setupOffscreenDocument(path);
        await creating;
        creating = null;

        // Pass credentials only once after creation
        chrome.storage.local.get(['teamId', 'account', 'dbEmail', 'dbPassword'], (data) => {
            if (data.teamId && data.account && data.dbEmail && data.dbPassword) {
                chrome.runtime.sendMessage({
                    type: "START_FIREBASE",
                    config: data
                }).catch(() => {});
            }
        });
    }
}


// Watch for credentials change and update offscreen doc
chrome.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }, namespace: string) => {
    if (namespace === 'local' && (changes.teamId || changes.account || changes.dbEmail || changes.dbPassword)) {
        chrome.storage.local.get(['teamId', 'account', 'dbEmail', 'dbPassword'], (data) => {
            if (data.teamId && data.account && data.dbEmail && data.dbPassword) {
                chrome.runtime.sendMessage({
                    type: "START_FIREBASE",
                    config: data
                }).catch(() => {});
            }
        });
    }

    if (namespace === 'local' && (changes.etsy_review_sync_hours || changes.review_sync_hours || changes.etsyReviewCronHours)) {
        etsyReviewSync.scheduleNextEtsyReviewCron().catch((err: any) => console.error('[Reviews] Failed to reschedule after setting change:', err));
    }
});

async function ensureAuth(): Promise<boolean> {
    // 1. Check if already logged in
    if (auth.currentUser) return true;

    // 2. Wait a bit for SDK to restore session from IndexedDB if it just started
    await new Promise(resolve => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
        setTimeout(resolve, 2000); // Max wait 2s for auto-restore
    });
    if (auth.currentUser) return true;

    // 3. Only if no session, attempt password login
    const { dbEmail, dbPassword } = (await chrome.storage.local.get(['dbEmail', 'dbPassword'])) as { [key: string]: string };
    if (dbEmail && dbPassword) {
        try {
            await signInWithEmailAndPassword(auth, dbEmail, dbPassword);
            return true;
        } catch (err) {
            console.error("Firebase Auth Error in Background:", err);
            return false;
        }
    }
    return false;
}


// Quét lại toàn bộ job pending từ Firestore khi SW thức dậy
// Giải quyết vấn đề localQueue bị xóa sạch trong RAM khi Service Worker bị Chrome terminate
async function scanPendingJobs(): Promise<void> {
    chrome.storage.local.get(['teamId', 'account'], async (rawData) => {
        const data = rawData as { teamId?: string; account?: string };
        if (!data.teamId || !data.account) return;

        const isAuthenticated = await ensureAuth();
        if (!isAuthenticated) return;

        try {
            const jobsRef = collection(db, 'user', data.teamId, 'sku_jobs');
            const q = query(
                jobsRef,
                where('account', '==', data.account),
                where('status', '==', 'pending')
            );
            const processingQuery = query(
                jobsRef,
                where('account', '==', data.account),
                where('status', '==', 'processing')
            );
            const [snap, processingSnap] = await Promise.all([getDocs(q), getDocs(processingQuery)]);
            const staleBefore = Date.now() - STALE_PROCESSING_JOB_MS;
            const docsToQueue = [
                ...snap.docs,
                ...processingSnap.docs.filter(docSnap => {
                    const updatedAt = Date.parse(String(docSnap.data()?.updated_at || ''));
                    return !Number.isFinite(updatedAt) || updatedAt < staleBefore;
                })
            ];

            let addedCount = 0;
            docsToQueue.forEach(docSnap => {
                const job = { id: docSnap.id, ...docSnap.data() };
                // Kiểm tra trùng lặp để không push 2 lần
                const isExists = localQueue.some(j => j.id === job.id);
                if (!isExists) {
                    localQueue.push(job);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                console.log(`[Worker] Resumed ${addedCount} pending job(s) from Firestore.`);
                processQueue(data.teamId as string);
            }
        } catch (err) {
            console.error('[Worker] scanPendingJobs failed:', err);
        }
    });
}

// Receive pushing tasks from the offscreen document
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "NEW_SKU_JOB") {
        const isExists = localQueue.some(j => j.id === msg.job.id);
        if (!isExists) {
            localQueue.push(msg.job);
        }

        processQueue(msg.teamId);
        sendResponse({ success: true });
        return;
    }

    if (msg.type === 'REMOTE_WORKER_COMMAND') {
        processRemoteWorkerCommand(String(msg.teamId || ''), msg.command)
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: String(error?.message || error) }));
        return true;
    }

    if (msg.type === 'APPLY_REVIEW_CRON_HOURS') {
        applyReviewCronHours(msg.hours)
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: String(error?.message || error) }));
        return true;
    }

    if (msg.type === 'BACKFILL_ETSY_REVIEWS') {
        etsyReviewSync.backFillEtsyReviews(String(msg.shopId || ''), msg.shopName ? String(msg.shopName) : undefined, msg.minDate ? String(msg.minDate) : undefined)
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: String(error?.message || error) }));
        return true;
    }

    if (msg.type === 'CRAWL_RECENT_REVIEWS_25') {
        const started = startReviewTask('recent_25', () => etsyReviewSync.crawlRecent25Reviews());
        sendResponse(started
            ? { success: true, started: true }
            : { success: false, error: 'Review worker is already running.' });
        return true;
    }

    if (msg.type === 'RUN_ETSY_REVIEW_SYNC') {
        const started = startReviewTask('cron', () => etsyReviewSync.runEtsyReviewCronJob());
        sendResponse(started
            ? { success: true, started: true }
            : { success: false, error: 'Review worker is already running.' });
        return true;
    }

    if (msg.type === 'SCHEDULE_ETSY_REVIEW_CRON') {
        etsyReviewSync.scheduleNextEtsyReviewCron()
            .then((nextRunAt: any) => sendResponse({ success: true, nextRunAt }))
            .catch((error: any) => sendResponse({ success: false, error: String(error?.message || error) }));
        return true;
    }
});

async function processRemoteWorkerCommand(teamId: string, command: any): Promise<{ started?: boolean; skipped?: boolean }> {
    if (!teamId || !command?.id) throw new Error('Missing remote worker command id.');

    const isAuthenticated = await ensureAuth();
    if (!isAuthenticated) throw new Error('Cannot authenticate Firebase for remote command.');

    const claimedCommand = await claimRemoteCommandViaApi(teamId, String(command.id), 'reviews');

    if (!claimedCommand) return { skipped: true };

    executeRemoteReviewCommand(teamId, String(claimedCommand.id || command.id), claimedCommand)
        .catch(error => console.error('[Reviews] Remote command failed:', error));

    return { started: true };
}

async function executeRemoteReviewCommand(teamId: string, commandId: string, command: any): Promise<void> {
    try {
        const payload = command.payload || {};
        let result: any = null;

        if (command.command === 'crawl_recent_reviews') {
            const shops = normalizeReviewShops(payload.shops);
            if (Array.isArray(payload.shops)) {
                await chrome.storage.local.set({ etsy_review_shops: shops });
            }
            result = await runReviewTask(() => etsyReviewSync.crawlRecent25Reviews());
        } else if (command.command === 'set_review_cron_hours') {
            result = await applyReviewCronHours(payload.hours);
        } else if (command.command === 'run_review_sync') {
            result = await runReviewTask(() => etsyReviewSync.runEtsyReviewCronJob());
        } else {
            throw new Error(`Unsupported review command: ${command.command || 'unknown'}`);
        }

        await completeRemoteCommandViaApi(teamId, commandId, 'success', result || null);
    } catch (error: any) {
        await completeRemoteCommandViaApi(teamId, commandId, 'error', null, String(error?.message || error));
        throw error;
    }
}

async function getExtensionApiUrl(): Promise<string> {
    const storage = await chrome.storage.local.get(['appUrl']);
    return String(storage.appUrl || DEFAULT_APP_URL).replace(/\/$/, '') + EXTENSION_API_PATH;
}

async function callExtensionApi(body: Record<string, any>): Promise<any> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Missing Firebase auth token for extension API.');

    const response = await fetch(await getExtensionApiUrl(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Extension API failed with HTTP ${response.status}`);
    }
    return data;
}

async function claimRemoteCommandViaApi(teamId: string, commandId: string, target: 'reviews' | 'health'): Promise<any | null> {
    const data = await callExtensionApi({
        action: 'claim-command',
        teamId,
        target,
        commandId
    });
    return data?.command || null;
}

async function completeRemoteCommandViaApi(teamId: string, commandId: string, status: 'success' | 'error', result?: any, error?: string): Promise<void> {
    await callExtensionApi({
        action: 'complete-command',
        teamId,
        commandId,
        status,
        result: result || null,
        error: error || null
    });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ETSY_SHOP_ID = 2147483647;

function isValidEtsyReviewShopId(value: unknown): boolean {
    const text = String(value || '').trim();
    if (!/^\d+$/.test(text)) return false;

    const numericValue = Number(text);
    return Number.isSafeInteger(numericValue) && numericValue > 0 && numericValue <= MAX_ETSY_SHOP_ID;
}

function pickReviewShopName(shop: any): string {
    const preferred = [
        shop?.label,
        shop?.etsyShopName,
        shop?.etsy_shop_name,
        shop?.name,
        shop?.shopLabel,
        shop?.displayName,
        shop?.shopName
    ].map(value => String(value || '').trim()).filter(Boolean);
    return preferred.find(value => !EMAIL_PATTERN.test(value))
        || preferred[0]
        || String(shop?.email || shop?.shopId || '').trim();
}

function normalizeReviewShops(rawShops: any): Array<{ shopId: string; shopName: string; label?: string | null; email?: string | null; name?: string | null; etsyShopName?: string | null }> {
    if (!Array.isArray(rawShops)) return [];
    return rawShops
        .map((shop: any) => {
            const shopId = [shop?.shopId, shop?.etsy_shop_id, shop?.etsyShopId]
                .map(value => String(value || '').trim())
                .find(isValidEtsyReviewShopId) || '';
            return {
                shopId,
                shopName: pickReviewShopName(shop),
                label: shop?.label || null,
                email: shop?.email || null,
                name: shop?.name || null,
                etsyShopName: shop?.etsyShopName || shop?.etsy_shop_name || null
            };
        })
        .filter(shop => shop.shopName);
}
function normalizeReviewCronHours(rawHours: any): number[] {
    if (!Array.isArray(rawHours)) return [];
    return Array.from(new Set(rawHours
        .map(hour => Number(hour))
        .filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23)))
        .sort((a, b) => a - b);
}

async function applyReviewCronHours(rawHours: any): Promise<{ hours: number[]; nextRunAt: string }> {
    const hours = normalizeReviewCronHours(rawHours);
    if (hours.length === 0) throw new Error('Invalid review cron hours.');

    await chrome.storage.local.set({ etsy_review_sync_hours: hours });
    const nextRunAt = await etsyReviewSync.scheduleNextEtsyReviewCron();
    return { hours, nextRunAt };
}

function runReviewTask(task: () => Promise<any>): Promise<any> {
    if (isReviewSyncProcessing) {
        return Promise.reject(new Error('Review worker is already running.'));
    }

    isReviewSyncProcessing = true;
    return task().finally(() => {
        isReviewSyncProcessing = false;
    });
}

function startReviewTask(action: string, task: () => Promise<any>): boolean {
    if (isReviewSyncProcessing) {
        console.warn(`[Reviews] Skip ${action}: another review task is already running.`);
        return false;
    }

    runReviewTask(task)
        .catch((err: any) => console.error(`[Reviews] ${action} task failed:`, err))

    return true;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeSkuValue(value: unknown): string {
    const normalized = String(value || '').trim();
    return INVALID_SKU_VALUES.has(normalized.toUpperCase()) ? '' : normalized;
}

function normalizeCustomerFiles(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(file => String(file || '').trim()).filter(Boolean)
        : [];
}

interface TaskVariantFields {
    variant1: string;
    variant2: string;
}

function isPersonalizationVariation(name: unknown): boolean {
    return /^(personalization|personalisation|personnalisation|wunschtext|personalizzazioni|personalizaci[oó]n|personaliza[cç][aã]o|personalisatie|peronalizacja|personaliz[aá]cia|personaliseer|personalized|personalised)$/i
        .test(String(name || '').trim());
}

function taskVariantsFromRecordItem(item: Record<string, any>): TaskVariantFields {
    return {
        variant1: String(item.variant1 ?? item.variant ?? ''),
        variant2: String(item.variant2 ?? '')
    };
}

function taskVariantsFromExtractedItem(item: Partial<ExtractedItem> | undefined): TaskVariantFields {
    if (!item) return { variant1: '', variant2: '' };

    if (Array.isArray(item.variations)) {
        const variants = item.variations
            .filter((variation: any) => !isPersonalizationVariation(variation?.name))
            .map((variation: any) => {
                if (!variation || typeof variation !== 'object') {
                    return String(variation || '').trim();
                }

                const name = String(variation.name || '').trim();
                const value = String(variation.value || '').trim();
                if (name && value) return `${name}: ${value}`;
                return value || name;
            })
            .filter(Boolean);

        return {
            variant1: variants[0] || '',
            variant2: variants[1] || ''
        };
    }

    if (typeof item.variations === 'string') {
        return {
            variant1: item.variations.trim(),
            variant2: ''
        };
    }

    return { variant1: '', variant2: '' };
}

function matchExtractedItem(
    extractedItems: ExtractedItem[],
    recordItem: Record<string, any> | undefined,
    index: number
): ExtractedItem | undefined {
    const recordTransactionId = String(recordItem?.transactionId || '').trim();
    if (recordTransactionId) {
        const transactionMatch = extractedItems.find(item =>
            String(item.transaction_id || '').trim() === recordTransactionId
        );
        if (transactionMatch) return transactionMatch;
    }

    return extractedItems[index];
}

function buildTaskSyncPayloads(
    orderId: string,
    extractedItems: ExtractedItem[],
    recordItems: any[],
    skuString: string,
    globalCustomerFiles: string[]
): TaskSyncPayload[] {
    const itemCount = recordItems.length > 0
        ? recordItems.length
        : Math.max(extractedItems.length, normalizeSkuValue(skuString) ? 1 : 0);
    if (itemCount === 0) return [];

    const payloads: TaskSyncPayload[] = [];

    for (let index = 0; index < itemCount; index++) {
        const sourceRecordItem = recordItems[index];
        const extractedItem = matchExtractedItem(extractedItems, sourceRecordItem, index);
        const recordItem = sourceRecordItem || {};
        const hasRecordItem = recordItems[index] !== undefined;
        const taskId = itemCount > 1 ? `${orderId}-${index + 1}` : orderId;
        const fallbackOrderSku = itemCount === 1 ? skuString : '';
        const sku = normalizeSkuValue(extractedItem?.sku)
            || normalizeSkuValue(recordItem.sku)
            || normalizeSkuValue(fallbackOrderSku);

        if (!sku) continue;

        const extractedFiles = normalizeCustomerFiles(extractedItem?.customerFiles);
        const recordFiles = normalizeCustomerFiles(recordItem.customerFiles);
        const taskVariants = hasRecordItem
            ? taskVariantsFromRecordItem(recordItem)
            : taskVariantsFromExtractedItem(extractedItem);
        const listingId = String(extractedItem?.listingId || recordItem.listingId || '').trim();
        const transactionId = String(extractedItem?.transaction_id || recordItem.transactionId || '').trim();

        payloads.push({
            taskId,
            sku,
            variant1: taskVariants.variant1,
            variant2: taskVariants.variant2,
            customerFiles: extractedFiles.length > 0 ? extractedFiles : (globalCustomerFiles.length > 0 ? globalCustomerFiles : recordFiles),
            listingId: listingId || undefined,
            transactionId: transactionId || undefined
        });
    }

    return payloads;
}

async function syncTaskViaCentralApi(payload: TaskSyncPayload): Promise<void> {
    const response = await fetch(TASK_ENRICHMENT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Enrichment API returned ${response.status} for task ${payload.taskId}${body ? `: ${body.slice(0, 300)}` : ''}`);
    }
}

async function processQueue(teamId: string) {
    if (isProcessing) return;

    if (isEtsyLoggedOut) {
        console.warn("[Worker] Queue paused: Etsy is logged out.");
        return;
    }

    if (Date.now() < rateLimitUntil) {
        const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000 / 60);
        console.warn(`[Worker] Queue paused: rate limited. Resuming in ~${remaining} min.`);
        return;
    }

    if (localQueue.length === 0) return;

    isProcessing = true;

    const isAuthenticated = await ensureAuth();
    if (!isAuthenticated) {
        console.error("[Worker] Cannot authenticate to Firebase. Pausing queue for 15s.");
        isProcessing = false;
        setTimeout(() => processQueue(teamId), 15_000);
        return;
    }

    while (localQueue.length > 0) {
        if (Date.now() < rateLimitUntil) break;
        if (isEtsyLoggedOut) break;

        // Priority: process priority=true jobs first
        let jobIndex = localQueue.findIndex(j => j.priority === true);
        if (jobIndex === -1) jobIndex = 0;

        const job = localQueue.splice(jobIndex, 1)[0];
        console.log(`[Worker] Processing job: ${job.order_id}`);

        try {
            const jobRef = doc(db, 'user', teamId, 'sku_jobs', job.id);
            await updateDoc(jobRef, { status: 'processing', updated_at: new Date().toISOString() });

            const skuResult = await fetchSKU(job.order_id);

            if (skuResult === "NULL_AUTH_REQUIRED") {
                isEtsyLoggedOut = true;
                await updateDoc(jobRef, { status: 'failed', error: 'Etsy Account Logged Out', sku: '', updated_at: new Date().toISOString() });
                reportHeartbeat();
                continue;
            }

            if (skuResult === "NULL_RATE_LIMIT") {
                await updateDoc(jobRef, { status: 'failed', error: '429 Rate Limit', sku: '', updated_at: new Date().toISOString() });
                localQueue.push(job); // Re-queue để thử lại
                reportHeartbeat();
                continue;
            }

            if (skuResult === "NULL_FETCH_FAILED") {
                await updateDoc(jobRef, { status: 'failed', error: 'Could not fetch Etsy order or parse SKU data. Please retry after checking the extension/Etsy session.', sku: '', updated_at: new Date().toISOString() });
                reportHeartbeat();
                continue;
            }

            const isObj = typeof skuResult === 'object' && skuResult !== null && !Array.isArray(skuResult);
            const resultObj = isObj ? (skuResult as FetchSKUResult) : null;
            const extractedItemsArray: ExtractedItem[] | string = resultObj ? resultObj.extractedItems : (skuResult as ExtractedItem[] | string);
            const extractedItems = Array.isArray(extractedItemsArray) ? extractedItemsArray : [];
            const globalCustomerFiles = resultObj ? normalizeCustomerFiles(resultObj.customerFiles) : [];
            const shippingPhone = resultObj?.shippingPhone ? String(resultObj.shippingPhone).trim() : '';
            const skuString = Array.isArray(extractedItemsArray)
                ? extractedItemsArray.map(i => normalizeSkuValue(i.sku)).filter(Boolean).join(', ')
                : normalizeSkuValue(extractedItemsArray);

            const recordsRef = collection(db, 'user', teamId, 'records');
            const qRecords = query(recordsRef, where('order_id', '==', job.order_id), where('source', '==', 'Etsy_Sales'));
            const snap = await getDocs(qRecords);
            const primaryRecord = snap.docs.find(recordDoc => Array.isArray(recordDoc.data()?.details?.items));
            const recordItems = primaryRecord ? (primaryRecord.data().details.items || []) : [];

            if (skuResult !== "NULL") {
                for (const recordDoc of snap.docs) {
                    const data = recordDoc.data();
                    if (data.details && Array.isArray(data.details.items)) {
                        const newItems = data.details.items.map((item: any, idx: number) => {
                            const extItem = extractedItems[idx];
                            if (extItem) {
                                const fetchedSku = String(extItem.sku || '').trim();
                                return {
                                    ...item,
                                    sku: fetchedSku || normalizeSkuValue(item.sku),
                                    ...(extItem.customerFiles && extItem.customerFiles.length > 0 ? { customerFiles: normalizeCustomerFiles(extItem.customerFiles) } : {}),
                                    ...(extItem.listingId ? { listingId: extItem.listingId } : {}),
                                    ...(extItem.transaction_id ? { transactionId: extItem.transaction_id } : {})
                                };
                            }
                            return {
                                ...item,
                                sku: normalizeSkuValue(item.sku) || skuString,
                                ...(globalCustomerFiles.length > 0 ? { customerFiles: globalCustomerFiles } : {})
                            };
                        });
                        const recordUpdate: any = { 'details.items': newItems };
                        if (shippingPhone && data.details?.shippingAddress) {
                            recordUpdate['details.shippingAddress.phone'] = shippingPhone;
                        }
                        await updateDoc(doc(db, 'user', teamId, 'records', recordDoc.id), recordUpdate);
                    }
                }
            }

            const taskPayloads = buildTaskSyncPayloads(
                String(job.order_id),
                extractedItems,
                recordItems,
                skuString,
                globalCustomerFiles
            );

            for (const payload of taskPayloads) {
                await syncTaskViaCentralApi(payload);
            }

            await updateDoc(jobRef, {
                status: 'completed',
                sku: skuString || 'NULL',
                ...(skuString ? {} : { error: 'SKU not found' }),
                updated_at: new Date().toISOString()
            });

        } catch (error) {
            console.error('[Worker] Job error:', error);
            try {
                const jobRef = doc(db, 'user', teamId, 'sku_jobs', job.id);
                await updateDoc(jobRef, { status: 'failed', error: String(error), sku: '', updated_at: new Date().toISOString() });
            } catch (_) {
                // Permission or network error, nothing we can do
            }
        }

        processedCount++;

        // Anti-bot: randomised delay between jobs
        let randomDelay = Math.floor(Math.random() * 5000) + 3000; // 3-8s normally

        if (localQueue.length > 15) {
            // Surge protection: slow down when queue is very large
            randomDelay = Math.floor(Math.random() * 10000) + 15000; // 15-25s
        } else if (processedCount > 0 && processedCount % 5 === 0) {
            // Macro break every 5 jobs
            randomDelay = Math.floor(Math.random() * 15000) + 15000; // 15-30s
        }

        await sleep(randomDelay);
    }

    isProcessing = false;
}

async function fetchSKU(orderId: string): Promise<FetchSKUResult | string> {
    let extractedItems: ExtractedItem[] | string = "NULL";
    let shopId = "";
    let csrfToken = "";
    let shippingPhone = "";
    let fetchFailureReason = "";

    // 1. Fetch Etsy sold orders page to get SKU JSON, shop_id, and csrf_token
    try {
        const searchResponse = await fetch(`https://www.etsy.com/your/orders/sold?search_query=${orderId}`, {
            headers: {
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        if (searchResponse.status === 200) {
            const searchHtml = await searchResponse.text();
            if (searchHtml.includes('class="sign-in-button-wrapper"') || searchHtml.includes('id="sign-in"')) {
                isEtsyLoggedOut = true;
                return "NULL_AUTH_REQUIRED";
            }

            const shopIdMatch = searchHtml.match(/"shop_id"\s*:\s*"?(\d+)"?/);
            if (shopIdMatch) shopId = shopIdMatch[1];

            const csrfMatch = searchHtml.match(/<meta name="csrf_nonce" content="([^"]+)"/);
            if (csrfMatch) csrfToken = csrfMatch[1];

            const contextPrefix = 'Etsy.Context=';
            const startIndex = searchHtml.indexOf(contextPrefix);
            if (startIndex > -1) {
                const jsonStart = startIndex + contextPrefix.length;
                let jsonEnd = searchHtml.indexOf(';</script>', jsonStart);
                if (jsonEnd === -1) jsonEnd = searchHtml.indexOf('</script>', jsonStart);
                if (jsonEnd > -1) {
                    let jsonStr = searchHtml.substring(jsonStart, jsonEnd).trim();
                    if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1);
                    const data = JSON.parse(jsonStr);
                    const orders = data?.data?.initial_data?.orders?.orders_search?.orders || [];
                    const items: ExtractedItem[] = [];

                    if (!shopId && data?.data?.initial_data?.shop_id) {
                        shopId = String(data.data.initial_data.shop_id);
                    }

                    if (orders.length > 0) {
                        const currentOrder = orders.find((o: any) => String(o.order_id) === String(orderId)) || orders[0];

                        if (!shopId && currentOrder.shop_id) {
                            shopId = String(currentOrder.shop_id);
                        }

                        shippingPhone = extractShippingPhone(currentOrder);

                        const transactions = currentOrder.transactions || [];
                        for (const tx of transactions) {
                            items.push({
                                sku: tx.product?.product_identifier || "NULL",
                                title: tx.product?.title || "",
                                quantity: tx.quantity || 1,
                                transaction_id: tx.transaction_id ? String(tx.transaction_id) : undefined,
                                variations: (tx.variations || []).map((v: any) => ({
                                    name: v.property || '',
                                    value: v.value || ''
                                }))
                            });
                        }
                    }
                    if (items.length > 0) extractedItems = items;
                    else fetchFailureReason = `No transactions found for order ${orderId}.`;
                }
            }
        } else if (searchResponse.status === 429) {
            rateLimitUntil = Date.now() + 15 * 60 * 1000; // 15 min cooldown
            return "NULL_RATE_LIMIT";
        } else {
            fetchFailureReason = `Etsy sold orders page returned ${searchResponse.status}.`;
        }
    } catch (e) {
        console.error("[Worker] fetchSKU HTML fetch error:", e);
        fetchFailureReason = e instanceof Error ? e.message : String(e || 'Unknown fetch error');
    }

    if (!Array.isArray(extractedItems)) {
        console.warn(`[Worker] SKU fetch failed for order ${orderId}: ${fetchFailureReason || 'Order data was not found in Etsy response.'}`);
        return "NULL_FETCH_FAILED";
    }

    // 2. Fetch Personalization Files via API v3
    let customerFiles: string[] = [];
    if (shopId && csrfToken) {
        try {
            const apiRes = await fetch(`https://www.etsy.com/api/v3/ajax/shop/${shopId}/mission-control/orders/personalization-files/${orderId}`, {
                headers: {
                    'x-csrf-token': csrfToken,
                    'x-requested-with': 'XMLHttpRequest',
                    'Accept': 'application/json'
                }
            });

            if (apiRes.ok) {
                const filesData = await apiRes.json();
                const itemFiles: Record<string, string[]> = {};
                const globalUrls = new Set<string>();

                if (Array.isArray(filesData)) {
                    filesData.forEach(f => {
                        if (f.url) {
                            const url = f.url.replace(/_\d+x\d+\./, '_fullxfull.');
                            globalUrls.add(url);

                            if (f.transaction_id) {
                                const txId = String(f.transaction_id);
                                if (!itemFiles[txId]) itemFiles[txId] = [];
                                itemFiles[txId].push(url);
                            }
                        }
                    });

                    customerFiles = Array.from(globalUrls);

                    // Map files to specific transaction items
                    if (Array.isArray(extractedItems)) {
                        extractedItems.forEach(item => {
                            if (item.transaction_id && itemFiles[item.transaction_id]) {
                                item.customerFiles = itemFiles[item.transaction_id];
                            }
                        });
                    }
                }
            } else {
                console.warn(`[Worker] Personalization files API: ${apiRes.status}`);
            }
        } catch (apiErr) {
            console.error("[Worker] Personalization files fetch error:", apiErr);
        }

        // 3. Fetch Listing IDs via API v3
        try {
            const ordersApiUrl = `https://www.etsy.com/api/v3/ajax/bespoke/shop/${shopId}/mission-control/orders/data?limit=50&offset=0&search_terms=${orderId}`;
            const ordersRes = await fetch(ordersApiUrl, {
                headers: {
                    'x-csrf-token': csrfToken,
                    'x-requested-with': 'XMLHttpRequest',
                    'Accept': 'application/json'
                }
            });

            if (ordersRes.ok) {
                const ordersData = await ordersRes.json();
                const listingIdMap: Record<string, string> = {};
                const ordersList = ordersData?.orders_search?.orders;

                if (Array.isArray(ordersList)) {
                    ordersList.forEach((o: any) => {
                        if (Array.isArray(o.transactions)) {
                            o.transactions.forEach((tx: any) => {
                                if (tx.transaction_id && tx.listing_id) {
                                    listingIdMap[String(tx.transaction_id)] = String(tx.listing_id);
                                }
                            });
                        }
                    });
                } else {
                    console.warn('[Worker] ListingID: orders_search.orders missing in API response.');
                }

                // Map listing IDs to transaction items
                if (Array.isArray(extractedItems)) {
                    extractedItems.forEach(item => {
                        if (item.transaction_id && listingIdMap[item.transaction_id]) {
                            item.listingId = listingIdMap[item.transaction_id];
                        }
                    });
                }
            } else {
                console.warn(`[Worker] ListingID API: ${ordersRes.status}`);
            }
        } catch (apiErr) {
            console.error("[Worker] ListingID fetch error:", apiErr);
        }
    } else {
        console.warn(`[Worker] Missing shopId or csrfToken for order ${orderId}, skipping API v3.`);
    }

    return {
        extractedItems,
        customerFiles,
        ...(shippingPhone ? { shippingPhone } : {})
    };
}

function extractShippingPhone(order: any): string {
    const candidates = [
        order?.fulfillment?.to_address?.phone,
        order?.fulfillment?.verified_address?.suggested_address?.phone,
        order?.to_address?.phone,
        order?.shipping_address?.phone,
        order?.shippingAddress?.phone,
        order?.buyer?.phone,
    ];

    for (const value of candidates) {
        const phone = normalizePhone(value);
        if (phone) return phone;
    }

    return "";
}

function normalizePhone(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') return "";
    const phone = String(value).trim();
    if (!phone) return "";
    return phone;
}
