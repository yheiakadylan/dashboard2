import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';
import { createNotificationDocument } from './_lib/notificationHelper.js';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js';

const SUSPENDED_NOT_FOUND_REASON = 'Etsy reviews page returned not found.';

type ShopHealthResult = {
  id?: string;
  label?: string;
  reviewAverage?: number | null;
  reviewCount?: number | null;
  suspended?: boolean;
  suspendedReason?: string | null;
  reviewPageNotFound?: boolean;
  reviewPageStatus?: number | null;
  reviewPageUrl?: string | null;
  notFoundEvidence?: string[] | null;
  status?: string;
  error?: string | null;
  checkedAt?: string;
};
type WorkerAlertType = 'worker_lost' | 'review_error';

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isConfirmedEtsyReviewsNotFound(result: ShopHealthResult): boolean {
  const evidence = Array.isArray(result.notFoundEvidence)
    ? result.notFoundEvidence.filter(item => typeof item === 'string')
    : [];
  const hasKnownEvidence = evidence.some(item =>
    item === 'http_404' ||
    item === 'visible_not_found_text' ||
    item === 'meta_not_found_description' ||
    item === 'etsy_error_404_beacon'
  );
  return result.reviewPageNotFound === true && isEtsyReviewsUrl(result.reviewPageUrl) && hasKnownEvidence;
}

function isEtsyReviewsUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === 'www.etsy.com'
      && /^\/shop\/[^/]+\/reviews\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizePlatforms(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(platform => String(platform).trim().toLowerCase()).filter(Boolean)
    : [];
}

function supportsEtsy(platforms: string[]): boolean {
  return platforms.includes('etsy');
}

function createNotificationDeepLink(notificationId: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard2-alpha-bay.vercel.app';
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('notification', notificationId);
    return url.toString();
  } catch {
    return `${baseUrl}?notification=${encodeURIComponent(notificationId)}`;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: `Method ${req.method} not allowed.` });
  }

  const action = req.body?.action;

  try {
    if (action === 'login') return await handleLogin(req, res);
    if (action === 'refresh-token') return await handleRefreshToken(req, res);
    if (action === 'get-shops') return await handleGetShops(req, res);
    if (action === 'save-health') return await handleSaveHealth(req, res);
    if (action === 'claim-command') return await handleClaimCommand(req, res);
    if (action === 'complete-command') return await handleCompleteCommand(req, res);
    if (action === 'worker-alert') return await handleWorkerAlert(req, res);

    return res.status(400).json({ success: false, message: 'Unknown action.' });
  } catch (error: any) {
    const status = getErrorStatus(error);
    console.error('[extension-shop-health]', error?.message || error);
    return res.status(status).json({ success: false, message: getPublicErrorMessage(error) });
  }
}

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const apiKey = getFirebaseApiKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'Missing Firebase API key on server.' });
  }

  const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
  const authData = await authResponse.json();

  if (!authResponse.ok || !authData.idToken) {
    return res.status(401).json({
      success: false,
      message: authData.error?.message || 'Invalid email or password.'
    });
  }

  const userProfile = await getVerifiedUserProfile(authData.idToken);
  const shops = await getTeamShops(userProfile.teamId, userProfile);

  return res.status(200).json({
    success: true,
    token: authData.idToken,
    refreshToken: authData.refreshToken,
    email: authData.email,
    uid: userProfile.uid,
    teamId: userProfile.teamId,
    shops
  });
}

async function handleRefreshToken(req: VercelRequest, res: VercelResponse) {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Missing refresh token.' });
  }

  const apiKey = getFirebaseApiKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'Missing Firebase API key on server.' });
  }

  const refreshResponse = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken)
    }).toString()
  });
  const refreshData = await refreshResponse.json();

  if (!refreshResponse.ok || !refreshData.id_token) {
    return res.status(401).json({
      success: false,
      message: refreshData.error?.message || 'Session expired. Please sign in again.'
    });
  }

  const userProfile = await getVerifiedUserProfile(refreshData.id_token);

  return res.status(200).json({
    success: true,
    token: refreshData.id_token,
    refreshToken: refreshData.refresh_token || refreshToken,
    uid: userProfile.uid,
    email: userProfile.email,
    teamId: userProfile.teamId
  });
}

