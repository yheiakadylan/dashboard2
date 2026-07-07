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
  setDoc,
  limit,
  orderBy
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";
import { Account, Record, UserProfile, Category, EtsyReview } from '../types';
import {
  fetchCachedDateRange,
  getAffectedCacheDatesForISO,
  markDailyCacheDirtyForDates,
} from './dailyCacheService';

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
  'apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'
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
// Thiết lập ngôn ngữ mặc định cho email là Tiếng Việt
auth.languageCode = 'en';
export const storage = getStorage(app);

// Helper: Upload Avatar
export const uploadAvatar = async (file: File, userId: string): Promise<string> => {
  const storageRef = ref(storage, `avatars/${userId}/${file.name}`);
  const snapshot = await uploadBytes(storageRef, file);
  return await getDownloadURL(snapshot.ref);
};

// === [NEW] Dashboard Avatar Upload (Overwrite strategy) ===
export const uploadDashboardAvatar = async (file: File, userId: string): Promise<string> => {
  // Save to fixed path "avatars_dashboard/{uid}" to ensure overwrite
  const storageRef = ref(storage, `avatars_dashboard/${userId}`);
  const snapshot = await uploadBytes(storageRef, file);
  return await getDownloadURL(snapshot.ref);
};

// === [NEW] Update User Role Profile ===
export const updateUserRoleProfile = async (userId: string, data: { displayName?: string; photoURL?: string }) => {
  const userRef = doc(db, 'user_roles', userId);
  // Using set with merge true in case document is missing (though it should exist)
  await setDoc(userRef, data, { merge: true });
};

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

type DateLikeValue = string | number | Date | Timestamp | { seconds?: number; toDate?: () => Date } | null | undefined;

const toISODateString = (value: DateLikeValue): string | undefined => {
  if (!value) return undefined;

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }

  return undefined;
};

const normalizeRecordDateFields = <T extends Partial<Record>>(record: T): T => {
  const normalizedDtLocal = toISODateString(record.dt_local as DateLikeValue);
  const normalizedFulfillDate = toISODateString(record.fulfill_date as DateLikeValue);
  const nextDtLocal = normalizedDtLocal && normalizedDtLocal !== record.dt_local ? normalizedDtLocal : undefined;
  const nextFulfillDate = normalizedFulfillDate && normalizedFulfillDate !== record.fulfill_date ? normalizedFulfillDate : undefined;
  if (!nextDtLocal && !nextFulfillDate) return record;

  return {
    ...record,
    ...(nextDtLocal ? { dt_local: nextDtLocal } : {}),
    ...(nextFulfillDate ? { fulfill_date: nextFulfillDate } : {}),
  };
};

const normalizeReviewDateFields = <T extends Partial<EtsyReview>>(review: T): T => {
  const normalizedCreateDate = toISODateString(review.create_date as DateLikeValue);
  const normalizedUpdatedAt = toISODateString(review.updated_at as DateLikeValue);
  const nextCreateDate = normalizedCreateDate && normalizedCreateDate !== review.create_date ? normalizedCreateDate : undefined;
  const nextUpdatedAt = normalizedUpdatedAt && normalizedUpdatedAt !== review.updated_at ? normalizedUpdatedAt : undefined;
  if (!nextCreateDate && !nextUpdatedAt) return review;

  return {
    ...review,
    ...(nextCreateDate ? { create_date: nextCreateDate } : {}),
    ...(nextUpdatedAt ? { updated_at: nextUpdatedAt } : {}),
  };
};

const normalizeList = <T,>(items: T[], normalizeItem: (item: T) => T): T[] => {
  let normalizedItems: T[] | null = null;

  items.forEach((item, index) => {
    const normalizedItem = normalizeItem(item);
    if (normalizedItems) {
      normalizedItems.push(normalizedItem);
      return;
    }

    if (normalizedItem !== item) {
      normalizedItems = items.slice(0, index);
      normalizedItems.push(normalizedItem);
    }
  });

  return normalizedItems || items;
};

