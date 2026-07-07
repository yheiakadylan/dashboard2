import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';
import { sendLarkShopHealthAlert } from './_lib/larkHelper.js';

type ShopHealthResult = {
  id?: string;
  label?: string;
  reviewAverage?: number | null;
  reviewCount?: number | null;
  suspended?: boolean;
  suspendedReason?: string | null;
  status?: string;
  error?: string | null;
  checkedAt?: string;
};

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePlatforms(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(platform => String(platform).trim().toLowerCase()).filter(Boolean)
    : [];
}

function supportsEtsy(platforms: string[]): boolean {
  return platforms.includes('etsy');
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
  const payload: Record<string, unknown> = {
    etsy_health_status: result.status || null,
    etsy_health_error: result.error || null,
    etsy_health_checked_at: result.checkedAt || new Date().toISOString(),
  };

  if (parsedReviewAverage !== null) payload.etsy_review_average = parsedReviewAverage;
  if (parsedReviewCount !== null) payload.etsy_review_count = parsedReviewCount;
  let larkSuspendAlert: { shopLabel: string; reason: string | null } | null = null;

  if (result.status === 'ok' || result.status === 'suspended') {
    const checkedAt = String(payload.etsy_health_checked_at);
    const wasSuspended = accountData.etsy_suspended === true;
    const isSuspended = result.suspended === true;
    const hasPendingSuspendAlert = accountData.etsy_lark_suspended_alert_pending === true;

    payload.etsy_suspended = isSuspended;
    payload.etsy_suspended_reason = result.suspendedReason || null;
    payload.etsy_newly_suspended = isSuspended && !wasSuspended;

    if (isSuspended) {
      payload.etsy_suspended_since = wasSuspended
        ? accountData.etsy_suspended_since || accountData.etsy_suspension_status_changed_at || checkedAt
        : checkedAt;
      if (!wasSuspended || hasPendingSuspendAlert) {
        payload.etsy_lark_suspended_alert_pending = true;
        const shopLabel = accountData.label || accountData.shopName || accountData.email || result.id || 'Unknown Shop';
        larkSuspendAlert = {
          shopLabel: String(shopLabel),
          reason: result.suspendedReason || accountData.etsy_suspended_reason || null
        };
      }
    } else {
      payload.etsy_suspended_since = null;
      payload.etsy_lark_suspended_alert_pending = false;
      payload.etsy_lark_suspended_alert_error = null;
    }

    if (isSuspended !== wasSuspended) {
      payload.etsy_suspension_status_changed_at = checkedAt;
    }
  }

  await accountRef.set(payload, { merge: true });

  if (larkSuspendAlert) {
    try {
      await sendLarkShopHealthAlert(larkSuspendAlert.shopLabel, 'suspended', larkSuspendAlert.reason);
      await accountRef.set({
        etsy_lark_suspended_alert_pending: false,
        etsy_lark_suspended_alert_sent_at: new Date().toISOString(),
        etsy_lark_suspended_alert_error: null
      }, { merge: true });
    } catch (larkErr) {
      console.error('[extension-shop-health] Lark suspend alert error:', larkErr);
      await accountRef.set({
        etsy_lark_suspended_alert_pending: true,
        etsy_lark_suspended_alert_error: larkErr instanceof Error ? larkErr.message : String(larkErr)
      }, { merge: true });
    }
  }

  return res.status(200).json({ success: true });
}

async function handleClaimCommand(req: VercelRequest, res: VercelResponse) {
  const userProfile = await getVerifiedUserProfile(getTokenFromRequest(req));
  const teamId = req.body?.teamId || userProfile.teamId;
  const target = String(req.body?.target || 'health');

  if (teamId !== userProfile.teamId) {
    return res.status(403).json({ success: false, message: 'Cannot read commands from another team.' });
  }
  if (target !== 'health') {
    return res.status(400).json({ success: false, message: 'Unsupported command target.' });
  }

  const db = getDb();
  const commandsRef = db.collection('user').doc(teamId).collection('worker_commands');
  const pendingSnap = await commandsRef.where('status', '==', 'pending').limit(25).get();
  const commandDoc = pendingSnap.docs.find(doc => doc.data()?.target === target);

  if (!commandDoc) {
    return res.status(200).json({ success: true, command: null });
  }

  const claimed = await db.runTransaction(async tx => {
    const fresh = await tx.get(commandDoc.ref);
    if (!fresh.exists) return null;

    const data = fresh.data() || {};
    if (data.status !== 'pending' || data.target !== target) return null;

    tx.set(commandDoc.ref, {
      status: 'running',
      claimed_at: new Date().toISOString(),
      claimed_by: userProfile.email || userProfile.uid || 'health-extension',
      updated_at: new Date().toISOString(),
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
  await commandRef.set({
    status,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    result: req.body?.result || null,
    error: req.body?.error || null,
  }, { merge: true });

  return res.status(200).json({ success: true });
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

async function getVerifiedUserProfile(idToken: string) {
  const adminApp = initFirebaseAdmin();
  const adminAuth = getAuth(adminApp);
  const decoded = await adminAuth.verifyIdToken(idToken);
  const db = getDb();
  const roleDoc = await db.collection('user_roles').doc(decoded.uid).get();

  if (!roleDoc.exists) {
    throw new Error('User role not found.');
  }

  const data = roleDoc.data() || {};
  if (!data.teamId) {
    throw new Error('User teamId not found.');
  }

  return {
    uid: decoded.uid,
    email: decoded.email || data.email,
    teamId: data.teamId as string,
    role: data.role as string,
    permissions: (data.permissions || {}) as Record<string, boolean>,
    allowedAccounts: Array.isArray(data.allowedAccounts) ? data.allowedAccounts.map(String) : []
  };
}

async function getTeamShops(teamId: string, userProfile: Awaited<ReturnType<typeof getVerifiedUserProfile>>) {
  const db = getDb();
  const snapshot = await db.collection('user').doc(teamId).collection('accounts').get();
  const allowed = new Set(userProfile.allowedAccounts || []);
  const hasFullAccountAccess = userProfile.role === 'owner' || userProfile.permissions?.canManageSettings === true;

  if (!hasFullAccountAccess && allowed.size === 0) {
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
    .filter(shop => hasFullAccountAccess || allowed.has(shop.id) || (shop.email && allowed.has(String(shop.email))) || allowed.has(shop.label))
    .filter(shop => Boolean(shop.label))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function canAccessAccount(
  accountId: string,
  data: Record<string, any>,
  userProfile: Awaited<ReturnType<typeof getVerifiedUserProfile>>
) {
  if (userProfile.role === 'owner' || userProfile.permissions?.canManageSettings === true) return true;

  const allowed = new Set(userProfile.allowedAccounts || []);
  if (allowed.size === 0) return false;

  const label = String(data.label || data.shopName || data.email || accountId);
  const email = data.email ? String(data.email) : '';

  return allowed.has(accountId) || (email ? allowed.has(email) : false) || allowed.has(label);
}
