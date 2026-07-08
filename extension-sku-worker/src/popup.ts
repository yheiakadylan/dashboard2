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

function pickValidEtsyShopId(accountData: any): string {
    const ids = [accountData.etsy_shop_id, accountData.etsyShopId, accountData.shopId];
    for (const id of ids) {
        const text = String(id || '').trim();
        if (!/^\d+$/.test(text)) continue;

        const numericValue = Number(text);
        if (Number.isSafeInteger(numericValue) && numericValue > 0 && numericValue <= 2147483647) {
            return text;
        }
    }
    return '';
}

document.addEventListener('DOMContentLoaded', async () => {
    const teamIdInput = document.getElementById('teamId') as HTMLInputElement;
    const accountInput = document.getElementById('account') as HTMLInputElement;
    const dbEmailInput = document.getElementById('dbEmail') as HTMLInputElement;
    const dbPasswordInput = document.getElementById('dbPassword') as HTMLInputElement;
    const statusMsg = document.getElementById('statusMsg') as HTMLDivElement;

    // Load existing saved values
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
        const account = accountInput.value.trim();
        const dbEmail = dbEmailInput.value.trim();
        const dbPassword = dbPasswordInput.value.trim();

        if (!teamId || !account || !dbEmail || !dbPassword) {
            statusMsg.textContent = 'Vui lòng điền đầy đủ tất cả các trường!';
            statusMsg.className = 'status error';
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Connecting...';
        statusMsg.textContent = 'Đang xác thực thông tin...';
        statusMsg.className = 'status info';

        try {
            // 1. Kiểm tra Login
            await signInWithEmailAndPassword(auth, dbEmail, dbPassword);

            // 2. Kiểm tra quyền truy cập Team + Tồn tại của Shop
            const accountDoc = await findWorkerAccount(teamId, account);

            if (!accountDoc) {
                throw new Error(`Shop "${account}" không tồn tại trong Team "${teamId}". Vui lòng kiểm tra lại.`);
            }

            // Lưu cấu hình
            const accountData = accountDoc.data() as any;
            const shopId = pickValidEtsyShopId(accountData);
            const shopLabel = accountData.label || accountData.shopName || accountData.name || accountData.etsyShopName || accountData.email || account;

            await chrome.storage.local.set({
                teamId,
                account,
                accountLabel: shopLabel,
                dbEmail,
                dbPassword,
                etsy_review_shops: [{
                    shopId,
                    shopName: shopLabel,
                    label: accountData.label || shopLabel,
                    email: accountData.email || account,
                    name: accountData.name || null,
                    etsyShopName: accountData.etsyShopName || accountData.etsy_shop_name || null
                }]
            });

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

    // --- Etsy Reviews Tools Section ---
    const toolStatusMsg = document.getElementById('toolStatusMsg') as HTMLDivElement;
    const cronHoursInput = document.getElementById('cronHours') as HTMLInputElement;
    const saveCronBtn = document.getElementById('saveCronBtn') as HTMLButtonElement;
    const crawl25Btn = document.getElementById('crawl25Btn') as HTMLButtonElement;
    const backfillBtn = document.getElementById('backfillBtn') as HTMLButtonElement;
    const minDateInput = document.getElementById('minDate') as HTMLInputElement;
    const reviewSyncState = document.getElementById('reviewSyncState') as HTMLDivElement;
    const reviewSyncAction = document.getElementById('reviewSyncAction') as HTMLSpanElement;
    const reviewSyncLastSuccess = document.getElementById('reviewSyncLastSuccess') as HTMLSpanElement;
    const reviewSyncLastResult = document.getElementById('reviewSyncLastResult') as HTMLSpanElement;
    const reviewSyncNextRun = document.getElementById('reviewSyncNextRun') as HTMLSpanElement;
    const reviewSyncLastError = document.getElementById('reviewSyncLastError') as HTMLDivElement;

    type ReviewSyncStatus = {
        state?: 'idle' | 'running' | 'success' | 'error';
        currentAction?: string;
        lastStartedAt?: string;
        lastFinishedAt?: string;
        lastSuccessAt?: string;
        lastError?: string;
        lastFetched?: number;
        lastSaved?: number;
        nextRunAt?: string;
        updatedAt?: string;
    };

    const formatStatusDate = (value?: string) => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatAction = (action?: string) => {
        if (action === 'recent_25') return 'Recent 25';
        if (action === 'backfill') return 'Back-fill';
        if (action === 'cron') return 'Cron';
        return action || '-';
    };

    const renderReviewSyncStatus = (status?: ReviewSyncStatus) => {
        const state = status?.state || 'idle';
        reviewSyncState.textContent = state;
        reviewSyncState.className = `review-status-pill ${state}`;
        reviewSyncAction.textContent = formatAction(status?.currentAction);
        reviewSyncLastSuccess.textContent = formatStatusDate(status?.lastSuccessAt || status?.lastFinishedAt);
        reviewSyncLastResult.textContent = typeof status?.lastFetched === 'number' || typeof status?.lastSaved === 'number'
            ? `Fetched ${status?.lastFetched || 0}, saved ${status?.lastSaved || 0}`
            : '-';
        reviewSyncNextRun.textContent = formatStatusDate(status?.nextRunAt);

        if (status?.lastError) {
            reviewSyncLastError.style.display = 'block';
            reviewSyncLastError.textContent = status.lastError;
        } else {
            reviewSyncLastError.style.display = 'none';
            reviewSyncLastError.textContent = '';
        }
    };

    chrome.storage.local.get(['etsy_review_sync_status'], (res) => {
        renderReviewSyncStatus(res.etsy_review_sync_status as ReviewSyncStatus | undefined);
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.etsy_review_sync_status) {
            renderReviewSyncStatus(changes.etsy_review_sync_status.newValue as ReviewSyncStatus | undefined);
        }
    });

    // Load existing cron hours
    chrome.storage.local.get(['etsy_review_sync_hours'], (res) => {
        if (res.etsy_review_sync_hours && Array.isArray(res.etsy_review_sync_hours)) {
            cronHoursInput.value = res.etsy_review_sync_hours.join(', ');
        }
    });

    saveCronBtn.addEventListener('click', async () => {
        const val = cronHoursInput.value;
        const hours = val.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 23);
        
        if (hours.length === 0) {
            toolStatusMsg.textContent = 'Vui lòng nhập giờ hợp lệ (0-23)';
            toolStatusMsg.className = 'status error';
            return;
        }

        await chrome.storage.local.set({ etsy_review_sync_hours: hours });
        chrome.runtime.sendMessage({ type: 'SCHEDULE_ETSY_REVIEW_CRON' });
        
        toolStatusMsg.textContent = 'Đã lưu giờ cron thành công!';
        toolStatusMsg.className = 'status success';
        setTimeout(() => { toolStatusMsg.textContent = ''; toolStatusMsg.className = 'status'; }, 3000);
    });

    crawl25Btn.addEventListener('click', () => {
        crawl25Btn.disabled = true;
        toolStatusMsg.textContent = 'Đang cào 25 reviews mới nhất...';
        toolStatusMsg.className = 'status info';

        chrome.runtime.sendMessage({ type: "CRAWL_RECENT_REVIEWS_25" }, (response) => {
            crawl25Btn.disabled = false;
            if (response && response.success) {
                if (response.started) {
                    toolStatusMsg.textContent = 'Da bat dau cao reviews. Theo doi trang thai o khung Sync status.';
                    toolStatusMsg.className = 'status success';
                    return;
                }
                toolStatusMsg.textContent = `Thành công! Đã lấy ${response.fetched}, lưu ${response.saved} review.`;
                toolStatusMsg.className = 'status success';
            } else {
                toolStatusMsg.textContent = `Lỗi: ${response?.error || 'Không xác định'}`;
                toolStatusMsg.className = 'status error';
            }
        });
    });

    backfillBtn.addEventListener('click', async () => {
        const minDate = minDateInput.value;
        if (!minDate) {
            toolStatusMsg.textContent = 'Vui lòng chọn ngày (Min Date) trước khi Back-fill!';
            toolStatusMsg.className = 'status error';
            return;
        }

        const data = await chrome.storage.local.get(['etsy_review_shops']);
        // Default to first configured shop or rely on background to resolve
        const shopId = (Array.isArray(data.etsy_review_shops) && data.etsy_review_shops.length > 0) ? data.etsy_review_shops[0].shopId : '';

        backfillBtn.disabled = true;
        toolStatusMsg.textContent = `Đang Back-fill từ ${minDate}... (Có thể mất vài phút)`;
        toolStatusMsg.className = 'status info';

        chrome.runtime.sendMessage({ 
            type: "BACKFILL_ETSY_REVIEWS", 
            shopId: shopId, // If empty, background script will try to resolve shopId automatically
            minDate: minDate 
        }, (response) => {
            backfillBtn.disabled = false;
            if (response && response.success) {
                toolStatusMsg.textContent = `Thành công! Đã lấy ${response.fetched}, lưu ${response.saved} review.`;
                toolStatusMsg.className = 'status success';
            } else {
                toolStatusMsg.textContent = `Lỗi: ${response?.error || 'Không xác định'}`;
                toolStatusMsg.className = 'status error';
            }
        });
    });

});

async function findWorkerAccount(teamId: string, account: string): Promise<any | null> {
    const accountsRef = collection(db, 'user', teamId, 'accounts');
    const normalizedAccount = String(account || '').trim();
    const candidates = Array.from(new Set([normalizedAccount, normalizedAccount.toLowerCase()].filter(Boolean)));
    const fields = ['email', 'label', 'name', 'shopName', 'etsyShopName'];

    for (const field of fields) {
        for (const candidate of candidates) {
            const snap = await getDocs(query(accountsRef, where(field, '==', candidate), limit(1)));
            if (!snap.empty) return snap.docs[0];
        }
    }

    const allAccountsSnap = await getDocs(accountsRef);
    const normalizedNeedles = new Set(candidates.map(value => value.toLowerCase()));
    for (const accountDoc of allAccountsSnap.docs) {
        const data = accountDoc.data() as any;
        const values = [
            data.email,
            data.label,
            data.name,
            data.shopName,
            data.etsyShopName
        ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);

        if (values.some(value => normalizedNeedles.has(value))) {
            return accountDoc;
        }
    }

    return null;
}
