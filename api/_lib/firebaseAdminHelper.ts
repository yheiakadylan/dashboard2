// File: api/_lib/firebaseAdminHelper.ts
import { initializeApp, cert, getApps, App, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

export function initFirebaseAdmin(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length) {
    cachedApp = getApps()[0]!;
    return cachedApp;
  }

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
  }

  // Vercel đôi khi giữ '\n' dạng '\\n' → chuyển về newline thật
  const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

  const sa: ServiceAccount = {
    projectId,
    clientEmail,
    privateKey: formattedPrivateKey,
  };

  try {
    cachedApp = initializeApp({ credential: cert(sa) });
  } catch (e: any) {
    console.error('[firebaseAdminHelper] Init error:', e?.message || e);
    if (e?.message?.includes('private key') || e?.message?.includes('PEM')) {
    }
    throw e;
  }
  return cachedApp!;
}

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  const app = initFirebaseAdmin();
  const db = getFirestore(app);

  try {
    // @ts-ignore (field có từ firebase-admin v12+)
    db.settings({ preferRest: true });
    console.log('[firebaseAdminHelper] Firestore settings: preferRest=true');
  } catch (e: any) {
    console.warn('[firebaseAdminHelper] preferRest not applied:', e?.message || e);
  }

  cachedDb = db;
  return db;
}