async function handleGetShops(req: VercelRequest, res: VercelResponse) {
  const userProfile = await getVerifiedUserProfile(getTokenFromRequest(req));
  const teamId = req.body?.teamId || userProfile.teamId;

  if (teamId !== userProfile.teamId) {
    return res.status(403).json({ success: false, message: 'Cannot read shops from another team.' });
  }

  const shops = await getTeamShops(teamId, userProfile);
  return res.status(200).json({ success: true, shops });
}

async function handleSaveHealth(req: VercelRequest, res: VercelResponse) {
  const userProfile = await getVerifiedUserProfile(getTokenFromRequest(req));
  const teamId = req.body?.teamId || userProfile.teamId;
  const result = req.body?.result as ShopHealthResult | undefined;

  if (teamId !== userProfile.teamId) {
    return res.status(403).json({ success: false, message: 'Cannot update shops from another team.' });
  }
  if (!result?.id) {
    return res.status(400).json({ success: false, message: 'Missing shop health result id.' });
  }

  const db = getDb();
  const accountRef = db.collection('user').doc(teamId).collection('accounts').doc(String(result.id));
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) {
    return res.status(404).json({ success: false, message: 'Shop account not found.' });
  }
  const accountData = accountSnap.data() || {};
  if (!canAccessAccount(String(result.id), accountData, userProfile)) {
    return res.status(403).json({ success: false, message: 'Cannot update an account outside your permissions.' });
  }
  if (!supportsEtsy(normalizePlatforms(accountData.platforms))) {
    return res.status(400).json({ success: false, message: 'This account is not marked as an Etsy account.' });
  }

  const parsedReviewAverage = parseFiniteNumber(result.reviewAverage);
  const parsedReviewCount = parseFiniteNumber(result.reviewCount);
  const hasRatingSignal = parsedReviewAverage !== null && parsedReviewCount !== null;
  const payload: Record<string, unknown> = {
    etsy_health_status: result.status || null,
    etsy_health_error: result.error || null,
    etsy_health_checked_at: result.checkedAt || new Date().toISOString(),
  };
  if (typeof result.reviewPageUrl === 'string') payload.etsy_health_review_page_url = result.reviewPageUrl;
  if (typeof result.reviewPageStatus === 'number') payload.etsy_health_review_page_status = result.reviewPageStatus;
  if (Array.isArray(result.notFoundEvidence)) payload.etsy_health_not_found_evidence = result.notFoundEvidence;

  if (result.status === 'ok' && hasRatingSignal) {
    payload.etsy_review_average = parsedReviewAverage;
    payload.etsy_review_count = parsedReviewCount;
  }
  if (result.status === 'ok' || result.status === 'suspended') {
    const checkedAt = String(payload.etsy_health_checked_at);
    const wasSuspended = accountData.etsy_suspended === true;
    const isConfirmedSuspension = result.status === 'suspended'
      && result.suspended === true
      && isConfirmedEtsyReviewsNotFound(result);
    const isConfirmedRecovery = result.status === 'ok'
      && result.suspended !== true
      && hasRatingSignal;
    const isAmbiguousRecovery = wasSuspended && result.status === 'ok' && !isConfirmedRecovery;
    const isMissingReviewStatsOk = !wasSuspended && result.status === 'ok' && !isConfirmedRecovery;
    const isInvalidSuspension = result.status === 'suspended' && !isConfirmedSuspension;
    const isSuspended = isConfirmedSuspension ? true : isConfirmedRecovery ? false : wasSuspended;
    payload.etsy_suspended = isSuspended;
    payload.etsy_suspended_reason = isConfirmedSuspension
      ? SUSPENDED_NOT_FOUND_REASON
      : isSuspended
        ? accountData.etsy_suspended_reason || null
        : null;
    payload.etsy_newly_suspended = isConfirmedSuspension && !wasSuspended;

    if (isAmbiguousRecovery) {
      payload.etsy_health_status = 'error';
      payload.etsy_health_error = 'Ambiguous Etsy health check: shop was suspended, but the latest run did not return both review average and review count. Keeping suspended until confirmed review stats are detected.';
    } else if (isMissingReviewStatsOk) {
      payload.etsy_health_status = 'error';
      payload.etsy_health_error = 'Etsy reviews page loaded, but review average/count were not found. Suspended status was not changed.';
    } else if (isInvalidSuspension) {
      payload.etsy_health_status = 'error';
      payload.etsy_health_error = 'Suspended status ignored. The Etsy reviews page did not provide confirmed 404/not-found evidence.';
    }

    if (isConfirmedSuspension) {
      payload.etsy_suspended_since = wasSuspended
        ? accountData.etsy_suspended_since || accountData.etsy_suspension_status_changed_at || checkedAt
        : checkedAt;
    } else if (isConfirmedRecovery) {
      payload.etsy_suspended_since = null;
    }

    if ((isConfirmedSuspension || isConfirmedRecovery) && isSuspended !== wasSuspended) {
      payload.etsy_suspension_status_changed_at = checkedAt;

      const shopLabel = accountData.label || accountData.shopName || accountData.email || result.id || 'Unknown Shop';
      const type = isConfirmedSuspension ? 'suspended' : 'recovered';
      const messageText = isConfirmedSuspension
        ? `Etsy warning: 1 newly suspended shop: ${shopLabel}`
        : `Etsy warning: Shop ${shopLabel} has been recovered!`;

      const notificationId = await createNotificationDocument({
        teamId,
        type: 'CASE_HELP',
        title: isConfirmedSuspension ? 'Etsy Shop Health Warning' : 'Etsy Shop Health Recovered',
        content: messageText,
        metadata: {
          subject: isConfirmedSuspension ? 'Suspended Etsy Shop Detected' : 'Etsy Shop Recovered',
          message: isConfirmedSuspension
            ? `The following Etsy shop is reported as suspended or failed check:\n\n- ${shopLabel}: ${SUSPENDED_NOT_FOUND_REASON}`
            : `The following Etsy shop is now active and recovered:\n\n- ${shopLabel}: Recovered`,
          priority: isConfirmedSuspension ? 'High' : 'Normal',
          shopName: shopLabel,
          shopHealthStatus: type,
          shopHealthAccountId: String(result.id || ''),
          shopHealthCheckedAt: checkedAt
        }
      });

      await sendPushNotificationToUsers(teamId, isConfirmedSuspension ? 'case' : 'help', {
        title: isConfirmedSuspension ? 'Etsy Shop Health Warning' : 'Etsy Shop Health Recovered',
        body: messageText,
        url: createNotificationDeepLink(notificationId)
      });

      console.log(`[API ShopHealth] Successfully saved notification document for shop ${shopLabel} (${type})`);
    }
  }

  await accountRef.set(payload, { merge: true });

  return res.status(200).json({ success: true });
}

