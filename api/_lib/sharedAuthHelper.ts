import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';

export const SHARED_APP_IDS = ['dashboard', 'workload'] as const;
export type SharedAppId = typeof SHARED_APP_IDS[number];

export const SHARED_ROLES = [
  'ADMIN', 'MANAGER',
  'CS_SUPPORT', 'CS_FULFILL',
  'LEADCS_SUPPORT', 'LEADCS_FULFILL',
  'DS_FULFILL', 'DS_IDEA', 'LEADDS_FULFILL', 'LEADDS_IDEA',
  'IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE',
] as const;

export type SharedRole = typeof SHARED_ROLES[number];

const sharedAppIdSet = new Set<string>(SHARED_APP_IDS);
const sharedRoleSet = new Set<string>(SHARED_ROLES);
const LEGACY_AUTH_COLLECTIONS = ['user_roles', 'users_roles', 'users'] as const;
const LEGACY_EMAIL_FIELDS = ['email', 'user_email', 'userEmail'] as const;
const LEGACY_EMP_ID_FIELDS = ['empID', 'employeeId', 'employeeID', 'staffId', 'user_number', 'userNumber'] as const;
const DASHBOARD_APP_ID: SharedAppId = 'dashboard';
const SHARED_TEAM_ID = 'jwnm5emo8mdG3gjIlh7CctiVvQO2';
export const AUTHENTICATION_ADMIN_EMAIL = 'haitrinh@gmail.com';
export const AUTHENTICATION_ADMIN_EMAILS = [AUTHENTICATION_ADMIN_EMAIL, 'buonngu@gmail.com'] as const;
const authenticationAdminEmailSet = new Set<string>(AUTHENTICATION_ADMIN_EMAILS);
export const isAuthenticationAdminEmail = (email: unknown): boolean =>
  authenticationAdminEmailSet.has(normalizeEmail(email));

const roleAliases = new Map<string, SharedRole>([
  ['owner', 'ADMIN'],
  ['admin', 'ADMIN'],
  ['administrator', 'ADMIN'],
  ['super_admin', 'ADMIN'],
  ['manager', 'MANAGER'],
  ['head', 'MANAGER'],
  ['lead', 'MANAGER'],
  ['user', 'CS_SUPPORT'],
  ['cs', 'CS_SUPPORT'],
  ['support', 'CS_SUPPORT'],
  ['fulfill', 'CS_FULFILL'],
  ['cs_support', 'CS_SUPPORT'],
  ['cs_fulfill', 'CS_FULFILL'],
  ['leadcs_support', 'LEADCS_SUPPORT'],
  ['leadcs_fulfill', 'LEADCS_FULFILL'],
  ['designer_fulfill', 'DS_FULFILL'],
  ['designer_idea', 'DS_IDEA'],
  ['design_fulfill', 'DS_FULFILL'],
  ['design_idea', 'DS_IDEA'],
  ['ds_fulfill', 'DS_FULFILL'],
  ['ds_idea', 'DS_IDEA'],
  ['idea_rd', 'IDEA_RD'],
  ['idea_scale', 'IDEA_SCALE'],
]);

type AdminAuthUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  customClaims?: Record<string, unknown>;
};

type AdminAuthLike = {
  getUser(uid: string): Promise<AdminAuthUser>;
  getUserByEmail(email: string): Promise<AdminAuthUser>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
};

type LegacyAuthRecord = {
  id: string;
  collectionName: string;
  data: DocumentData;
};

export class SharedAuthError extends Error {
  code: string;
  status: number;
  field: 'identifier' | 'password' | 'credentials' | 'server';

  constructor(
    message: string,
    options: {
      code: string;
      status: number;
      field?: 'identifier' | 'password' | 'credentials' | 'server';
    },
  ) {
    super(message);
    this.name = 'SharedAuthError';
    this.code = options.code;
    this.status = options.status;
    this.field = options.field || 'credentials';
  }
}

export const normalizeSharedAppId = (value: unknown): SharedAppId | null => {
  if (typeof value !== 'string') return null;
  return sharedAppIdSet.has(value) ? value as SharedAppId : null;
};

export const normalizeSharedRole = (value: unknown): SharedRole | null => {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const role = raw.toUpperCase();
  return sharedRoleSet.has(role) ? role as SharedRole : null;
};

