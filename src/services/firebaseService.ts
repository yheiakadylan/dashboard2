import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  writeBatch,
  doc,
  query,
  where,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
  addDoc,
  Timestamp,
  updateDoc,
  deleteDoc,
  setDoc
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getMessaging, isSupported } from "firebase/messaging";
import { Account, Record } from '../types';

// Firebase configuration - uses VITE_ prefix for client-side access
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validate all required Firebase config values
const requiredFields: (keyof typeof firebaseConfig)[] = [
  'apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'
];

for (const field of requiredFields) {
  if (!firebaseConfig[field]) {
    throw new Error(
      `Firebase configuration error: ${field} is missing. ` +
      `Please set VITE_${field.replace(/([A-Z])/g, '_$1').toUpperCase()} in your environment variables.`
    );
  }
}

// Initialize Firebase and Firestore.
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// HÀM QUAN TRỌNG: Khởi tạo messaging an toàn
export const getMessagingInstance = async () => {
  try {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
    console.warn("Firebase Messaging is not supported in this browser.");
    return null;
  } catch (err) {
    console.error("Error checking messaging support:", err);
    return null;
  }
};

const getTimezoneOffsetString = (timeZone: string, dateStr: string): string => {
  try {
    // Use noon of the given date to safely avoid DST crossover issues at midnight
    const date = new Date(dateStr + "T12:00:00Z");
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset'
    });
    const parts = formatter.formatToParts(date);
    const gmtPart = parts.find(p => p.type === 'timeZoneName');

    if (gmtPart) {
      // gmtPart.value is "GMT-07:00", "GMT+05:30", etc.
      return gmtPart.value.replace('GMT', '');
    }

    console.warn(`Could not determine offset for ${timeZone} using 'longOffset'. Falling back to UTC.`);
    return '+00:00';
  } catch (e) {
    console.error(`Failed to get offset for timezone ${timeZone} for date ${dateStr}`, e);
    return '+00:00'; // Fallback to UTC
  }
};


export const getAccountsFromFirebase = async (teamId: string): Promise<Account[]> => {
  const accountsCol = collection(db, 'user', teamId, 'accounts');
  const accountSnapshot = await getDocs(accountsCol);
  const accountList = accountSnapshot.docs.map(doc => ({ ...(doc.data() as object), id: doc.id } as Account));

  // Sort by the order field
  accountList.sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : Infinity;
    const orderB = typeof b.order === 'number' ? b.order : Infinity;
    return orderA - orderB;
  });

  return accountList;
};

export const listenForAccounts = (teamId: string, callback: (accounts: Account[]) => void): (() => void) => {
  const accountsCol = collection(db, 'user', teamId, 'accounts');

  const unsubscribe = onSnapshot(accountsCol, (snapshot) => {
    const accountList = snapshot.docs.map(doc => ({ ...(doc.data() as object), id: doc.id } as Account));

    // Sort by the order field
    accountList.sort((a, b) => {
      const orderA = typeof a.order === 'number' ? a.order : Infinity;
      const orderB = typeof b.order === 'number' ? b.order : Infinity;
      return orderA - orderB;
    });

    callback(accountList);
  }, (error) => {
    console.error("Error listening for accounts:", error);
  });

  return unsubscribe;
};

export const saveAccountsToFirebase = async (teamId: string, accounts: Account[], deletedAccountIds: string[] = []): Promise<void> => {
  const batch = writeBatch(db);

  // 1. Delete explicitly removed accounts
  if (deletedAccountIds.length > 0) {
    deletedAccountIds.forEach(id => {
      const docRef = doc(db, 'user', teamId, 'accounts', id);
      batch.delete(docRef);
    });
  }

  // 2. Upsert (Add/Update) accounts
  if (accounts.length > 0) {
    accounts.forEach(acc => {
      const docRef = doc(db, 'user', teamId, 'accounts', acc.id);
      // Use set to overwrite or create. 
      // Ensuring we write the full object as provided.
      batch.set(docRef, acc);
    });
  }

  await batch.commit();
};

export const updateAccountsInFirebase = async (teamId: string, accountsToUpdate: (Partial<Account> & { id: string })[]): Promise<void> => {
  if (!accountsToUpdate || accountsToUpdate.length === 0) {
    return;
  }
  const batch = writeBatch(db);
  accountsToUpdate.forEach(accountUpdate => {
    const { id, ...dataToUpdate } = accountUpdate;
    if (id && Object.keys(dataToUpdate).length > 0) {
      const accountRef = doc(db, 'user', teamId, 'accounts', id);
      batch.set(accountRef, dataToUpdate, { merge: true });
    }
  });
  await batch.commit();
};

export const updateRecordsInFirebase = async (teamId: string, recordsToUpdate: (Partial<Record> & { id: string })[]): Promise<void> => {
  if (!recordsToUpdate || recordsToUpdate.length === 0) {
    return;
  }
  const batch = writeBatch(db);
  recordsToUpdate.forEach(recordUpdate => {
    const { id, ...dataToUpdate } = recordUpdate;
    if (id && Object.keys(dataToUpdate).length > 0) {
      const recordRef = doc(db, 'user', teamId, 'records', id);
      batch.update(recordRef, dataToUpdate);
    }
  });
  await batch.commit();
};

