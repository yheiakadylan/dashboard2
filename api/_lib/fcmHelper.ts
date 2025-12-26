// api/_lib/fcmHelper.ts
import { getDb, initFirebaseAdmin } from './firebaseAdminHelper.js';
import { getMessaging } from 'firebase-admin/messaging';

// Initialize Admin SDK
initFirebaseAdmin();

const BATCH_SIZE = 500; // FCM giới hạn ~500 tokens / 1 request

const db = getDb();
const messaging = getMessaging();

/**
 * Xoá các token FCM không còn hợp lệ khỏi collection user_roles
 * tokens: list token bị FCM báo lỗi
 */
async function removeInvalidTokens(tokens: string[]) {
  if (!tokens.length) return;

  const userRolesRef = db.collection('user_roles');

  for (const token of tokens) {
    try {
      const snap = await userRolesRef
        .where('fcmTokens', 'array-contains', token)
        .get();

      if (snap.empty) continue;

      const batch = db.batch();

      snap.forEach((doc) => {
        const data = doc.data();
        const oldTokens: string[] = data.fcmTokens || [];
        const newTokens = oldTokens.filter((t) => t !== token);
        batch.update(doc.ref, { fcmTokens: newTokens });
      });

      await batch.commit();
      console.log(`[FCM] Cleaned token ${token} from ${snap.size} user_roles`);
    } catch (err) {
      console.error('[FCM] Error cleaning token', token, err);
    }
  }
}

/**
 * Gửi multicast (data-only) + tự cleanup token lỗi
 */
async function sendMulticastWithCleanup(
  tokens: string[],
  data: { [key: string]: string }
) {
  if (!tokens.length) return;

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batchTokens = tokens.slice(i, i + BATCH_SIZE);

    const message = {
      // ❗ KHÔNG dùng `notification` để tránh iOS hiển thị 2 lần
      data,
      tokens: batchTokens,
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      console.log(
        `[FCM] Batch ${i / BATCH_SIZE}: success=${response.successCount}, failed=${response.failureCount}`
      );

      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(batchTokens[idx]);
          }
        });

        if (failedTokens.length) {
          console.log('[FCM] Need cleanup tokens:', failedTokens.length);
          await removeInvalidTokens(failedTokens);
        }
      }
    } catch (error) {
      console.error('[FCM] Error sending multicast batch:', error);
    }
  }
}

/**
 * Gửi push notification tới tất cả user trong 1 team
 * - Lọc theo notificationSettings[type] == true
 * - Dùng fcmTokens trong user_roles
 * - Giới hạn tối đa 3 token / user (tránh spam nhiều token trên cùng 1 máy)
 */
export const sendPushNotificationToUsers = async (
  userIdsOrTeamId: string | string[],
  notificationType: 'order' | 'funds' | 'summary' | 'login',
  payload: { title: string; body: string; url?: string }
) => {
  const userRolesRef = db.collection('user_roles');

  // Ở app hiện tại bạn đang dùng teamId (SHARED_USER_ID)
  const teamId =
    typeof userIdsOrTeamId === 'string'
      ? userIdsOrTeamId
      : userIdsOrTeamId[0];

  const snapshot = await userRolesRef.where('teamId', '==', teamId).get();

  if (snapshot.empty) {
    console.log('[FCM] No user_roles found for teamId:', teamId);
    return;
  }

  const allTokens: string[] = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    const settings = data.notificationSettings || {};
    const tokens: string[] = data.fcmTokens || [];

    // Check preference (Default: ON. Only skip if explicitly false)
    if (settings[notificationType] === false) return;
    if (!Array.isArray(tokens) || tokens.length === 0) return;

    // Giới hạn số token / user (giữ 3 token cuối cùng)
    const limitedTokens = tokens.slice(-3);
    allTokens.push(...limitedTokens);
  });

  // Deduplicate tokens
  const uniqueTokens = [...new Set(allTokens)];

  if (uniqueTokens.length === 0) {
    console.log('[FCM] No tokens to send for teamId:', teamId);
    return;
  }

  console.log(
    `[FCM] Sending type=${notificationType} to ${uniqueTokens.length} tokens`
  );

  // Gửi data-only, để service worker tự show notification
  const data = {
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    type: notificationType,
  };

  await sendMulticastWithCleanup(uniqueTokens, data);
};