const normalizeRecordDoc = (docSnap: { id: string; data: () => DocumentData }): Record => {
  return normalizeRecordDateFields({ ...(docSnap.data() as object), id: docSnap.id } as Record);
};

const normalizeReviewDoc = (docSnap: { id: string; data: () => DocumentData }): EtsyReview => {
  return normalizeReviewDateFields({ ...(docSnap.data() as object), id: docSnap.id } as EtsyReview);
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

      // Clean up undefined values which Firestore WriteBatch rejects
      const safeAcc: any = { ...acc };
      Object.keys(safeAcc).forEach(key => {
        if (safeAcc[key] === undefined) {
          delete safeAcc[key];
        }
      });

      // Use set to overwrite or create. 
      // Ensuring we write the full object as provided.
      batch.set(docRef, safeAcc);
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

type UpdateRecordsProgress = {
  processed: number;
  total: number;
  batchIndex: number;
  batchCount: number;
  writes: number;
};

type UpdateRecordsOptions = {
  batchSize?: number;
  markDailyCacheDirty?: boolean;
  onProgress?: (progress: UpdateRecordsProgress) => void;
};

export const markRecordsDailyCacheDirty = async (
  teamId: string,
  dates: string[],
  reason: string,
): Promise<void> => {
  await markDailyCacheDirtyForDates(db, teamId, ['records'], dates, reason)
    .catch(error => console.warn('[dailyCache] Failed to mark records dirty:', error));
};

export const updateRecordsInFirebase = async (
  teamId: string,
  recordsToUpdate: (Partial<Record> & { id: string })[],
  options: UpdateRecordsOptions = {}
): Promise<string[]> => {
  if (!recordsToUpdate || recordsToUpdate.length === 0) {
    return [];
  }
  const batchSize = Math.max(1, Math.min(options.batchSize || 250, 450));
  const affectedDates = new Set<string>();

  const updatesNeedingLookup = recordsToUpdate.filter(recordUpdate => recordUpdate.id && !recordUpdate.dt_local);
  for (const recordUpdate of updatesNeedingLookup) {
    try {
      const recordSnap = await getDoc(doc(db, 'user', teamId, 'records', recordUpdate.id));
      const existingRecord = recordSnap.exists() ? recordSnap.data() as Partial<Record> : null;
      getAffectedCacheDatesForISO(existingRecord?.dt_local).forEach(date => affectedDates.add(date));
    } catch (error) {
      console.warn('[dailyCache] Could not resolve updated record date for dirty mark:', error);
    }
  }

  let processed = 0;
  const batchCount = Math.ceil(recordsToUpdate.length / batchSize);
  for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
    const batchIndex = Math.floor(i / batchSize) + 1;
    const batch = writeBatch(db);
    let writes = 0;

    recordsToUpdate.slice(i, i + batchSize).forEach(recordUpdate => {
      const { id, ...dataToUpdate } = recordUpdate;
      if (id && Object.keys(dataToUpdate).length > 0) {
        const recordRef = doc(db, 'user', teamId, 'records', id);
        const normalizedUpdate = normalizeRecordDateFields(dataToUpdate as Partial<Record>);
        batch.update(recordRef, normalizedUpdate);
        getAffectedCacheDatesForISO(normalizedUpdate.dt_local).forEach(date => affectedDates.add(date));
        writes++;
      }
    });

    if (writes > 0) {
      await batch.commit();
    }
    processed = Math.min(i + batchSize, recordsToUpdate.length);
    options.onProgress?.({ processed, total: recordsToUpdate.length, batchIndex, batchCount, writes });
  }

  const affectedDateList = Array.from(affectedDates);
  if (options.markDailyCacheDirty !== false) {
    await markRecordsDailyCacheDirty(teamId, affectedDateList, 'records-updated');
  }
  return affectedDateList;
};