export const isManagementRole = (role: SharedRole): boolean =>
  role === 'ADMIN' || role === 'MANAGER';

const normalizeEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeKey = (value: unknown): string =>
  normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_');

const normalizeArray = (value: unknown): string[] => Array.isArray(value)
  ? Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)))
  : [];

const normalizePermissions = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, boolean] => entry[0].trim().length > 0 && typeof entry[1] === 'boolean'),
  );
};

const pickText = (...values: unknown[]): string =>
  values.map(normalizeText).find(Boolean) || '';

const normalizeLegacyRole = (value: unknown): SharedRole | null =>
  normalizeSharedRole(value) || roleAliases.get(normalizeKey(value)) || null;

const inferLegacyRole = (legacy: DocumentData): { role: SharedRole; warning: string | null } => {
  const role = normalizeLegacyRole(legacy.role ?? legacy.sharedRole ?? legacy.nhmediaRole ?? legacy.userRole);
  if (role) return { role, warning: null };
  const permissions = normalizePermissions(legacy.permissions);
  if (permissions.canManageUsers || permissions.canManageSettings) {
    return { role: 'MANAGER', warning: 'fallback MANAGER from management permission' };
  }
  return { role: 'CS_SUPPORT', warning: 'fallback CS_SUPPORT from missing/unknown legacy role' };
};

const getDepartmentFromRole = (role: SharedRole): string | null => {
  if (['DS_IDEA', 'DS_FULFILL', 'LEADDS_IDEA', 'LEADDS_FULFILL'].includes(role)) return 'Designer';
  if (['IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE'].includes(role)) return 'IDEA';
  if (['CS_SUPPORT', 'CS_FULFILL', 'LEADCS_SUPPORT', 'LEADCS_FULFILL'].includes(role)) return 'Customer Service';
  if (['ADMIN', 'MANAGER'].includes(role)) return 'Management';
  return null;
};

const findByEmpId = async (db: Firestore, collectionName: string, empID: string) => {
  let snapshot = await db.collection(collectionName).where('empID', '==', empID).limit(2).get();
  const upperEmpID = empID.toUpperCase();

  if (snapshot.empty && upperEmpID !== empID) {
    snapshot = await db.collection(collectionName).where('empID', '==', upperEmpID).limit(2).get();
  }

  return snapshot;
};

const getLegacyEmail = (legacy: DocumentData): string =>
  LEGACY_EMAIL_FIELDS.map(field => normalizeEmail(legacy[field])).find(Boolean) || '';

const getLegacyEmpId = (legacy: DocumentData): string =>
  LEGACY_EMP_ID_FIELDS.map(field => normalizeText(legacy[field])).find(Boolean) || '';

const findLegacyByUid = async (db: Firestore, uid: string): Promise<LegacyAuthRecord | null> => {
  for (const collectionName of LEGACY_AUTH_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).doc(uid).get();
    if (snapshot.exists) return { id: snapshot.id, collectionName, data: snapshot.data() || {} };
  }
  return null;
};

const findLegacyByField = async (
  db: Firestore,
  fields: readonly string[],
  value: string,
): Promise<LegacyAuthRecord[]> => {
  const found = new Map<string, LegacyAuthRecord>();
  for (const collectionName of LEGACY_AUTH_COLLECTIONS) {
    for (const field of fields) {
      const snapshot = await db.collection(collectionName).where(field, '==', value).limit(2).get();
      snapshot.docs.forEach(doc => {
        found.set(`${collectionName}/${doc.id}`, { id: doc.id, collectionName, data: doc.data() || {} });
      });
    }
  }
  return [...found.values()];
};

const findLegacyByEmail = async (db: Firestore, email: string): Promise<LegacyAuthRecord | null> => {
  const records = await findLegacyByField(db, LEGACY_EMAIL_FIELDS, normalizeEmail(email));
  return records.find(record => getLegacyEmail(record.data) === normalizeEmail(email)) || null;
};