export const getRecordsForDateRange = async (teamId: string, startDate: string, endDate: string, timeZone: string): Promise<Record[]> => {
  const recordsCol = collection(db, 'user', teamId, 'records');

  const startOffset = getTimezoneOffsetString(timeZone, startDate);
  const endOffset = getTimezoneOffsetString(timeZone, endDate);

  const fromDate = new Date(`${startDate}T00:00:00.000${startOffset}`);
  const fromISO = fromDate.toISOString();

  const toDate = new Date(`${endDate}T23:59:59.999${endOffset}`);
  const toISO = toDate.toISOString();

  const q = query(recordsCol,
    where("dt_local", ">=", fromISO),
    where("dt_local", "<=", toISO)
  );

  const recordSnapshot = await getDocs(q);
  const recordList = recordSnapshot.docs.map(doc => ({ ...(doc.data() as object), id: doc.id } as Record));
  return recordList;
};

export const getAllRecordsForAccount = async (teamId: string, accountEmail: string): Promise<Record[]> => {
  const recordsCol = collection(db, 'user', teamId, 'records');
  const q = query(recordsCol, where('account', '==', accountEmail));
  const querySnapshot = await getDocs(q);
  const records = querySnapshot.docs.map(doc => ({ ...(doc.data() as object), id: doc.id } as Record));
  return records;
};

export const deleteRecordsForAccounts = async (teamId: string, accountEmails: string[]): Promise<void> => {
  if (accountEmails.length === 0) return;

  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const q = query(recordsCollectionRef, where('account', 'in', accountEmails));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return;

  const BATCH_LIMIT = 500;
  const promises: Promise<void>[] = [];
  let batch = writeBatch(db);
  let count = 0;

  querySnapshot.forEach((doc) => {
    batch.delete(doc.ref);
    count++;
    if (count === BATCH_LIMIT) {
      promises.push(batch.commit());
      batch = writeBatch(db);
      count = 0;
    }
  });

  if (count > 0) {
    promises.push(batch.commit());
  }

  await Promise.all(promises);
};

// Helper to chunk arrays
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// === [UPDATED] Hàm quan trọng: Lưu record với ID là email_id ===
export const saveRecordsToFirebase = async (
  teamId: string,
  newlyFetchedRecords: Record[]
): Promise<Record[]> => {
  const emailIdsToCheck = newlyFetchedRecords
    .map(r => r.email_id)
    .filter((id): id is string => !!id);

  const existingEmailIds = new Set<string>();

  // Vẫn giữ bước kiểm tra này để hạn chế write không cần thiết,
  // nhưng bước lưu bên dưới sẽ đảm bảo tính Unique bằng Document ID.
  if (emailIdsToCheck.length > 0) {
    const IN_QUERY_LIMIT = 30;
    const idChunks = chunkArray(emailIdsToCheck, IN_QUERY_LIMIT);
    const recordsRef = collection(db, 'user', teamId, 'records');

    for (const chunk of idChunks) {
      if (chunk.length > 0) {
        // Lưu ý: Query này kiểm tra field 'email_id' bên trong document
        const q = query(recordsRef, where('email_id', 'in', chunk));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach(doc => {
          existingEmailIds.add((doc.data() as { email_id: string }).email_id);
        });
      }
    }
  }

  // Lọc ra các record chưa tồn tại để lưu
  const recordsToAdd = newlyFetchedRecords.filter(
    r => !r.email_id || !existingEmailIds.has(r.email_id)
  );

  if (recordsToAdd.length === 0) {
    return [];
  }

  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const BATCH_LIMIT = 500;
  try {
    const addPromises: Promise<void>[] = [];
    let addBatch = writeBatch(db);
    let addCount = 0;

    recordsToAdd.forEach((record) => {
      // --- THAY ĐỔI QUAN TRỌNG ---
      // Nếu có email_id, dùng nó làm Document ID.
      // Nếu không, mới để Firestore tự sinh ID.
      const newRecordRef = record.email_id
        ? doc(recordsCollectionRef, record.email_id)
        : doc(recordsCollectionRef);

      // Xóa id ảo trong data để tránh lưu dư thừa
      const { id, ...recordData } = record;

      // Dùng set thay vì addDoc để có thể chỉ định ID
      addBatch.set(newRecordRef, recordData);
      // --------------------------

      addCount++;
      if (addCount >= BATCH_LIMIT) {
        addPromises.push(addBatch.commit());
        addBatch = writeBatch(db);
        addCount = 0;
      }
    });
    if (addCount > 0) {
      addPromises.push(addBatch.commit());
    }
    await Promise.all(addPromises);
    return recordsToAdd;
  } catch (error) {
    console.error("Error while adding new records:", error);
    throw new Error("Failed to add new records.");
  }
};