export const getRecordsForDateRange = async (teamId: string, startDate: string, endDate: string, timeZone: string): Promise<Record[]> => {
  const records = await fetchCachedDateRange<Record>({
    db,
    teamId,
    collectionName: 'records',
    field: 'dt_local',
    startDate,
    endDate,
    timeZone,
    compactDoc: normalizeRecordDoc,
  });
  return normalizeList(records, normalizeRecordDateFields);
};

export const getEtsyReviewsForDateRange = async (teamId: string, startDate: string, endDate: string, timeZone: string): Promise<EtsyReview[]> => {
  const reviewsCol = collection(db, 'user', teamId, 'reviews');
  const startOffset = getTimezoneOffsetString(timeZone, startDate);
  const endOffset = getTimezoneOffsetString(timeZone, endDate);
  const fromISO = new Date(`${startDate}T00:00:00.000${startOffset}`).toISOString();
  const toISO = new Date(`${endDate}T23:59:59.999${endOffset}`).toISOString();

  const reviewsQuery = query(
    reviewsCol,
    where('create_date', '>=', fromISO),
    where('create_date', '<=', toISO),
  );
  const snapshot = await getDocs(reviewsQuery);
  const reviews = snapshot.docs.map(normalizeReviewDoc);
  return normalizeList(reviews, normalizeReviewDateFields);
};

export const getAllRecordsForAccount = async (teamId: string, accountEmail: string): Promise<Record[]> => {
  const recordsCol = collection(db, 'user', teamId, 'records');
  const q = query(recordsCol, where('account', '==', accountEmail));
  const querySnapshot = await getDocs(q);
  const records = querySnapshot.docs.map(doc => ({ ...(doc.data() as object), id: doc.id } as Record));
  return records;
};

export const getRefundRecordsForOrderIds = async (
  teamId: string,
  orderIds: string[],
  rangeFromStr?: string,
  rangeToStr?: string
): Promise<Record[]> => {
  if (!orderIds || orderIds.length === 0) return [];

  const recordsRef = collection(db, 'user', teamId, 'records');
  const results: Record[] = [];

  // Remove duplicates and empty IDs
  const uniqueOrderIdsSet = new Set(orderIds.filter(id => !!id));
  if (uniqueOrderIdsSet.size === 0) return [];

  if (rangeFromStr) {
    let constraints: any[] = [
      where('source', '==', 'Etsy_Refunded'),
      where('dt_local', '>=', rangeFromStr)
    ];

    if (rangeToStr) {
      // Add a 60-day buffer to the end date (because refunds rarely happen >60 days after order)
      const toDate = new Date(rangeToStr);
      toDate.setDate(toDate.getDate() + 60);

      // Prevent querying into the future
      const now = new Date();
      const upperBound = toDate > now ? now.toISOString() : toDate.toISOString();

      constraints.push(where('dt_local', '<=', upperBound));

      if (import.meta.env.DEV) {
        console.log(`[firebaseService] 🔍 Fast cross-checking ${uniqueOrderIdsSet.size} orders for refunds between ${rangeFromStr} and ${upperBound}`);
      }
    } else {
      if (import.meta.env.DEV) {
        console.log(`[firebaseService] 🔍 Fast cross-checking ${uniqueOrderIdsSet.size} orders for refunds strictly after ${rangeFromStr}`);
      }
    }

    const q = query(recordsRef, ...constraints);
    const snapshot = await getDocs(q);

    snapshot.docs.forEach(doc => {
      const data = { ...(doc.data() as object), id: doc.id } as Record;
      if (data.order_id && uniqueOrderIdsSet.has(data.order_id)) {
        results.push(data);
      }
    });

    if (import.meta.env.DEV) {
      console.log(`[firebaseService] 📬 Found ${snapshot.size} total refunds in range. Matched ${results.length} related refunds.`);
    }

    return results;
  }

  // Fallback: chunked query for absolute safety if rangeFromStr is not provided
  const uniqueOrderIds = Array.from(uniqueOrderIdsSet);
  const IN_QUERY_LIMIT = 30;
  const chunks = [];
  for (let i = 0; i < uniqueOrderIds.length; i += IN_QUERY_LIMIT) {
    chunks.push(uniqueOrderIds.slice(i, i + IN_QUERY_LIMIT));
  }

  const promises = chunks.map(chunk => {
    const q = query(recordsRef,
      where('source', '==', 'Etsy_Refunded'),
      where('order_id', 'in', chunk)
    );
    return getDocs(q);
  });

  const snapshots = await Promise.all(promises);
  snapshots.forEach(snap => {
    snap.docs.forEach(doc => {
      // Still ensure uniqueness
      if (uniqueOrderIdsSet.has((doc.data() as Record).order_id as string)) {
        results.push({ ...(doc.data() as object), id: doc.id } as Record);
      }
    });
  });

  return results;
};