async function handleWorkerAlert(req: VercelRequest, res: VercelResponse) {
  const userProfile = await getVerifiedUserProfile(getTokenFromRequest(req));
  const teamId = req.body?.teamId || userProfile.teamId;
  const type = String(req.body?.type || '') as WorkerAlertType;
  const accountId = String(req.body?.accountId || '').trim();
  const workerAccount = String(req.body?.workerAccount || '').trim().toLowerCase();

  if (teamId !== userProfile.teamId) {
    return res.status(403).json({ success: false, message: 'Cannot alert for another team.' });
  }
  if (!['worker_lost', 'review_error'].includes(type)) {
    return res.status(400).json({ success: false, message: 'Unsupported worker alert type.' });
  }
  if (!accountId && !workerAccount) {
    return res.status(400).json({ success: false, message: 'Missing worker account.' });
  }

  const db = getDb();
  const accountsRef = db.collection('user').doc(teamId).collection('accounts');
  const accountSnapshot = accountId ? await accountsRef.doc(accountId).get() : null;
  const accountDoc = accountSnapshot?.exists
    ? accountSnapshot
    : (await accountsRef.get()).docs.find(doc => {
      const data = doc.data() || {};
      return doc.id.toLowerCase() === workerAccount
        || String(data.email || '').trim().toLowerCase() === workerAccount;
    });

  if (!accountDoc?.exists) {
    return res.status(404).json({ success: false, message: 'Worker account not found.' });
  }

  const accountData = accountDoc.data() || {};
  if (!canAccessAccount(accountDoc.id, accountData, userProfile)) {
    return res.status(403).json({ success: false, message: 'Cannot alert for an account outside your permissions.' });
  }
  if (accountData.etsy_suspended === true) {
    return res.status(200).json({ success: true, ignored: 'suspended' });
  }

  const workerStatus = accountData.worker_status || {};
  const crawlerStatus = type === 'review_error'
    ? workerStatus.review_status || {}
    : {};
  const now = new Date();
  const occurredAt = String(req.body?.occurredAt || crawlerStatus.lastFinishedAt || crawlerStatus.updatedAt || now.toISOString());
  const error = String(req.body?.error || crawlerStatus.lastError || '').trim();
  const action = String(req.body?.currentAction || crawlerStatus.currentAction || '').trim();
  const lastHeartbeat = String(workerStatus.last_heartbeat || '').trim();

  if (type === 'worker_lost') {
    const heartbeatAt = parseTimestamp(workerStatus.last_heartbeat);
    if (heartbeatAt === null || now.getTime() - heartbeatAt < 10 * 60 * 1000) {
      return res.status(200).json({ success: true, ignored: 'worker-active' });
    }
  } else if (!error) {
    return res.status(400).json({ success: false, message: 'Missing crawler error.' });
  }

  const eventKey = String(req.body?.eventKey || `${occurredAt}|${error || lastHeartbeat}`).trim().slice(0, 1500);
  const stateField = type === 'worker_lost' ? 'lostKey' : 'reviewErrorKey';
  const claim = await db.runTransaction(async tx => {
    const freshSnapshot = await tx.get(accountDoc.ref);
    if (!freshSnapshot.exists) return { status: 'missing' as const, previousKey: null, eventKey };

    const freshData = freshSnapshot.data() || {};
    if (freshData.etsy_suspended === true) {
      return { status: 'suspended' as const, previousKey: null, eventKey };
    }

    const freshWorkerStatus = freshData.worker_status || {};
    if (type === 'worker_lost') {
      const heartbeatAt = parseTimestamp(freshWorkerStatus.last_heartbeat);
      if (heartbeatAt === null || now.getTime() - heartbeatAt < 10 * 60 * 1000) {
        return { status: 'active' as const, previousKey: null, eventKey };
      }
    }

    const claimedEventKey = type === 'worker_lost'
      ? String(freshWorkerStatus.last_heartbeat || '')
      : eventKey;
    const alertState = freshData.worker_lark_alert_state || {};
    if (alertState[stateField] === claimedEventKey) {
      return { status: 'duplicate' as const, previousKey: null, eventKey: claimedEventKey };
    }

    const previousKey = alertState[stateField] ?? null;
    tx.update(accountDoc.ref, {
      [`worker_lark_alert_state.${stateField}`]: claimedEventKey,
      'worker_lark_alert_state.updatedAt': now.toISOString(),
    });
    return { status: 'claimed' as const, previousKey, eventKey: claimedEventKey, accountData: freshData };
  });

  if (claim.status === 'missing') return res.status(404).json({ success: false, message: 'Worker account not found.' });
  if (claim.status === 'suspended') return res.status(200).json({ success: true, ignored: 'suspended' });
  if (claim.status === 'active') return res.status(200).json({ success: true, ignored: 'worker-active' });
  if (claim.status === 'duplicate') return res.status(200).json({ success: true, duplicate: true });

  return res.status(200).json({ success: true, sent: false });
}

