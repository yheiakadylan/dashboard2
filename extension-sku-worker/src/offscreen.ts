/// <reference types="chrome" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, setPersistence, indexedDBLocalPersistence, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';

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

// Initialize persistence - use indexedDB for stability across extension contexts
setPersistence(auth, indexedDBLocalPersistence).catch(console.error);


let unsubscribe: (() => void) | null = null;
let currentConfig: Record<string, string> | null = null;

async function startListening(config: Record<string, string>): Promise<void> {
    currentConfig = config; // Lưu lại để dùng cho retry
    const { teamId, account, dbEmail, dbPassword } = config;
    if (!teamId || !account || !dbEmail || !dbPassword) {
        console.log("Offscreen: Missing config/credentials. Waiting.");
        return;
    }

    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }

    try {
        // 1. Check if session already exists
        if (!auth.currentUser) {
            // Wait for potential auto-restore
            await new Promise(resolve => {
                const unsubscribe = onAuthStateChanged(auth, (user) => {
                    unsubscribe();
                    resolve(user);
                });
                setTimeout(resolve, 1500); 
            });
        }

        // 2. Only sign in if still not authenticated OR switching accounts
        if (!auth.currentUser || auth.currentUser.email !== dbEmail) {
            console.log("Offscreen: No session or email mismatch, authenticating...");
            await signInWithEmailAndPassword(auth, dbEmail, dbPassword);
        }
        
        console.log("Offscreen: Firebase Authenticated UID:", auth.currentUser?.uid);
    } catch (err: any) {
        console.error("Offscreen: Firebase Auth Error:", err);
        
        // Handle Quota Exceeded specifically
        const isQuotaError = err.code === 'auth/quota-exceeded' || (err.message && err.message.includes('quota'));
        const retryDelay = isQuotaError ? 60_000 : 10_000; // Wait 1 min if quota hit

        if (isQuotaError) {
             console.error("CRITICAL: Firebase Auth Quota Exceeded. Slowing down retries to 1 minute.");
        }

        setTimeout(() => {
            if (currentConfig) startListening(currentConfig);
        }, retryDelay);
        return;
    }


    console.log(`Offscreen: Listening for jobs on team: ${teamId}, account: ${account}`);
    const jobsRef = collection(db, 'user', teamId, 'sku_jobs');
    const q = query(jobsRef, where('account', '==', account), where('status', '==', 'pending'));

    unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const job = { id: change.doc.id, ...change.doc.data() };
                console.log('Offscreen: New job received, routing to background worker...', job);
                
                // Send job to background.js to wake it up and process
                // FIX Bug#3: .catch() suppresses "Could not establish connection" when SW is terminating
                chrome.runtime.sendMessage({
                    type: "NEW_SKU_JOB",
                    job,
                    teamId
                }).catch(() => { /* SW đang terminate, job sẽ được scanPendingJobs() vớt lại */ });
            }
        });
    }, (error) => {
        // QUAN TRỌNG: Khởi động lại listener nếu bị ngắt kết nối hoàn toàn
        console.error("Offscreen: Firebase listen error (Listener died):", error);
        setTimeout(() => {
            console.log("Offscreen: Attempting to restart listener...");
            if (currentConfig) startListening(currentConfig);
        }, 5_000);
    });
}

// Listen for messages from background.ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_FIREBASE') {
        startListening(msg.config);
        sendResponse({ success: true });
    } else if (msg.type === 'PING') {
        sendResponse({ status: 'ALIVE' });
    }
});