const findLegacyByIdentifier = async (db: Firestore, identifier: string): Promise<LegacyAuthRecord | null> => {
  const normalizedIdentifier = identifier.trim();
  if (normalizedIdentifier.includes('@')) return findLegacyByEmail(db, normalizedIdentifier);

  const variants = Array.from(new Set([normalizedIdentifier, normalizedIdentifier.toUpperCase()]));
  const records = (await Promise.all(variants.map(value => findLegacyByField(db, LEGACY_EMP_ID_FIELDS, value)))).flat();
  const byPath = new Map(records.map(record => [`${record.collectionName}/${record.id}`, record]));
  const matches = [...byPath.values()].filter(record => getLegacyEmpId(record.data).toUpperCase() === normalizedIdentifier.toUpperCase());
  if (matches.length > 1) {
    const emails = new Set(matches.map(record => getLegacyEmail(record.data)).filter(Boolean));
    if (emails.size > 1) {
      throw new SharedAuthError('Employee ID is duplicated in the legacy user data.', {
        code: 'EMP_ID_DUPLICATED',
        status: 409,
        field: 'identifier',
      });
    }
  }
  return matches[0] || null;
};

export async function resolveEmailFromIdentifier(db: Firestore, identifier: string): Promise<string> {
  const normalizedIdentifier = identifier.trim();
  if (normalizedIdentifier.includes('@')) return normalizeEmail(normalizedIdentifier);

  const snapshot = await findByEmpId(db, 'authentication', normalizedIdentifier);
  if (snapshot.size > 1) {
    throw new SharedAuthError('Employee ID is duplicated in the system.', {
      code: 'EMP_ID_DUPLICATED',
      status: 409,
      field: 'identifier',
    });
  }
  if (!snapshot.empty) {
    const email = normalizeEmail(snapshot.docs[0].data().email);
    if (!email) {
      throw new SharedAuthError('This employee does not have a login email configured.', {
        code: 'USER_PROFILE_MISSING',
        status: 403,
        field: 'identifier',
      });
    }
    return email;
  }

  const legacyRecord = await findLegacyByIdentifier(db, normalizedIdentifier);
  if (legacyRecord) {
    const email = getLegacyEmail(legacyRecord.data);
    if (!email) {
      throw new SharedAuthError('This employee does not have a login email configured.', {
        code: 'USER_PROFILE_MISSING',
        status: 403,
        field: 'identifier',
      });
    }
    return email;
  }

  throw new SharedAuthError('Employee ID or email was not found.', {
    code: 'EMP_ID_NOT_FOUND',
    status: 401,
    field: 'identifier',
  });
}

