import { collection, doc, setDoc, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "./firebaseService";

export interface SkuJob {
    id?: string;
    order_id: string;
    account: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    priority: boolean;
    sku?: string;
    error?: string;
    created_at: string;
    updated_at: string;
}

export const addSkuJob = async (teamId: string, orderId: string, account: string, priority: boolean = false): Promise<string> => {
    const jobsRef = collection(db, 'user', teamId, 'sku_jobs');
    
    // Check if pending job already exists
    const q = query(jobsRef, where('order_id', '==', orderId), where('status', '==', 'pending'));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
        // Already in queue
        return snapshot.docs[0].id;
    }
    
    // Create new job document
    // We use order_id as the document ID for simplicity to avoid duplicates, or generate a random one
    const jobDocRef = doc(jobsRef, orderId); // using orderId as DocID ensures uniqueness per order
    
    const newJob: SkuJob = {
        order_id: orderId,
        account,
        status: 'pending',
        priority,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    await setDoc(jobDocRef, newJob);
    return jobDocRef.id;
};

// Listener for a specific job to update UI in real-time
export const listenToSkuJob = (teamId: string, jobId: string, callback: (job: SkuJob) => void): (() => void) => {
    const jobRef = doc(db, 'user', teamId, 'sku_jobs', jobId);
    const unsubscribe = onSnapshot(jobRef, (docSnap) => {
        if (docSnap.exists()) {
            callback({ id: docSnap.id, ...docSnap.data() } as SkuJob);
        }
    });
    return unsubscribe;
};
