/// <reference types="chrome" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
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

let unsubscribe: (() => void) | null = null;

async function startListening(config: Record<string, string>) {
    const { teamId, account, dbEmail, dbPassword } = config;
    if (!teamId || !account || !dbEmail || !dbPassword) {
        console.log("Offscreen: Missing config/credentials. Waiting.");
        return;
    }

    if (unsubscribe) {
        unsubscribe();
    }

    try {
        await signInWithEmailAndPassword(auth, dbEmail, dbPassword);
        console.log("Offscreen: Firebase Authenticated as:", auth.currentUser?.uid);
    } catch (err: any) {
        console.error("Offscreen: Firebase Auth Error:", err);
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
                chrome.runtime.sendMessage({
                    type: "NEW_SKU_JOB",
                    job,
                    teamId
                });
            }
        });
    }, (error) => {
        console.error("Offscreen: Firebase listen error:", error);
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
