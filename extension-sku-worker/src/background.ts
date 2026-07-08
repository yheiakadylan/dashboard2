/// <reference types="chrome" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, setPersistence, indexedDBLocalPersistence, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, doc, updateDoc, deleteDoc, getDocs, runTransaction } from 'firebase/firestore';
import { createEtsyReviewSync, ETSY_REVIEW_ALARM } from './reviews/reviewSync';

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
            const snap = await getDocs(q);

            let addedCount = 0;
            snap.docs.forEach(docSnap => {
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

    const commandRef = doc(db, 'user', teamId, 'worker_commands', String(command.id));
    const storage = await chrome.storage.local.get(['account']);
    const workerAccount = String(storage.account || '');

    const claimedCommand = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(commandRef);
        if (!snap.exists()) return null;

        const data = snap.data() as any;
        if (data.status !== 'pending' || data.target !== 'reviews') return null;

        transaction.update(commandRef, {
            status: 'running',
            claimed_at: new Date().toISOString(),
            claimed_by: workerAccount || 'sku-worker',
            updated_at: new Date().toISOString()
        });

        return data;
    });

    if (!claimedCommand) return { skipped: true };

    executeRemoteReviewCommand(teamId, String(command.id), claimedCommand)
        .catch(error => console.error('[Reviews] Remote command failed:', error));

    return { started: true };
}