export async function syncLegacyAuthenticationProfile(
  db: Firestore,
  authUser: AdminAuthUser,
  updatedBy: string,
  fallbackEmail = '',
  options: { requireDashboardAccess?: boolean } = {},
): Promise<AppAccessProfile> {
  const email = normalizeEmail(authUser.email || fallbackEmail);
  const legacyRecord = await findLegacyByUid(db, authUser.uid)
    || (email ? await findLegacyByEmail(db, email) : null);
  if (!legacyRecord) {
    throw new SharedAuthError('This account is not configured in authentication or legacy user roles.', {
      code: 'USER_PROFILE_MISSING',
      status: 403,
      field: 'identifier',
    });
  }

  const legacy = legacyRecord.data;
  const [existingCommonSnapshot, existingAppSnapshot] = await Promise.all([
    db.doc(`authentication/${authUser.uid}`).get(),
    db.doc(`authentication/${authUser.uid}/apps/${DASHBOARD_APP_ID}`).get(),
  ]);
  const existingCommon = existingCommonSnapshot.data() || {};
  const existingApp = existingAppSnapshot.data() || {};
  const existingRole = normalizeSharedRole(existingCommon.role);
  const role = isAuthenticationAdminEmail(email) ? 'ADMIN' : existingRole || inferLegacyRole(legacy).role;
  const finalEmail = getLegacyEmail(legacy) || email;
  if (!finalEmail) {
    throw new SharedAuthError('This employee does not have a login email configured.', {
      code: 'USER_PROFILE_MISSING',
      status: 403,
      field: 'identifier',
    });
  }

  const fallbackName = finalEmail.split('@')[0] || authUser.uid;
  const fullName = pickText(existingCommon.fullName, legacy.fullName, legacy.full_name, legacy.name, legacy.displayName, legacy.display_name, authUser.displayName, fallbackName);
  const displayName = pickText(existingCommon.displayName, legacy.displayName, legacy.display_name, fullName);
  const active = isAuthenticationAdminEmail(email)
    ? true
    : typeof existingCommon.active === 'boolean'
      ? existingCommon.active
      : typeof legacy.active === 'boolean'
      ? legacy.active
      : legacy.disabled === true
        ? false
        : true;
  const existingPermissions = normalizePermissions(existingApp.permissions);
  const legacyPermissions = normalizePermissions(legacy.permissions);
  const existingAllowedAccounts = normalizeArray(existingApp.allowedAccounts);
  const legacyAllowedAccounts = normalizeArray(legacy.allowedAccounts);
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  const commonData = {
    uid: authUser.uid,
    email: finalEmail,
    fullName,
    displayName,
    empID: pickText(existingCommon.empID, getLegacyEmpId(legacy)) || null,
    role,
    department: getDepartmentFromRole(role),
    teamId: normalizeText(existingCommon.teamId) || normalizeText(legacy.teamId) || SHARED_TEAM_ID,
    active,
    photoURL: pickText(existingCommon.photoURL, legacy.photoURL, authUser.photoURL) || null,
    updatedAt: now,
    updatedBy,
    legacySource: legacyRecord.collectionName,
  };
  const appData = {
    appId: DASHBOARD_APP_ID,
    enabled: typeof existingApp.enabled === 'boolean' ? existingApp.enabled : true,
    allowedAccounts: existingAllowedAccounts.length ? existingAllowedAccounts : legacyAllowedAccounts,
    permissions: Object.keys(existingPermissions).length ? existingPermissions : legacyPermissions,
    updatedAt: now,
    updatedBy,
    legacySource: legacyRecord.collectionName,
  };

  batch.set(db.doc(`authentication/${authUser.uid}`), commonData, { merge: true });
  batch.set(db.doc(`authentication/${authUser.uid}/apps/${DASHBOARD_APP_ID}`), appData, { merge: true });
  await batch.commit();

  if (options.requireDashboardAccess === false) {
    return {
      uid: authUser.uid,
      email: finalEmail,
      displayName,
      empID: commonData.empID,
      role,
      commonData,
      appData,
    };
  }

  return loadAppAccessProfile(db, authUser.uid, DASHBOARD_APP_ID, finalEmail);
}

export async function syncLegacyAuthenticationUsers(
  db: Firestore,
  auth: AdminAuthLike,
  updatedBy: string,
): Promise<{ synced: number; skipped: number; warnings: number }> {
  const items = new Map<string, { id: string; data: DocumentData; sources: string[] }>();
  for (const collectionName of LEGACY_AUTH_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    snapshot.docs.forEach(doc => {
      const current = items.get(doc.id);
      items.set(doc.id, {
        id: doc.id,
        data: current ? { ...doc.data(), ...current.data } : doc.data(),
        sources: [...(current?.sources || []), collectionName],
      });
    });
  }

  let synced = 0;
  let skipped = 0;
  let warnings = 0;

  for (const item of items.values()) {
    const email = getLegacyEmail(item.data);
    const authUser = await auth.getUser(item.id).catch(() => email ? auth.getUserByEmail(email).catch(() => null) : null);
    if (!authUser) {
      skipped += 1;
      continue;
    }
    const inferred = inferLegacyRole(item.data);
    if (inferred.warning) warnings += 1;
    const profile = await syncLegacyAuthenticationProfile(db, authUser, updatedBy, email, { requireDashboardAccess: false });
    await auth.setCustomUserClaims(authUser.uid, {
      ...(authUser.customClaims || {}),
      role: profile.role,
      admin: isManagementRole(profile.role),
    });
    synced += 1;
  }

  return { synced, skipped, warnings };
}

export interface AppAccessProfile {
  uid: string;
  email: string;
  displayName: string;
  empID: string | null;
  role: SharedRole;
  commonData: DocumentData;
  appData: DocumentData;
}

const APP_ACCESS_LABELS: Record<SharedAppId, string> = {
  dashboard: 'Dashboard',
  workload: 'Workload',
};

const createAppAccessMessage = (appId: SharedAppId) =>
  `Tài khoản chưa được cấp quyền truy cập ${APP_ACCESS_LABELS[appId]}. Vui lòng liên hệ quản trị viên.`;

