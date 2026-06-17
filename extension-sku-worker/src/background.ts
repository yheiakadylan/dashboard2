/// <reference types="chrome" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, setPersistence, indexedDBLocalPersistence, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, doc, updateDoc, getDocs } from 'firebase/firestore';

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

interface ExtractedItem {
    sku: string;
    title: string;
    quantity: number;
    variations: { name: string; value: string }[] | string;
    transaction_id?: string;
    customerFiles?: string[];
}

interface FetchSKUResult {
    extractedItems: ExtractedItem[] | string;
    customerFiles: string[];
}

chrome.runtime.onInstalled.addListener(() => {
    console.log("Etsy SKU Worker installed.");
    maintainOffscreen();
});

chrome.runtime.onStartup.addListener(() => {
    maintainOffscreen();
    scanPendingJobs(); // FIX Bug#2: vẫt lại job pending sau khi SW thức dậy
});

// Alarm just to re-verify offscreen doc exists if SW wakes up for any reason
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name === 'keepAlive') {
        maintainOffscreen();
        scanPendingJobs();
        // Heartbeat để báo cáo trạng thái lên Dashboard
        reportHeartbeat();
    }
});

async function reportHeartbeat() {
    try {
        const { teamId, account } = (await chrome.storage.local.get(['teamId', 'account'])) as { teamId?: string; account?: string };
        if (!teamId || !account) {
            console.log("[Heartbeat] Missing teamId or account in storage.");
            return;
        }

        const isAuthenticated = await ensureAuth();
        if (!isAuthenticated) {
            console.log("[Heartbeat] Auth failed.");
            return;
        }

        const normalizedEmail = account.trim().toLowerCase();
        
        // Tìm accountId tương ứng với account email
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
                    version: chrome.runtime.getManifest().version
                }
            });
            console.log(`[Heartbeat] Success for ${normalizedEmail} (Status: ${status})`);
        } else {
            console.warn(`[Heartbeat] No account found in Firestore for email: ${normalizedEmail} in team: ${teamId}`);
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
            console.log("Offscreen document created successfully.");
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
            console.log("Background: Session missing, authenticating with password...");
            await signInWithEmailAndPassword(auth, dbEmail, dbPassword);
            return true;
        } catch (err) {
            console.error("Firebase Auth Error in Background:", err);
            return false;
        }
    }
    return false;
}


// FIX Bug#2: Quét lại toàn bộ job pending từ Firestore khi SW thức dậy
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
                // FIX Bug#1: Kiểm tra trùng lặp để không push 2 lần
                const isExists = localQueue.some(j => j.id === job.id);
                if (!isExists) {
                    localQueue.push(job);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                console.log(`[scanPendingJobs] Found ${addedCount} pending job(s) from Firestore. Resuming queue.`);
                processQueue(data.teamId as string);
            }
        } catch (err) {
            console.error('[scanPendingJobs] Failed to fetch pending jobs:', err);
        }
    });
}