export const listenForNewRecords = (teamId: string, callback: (record: Record) => void): (() => void) => {
  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const q = query(recordsCollectionRef, where("dt_local", ">", new Date().toISOString()));

  const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added" && !change.doc.metadata.hasPendingWrites) {
        const newRecord = { ...(change.doc.data() as object), id: change.doc.id } as Record;
        callback(newRecord);
      }
    });
  });
  return unsubscribe;
};

export const getManualCosts = async (teamId: string): Promise<any[]> => {
  const costsCol = collection(db, 'user', teamId, 'manual_costs');
  const costSnapshot = await getDocs(costsCol);
  const costList = costSnapshot.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as object)
  }));
  return costList;
};

export const addManualCost = async (teamId: string, entry: {
  providerName: string;
  cost: number;
  date: string;
  timeZone: string;
}): Promise<string> => {
  const costEntry = {
    ...entry,
    currency: 'USD',
    createdAt: Timestamp.now(),
  };
  const docRef = await addDoc(collection(db, 'user', teamId, 'manual_costs'), costEntry);
  return docRef.id;
};

export const updateManualCost = async (teamId: string, costId: string, updatedData: {
  providerName: string;
  cost: number;
  date: string;
}): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'manual_costs', costId);
  await updateDoc(docRef, updatedData);
};

export const deleteManualCost = async (teamId: string, costId: string): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'manual_costs', costId);
  await deleteDoc(docRef);
};

export const deleteRecord = async (teamId: string, recordId: string): Promise<void> => {
  const recordRef = doc(db, 'user', teamId, 'records', recordId);
  await deleteDoc(recordRef);
};

export const deleteRecordsByEmailId = async (teamId: string, emailId: string): Promise<void> => {
  const recordsCol = collection(db, 'user', teamId, 'records');
  const q = query(recordsCol, where('email_id', '==', emailId));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return;

  const batch = writeBatch(db);
  querySnapshot.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
};

// === [UPDATED] Hàm thêm 1 record, hỗ trợ Document ID ===
export const addRecord = async (teamId: string, record: Record): Promise<Record> => {
  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const { id, ...data } = record;

  // Nếu có email_id -> Dùng làm Document ID
  const docRef = record.email_id
    ? doc(recordsCollectionRef, record.email_id)
    : doc(recordsCollectionRef); // Fallback: Auto ID

  await setDoc(docRef, data);
  return { ...record, id: docRef.id };
};

export const searchGlobalRecords = async (teamId: string, term: string): Promise<Record[]> => {
  if (!term || !term.trim()) return [];

  const recordsRef = collection(db, 'user', teamId, 'records');
  const results: Record[] = [];
  const seenIds = new Set<string>();

  // Helper to add unique records
  const addDocs = (docs: QuerySnapshot<DocumentData>) => {
    docs.forEach(doc => {
      if (!seenIds.has(doc.id)) {
        seenIds.add(doc.id);
        results.push({ ...(doc.data() as object), id: doc.id } as Record);
      }
    });
  };

  try {
    // 1. Exact match on Order ID
    const qOrder = query(recordsRef, where('order_id', '==', term.trim()));
    const snapOrder = await getDocs(qOrder);
    addDocs(snapOrder);

    // 2. Exact match on FF Code
    const qFF = query(recordsRef, where('ff_code', '==', term.trim()));
    const snapFF = await getDocs(qFF);
    addDocs(snapFF);

    // 3. Exact match on Email ID (sometimes used as ref)
    const qEmailId = query(recordsRef, where('email_id', '==', term.trim()));
    const snapEmailId = await getDocs(qEmailId);
    addDocs(snapEmailId);

    return results;
  } catch (error) {
    console.error("Global search error:", error);
    return [];
  }
};

// === Settings Management ===
export interface TeamSettings {
  googleSheetId?: string;
  sheetAccount?: Account;
  autoSyncToSheet?: boolean;
  [key: string]: any;
}

export const getSettings = async (teamId: string): Promise<TeamSettings> => {
  try {
    const settingsRef = doc(db, 'user', teamId, 'settings', 'config');
    const settingsSnap = await getDoc(settingsRef);

    if (!settingsSnap.exists()) {
      return {};
    }

    return settingsSnap.data() as TeamSettings;
  } catch (error) {
    console.error("Error getting settings:", error);
    return {};
  }
};

export const saveSettings = async (teamId: string, settings: Partial<TeamSettings>): Promise<void> => {
  try {
    const settingsRef = doc(db, 'user', teamId, 'settings', 'config');
    await setDoc(settingsRef, settings, { merge: true });
  } catch (error) {
    console.error("Error saving settings:", error);
    throw new Error("Failed to save settings.");
  }
};

export const listenForSettings = (teamId: string, callback: (settings: TeamSettings) => void): (() => void) => {
  const settingsRef = doc(db, 'user', teamId, 'settings', 'config');

  const unsubscribe = onSnapshot(settingsRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data() as TeamSettings);
    } else {
      callback({});
    }
  }, (error) => {
    console.error("Error listening for settings:", error);
  });

  return unsubscribe;
};