export const deleteRecordsForAccounts = async (teamId: string, accountEmails: string[]): Promise<void> => {
  if (accountEmails.length === 0) return;

  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const q = query(recordsCollectionRef, where('account', 'in', accountEmails));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return;

  const BATCH_LIMIT = 450;
  const promises: Promise<void>[] = [];
  let batch = writeBatch(db);
  let count = 0;
  const affectedDates = new Set<string>();

  querySnapshot.forEach((doc) => {
    getAffectedCacheDatesForISO((doc.data() as Partial<Record>).dt_local).forEach(date => affectedDates.add(date));
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
  await markDailyCacheDirtyForDates(db, teamId, ['records'], Array.from(affectedDates), 'accounts-deleted')
    .catch(error => console.warn('[dailyCache] Failed to mark deleted account records dirty:', error));
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

  const normalizedRecordsToAdd = normalizeList(recordsToAdd, normalizeRecordDateFields);
  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const BATCH_WRITE_LIMIT = 450;

  // Pre-fetch all accounts to avoid await inside forEach loop
  const accountsMap: { [email: string]: string } = {};
  try {
    const accountsRef = collection(db, 'user', teamId, 'accounts');
    const accSnap = await getDocs(accountsRef);
    accSnap.docs.forEach(doc => {
      const data = doc.data();
      if (data.email && data.label) {
        accountsMap[data.email] = data.label;
      }
    });
  } catch (e) { console.error("Could not pre-fetch accounts for mapping", e); }

  try {
    const addPromises: Promise<void>[] = [];
    let addBatch = writeBatch(db);
    let pendingWriteCount = 0;

    const rotateAddBatchIfNeeded = () => {
      if (pendingWriteCount < BATCH_WRITE_LIMIT) return;
      addPromises.push(addBatch.commit());
      addBatch = writeBatch(db);
      pendingWriteCount = 0;
    };

    normalizedRecordsToAdd.forEach((record) => {
      rotateAddBatchIfNeeded();
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

      pendingWriteCount++;

      // [NEW] Auto Push SKU Job & Create Draft Tasks for new Etsy Sales
      if (record.source === 'Etsy_Sales' && record.order_id && record.account) {
        // 1. Push to Sku Job Queue
        const jobsRef = collection(db, 'user', teamId, 'sku_jobs');
        const jobDocRef = doc(jobsRef, record.order_id);
        rotateAddBatchIfNeeded();
        addBatch.set(jobDocRef, {
          order_id: record.order_id,
          account: record.account,
          status: 'pending',
          priority: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { merge: true });
        pendingWriteCount++;

        // 2. Stage 1 Sync: Create 'pending_sku' tasks in vikcomltd for EACH item
        if (record.details && record.details.items && record.details.items.length > 0) {
          const tasksRef = collection(db, 'tasks');

          // Use pre-fetched account label
          let accountLabel = accountsMap[record.account] || record.account;

          record.details.items.forEach((item: any, index: number) => {
            // Append -1, -2 etc. for multi-item orders
            const taskId = record.details!.items!.length > 1
              ? `${record.order_id}-${index + 1}`
              : record.order_id;

            // Parse SKU to extract parts
            const cleanSku = String(item.sku || '').trim().toUpperCase();
            const SKU_REGEX = /^([^-]+)-([^-]+)-(.*)$/;
            let productType = '';
            let ideaEmpId = '';
            let originalSku = '';

            if (SKU_REGEX.test(cleanSku)) {
              const parts = cleanSku.split('-');
              productType = parts[0].trim();
              ideaEmpId = parts[1].trim();
              originalSku = parts.slice(2).join('-').trim();
            } else {
              // SKU không đúng format, log warning và để trống
              console.warn(`[SKU Parse Warning] SKU "${cleanSku}" không đúng format PRODUCTTYPE-EMPID-ORIGINALSKU cho order ${record.order_id}`);
            }

            const taskDocRef = doc(tasksRef, taskId);
            rotateAddBatchIfNeeded();
            addBatch.set(taskDocRef, {
              id: taskId,
              readableId: taskId, // Hiển thị trên Board
              orderId: record.order_id, // Bổ sung để Extension query cho nhanh
              title: record.product_name || item.name || 'New Etsy Order',
              sku: cleanSku, // Sẽ được Update ở Stage 2 bởi Extension
              productType,
              idea_emp_id: ideaEmpId,
              originalSku,
              // description: item.variant || '', // Variant/Size (OLD)
              variant1: item.variant1 || item.variant || '', // NEW FIELD
              variant2: item.variant2 || '', // NEW FIELD
              personalization: item.personalization || '', // NEW FIELD
              quantity: item.quantity || 1, // Store quantity
              transactionId: item.transactionId || '',
              // Logic: Có nội dung personalization thực sự -> 'draft', ngược lại -> 'new'
              status: 'draft', // Ném thẳng vào Draft, Extension sẽ bổ sung SKU sau
              isUrgent: false,
              createdBy: 'auto_sync',
              mockupUrl: item.image || '', // Ảnh thumbnail từ email
              customerFiles: Array.isArray(item.customerFiles) ? item.customerFiles : [],
              created_at: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              account: accountLabel, // Lấy Label của Shop thay vì Email
              listingId: item.listingId || '', // Sẽ được Update bởi Extension
              collectionName: 'tasks' // Quan trọng cho Security Rules cũ
            }, { merge: true });
            pendingWriteCount++;
          });
        }
      }
    });
    if (pendingWriteCount > 0) {
      addPromises.push(addBatch.commit());
    }
    await Promise.all(addPromises);
    const affectedDates = normalizedRecordsToAdd.flatMap(record => getAffectedCacheDatesForISO(record.dt_local));
    await markDailyCacheDirtyForDates(db, teamId, ['records'], affectedDates, 'records-added')
      .catch(error => console.warn('[dailyCache] Failed to mark added records dirty:', error));
    return normalizedRecordsToAdd;
  } catch (error) {
    console.error("Error while adding new records:", error);
    console.error("Failed records data:", JSON.stringify(recordsToAdd, null, 2));
    throw new Error("Failed to add new records.");
  }
};

export const listenForNewRecords = (teamId: string, callback: (record: Record) => void): (() => void) => {
  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const q = query(recordsCollectionRef, where("dt_local", ">", new Date().toISOString()));

  const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added" && !change.doc.metadata.hasPendingWrites) {
        const newRecord = normalizeRecordDoc(change.doc);
        callback(newRecord);
      }
    });
  });
  return unsubscribe;
};