async function handleClaimCommand(req: VercelRequest, res: VercelResponse) {
  const userProfile = await getVerifiedUserProfile(getTokenFromRequest(req));
  const teamId = req.body?.teamId || userProfile.teamId;
  const target = String(req.body?.target || 'health');
  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId.trim() : '';
  if (teamId !== userProfile.teamId) {
    return res.status(403).json({ success: false, message: 'Cannot read commands from another team.' });
  }
  if (target !== 'health' && target !== 'reviews') {
    return res.status(400).json({ success: false, message: 'Unsupported command target.' });
  }

  const db = getDb();
  const commandsRef = db.collection('user').doc(teamId).collection('worker_commands');
  let commandDoc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot | null = null;

  if (commandId) {
    const exactDoc = await commandsRef.doc(commandId).get();
    commandDoc = exactDoc.exists ? exactDoc : null;
  } else {
    const pendingSnap = await commandsRef.where('status', '==', 'pending').limit(25).get();
    commandDoc = pendingSnap.docs.find(doc => doc.data()?.target === target) || null;
  }

  if (!commandDoc) {
    return res.status(200).json({ success: true, command: null });
  }

  const claimed = await db.runTransaction(async tx => {
    const fresh = await tx.get(commandDoc.ref);
    if (!fresh.exists) return null;

    const data = fresh.data() || {};
    if (data.status !== 'pending' || data.target !== target) return null;

    const now = new Date().toISOString();

    tx.set(commandDoc.ref, {
      status: 'running',
      claimed_at: now,
      claimed_by: userProfile.email || userProfile.uid || 'health-extension',
      updated_at: now,
    }, { merge: true });

    return {
      id: commandDoc.id,
      command: data.command || '',
      payload: data.payload || {},
      createdAt: data.created_at || null,
    };
  });

  return res.status(200).json({ success: true, command: claimed });
}

