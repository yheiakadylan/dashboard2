import { db } from '../../../services/firebaseService';
import { arrayUnion, doc, serverTimestamp, setDoc } from "firebase/firestore";

const VAPID_KEY = "BEbquJkOmEQNEhC5mOvCxcg9hpIR4fryuHqOCrIfABh_g5CixXo_Xiw_VS_pDn2OhaJRUT5nJ1EVAincHXI_QVM";
const DASHBOARD_APP_ID = 'dashboard';

export interface DashboardNotificationPrefs {
  order: boolean;
  funds: boolean;
  summary: boolean;
  login: boolean;
  support: boolean;
}

export const saveDashboardFCMToken = async (
  userId: string,
  token: string,
  notificationSettings?: DashboardNotificationPrefs,
) => {
  const appRef = doc(db, 'authentication', userId, 'apps', DASHBOARD_APP_ID);
  const appData: Record<string, unknown> = {
    fcmTokens: arrayUnion(token),
    fcmUpdatedAt: serverTimestamp(),
  };
  if (notificationSettings) appData.notificationSettings = notificationSettings;

  await setDoc(appRef, appData, { merge: true });
};

export const requestForToken = async (userId?: string) => {
  try {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
      await Notification.requestPermission();
      return null;
    }

    const [{ getMessagingInstance }, { getToken }] = await Promise.all([
      import('../../../services/firebaseMessagingService'),
      import('firebase/messaging'),
    ]);
    const messaging = await getMessagingInstance();

    if (!messaging) {
      console.warn("Firebase Messaging is not supported or failed to initialize.");
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      if (!('serviceWorker' in navigator)) return null;
      const registration = await navigator.serviceWorker.ready;
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (userId && token) {
        try {
          await saveDashboardFCMToken(userId, token);
        } catch (saveError) {
          console.error('Error saving token to Firestore:', saveError);
        }
      }

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

export const sendLoginNotification = (
  email: string | null,
  role: string,
  teamId?: string,
  displayName?: string | null
): void => {
  if (role !== 'user') {
    return;
  }
  fetch('/api/lark-events?action=login-notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, role, teamId, displayName }),
  }).catch(err => {
    console.error('Failed to trigger login notification:', err);
  });
};