// Listen to a specific record document by its Firestore ID (for real-time updates in modals)
export const listenToRecord = (
  teamId: string,
  recordId: string,
  callback: (record: Record | null) => void
): (() => void) => {
  const recordRef = doc(db, 'user', teamId, 'records', recordId);
  const unsubscribe = onSnapshot(recordRef, (docSnap) => {
    if (docSnap.exists()) {
      callback({ ...(docSnap.data() as object), id: docSnap.id } as Record);
    } else {
      callback(null);
    }
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
  const recordSnap = await getDoc(recordRef);
  const affectedDates = recordSnap.exists()
    ? getAffectedCacheDatesForISO((recordSnap.data() as Partial<Record>).dt_local)
    : [];
  await deleteDoc(recordRef);
  await markDailyCacheDirtyForDates(db, teamId, ['records'], affectedDates, 'record-deleted')
    .catch(error => console.warn('[dailyCache] Failed to mark deleted record dirty:', error));
};

export const deleteRecordsByEmailId = async (teamId: string, emailId: string): Promise<void> => {
  const recordsCol = collection(db, 'user', teamId, 'records');
  const q = query(recordsCol, where('email_id', '==', emailId));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return;

  const batch = writeBatch(db);
  const affectedDates = new Set<string>();
  querySnapshot.forEach((doc) => {
    getAffectedCacheDatesForISO((doc.data() as Partial<Record>).dt_local).forEach(date => affectedDates.add(date));
    batch.delete(doc.ref);
  });
  await batch.commit();
  await markDailyCacheDirtyForDates(db, teamId, ['records'], Array.from(affectedDates), 'records-deleted-by-email')
    .catch(error => console.warn('[dailyCache] Failed to mark email-deleted records dirty:', error));
};

// === [UPDATED] Hàm thêm 1 record, hỗ trợ Document ID ===
export const addRecord = async (teamId: string, record: Record): Promise<Record> => {
  const recordsCollectionRef = collection(db, 'user', teamId, 'records');
  const normalizedRecord = normalizeRecordDateFields(record);
  const { id, ...data } = normalizedRecord;

  // Nếu có email_id -> Dùng làm Document ID
  const docRef = normalizedRecord.email_id
    ? doc(recordsCollectionRef, normalizedRecord.email_id)
    : doc(recordsCollectionRef); // Fallback: Auto ID

  await setDoc(docRef, data);
  await markDailyCacheDirtyForDates(db, teamId, ['records'], getAffectedCacheDatesForISO(normalizedRecord.dt_local), 'record-added')
    .catch(error => console.warn('[dailyCache] Failed to mark single added record dirty:', error));

  // [NEW] Auto Push SKU Job & Create Draft Tasks for new Etsy Sales
  if (normalizedRecord.source === 'Etsy_Sales' && normalizedRecord.order_id && normalizedRecord.account) {
    // 1. Push to SKU Job Queue
    const jobDocRef = doc(collection(db, 'user', teamId, 'sku_jobs'), normalizedRecord.order_id);
    await setDoc(jobDocRef, {
      order_id: normalizedRecord.order_id,
      account: normalizedRecord.account,
      status: 'pending',
      priority: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { merge: true });

    // 2. Stage 1 Sync: Create 'pending_sku' tasks in vikcomltd for EACH item
    if (normalizedRecord.details && normalizedRecord.details.items && normalizedRecord.details.items.length > 0) {
      const tasksRef = collection(db, 'tasks');
      const batch = writeBatch(db); // Use batch for multiple items to ensure atomicity

      // Fetch account label
      let accountLabel = normalizedRecord.account;
      try {
        const accountsRef = collection(db, 'user', teamId, 'accounts');
        const accSnap = await getDocs(accountsRef);
        const foundAcc = accSnap.docs.map(d => d.data()).find(a => a.email === normalizedRecord.account);
        if (foundAcc && foundAcc.label) {
          accountLabel = foundAcc.label;
        }
      } catch (e) { console.error("Could not fetch account label for task sync", e); }

      normalizedRecord.details.items.forEach((item: any, index: number) => {
        const taskId = normalizedRecord.details!.items!.length > 1
          ? `${normalizedRecord.order_id}-${index + 1}`
          : normalizedRecord.order_id;

        const taskDocRef = doc(tasksRef, taskId);
        batch.set(taskDocRef, {
          id: taskId,
          readableId: taskId,
          orderId: record.order_id, // Bổ sung để Extension query cho nhanh
          title: normalizedRecord.product_name || item.name || 'New Etsy Order',
          sku: item.sku || '',
          variant1: item.variant1 || item.variant || '', // NEW FIELD
          variant2: item.variant2 || '', // NEW FIELD
          personalization: item.personalization || '', // NEW FIELD
          quantity: item.quantity || 1, // Store quantity
          transactionId: item.transactionId || '',
          // Logic: Có nội dung personalization thực sự -> 'draft', ngược lại -> 'new'
          status: 'draft',
          isUrgent: false,
          createdBy: 'auto_sync',
          mockupUrl: item.image || '',
          customerFiles: Array.isArray(item.customerFiles) ? item.customerFiles : [],
          created_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          account: accountLabel, // Lấy Label của shop thay vì Email
          listingId: item.listingId || '', // Sẽ được Update bởi Extension
          collectionName: 'tasks'
        }, { merge: true });
      });
      await batch.commit();
    }
  }

  return { ...normalizedRecord, id: docRef.id };
};

export const bulkPushSkuJobs = async (teamId: string, records: Record[]): Promise<number> => {
  if (!records || records.length === 0) return 0;
  
  const jobsRef = collection(db, 'user', teamId, 'sku_jobs');
  let batch = writeBatch(db);
  let count = 0;
  let totalCount = 0;
  
  for (const record of records) {
    if (record.order_id && record.account && record.source === 'Etsy_Sales') {
      
      // Check if this order actually needs SKU fetching
      // True if it has items and ANY item is missing a SKU, OR if it has no items (to be safe)
      let needsSku = true;
      if (record.details?.items && record.details.items.length > 0) {
        needsSku = record.details.items.some(item => !item.sku || item.sku.trim() === '');
      }
      
      if (!needsSku) continue; // Skip if all items already have a SKU

      const jobDocRef = doc(jobsRef, record.order_id);
      batch.set(jobDocRef, {
        order_id: record.order_id,
        account: record.account,
        status: 'pending',
        priority: true, // Manual triggers get priority
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { merge: true });
      
      count++;
      totalCount++;
      
      if (count >= 500) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
  }
  
  if (count > 0) {
    await batch.commit();
  }
  
  return totalCount;
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

export const getTeamMembers = async (teamId: string): Promise<UserProfile[]> => {
  try {
    const rolesRef = collection(db, 'user_roles');
    const q = query(rolesRef, where('teamId', '==', teamId), where('role', '==', 'user'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...(doc.data() as UserProfile), uid: doc.id }));
  } catch (error) {
    console.error("Error getting team members:", error);
    return [];
  }
};

// === [NEW] Category & Product Mapping Services ===

export const getCategories = async (teamId: string): Promise<Category[]> => {
  const col = collection(db, 'user', teamId, 'categories');
  const snap = await getDocs(col);
  return snap.docs.map(doc => ({ ...(doc.data() as Category), id: doc.id }));
};

export const saveCategory = async (teamId: string, category: Partial<Category> & { code: string }): Promise<void> => {
  // Use code as document ID for easy reference/lookup
  const docRef = doc(db, 'user', teamId, 'categories', category.code.toUpperCase().trim());
  const data = {
    ...category,
    code: category.code.toUpperCase().trim(),
    updatedAt: new Date().toISOString()
  };
  if (!category.createdAt) (data as any).createdAt = new Date().toISOString();
  await setDoc(docRef, data, { merge: true });
};

export const saveCategoriesBulk = async (teamId: string, categories: { code: string, name: string }[]): Promise<void> => {
  const batch = writeBatch(db);
  const now = new Date().toISOString();

  // 1. Get existing categories to handle deletions
  const colRef = collection(db, 'user', teamId, 'categories');
  const existingSnap = await getDocs(colRef);
  const existingCodes = existingSnap.docs.map(doc => doc.id);

  // 2. Identify codes to delete (those that are in DB but NOT in the new list)
  const newCodes = new Set(categories.map(c => c.code.toUpperCase().trim()));
  const codesToDelete = existingCodes.filter(code => !newCodes.has(code));

  // 3. Add deletions to batch
  codesToDelete.forEach(code => {
    const docRef = doc(db, 'user', teamId, 'categories', code);
    batch.delete(docRef);
  });

  // 4. Upsert (Add/Update) new categories
  categories.forEach(category => {
    const code = category.code.toUpperCase().trim();
    const docRef = doc(db, 'user', teamId, 'categories', code);

    // Find if it was an existing category to keep its createdAt if possible
    const existingDoc = existingSnap.docs.find(d => d.id === code);
    const existingData = existingDoc ? existingDoc.data() : null;

    batch.set(docRef, {
      code,
      name: category.name.trim(),
      updatedAt: now,
      createdAt: existingData?.createdAt || now
    }, { merge: true });
  });

  await batch.commit();
};

export const deleteCategory = async (teamId: string, categoryId: string): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'categories', categoryId);
  await deleteDoc(docRef);
};


// === [NEW] Worker Management Services ===

/**
 * Xóa các job đang ở trạng thái 'pending' (toàn bộ team hoặc theo từng shop)
 */
export const clearPendingSkuJobs = async (teamId: string, shopEmail?: string): Promise<number> => {
  const jobsRef = collection(db, 'user', teamId, 'sku_jobs');
  let q = query(jobsRef, where('status', '==', 'pending'));
  
  if (shopEmail) {
    q = query(jobsRef, where('status', '==', 'pending'), where('account', '==', shopEmail));
  }
  
  const snap = await getDocs(q);
  if (snap.empty) return 0;
  
  const batch = writeBatch(db);
  snap.docs.forEach(docSnap => {
    batch.delete(docSnap.ref);
  });
  
  await batch.commit();
  return snap.size;
};

/**
 * Reset trạng thái worker của tất cả account về Offline (dùng khi hệ thống bảo trì hoặc clear rác)
 */
export const clearAllWorkerHeartbeats = async (teamId: string): Promise<void> => {
  const accountsRef = collection(db, 'user', teamId, 'accounts');
  const snap = await getDocs(accountsRef);
  
  if (snap.empty) return;
  
  const batch = writeBatch(db);
  snap.docs.forEach(docSnap => {
    batch.update(docSnap.ref, {
      worker_status: {
        status: 'idle',
        last_heartbeat: 'cleared',
        pending_count: 0
      }
    });
  });

  await batch.commit();
};

export type RemoteWorkerTarget = 'health' | 'reviews';

export const enqueueRemoteWorkerCommand = async (
  teamId: string,
  target: RemoteWorkerTarget,
  command: string,
  payload: globalThis.Record<string, any> = {}
): Promise<string> => {
  const commandsRef = collection(db, 'user', teamId, 'worker_commands');
  const docRef = await addDoc(commandsRef, {
    target,
    command,
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
    created_by_uid: auth.currentUser?.uid || null,
    created_by_email: auth.currentUser?.email || null,
  });
  return docRef.id;
};

export const saveRemoteReviewCronHours = async (teamId: string, hours: number[]): Promise<void> => {
  const settingsRef = doc(db, 'user', teamId, 'settings', 'worker_control');
  await setDoc(settingsRef, {
    review_cron_hours: hours,
    review_cron_updated_at: new Date().toISOString(),
    review_cron_updated_by_uid: auth.currentUser?.uid || null,
    review_cron_updated_by_email: auth.currentUser?.email || null,
  }, { merge: true });

  await enqueueRemoteWorkerCommand(teamId, 'reviews', 'set_review_cron_hours', { hours });
};
