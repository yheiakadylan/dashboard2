
import { initializeApp } from "firebase/app";
import { 
    getFirestore, 
    collection, 
    getDocs, 
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
import { Account, Record } from '../api/_lib/types';

const firebaseConfig = {

  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyCf9A3apdFE24uU4M3E4j1cnBvmjiB9Z7E",

  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "dashboard-13ec8.firebaseapp.com",

  projectId: process.env.FIREBASE_PROJECT_ID || "dashboard-13ec8",

  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "dashboard-13ec8.firebasestorage.app",

  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "604763790543",

  appId: process.env.FIREBASE_APP_ID || "1:604763790543:web:26905ec5742624300e6bba",

};
/*const firebaseConfig = {

  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyCMfkDrGBzVa2ungr5iX8VDNpfdssw1RhA",

  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "servertest-25b17.firebaseapp.com",

  projectId: process.env.FIREBASE_PROJECT_ID || "servertest-25b17",

  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "servertest-25b17.firebasestorage.app",

  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "1056476786050",

  appId: process.env.FIREBASE_APP_ID || "1:1056476786050:web:e60baea741d839de3ab39b",

};*/
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
        return gmtPart.value.replace('GMT', ''); // Returns "-07:00", "+05:30"
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
  // FIX: Cast doc.data() to object to resolve "Spread types may only be created from object types" error.
  const accountList = accountSnapshot.docs.map(doc => ({ ...(doc.data() as object), id: doc.id } as Account));
  
  // Sort by the order field, putting accounts without an order at the end.
  accountList.sort((a, b) => {
      const orderA = typeof a.order === 'number' ? a.order : Infinity;
      const orderB = typeof b.order === 'number' ? b.order : Infinity;
      return orderA - orderB;
  });

  return accountList;
};

export const saveAccountsToFirebase = async (teamId: string, accounts: Account[]): Promise<void> => {
  const batch = writeBatch(db);
  const accountsCollectionRef = collection(db, 'user', teamId, 'accounts');
  const existingDocsSnapshot = await getDocs(accountsCollectionRef);
  existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));
  accounts.forEach(acc => {
    const docRef = doc(db, 'user', teamId, 'accounts', acc.id);
    batch.set(docRef, acc);
  });
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
            batch.update(accountRef, dataToUpdate);
        }
    });
    await batch.commit();
};

/**
 * Updates specific fields for multiple records in Firestore in a single batch.
 * @param recordsToUpdate An array of records to update. Each object must have an `id`.
 */
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
  // FIX: Cast doc.data() to object to resolve "Spread types may only be created from object types" error.
  const recordList = recordSnapshot.docs.map(doc => ({...(doc.data() as object), id: doc.id } as Record));
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
    if (accountEmails.length === 0) {
        return;
    }

    const recordsCollectionRef = collection(db, 'user', teamId, 'records');
    const q = query(recordsCollectionRef, where('account', 'in', accountEmails));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        return;
    }


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

// Helper to chunk arrays for Firestore 'in' query which has a 30-item limit.
const chunkArray = <T>(array: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};


export const saveRecordsToFirebase = async (
    teamId: string,
    newlyFetchedRecords: Record[]
): Promise<Record[]> => {
    const emailIdsToCheck = newlyFetchedRecords
        .map(r => r.email_id)
        .filter((id): id is string => !!id);

    const existingEmailIds = new Set<string>();

    if (emailIdsToCheck.length > 0) {
        const IN_QUERY_LIMIT = 30;
        const idChunks = chunkArray(emailIdsToCheck, IN_QUERY_LIMIT);
        const recordsRef = collection(db, 'user', teamId, 'records');
        
        for (const chunk of idChunks) {
            if (chunk.length > 0) {
                const q = query(recordsRef, where('email_id', 'in', chunk));
                const querySnapshot = await getDocs(q);
                querySnapshot.forEach(doc => {
                    // FIX: Cast doc.data() to access property and resolve "Property 'email_id' does not exist on type 'unknown'" error.
                    existingEmailIds.add((doc.data() as { email_id: string }).email_id);
                });
            }
        }
    }
    
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
            const newRecordRef = doc(recordsCollectionRef);
            addBatch.set(newRecordRef, record);
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
    } catch(error) {
        console.error("Error while adding new records:", error);
        throw new Error("Failed to add new records.");
    }
};

export const listenForNewRecords = (teamId: string, callback: (record: Record) => void): (() => void) => {
  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const q = query(recordsCollectionRef, where("dt_local", ">", new Date().toISOString()));
  // FIX: Explicitly type `snapshot` as QuerySnapshot to fix incorrect type inference and resolve "Property 'docChanges' does not exist" error.
  const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added" && !change.doc.metadata.hasPendingWrites) {
        // FIX: Cast doc.data() to object to resolve "Spread types may only be created from object types" error.
        const newRecord = { ...(change.doc.data() as object), id: change.doc.id } as Record;
        callback(newRecord);
      }
    });
  });
  return unsubscribe;
};

/**
 * Lấy tất cả các mục chi phí thủ công cho team.
 */
export const getManualCosts = async (teamId: string): Promise<any[]> => {
  const costsCol = collection(db, 'user', teamId, 'manual_costs');
  const costSnapshot = await getDocs(costsCol);
  const costList = costSnapshot.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as object)
  }));
  return costList;
};

/**
 * Thêm một mục chi phí thủ công mới.
 */
export const addManualCost = async (teamId: string, entry: {
  providerName: string;
  cost: number;
  date: string;
  timeZone: string;
}): Promise<string> => {
  const costEntry = {
    ...entry,
    currency: 'USD', // Mặc định là USD như yêu cầu
    createdAt: Timestamp.now(),
  };
  const docRef = await addDoc(collection(db, 'user', teamId, 'manual_costs'), costEntry);
  return docRef.id;
};

/**
 * Cập nhật một mục chi phí thủ công.
 */
export const updateManualCost = async (teamId: string, costId: string, updatedData: {
  providerName: string;
  cost: number;
  date: string;
}): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'manual_costs', costId);
  await updateDoc(docRef, updatedData);
};

/**
 * Xóa một mục chi phí thủ công.
 */
export const deleteManualCost = async (teamId: string, costId: string): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'manual_costs', costId);
  await deleteDoc(docRef);
};

/**
 * Deletes a single record by ID.
 */
export const deleteRecord = async (teamId: string, recordId: string): Promise<void> => {
    const recordRef = doc(db, 'user', teamId, 'records', recordId);
    await deleteDoc(recordRef);
};

/**
 * Deletes ALL records that match a specific email_id. 
 * Used to clean up duplicates before re-saving.
 */
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

/**
 * Adds a single record and returns it with the new ID.
 */
export const addRecord = async (teamId: string, record: Record): Promise<Record> => {
    const recordsCollectionRef = collection(db, 'user', teamId, 'records');
    // Remove 'id' from payload if it exists to let Firestore generate a new one
    const { id, ...data } = record; 
    const docRef = await addDoc(recordsCollectionRef, data);
    return { ...record, id: docRef.id };
};
