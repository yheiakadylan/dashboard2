/// <reference types="chrome" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
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

let isProcessing = false;
let processedCount = 0;
let rateLimitUntil = 0;
let isEtsyLoggedOut = false;

// Queue mechanism (runs in memory, flushed only if SW entirely sleeps when idle)
const localQueue: any[] = [];

chrome.runtime.onInstalled.addListener(() => {
    console.log("Etsy SKU Worker installed.");
    maintainOffscreen();
});

chrome.runtime.onStartup.addListener(() => {
    maintainOffscreen();
});

// Alarm just to re-verify offscreen doc exists if SW wakes up for any reason
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name === 'keepAlive') {
        maintainOffscreen();
        // If queue has items and we're not processing, try to resume
        if (localQueue.length > 0 && !isProcessing) {
            chrome.storage.local.get('teamId', (data) => {
                if (data.teamId) processQueue(data.teamId as string);
            });
        }
    }
});

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
        creating = setupOffscreenDocument('offscreen.html');
        await creating;
        creating = null;
        
        // Pass credentials to offscreen doc after creation
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

async function ensureAuth() {
    if (auth.currentUser) return;
    const { dbEmail, dbPassword } = (await chrome.storage.local.get(['dbEmail', 'dbPassword'])) as { [key: string]: string };
    if (dbEmail && dbPassword) {
        try {
            await signInWithEmailAndPassword(auth, dbEmail, dbPassword);
        } catch (err) {
            console.error("Firebase Auth Error in Background:", err);
        }
    }
}

// Receive pushing tasks from the offscreen document
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "NEW_SKU_JOB") {
        console.log("Background received new job from Offscreen:", msg.job);
        localQueue.push(msg.job);
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
    await ensureAuth();

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

            const sku = await fetchSKU(job.order_id);
            console.log(`Order ${job.order_id} fetched SKU: ${sku}`);

            if (sku === "NULL_AUTH_REQUIRED") {
                await updateDoc(jobRef, { status: 'failed', error: 'Etsy Account Logged Out', sku: 'NULL', updated_at: new Date().toISOString() });
                // We break out naturally because isEtsyLoggedOut is now true
                continue;
            }

            if (sku === "NULL_RATE_LIMIT") {
                await updateDoc(jobRef, { status: 'failed', error: '429 Rate Limit (Cloudflare / Etsy)', sku: 'NULL', updated_at: new Date().toISOString() });
                // Return item to back of the queue to retry later
                localQueue.push(job);
                continue;
            }

            // Sync successfully fetched SKU 
            if (sku !== "NULL") {
                try {
                    const recordsRef = collection(db, 'user', teamId, 'records');
                    const qRecords = query(recordsRef, where('order_id', '==', job.order_id), where('source', '==', 'Etsy_Sales'));
                    const snap = await getDocs(qRecords);
                    
                    for (const recordDoc of snap.docs) {
                        const data = recordDoc.data();
                        if (data.details && data.details.items) {
                            const newItems = data.details.items.map((item: any) => ({ ...item, sku }));
                            await updateDoc(doc(db, 'user', teamId, 'records', recordDoc.id), {
                                'details.items': newItems
                            });
                        }
                    }
                } catch (err) {
                    console.error("Failed to update record with SKU:", err);
                }
            }

            // Return result
            await updateDoc(jobRef, { status: 'completed', sku, updated_at: new Date().toISOString() });

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
        
        // Micro-batching pause
        if (processedCount % 5 === 0) {
            randomDelay = Math.floor(Math.random() * 10000) + 20000; // 20s - 30s long break
            console.log(`[Anti-Bot] Processed 5 jobs. Taking a macro break for ${randomDelay}ms...`);
        } else {
            console.log(`Waiting ${randomDelay}ms before next job...`);
        }
        
        await sleep(randomDelay);
    }

    isProcessing = false;
}

async function fetchSKU(orderId: string): Promise<string> {
    try {
        const response = await fetch(`https://www.etsy.com/your/orders/sold/new?search_query=${orderId}`, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'max-age=0',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        
        if (response.status === 429) {
            console.warn("Rate limited by Etsy! Backing off for 10 minutes.");
            rateLimitUntil = Date.now() + 10 * 60 * 1000;
            return "NULL_RATE_LIMIT";
        }
        
        // Sometimes Cloudflare returns 403 on API blocks
        if (response.status === 403) {
             console.warn("403 Forbidden! Possible Cloudflare block. Backing off for 10 minutes.");
             rateLimitUntil = Date.now() + 10 * 60 * 1000;
             return "NULL_RATE_LIMIT";
        }
        
        const html = await response.text();
        
        // Check for session expiry by looking for typical sign-in hooks in HTML
        if (html.includes('class="sign-in-button-wrapper"') || html.includes('id="sign-in"') || html.includes('name="user_id" content=""') || html.includes('/signin?')) {
            console.error("Etsy Session Expired / Logged out! Pausing completely.");
            isEtsyLoggedOut = true;
            return "NULL_AUTH_REQUIRED";
        }
        
        let extractedSku = "NULL";
        try {
            const regex = /"product_identifier"\s*:\s*"([^"]+)"/g;
            const matches = [...html.matchAll(regex)];
            
            if (matches.length > 0) {
                extractedSku = matches.map(m => m[1]).filter(Boolean).join(', ');
            }
        } catch (error) {
            console.error("SKU Extraction Error:", error);
        }
        
        return extractedSku;
    } catch (error) {
        console.error("Fetch SKU error:", error);
        return "NULL"; 
    }
}