// Receive pushing tasks from the offscreen document
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "NEW_SKU_JOB") {
        console.log("Background received new job from Offscreen:", msg.job);
        
        // FIX Bug#1: Kiểm tra trùng lặp dựa trên job.id trước khi push vào queue
        const isExists = localQueue.some(j => j.id === msg.job.id);
        if (!isExists) {
            localQueue.push(msg.job);
        } else {
            console.log(`[Dedup] Job ${msg.job.id} already in queue. Skipping.`);
        }
        
        processQueue(msg.teamId);
        sendResponse({ success: true });
    }
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function processQueue(teamId: string) {
    if (isProcessing) return;
    
    // Check Etsy session logout lock
    if (isEtsyLoggedOut) {
        console.log("Queue paused: Etsy is logged out. Please log in and restart extension.");
        return;
    }

    // Check rate limit lock
    if (Date.now() < rateLimitUntil) {
        const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000 / 60);
        console.log(`Queue paused due to rate limiting. Resuming in ~${remaining} minutes.`);
        return;
    }

    if (localQueue.length === 0) return;

    isProcessing = true;

    // QUAN TRỌNG: Kiểm tra Auth, nếu false thì tạm dừng queue
    const isAuthenticated = await ensureAuth();
    if (!isAuthenticated) {
        console.log("Background: Cannot authenticate to Firebase. Pausing queue for 15s.");
        isProcessing = false;
        // Tự động thử lại sau 15 giây
        setTimeout(() => processQueue(teamId), 15_000);
        return;
    }

    while (localQueue.length > 0) {
        // Enforce rate limit Check before each processing run
        if (Date.now() < rateLimitUntil) {
            console.log("Hit rate limit. Breaking processing loop.");
            break;
        }

        if (isEtsyLoggedOut) {
            console.log("Etsy Auth expired while processing. Breaking loop.");
            break;
        }

        // Priority Logic
        let jobIndex = localQueue.findIndex(j => j.priority === true);
        if (jobIndex === -1) jobIndex = 0;
        
        const job = localQueue.splice(jobIndex, 1)[0];
        console.log('Processing job:', job);

        try {
            const jobRef = doc(db, 'user', teamId, 'sku_jobs', job.id);
            await updateDoc(jobRef, { status: 'processing', updated_at: new Date().toISOString() });

            const skuResult = await fetchSKU(job.order_id);
            console.log(`Order ${job.order_id} fetched SKUs:`, skuResult);

            if (skuResult === "NULL_AUTH_REQUIRED") {
                isEtsyLoggedOut = true;
                await updateDoc(jobRef, { status: 'failed', error: 'Etsy Account Logged Out', sku: 'NULL', updated_at: new Date().toISOString() });
                reportHeartbeat(); // Update status ngay lập tức
                continue;
            }

            if (skuResult === "NULL_RATE_LIMIT") {
                await updateDoc(jobRef, { status: 'failed', error: '429 Rate Limit (Cloudflare / Etsy)', sku: 'NULL', updated_at: new Date().toISOString() });
                localQueue.push(job);
                reportHeartbeat();
                continue;
            }


            // Central API for Enrichment & Auto-Reuse
            // Note: VIKCOM_API_URL should be configured in extension settings or point to your Vercel deployment
            const enrichmentApiUrl = 'https://vikcomltd.vercel.app/api/tasks/update-with-reuse';

            // Sync successfully fetched SKU 
            if (skuResult !== "NULL") {
                try {
                    const isObj = typeof skuResult === 'object' && skuResult !== null && !Array.isArray(skuResult);
                    const resultObj = isObj ? (skuResult as FetchSKUResult) : null;
                    const extractedItemsArray: ExtractedItem[] | string = resultObj ? resultObj.extractedItems : (skuResult as ExtractedItem[] | string);
                    const globalCustomerFiles: string[] = resultObj ? (resultObj.customerFiles || []) : [];

                    const skuString = Array.isArray(extractedItemsArray) ? extractedItemsArray.map(i => i.sku).join(', ') : String(extractedItemsArray);
                    
                    // 1. Update internal records for Dashboardvikcom (Marketing/Ads data)
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
                                        ...(extItem.customerFiles && extItem.customerFiles.length > 0 ? { customerFiles: extItem.customerFiles } : {})
                                    };
                                }
                                return { ...item, sku: skuString, ...(globalCustomerFiles.length > 0 ? { customerFiles: globalCustomerFiles } : {}) };
                            });
                            await updateDoc(doc(db, 'user', teamId, 'records', recordDoc.id), {
                                'details.items': newItems
                            });
                        }
                    }

                    // --- [STAGE 2 SYNC] Enrich tasks in vikcomltd via Central API ---
                    console.log(`[Stage 2 Sync] Enriching tasks via API for orderId: ${job.order_id}`);
                    const tasksRef = collection(db, 'tasks');
                    const qTasks = query(tasksRef, where('orderId', '==', job.order_id));
                    const taskSnap = await getDocs(qTasks);
                    const tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

                    if (tasks.length > 0) {
                        const extractedItems = Array.isArray(extractedItemsArray) ? extractedItemsArray : [];
                        
                        for (const task of tasks) {
                            // Filter: Only enrich 'new' or 'draft' tasks
                            if (task.status !== 'draft' && task.status !== 'new') continue;

                            let taskSku = skuString;
                            let taskCustomerFiles: string[] = []; // Default empty array to prevent undefined error
                            let v1 = task.variant1;
                            let v2 = task.variant2;

                            if (extractedItems.length > 1) {
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
                                    if (bestMatch.customerFiles && bestMatch.customerFiles.length > 0) {
                                        taskCustomerFiles = bestMatch.customerFiles;
                                    }
                                }
                            } else if (extractedItems.length === 1) {
                                taskSku = extractedItems[0].sku;
                                if (extractedItems[0].customerFiles && extractedItems[0].customerFiles.length > 0) {
                                    taskCustomerFiles = extractedItems[0].customerFiles;
                                } else if (globalCustomerFiles && globalCustomerFiles.length > 0) {
                                    taskCustomerFiles = globalCustomerFiles;
                                }
                            }

                            // ALWAYS update customerFiles directly to Firestore tasks first
                            if (taskCustomerFiles && taskCustomerFiles.length > 0) {
                                try {
                                    await updateDoc(doc(db, 'tasks', task.id), {
                                        customerFiles: taskCustomerFiles
                                    });
                                } catch (e) {
                                    console.error(`Failed to update customerFiles for task ${task.id}`, e);
                                }
                            }

                            // CALL CENTRAL ENRICHMENT API
                            try {
                                const apiRes = await fetch(enrichmentApiUrl, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        taskId: task.id,
                                        sku: taskSku,
                                        variant1: v1,
                                        variant2: v2,
                                        customerFiles: taskCustomerFiles
                                    })
                                });
                                const apiData = await apiRes.json();
                                console.log(`[API Enrichment] Task ${task.id} result:`, apiData);
                            } catch (apiErr) {
                                console.error(`[API Enrichment Error] Failed for task ${task.id}:`, apiErr);
                                // Fallback to direct Firestore update if API fails (without auto-reuse)
                                await updateDoc(doc(db, 'tasks', task.id), {
                                    sku: taskSku,
                                    updatedAt: new Date().toISOString()
                                });
                            }
                        }
                    }
                    
                    await updateDoc(jobRef, { status: 'completed', sku: skuString, updated_at: new Date().toISOString() });
                } catch (innerErr) {
                    console.error("Inner processing error:", innerErr);
                }
            } else {
                await updateDoc(jobRef, { status: 'completed', sku: 'NULL', updated_at: new Date().toISOString() });
            }

        } catch (error) {
            console.error('Job error:', error);
            try {
                const jobRef = doc(db, 'user', teamId, 'sku_jobs', job.id);
                await updateDoc(jobRef, { status: 'failed', error: String(error), sku: 'NULL', updated_at: new Date().toISOString() });
            } catch (authError) {
                // If the error was caused by permissions issue, etc
            }
        }

        processedCount++;
        
        // Anti-bot Smart Delay
        let randomDelay = Math.floor(Math.random() * 5000) + 3000; // 3s - 8s normally
        
        // SURGE PROTECTION: Nếu queue quá dài (>15), tăng delay lên gấp đôi để bớt "gắt"
        if (localQueue.length > 15) {
            randomDelay = Math.floor(Math.random() * 10000) + 15000; // 15s - 25s
            console.log(`[Surge Protection] Large queue (${localQueue.length}). Slowing down: ${randomDelay}ms`);
        }

        // Micro-batching pause
        if (processedCount > 0 && processedCount % 5 === 0) {
            randomDelay = Math.floor(Math.random() * 15000) + 30000; // 30s - 45s macro break
            console.log(`[Anti-Bot] Processed 5 jobs. Taking a macro break for ${randomDelay}ms...`);
        } else {
            console.log(`Waiting ${randomDelay}ms before next job...`);
        }
        
        await sleep(randomDelay);
    }


    isProcessing = false;
}