async function handleCompleteCommand(req: VercelRequest, res: VercelResponse) {
  const userProfile = await getVerifiedUserProfile(getTokenFromRequest(req));
  const teamId = req.body?.teamId || userProfile.teamId;
  const commandId = String(req.body?.commandId || '');
  const status = req.body?.status === 'success' ? 'success' : 'error';

  if (teamId !== userProfile.teamId) {
    return res.status(403).json({ success: false, message: 'Cannot update commands from another team.' });
  }
  if (!commandId) {
    return res.status(400).json({ success: false, message: 'Missing commandId.' });
  }

  const db = getDb();
  const commandRef = db.collection('user').doc(teamId).collection('worker_commands').doc(commandId);
  const completedAt = new Date().toISOString();
  const transactionResult = await db.runTransaction(async tx => {
    const commandSnapshot = await tx.get(commandRef);
    if (!commandSnapshot.exists) return { deleted: false, nextQueued: false, alreadyCompleted: true };

    if (status === 'success') {
      tx.delete(commandRef);
      return { deleted: true, nextQueued: false };
    }

    tx.set(commandRef, {
      status,
      finished_at: completedAt,
      updated_at: completedAt,
      result: req.body?.result || null,
      error: req.body?.error || null,
    }, { merge: true });
    return { deleted: false, nextQueued: false };
  });

  return res.status(200).json({ success: true, ...transactionResult });
}

function getTokenFromRequest(req: VercelRequest): string {
  const header = req.headers.authorization;
  const bearer = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : null;
  const bodyToken = typeof req.body?.token === 'string' ? req.body.token : null;
  const token = bearer || bodyToken;
  if (!token) throw new Error('Missing auth token.');
  return token;
}

function getErrorStatus(error: any): number {
  const code = error?.code || error?.errorInfo?.code;
  if (
    code === 'auth/id-token-expired' ||
    code === 'auth/argument-error' ||
    code === 'auth/id-token-revoked' ||
    /Missing auth token|expired|invalid/i.test(error?.message || '')
  ) {
    return 401;
  }
  return 500;
}

function getPublicErrorMessage(error: any): string {
  const code = error?.code || error?.errorInfo?.code;
  if (code === 'auth/id-token-expired' || /expired/i.test(error?.message || '')) {
    return 'Session expired. Please sign in again.';
  }
  if (/Missing auth token/i.test(error?.message || '')) {
    return 'Missing auth token.';
  }
  return error?.message || 'Internal Server Error';
}

function getFirebaseApiKey(): string {
  return process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '';
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  return null;
}

