export const DB_NAME = 'DashboardVikcomDB';
export const DB_VERSION = 2;
export const STORE_IMAGES = 'user_images';
export const STORE_OPERATION_REPORT_CACHE = 'operation_report_cache';

export const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_IMAGES)) {
                db.createObjectStore(STORE_IMAGES);
            }
            if (!db.objectStoreNames.contains(STORE_OPERATION_REPORT_CACHE)) {
                db.createObjectStore(STORE_OPERATION_REPORT_CACHE);
            }
        };

        request.onsuccess = (event) => {
            resolve((event.target as IDBOpenDBRequest).result);
        };

        request.onerror = (event) => {
            reject((event.target as IDBOpenDBRequest).error);
        };
    });
};

export const saveValueToDB = async <T,>(storeName: string, key: string, value: T): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value, key);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
};

export const getValueFromDB = async <T,>(storeName: string, key: string): Promise<T | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = (event) => {
            const result = (event.target as IDBRequest).result;
            resolve(result || null);
        };
        request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
};

export const saveImageToDB = async (userId: string, file: Blob): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_IMAGES], 'readwrite');
        const store = transaction.objectStore(STORE_IMAGES);
        const request = store.put(file, userId);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
};

export const getImageFromDB = async (userId: string): Promise<Blob | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_IMAGES], 'readonly');
        const store = transaction.objectStore(STORE_IMAGES);
        const request = store.get(userId);

        request.onsuccess = (event) => {
            const result = (event.target as IDBRequest).result;
            resolve(result || null);
        };
        request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
};
