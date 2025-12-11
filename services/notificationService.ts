import { getToken } from "firebase/messaging";
import { getMessagingInstance, db } from "./firebaseService"; // Thêm db
import { doc, updateDoc, arrayUnion } from "firebase/firestore"; // Thêm các hàm Firestore

// VAPID Key của bạn
const VAPID_KEY = "BEbquJkOmEQNEhC5mOvCxcg9hpIR4fryuHqOCrIfABh_g5CixXo_Xiw_VS_pDn2OhaJRUT5nJ1EVAincHXI_QVM";

// Thêm tham số userId (optional) để biết lưu vào user nào
export const requestForToken = async (userId?: string) => {
  try {
    const messaging = await getMessagingInstance();

    if (!messaging) {
      console.warn("Firebase Messaging is not supported or failed to initialize.");
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY
      });
      // --- LOGIC MỚI: Tự động lưu vào DB ---
      if (userId && token) {
        try {
          const userRef = doc(db, 'user_roles', userId);
          // arrayUnion: Nếu token mới (do cài lại app) -> Thêm vào mảng. Nếu cũ -> Bỏ qua.
          await updateDoc(userRef, {
            fcmTokens: arrayUnion(token)
          });
          console.log('Token saved to Firestore automatically.');
        } catch (saveError) {
          console.error('Error saving token to Firestore:', saveError);
        }
      }
      // -------------------------------------

      return token;
    } else {
      console.log('Quyền thông báo bị từ chối.');
      return null;
    }
  } catch (error) {
    console.error('Lỗi khi lấy token:', error);
    return null;
  }
};

export const sendLarkLoginNotification = (
  email: string | null,
  role: string,
  teamId?: string
): void => {
  if (role !== 'user') {
    return;
  }
  fetch('/api/lark-login-notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, role, teamId }),
  }).catch(err => {
    console.error('Failed to trigger login notification:', err);
  });
};
