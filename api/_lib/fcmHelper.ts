// api/_lib/fcmHelper.ts
import { getDb, initFirebaseAdmin } from './firebaseAdminHelper.js';
import { getMessaging } from 'firebase-admin/messaging';

// Initialize Admin
initFirebaseAdmin();

export const sendPushNotificationToUsers = async (
  userIdsOrTeamId: string | string[],
  notificationType: 'order' | 'funds' | 'summary',
  payload: { title: string; body: string; url?: string }
) => {
  const db = getDb();
  const messaging = getMessaging();

  const teamId = typeof userIdsOrTeamId === 'string' ? userIdsOrTeamId : userIdsOrTeamId[0];
  const userRolesRef = db.collection('user_roles');
  
  const snapshot = await userRolesRef.where('teamId', '==', teamId).get();
  
  if (snapshot.empty) return;

  const tokensToSend: string[] = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const settings = data.notificationSettings || {};
    const tokens = data.fcmTokens || [];

    if (settings[notificationType] === true && Array.isArray(tokens) && tokens.length > 0) {
      tokensToSend.push(...tokens);
    }
  });

  if (tokensToSend.length === 0) return;

  // Deduplicate tokens
  const uniqueTokens = [...new Set(tokensToSend)];

  // --- SỬA ĐỔI QUAN TRỌNG: Dùng Data-Only Message ---
  // Bỏ key 'notification' để tránh trình duyệt tự hiển thị
  const message = {
    data: {
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      type: notificationType
    },
    tokens: uniqueTokens,
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    console.log(`[FCM] Sent ${response.successCount} messages. Failed: ${response.failureCount}`);
    
    if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                failedTokens.push(uniqueTokens[idx]);
            }
        });
    }
  } catch (error) {
    console.error('[FCM] Error sending multicast:', error);
  }
};
