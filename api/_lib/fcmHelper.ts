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

  // If passed a teamId (shared ID), find all users who have access to this team (or are owner)
  // For simplicity based on current app structure, we assume we iterate over all user_roles 
  // and check if they belong to the team and have the setting enabled.
  
  const userRolesRef = db.collection('user_roles');
  // We need to fetch users who:
  // 1. Have notificationSettings.{type} == true
  // 2. Have fcmTokens array not empty
  
  // Note: Firestore array-contains only works for one value. 
  // We'll query users with non-empty fcmTokens and filter in code for specific settings.
  // Ideally, query: where('teamId', '==', teamId) if applicable.
  
  // Assuming 'userIdsOrTeamId' is the teamId (SHARED_USER_ID)
  const teamId = typeof userIdsOrTeamId === 'string' ? userIdsOrTeamId : userIdsOrTeamId[0];

  const snapshot = await userRolesRef.where('teamId', '==', teamId).get();
  
  if (snapshot.empty) return;

  const tokensToSend: string[] = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const settings = data.notificationSettings || {};
    const tokens = data.fcmTokens || [];

    // Check preference
    if (settings[notificationType] === true && Array.isArray(tokens) && tokens.length > 0) {
      tokensToSend.push(...tokens);
    }
  });

  if (tokensToSend.length === 0) return;

  // Deduplicate tokens
  const uniqueTokens = [...new Set(tokensToSend)];

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: {
      url: payload.url || '/',
      type: notificationType
    },
    tokens: uniqueTokens,
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    console.log(`[FCM] Sent ${response.successCount} messages. Failed: ${response.failureCount}`);
    
    // Cleanup invalid tokens
    if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                failedTokens.push(uniqueTokens[idx]);
            }
        });
        // Note: Removing tokens from Firestore requires reverse lookup or iterating users again.
        // For production, implement token cleanup here.
    }
  } catch (error) {
    console.error('[FCM] Error sending multicast:', error);
  }
};