async function executeRemoteReviewCommand(teamId: string, commandId: string, command: any): Promise<void> {
    const commandRef = doc(db, 'user', teamId, 'worker_commands', commandId);

    try {
        const payload = command.payload || {};
        let result: any = null;

        if (command.command === 'crawl_recent_reviews') {
            const shops = normalizeReviewShops(payload.shops);
            if (shops.length > 0) {
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

        await updateDoc(commandRef, {
            status: 'success',
            result: result || null,
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    } catch (error: any) {
        await updateDoc(commandRef, {
            status: 'error',
            error: String(error?.message || error),
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
        throw error;
    }
}

function normalizeReviewShops(rawShops: any): Array<{ shopId: string; shopName: string }> {
    if (!Array.isArray(rawShops)) return [];
    return rawShops
        .map((shop: any) => ({
            shopId: String(shop?.shopId || shop?.etsy_shop_id || shop?.id || '').trim(),
            shopName: String(shop?.shopName || shop?.label || shop?.name || shop?.email || shop?.shopId || '').trim()
        }))
        .filter(shop => shop.shopId && shop.shopName);
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
                await updateDoc(jobRef, { status: 'failed', error: 'Etsy Account Logged Out', sku: 'NULL', updated_at: new Date().toISOString() });
                reportHeartbeat();
                continue;
            }

            if (skuResult === "NULL_RATE_LIMIT") {
                await updateDoc(jobRef, { status: 'failed', error: '429 Rate Limit', sku: 'NULL', updated_at: new Date().toISOString() });
                localQueue.push(job); // Re-queue để thử lại
                reportHeartbeat();
                continue;
            }

            // Central API for Enrichment & Auto-Reuse
            const enrichmentApiUrl = 'https://vikcomltd.vercel.app/api/tasks/update-with-reuse';

            if (skuResult !== "NULL") {
                try {
                    const isObj = typeof skuResult === 'object' && skuResult !== null && !Array.isArray(skuResult);
                    const resultObj = isObj ? (skuResult as FetchSKUResult) : null;
                    const extractedItemsArray: ExtractedItem[] | string = resultObj ? resultObj.extractedItems : (skuResult as ExtractedItem[] | string);
                    const globalCustomerFiles: string[] = resultObj ? (resultObj.customerFiles || []) : [];
                    const shippingPhone = resultObj?.shippingPhone ? String(resultObj.shippingPhone).trim() : '';

                    const skuString = Array.isArray(extractedItemsArray) ? extractedItemsArray.map(i => i.sku).join(', ') : String(extractedItemsArray);

                    // 1. Update internal records (Marketing/Ads data)
                    const recordsRef = collection(db, 'user', teamId, 'records');
                    const qRecords = query(recordsRef, where('order_id', '==', job.order_id), where('source', '==', 'Etsy_Sales'));
                    const snap = await getDocs(qRecords);

                    for (const recordDoc of snap.docs) {
                        const data = recordDoc.data();
                        if (data.details && data.details.items) {
                            const newItems = data.details.items.map((item: any, idx: number) => {
                                if (Array.isArray(extractedItemsArray) && extractedItemsArray[idx]) {
                                    const extItem = extractedItemsArray[idx];
                                    return {
                                        ...item,
                                        sku: extItem.sku,
                                        ...(extItem.customerFiles && extItem.customerFiles.length > 0 ? { customerFiles: extItem.customerFiles } : {}),
                                        ...(extItem.listingId ? { listingId: extItem.listingId } : {})
                                    };
                                }
                                return { ...item, sku: skuString, ...(globalCustomerFiles.length > 0 ? { customerFiles: globalCustomerFiles } : {}) };
                            });
                            const recordUpdate: any = { 'details.items': newItems };
                            if (shippingPhone && data.details?.shippingAddress) {
                                recordUpdate['details.shippingAddress.phone'] = shippingPhone;
                            }
                            await updateDoc(doc(db, 'user', teamId, 'records', recordDoc.id), recordUpdate);
                        }
                    }

                    // 2. Enrich tasks via Central API
                    const tasksRef = collection(db, 'tasks');
                    const qTasks = query(tasksRef, where('orderId', '==', job.order_id));
                    const taskSnap = await getDocs(qTasks);
                    const tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

                    if (tasks.length > 0) {
                        const extractedItems = Array.isArray(extractedItemsArray) ? extractedItemsArray : [];

                        for (const task of tasks) {
                            // Only enrich draft/new tasks
                            if (task.status !== 'draft' && task.status !== 'new') continue;

                            let taskSku = skuString;
                            let taskCustomerFiles: string[] = [];
                            let taskListingId = "";
                            let matchedTransactionId = "";
                            const v1 = task.variant1;
                            const v2 = task.variant2;
                            let matchedItem: ExtractedItem | null = null;

                            const existingTaskTransactionId = task.transactionId ? String(task.transactionId) : "";
                            if (existingTaskTransactionId) {
                                matchedItem = extractedItems.find(ext => String(ext.transaction_id || "") === existingTaskTransactionId) || null;
                            }

                            if (!matchedItem && extractedItems.length > 0) {
                                const taskId = String(task.id || "");
                                const orderIdText = String(job.order_id);
                                if (taskId === orderIdText) {
                                    matchedItem = extractedItems[0] || null;
                                } else if (taskId.startsWith(`${orderIdText}-`)) {
                                    const itemNumber = Number(taskId.slice(orderIdText.length + 1));
                                    if (Number.isInteger(itemNumber) && itemNumber > 0) {
                                        matchedItem = extractedItems[itemNumber - 1] || null;
                                    }
                                }
                            }

                            if (matchedItem) {
                                taskSku = matchedItem.sku;
                                if (matchedItem.customerFiles && matchedItem.customerFiles.length > 0) taskCustomerFiles = matchedItem.customerFiles;
                                if (matchedItem.listingId) taskListingId = String(matchedItem.listingId);
                                if (matchedItem.transaction_id) matchedTransactionId = String(matchedItem.transaction_id);
                            } else if (extractedItems.length > 1) {
                                // Fuzzy match: score by title prefix + variant overlap
                                let maxScore = -1;
                                let bestMatch: ExtractedItem | null = null;
                                for (const ext of extractedItems) {
                                    let score = 0;
                                    if (task.title && ext.title && ext.title.toLowerCase().includes(task.title.toLowerCase().substring(0, 10))) score += 10;
                                    const taskVars = [(task.variant1 || "").toLowerCase(), (task.variant2 || "").toLowerCase()].filter(Boolean);
                                    if (Array.isArray(ext.variations)) {
                                        const extVars = ext.variations.map((v: { value?: string }) => (v.value || "").toLowerCase()).filter(Boolean);
                                        const matches = taskVars.filter((tv: string) => extVars.some((ev: string) => ev.includes(tv) || tv.includes(ev)));
                                        score += matches.length * 50;
                                    }
                                    if (score > maxScore) {
                                        maxScore = score;
                                        bestMatch = ext;
                                    }
                                }
                                if (bestMatch) {
                                    taskSku = bestMatch.sku;
                                    if (bestMatch.customerFiles && bestMatch.customerFiles.length > 0) taskCustomerFiles = bestMatch.customerFiles;
                                    if (bestMatch.listingId) taskListingId = String(bestMatch.listingId);
                                    if (bestMatch.transaction_id) matchedTransactionId = String(bestMatch.transaction_id);
                                }
                            } else if (extractedItems.length === 1) {
                                taskSku = extractedItems[0].sku;
                                if (extractedItems[0].customerFiles && extractedItems[0].customerFiles.length > 0) {
                                    taskCustomerFiles = extractedItems[0].customerFiles;
                                } else if (globalCustomerFiles && globalCustomerFiles.length > 0) {
                                    taskCustomerFiles = globalCustomerFiles;
                                }
                                if (extractedItems[0].listingId) taskListingId = String(extractedItems[0].listingId);
                                if (extractedItems[0].transaction_id) matchedTransactionId = String(extractedItems[0].transaction_id);
                            }

                            // Write customerFiles & listingId directly to Firestore first
                            const updateData: any = {};
                            if (taskCustomerFiles && taskCustomerFiles.length > 0) updateData.customerFiles = taskCustomerFiles;
                            if (taskListingId) updateData.listingId = taskListingId;
                            if (matchedTransactionId) updateData.transactionId = matchedTransactionId;
                            if (shippingPhone) updateData['shippingAddress.phone'] = shippingPhone;

                            if (Object.keys(updateData).length > 0) {
                                try {
                                    await updateDoc(doc(db, 'tasks', task.id), updateData);
                                } catch (e) {
                                    console.error(`[Worker] Failed to update task ${task.id}:`, e);
                                }
                            }

                            // Call Central Enrichment API (handles SKU + auto-reuse)
                            try {
                                const apiRes = await fetch(enrichmentApiUrl, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        taskId: task.id,
                                        sku: taskSku,
                                        variant1: v1,
                                        variant2: v2,
                                        customerFiles: taskCustomerFiles,
                                        listingId: taskListingId,
                                        transactionId: matchedTransactionId
                                    })
                                });
                                if (!apiRes.ok) {
                                    console.warn(`[Worker] Enrichment API returned ${apiRes.status} for task ${task.id}`);
                                }
                            } catch (apiErr) {
                                console.error(`[Worker] Enrichment API failed for task ${task.id}:`, apiErr);
                                // Fallback: direct Firestore update without auto-reuse
                                await updateDoc(doc(db, 'tasks', task.id), {
                                    sku: taskSku,
                                    ...(taskListingId ? { listingId: taskListingId } : {}),
                                    ...(matchedTransactionId ? { transactionId: matchedTransactionId } : {}),
                                    ...(taskCustomerFiles.length > 0 ? { customerFiles: taskCustomerFiles } : {}),
                                    ...(shippingPhone ? { 'shippingAddress.phone': shippingPhone } : {}),
                                    updatedAt: new Date().toISOString()
                                });
                            }
                        }
                    }

                    await deleteDoc(jobRef); 
                } catch (innerErr) {
                    console.error("[Worker] Inner processing error:", innerErr);
                }
            } else {
                await deleteDoc(jobRef); // SKU NULL nhưng đã xử lý xong, xóa luôn
            }

        } catch (error) {
            console.error('[Worker] Job error:', error);
            try {
                const jobRef = doc(db, 'user', teamId, 'sku_jobs', job.id);
                await updateDoc(jobRef, { status: 'failed', error: String(error), sku: 'NULL', updated_at: new Date().toISOString() });
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
                }
            }
        } else if (searchResponse.status === 429) {
            rateLimitUntil = Date.now() + 15 * 60 * 1000; // 15 min cooldown
            return "NULL_RATE_LIMIT";
        }
    } catch (e) {
        console.error("[Worker] fetchSKU HTML fetch error:", e);
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
