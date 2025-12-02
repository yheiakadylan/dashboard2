import { getToken } from "firebase/messaging";
import { getMessagingInstance } from "./firebaseService"; 

// VAPID Key của bạn (giữ nguyên)
const VAPID_KEY = "BEdIPBCogmSpUUQuFNI3v2SM_j5-9gGHpD1WVNMB8WB2e9Zo_EY9o5IOs-pKv8noSf7RVJ3q2ajShI3cFJrHENs"; 

export const requestForToken = async () => {
  try {
    // SỬA ĐOẠN NÀY: Gọi hàm getMessagingInstance()
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
      console.log('FCM Token:', token);
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
  role: string
): void => {
  if (role !== 'user') {
    return; 
  }
  fetch('/api/lark-login-notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, role }),
  }).catch(err => {
    console.error('Failed to trigger login notification:', err);
  });
};