async function getVerifiedUserProfile(idToken: string) {
  const adminApp = initFirebaseAdmin();
  const adminAuth = getAuth(adminApp);
  const decoded = await adminAuth.verifyIdToken(idToken);
  const db = getDb();
  const [authenticationDoc, appDoc] = await Promise.all([
    db.collection('authentication').doc(decoded.uid).get(),
    db.doc(`authentication/${decoded.uid}/apps/dashboard`).get(),
  ]);

  if (!authenticationDoc.exists) {
    throw new Error('User profile not found.');
  }

  const data = authenticationDoc.data() || {};
  const role = String(data.role || '');
  if (data.active !== true || !appDoc.exists || appDoc.data()?.enabled !== true) {
    throw new Error('User access is disabled.');
  }
  if (!data.teamId) {
    throw new Error('User teamId not found.');
  }

  const rolePermissionDoc = role
    ? await db.doc(`authentication/_settings/permission_roles/${role}/apps/dashboard`).get()
    : null;
  const rolePermissions = rolePermissionDoc?.data()?.permissions;
  const appData = appDoc.data() || {};
  const normalizedRolePermissions = rolePermissions && typeof rolePermissions === 'object' && !Array.isArray(rolePermissions)
    ? rolePermissions as Record<string, boolean>
    : {};
  const userPermissions = appData.permissions && typeof appData.permissions === 'object' && !Array.isArray(appData.permissions)
    ? appData.permissions as Record<string, boolean>
    : {};

  return {
    uid: decoded.uid,
    email: decoded.email || data.email,
    teamId: data.teamId as string,
    role,
    permissions: {
      ...normalizedRolePermissions,
      ...userPermissions,
    } as Record<string, boolean>,
    allowedAccounts: Array.isArray(appData.allowedAccounts)
      ? appData.allowedAccounts.map(String)
      : []
  };
}

function hasFullAccountAccess(userProfile: Awaited<ReturnType<typeof getVerifiedUserProfile>>) {
  return ['ADMIN', 'MANAGER', 'owner'].includes(userProfile.role)
    || userProfile.permissions?.canManageSettings === true;
}

async function getTeamShops(teamId: string, userProfile: Awaited<ReturnType<typeof getVerifiedUserProfile>>) {
  const db = getDb();
  const snapshot = await db.collection('user').doc(teamId).collection('accounts').get();
  const allowed = new Set(userProfile.allowedAccounts || []);
  const canViewAllAccounts = hasFullAccountAccess(userProfile);

  if (!canViewAllAccounts && allowed.size === 0) {
    return [];
  }

  return snapshot.docs
    .map(doc => {
      const data = doc.data() || {};
      const platforms = normalizePlatforms(data.platforms);
      return {
        id: doc.id,
        label: String(data.label || data.shopName || data.email || doc.id),
        email: data.email || null,
        platforms,
        selected: true,
        reviewAverage: parseFiniteNumber(data.etsy_review_average),
        reviewCount: parseFiniteNumber(data.etsy_review_count),
        suspended: data.etsy_suspended === true,
        suspendedReason: data.etsy_suspended_reason || null,
        newlySuspended: data.etsy_newly_suspended === true,
        suspendedSince: data.etsy_suspended_since || null,
        suspensionStatusChangedAt: data.etsy_suspension_status_changed_at || null,
        healthStatus: data.etsy_health_status || null,
        healthError: data.etsy_health_error || null,
        healthCheckedAt: data.etsy_health_checked_at || null,
      };
    })
    .filter(shop => supportsEtsy(shop.platforms))
    .filter(shop => canViewAllAccounts || allowed.has(shop.id) || (shop.email && allowed.has(String(shop.email))) || allowed.has(shop.label))
    .filter(shop => Boolean(shop.label))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function canAccessAccount(
  accountId: string,
  data: Record<string, any>,
  userProfile: Awaited<ReturnType<typeof getVerifiedUserProfile>>
) {
  if (hasFullAccountAccess(userProfile)) return true;

  const allowed = new Set(userProfile.allowedAccounts || []);
  if (allowed.size === 0) return false;

  const label = String(data.label || data.shopName || data.email || accountId);
  const email = data.email ? String(data.email) : '';

  return allowed.has(accountId) || (email ? allowed.has(email) : false) || allowed.has(label);
}