export async function loadAppAccessProfile(
  db: Firestore,
  uid: string,
  appId: SharedAppId,
  fallbackEmail = '',
): Promise<AppAccessProfile> {
  const [commonSnapshot, appSnapshot] = await Promise.all([
    db.doc(`authentication/${uid}`).get(),
    db.doc(`authentication/${uid}/apps/${appId}`).get(),
  ]);

  const commonData = commonSnapshot.exists ? commonSnapshot.data() || null : null;
  const appData = appSnapshot.exists ? appSnapshot.data() || null : null;

  if (!commonData) {
    throw new SharedAuthError('This account is not configured in the system.', {
      code: 'USER_PROFILE_MISSING',
      status: 403,
      field: 'identifier',
    });
  }

  if (commonData.active !== true) {
    throw new SharedAuthError('This account is inactive. Please contact an administrator.', {
      code: 'USER_INACTIVE',
      status: 403,
      field: 'identifier',
    });
  }

  if (!appData || appData.enabled !== true) {
    throw new SharedAuthError(createAppAccessMessage(appId), {
      code: 'APP_ACCESS_DENIED',
      status: 403,
      field: 'identifier',
    });
  }

  const role = normalizeSharedRole(commonData.role);

  if (!role) {
    throw new SharedAuthError('This account does not have a valid shared role.', {
      code: 'USER_ROLE_INVALID',
      status: 403,
      field: 'identifier',
    });
  }

  const email = normalizeEmail(commonData.email || fallbackEmail);
  const displayName = String(
    commonData.displayName
    || commonData.fullName
    || email.split('@')[0]
    || 'User',
  );

  return {
    uid,
    email,
    displayName,
    empID: typeof commonData.empID === 'string'
      ? commonData.empID
      : null,
    role,
    commonData,
    appData,
  };
}

export function getFirebaseWebApiKey(): string | undefined {
  return process.env.FIREBASE_WEB_API_KEY
    || process.env.VITE_FIREBASE_API_KEY
    || process.env.FIREBASE_API_KEY;
}

export async function authenticateWithPassword(
  email: string,
  password: string,
  requestOrigin?: string,
): Promise<{ localId: string }> {
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey) {
    throw new SharedAuthError('Missing Firebase Web API key for the login API.', {
      code: 'AUTH_CONFIG_MISSING',
      status: 500,
      field: 'server',
    });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (requestOrigin) {
    try {
      const origin = new URL(requestOrigin).origin;
      headers.Origin = origin;
      headers.Referer = `${origin}/`;
    } catch {}
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const firebaseCode = String(data?.error?.message || 'INVALID_LOGIN_CREDENTIALS');
    console.warn('[Shared auth] Firebase password verification failed:', firebaseCode);
    if (
      firebaseCode.includes('API_KEY')
      || firebaseCode === 'PROJECT_NOT_FOUND'
      || firebaseCode === 'CONFIGURATION_NOT_FOUND'
      || firebaseCode === 'OPERATION_NOT_ALLOWED'
    ) {
      throw new SharedAuthError('Firebase password authentication is not configured correctly.', {
        code: 'AUTH_CONFIG_INVALID',
        status: 500,
        field: 'server',
      });
    }
    if (firebaseCode === 'USER_DISABLED') {
      throw new SharedAuthError('This account is disabled. Please contact an administrator.', {
        code: 'USER_DISABLED',
        status: 403,
        field: 'identifier',
      });
    }
    if (firebaseCode === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
      throw new SharedAuthError('Too many failed attempts. Please try again later.', {
        code: 'TOO_MANY_ATTEMPTS',
        status: 429,
        field: 'password',
      });
    }
    throw new SharedAuthError('Invalid employee ID, email, or password.', {
      code: 'INVALID_CREDENTIALS',
      status: 401,
      field: firebaseCode.includes('PASSWORD') ? 'password' : 'credentials',
    });
  }

  const localId = typeof data?.localId === 'string' ? data.localId : '';
  if (!localId) {
    throw new SharedAuthError('Firebase did not return a valid user ID.', {
      code: 'FIREBASE_AUTH_ERROR',
      status: 500,
      field: 'server',
    });
  }

  return { localId };
}
