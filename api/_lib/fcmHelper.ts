import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getDb, initFirebaseAdmin } from './firebaseAdminHelper.js';

initFirebaseAdmin();

const APP_ID = 'dashboard';
const BATCH_SIZE = 500;
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const db = getDb();
const messaging = getMessaging();

type AuthenticationSnapshot = QueryDocumentSnapshot<DocumentData>;
type TokenOwners = Map<string, Set<DocumentReference<DocumentData>>>;

const normalizeTokens = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((token): token is string => typeof token === 'string' && token.trim().length > 0)
  : [];

const normalizeSettings = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
};

const loadAuthenticationProfiles = async (
  userIdsOrTeamId: string | string[],
): Promise<AuthenticationSnapshot[]> => {
  if (Array.isArray(userIdsOrTeamId)) {
    const userIds = [...new Set(userIdsOrTeamId.map(String).map(value => value.trim()).filter(Boolean))];
    if (userIds.length === 0) return [];
    const snapshots = await db.getAll(...userIds.map(uid => db.collection('authentication').doc(uid)));
    return snapshots.filter((snapshot): snapshot is AuthenticationSnapshot => snapshot.exists);
  }

  const teamId = String(userIdsOrTeamId || '').trim();
  if (!teamId) return [];
  const snapshot = await db.collection('authentication').where('teamId', '==', teamId).get();
  return snapshot.docs;
};

const addTokenOwner = (
  tokenOwners: TokenOwners,
  token: string,
  owner: DocumentReference<DocumentData>,
) => {
  const owners = tokenOwners.get(token) || new Set<DocumentReference<DocumentData>>();
  owners.add(owner);
  tokenOwners.set(token, owners);
};

const removeInvalidTokens = async (tokens: string[], tokenOwners: TokenOwners) => {
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return;

  const updates = new Map<string, { ref: DocumentReference<DocumentData>; tokens: string[] }>();
  uniqueTokens.forEach(token => {
    tokenOwners.get(token)?.forEach(ref => {
      const entry = updates.get(ref.path) || { ref, tokens: [] };
      entry.tokens.push(token);
      updates.set(ref.path, entry);
    });
  });

  if (updates.size === 0) return;
  const batch = db.batch();
  updates.forEach(({ ref, tokens: invalidTokens }) => {
    batch.update(ref, {
      fcmTokens: FieldValue.arrayRemove(...invalidTokens),
      fcmUpdatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  console.log(`[FCM:${APP_ID}] Cleaned ${uniqueTokens.length} invalid tokens from ${updates.size} documents.`);
};

const sendMulticastWithCleanup = async (
  tokens: string[],
  data: Record<string, string>,
  tokenOwners: TokenOwners,
) => {
  for (let index = 0; index < tokens.length; index += BATCH_SIZE) {
    const batchTokens = tokens.slice(index, index + BATCH_SIZE);
    try {
      const response = await messaging.sendEachForMulticast({ data, tokens: batchTokens });
      const invalidTokens: string[] = [];

      response.responses.forEach((result, resultIndex) => {
        const errorCode = result.error?.code;
        if (!result.success && errorCode && INVALID_TOKEN_CODES.has(errorCode)) {
          invalidTokens.push(batchTokens[resultIndex]);
        }
      });

      if (invalidTokens.length > 0) {
        await removeInvalidTokens(invalidTokens, tokenOwners);
      }
      console.log(
        `[FCM:${APP_ID}] Batch ${index / BATCH_SIZE}: success=${response.successCount}, failed=${response.failureCount}`,
      );
    } catch (error) {
      console.error(`[FCM:${APP_ID}] Error sending multicast batch:`, error);
    }
  }
};

export const sendPushNotificationToUsers = async (
  userIdsOrTeamId: string | string[],
  notificationType: 'order' | 'funds' | 'summary' | 'login' | 'case' | 'help',
  payload: { title: string; body: string; url?: string },
) => {
  const profiles = await loadAuthenticationProfiles(userIdsOrTeamId);
  if (profiles.length === 0) {
    console.log(`[FCM:${APP_ID}] No matching authentication profiles.`);
    return;
  }

  const appRefs = profiles.map(profile => profile.ref.collection('apps').doc(APP_ID));
  const appSnapshots = await db.getAll(...appRefs);
  const tokenOwners: TokenOwners = new Map();
  const allTokens: string[] = [];

  profiles.forEach((_, index) => {
    const appSnapshot = appSnapshots[index];
    const appData = appSnapshot.exists ? appSnapshot.data() || {} : {};
    if (appData.enabled !== true) return;

    const settings = normalizeSettings(appData.notificationSettings);
    const settingKey = notificationType === 'case' || notificationType === 'help'
      ? 'support'
      : notificationType;
    if (settings[settingKey] === false) return;

    const selectedTokens = normalizeTokens(appData.fcmTokens).slice(-3);

    selectedTokens.forEach(token => {
      allTokens.push(token);
      addTokenOwner(tokenOwners, token, appRefs[index]);
    });
  });

  const uniqueTokens = [...new Set(allTokens)];
  if (uniqueTokens.length === 0) {
    console.log(`[FCM:${APP_ID}] No enabled tokens for notification type ${notificationType}.`);
    return;
  }

  await sendMulticastWithCleanup(uniqueTokens, {
    appId: APP_ID,
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    type: notificationType,
  }, tokenOwners);
};