async function fetchSKU(orderId: string): Promise<FetchSKUResult | string> {
    let extractedItems: ExtractedItem[] | string = "NULL";
    let shopId = "";
    let csrfToken = "";
    
    // 1. Fetch search_query hiddenly to get SKU JSON, shop_id, and csrf_token
    try {
        const searchResponse = await fetch(`https://www.etsy.com/your/orders/sold/new?search_query=${orderId}`, {
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
            
            // Extract shopId and csrfToken for API v3
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
                    
                    // Fallback for shop_id if regex fails
                    if (!shopId && data?.data?.initial_data?.shop_id) {
                        shopId = String(data.data.initial_data.shop_id);
                    }

                    if (orders.length > 0) {
                        const currentOrder = orders.find((o: any) => String(o.order_id) === String(orderId)) || orders[0];
                        
                        // Another fallback for shop_id
                        if (!shopId && currentOrder.shop_id) {
                            shopId = String(currentOrder.shop_id);
                        }

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
        }
    } catch (e) {
        console.error("SKU Fetch Error", e);
    }

    console.log(`%c[Debug API v3] orderId: ${orderId} | shop_id: "${shopId}" | csrf_token: "${csrfToken ? csrfToken.substring(0, 6) + '***' : 'MISSING'}"`, "color: #bada55; font-size: 14px; font-weight: bold;");

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
                            let url = f.url;
                            // Ensure high res url
                            url = url.replace(/_\d+x\d+\./, '_fullxfull.');
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
                console.log(`[API v3] orderId=${orderId} -> found ${customerFiles.length} global files`);
            } else {
                console.warn(`[API v3] Failed with status ${apiRes.status}`);
            }
        } catch (apiErr) {
            console.error("[API v3] Fetch error:", apiErr);
        }
    } else {
        console.warn(`[API v3] Missing shopId (${shopId}) or csrfToken (${csrfToken}), skipping API fetch.`);
    }

    return {
        extractedItems,
        customerFiles
    };
}
