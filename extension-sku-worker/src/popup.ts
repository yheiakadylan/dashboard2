import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, limit } from 'firebase/firestore';

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

document.addEventListener('DOMContentLoaded', async () => {
    const teamIdInput = document.getElementById('teamId') as HTMLInputElement;
    const accountInput = document.getElementById('account') as HTMLInputElement;
    const dbEmailInput = document.getElementById('dbEmail') as HTMLInputElement;
    const dbPasswordInput = document.getElementById('dbPassword') as HTMLInputElement;
    const statusMsg = document.getElementById('statusMsg') as HTMLDivElement;

    
    // Load existing
    const data = (await chrome.storage.local.get(['teamId', 'account', 'dbEmail', 'dbPassword'])) as { [key: string]: string };
    if (data.teamId) teamIdInput.value = data.teamId;
    if (data.account) accountInput.value = data.account;
    if (data.dbEmail) dbEmailInput.value = data.dbEmail;
    if (data.dbPassword) dbPasswordInput.value = data.dbPassword;
    
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
    
    // Auto show a soft connected status if data exists
    if (data.teamId && data.account && data.dbEmail && data.dbPassword) {
        statusMsg.textContent = 'Worker is ready for this Shop.';
        statusMsg.className = 'status success';
    }

    saveBtn.addEventListener('click', async () => {
        const teamId = teamIdInput.value.trim();
        const account = accountInput.value.trim().toLowerCase();
        const dbEmail = dbEmailInput.value.trim();
        const dbPassword = dbPasswordInput.value.trim();
        
        if(!teamId || !account || !dbEmail || !dbPassword) {
            statusMsg.textContent = 'Vui lòng điền đầy đủ 4 trường!';
            statusMsg.className = 'status error';
            return;
        }
        
        saveBtn.disabled = true;
        saveBtn.textContent = 'Validating...';
        statusMsg.textContent = 'Đang xác thực thông tin...';
        statusMsg.className = 'status info';

        try {
            // 1. Kiểm tra Login
            await signInWithEmailAndPassword(auth, dbEmail, dbPassword);
            
            // 2. Kiểm tra quyền truy cập Team + Tồn tại của Shop
            const accountsRef = collection(db, 'user', teamId, 'accounts');
            const q = query(accountsRef, where('email', '==', account), limit(1));
            const snap = await getDocs(q);
            
            if (snap.empty) {
                throw new Error(`Shop "${account}" không tồn tại trong Team "${teamId}". Vui lòng kiểm tra lại.`);
            }

            // Thành công
            await chrome.storage.local.set({ teamId, account, dbEmail, dbPassword });
            
            statusMsg.textContent = 'Xác thực thành công! Đang khởi động worker...';
            statusMsg.className = 'status success';
            
            setTimeout(() => {
                chrome.runtime.reload();
            }, 1000);

        } catch (err: any) {
            console.error("Validation failed:", err);
            let userMsg = "Lỗi xác thực: ";
            
            if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
                userMsg += "Email hoặc mật khẩu DB không đúng.";
            } else if (err.code === 'permission-denied') {
                userMsg += "Sai Team ID hoặc bạn không có quyền truy cập Team này.";
            } else {
                userMsg += err.message || "Không xác định. Kiểm tra internet.";
            }

            statusMsg.textContent = userMsg;
            statusMsg.className = 'status error';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & Connect';
        }
    });
});

