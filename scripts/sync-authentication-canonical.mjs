#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');
const selfCheck = args.has('--self-check');
const roleArg = process.argv.slice(2).find(arg => arg.startsWith('--role='));

const SOURCE_COLLECTIONS = ['users_roles', 'user_roles'];
const DASHBOARD_APP_ID = 'dashboard';
const SHARED_TEAM_ID = 'jwnm5emo8mdG3gjIlh7CctiVvQO2';
const UPDATED_BY = 'sync:authentication';
const VALID_ROLES = new Set([
  'ADMIN', 'MANAGER',
  'CS_SUPPORT', 'CS_FULFILL',
  'LEADCS_SUPPORT', 'LEADCS_FULFILL',
  'DS_FULFILL', 'DS_IDEA', 'LEADDS_FULFILL', 'LEADDS_IDEA',
  'IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE',
]);
const ROLE_ALIASES = new Map([
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

const stripQuotes = value => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const loadEnv = () => {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = stripQuotes(trimmed.slice(index + 1));
    if (key && !process.env[key]) process.env[key] = value;
  }
};

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = value => normalizeText(value).toLowerCase();
const normalizeKey = value => normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_');
const normalizeArray = value => Array.isArray(value)
  ? Array.from(new Set(value
    .filter(item => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)))
  : [];
const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const normalizePermissions = value => isPlainObject(value)
  ? Object.fromEntries(Object.entries(value).filter(([key, val]) => key.trim() && typeof val === 'boolean'))
  : {};
const pickText = (...values) => values.map(normalizeText).find(Boolean) || '';
const pickExistingObject = (existing, fallback) =>
  !force && Object.keys(existing).length ? existing : fallback;
const pickExistingArray = (existing, fallback) =>
  !force && existing.length ? existing : fallback;

const normalizeSharedRole = value => {
  const raw = normalizeText(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (VALID_ROLES.has(upper)) return upper;
  return ROLE_ALIASES.get(normalizeKey(raw)) || null;
};

const forcedRole = roleArg ? normalizeSharedRole(roleArg.slice('--role='.length)) : null;
if (roleArg && !forcedRole) {
  throw new Error(`Invalid --role value: ${roleArg.slice('--role='.length)}`);
}

const inferRole = legacy => {
  const role = normalizeSharedRole(legacy.role ?? legacy.sharedRole ?? legacy.nhmediaRole ?? legacy.userRole);
  if (role) return { role, warning: null };

  const permissions = normalizePermissions(legacy.permissions);
  if (permissions.canManageUsers || permissions.canManageSettings) {
    return { role: 'MANAGER', warning: 'fallback MANAGER from management permission' };
  }

  return { role: 'CS_SUPPORT', warning: 'fallback CS_SUPPORT from missing/unknown legacy role' };
};

const getDepartmentFromRole = role => {
  if (['DS_IDEA', 'DS_FULFILL', 'LEADDS_IDEA', 'LEADDS_FULFILL'].includes(role)) return 'Designer';
  if (['IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE'].includes(role)) return 'IDEA';
  if (['CS_SUPPORT', 'CS_FULFILL', 'LEADCS_SUPPORT', 'LEADCS_FULFILL'].includes(role)) return 'Customer Service';
  if (['ADMIN', 'MANAGER'].includes(role)) return 'Management';
  return null;
};

const resolveAuthUser = async (auth, sourceId, legacy) => {
  try {
    return await auth.getUser(sourceId);
  } catch {}

  const email = normalizeEmail(legacy.email ?? legacy.user_email ?? legacy.userEmail);
  if (!email) return null;

  try {
    return await auth.getUserByEmail(email);
  } catch {
    return null;
  }
};

const collectLegacyUsers = async db => {
  const users = new Map();
  for (const collectionName of SOURCE_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    console.log(`${collectionName}: ${snapshot.size} docs`);
    snapshot.docs.forEach(doc => {
      const current = users.get(doc.id);
      const data = doc.data() || {};
      users.set(doc.id, {
        id: doc.id,
        legacy: current ? { ...data, ...current.legacy } : data,
        sources: [...(current?.sources || []), collectionName],
      });
    });
  }
  return [...users.values()];
};

const buildRecord = async (db, auth, item) => {
  const legacy = item.legacy;
  const authUser = await resolveAuthUser(auth, item.id, legacy);
  if (!authUser) return { skip: `missing Firebase Auth user for ${item.id}` };

  const uid = authUser.uid;
  const [commonSnapshot, appSnapshot] = await Promise.all([
    db.doc(`authentication/${uid}`).get(),
    db.doc(`authentication/${uid}/apps/${DASHBOARD_APP_ID}`).get(),
  ]);
  const existingCommon = commonSnapshot.data() || {};
  const existingApp = appSnapshot.data() || {};
  const email = normalizeEmail(legacy.email ?? legacy.user_email ?? legacy.userEmail)
    || normalizeEmail(existingCommon.email)
    || normalizeEmail(authUser.email);
  if (!email) return { skip: `missing email for ${uid}` };

  const fallbackName = email.split('@')[0] || uid;
  const fullName = pickText(
    force ? '' : existingCommon.fullName,
    legacy.fullName,
    legacy.full_name,
    legacy.name,
    legacy.displayName,
    legacy.display_name,
    authUser.displayName,
    fallbackName,
  );
  const displayName = pickText(
    force ? '' : existingCommon.displayName,
    legacy.displayName,
    legacy.display_name,
    fullName,
  );
  const empID = pickText(
    force ? '' : existingCommon.empID,
    legacy.empID,
    legacy.employeeId,
    legacy.employeeID,
    legacy.staffId,
    legacy.user_number,
    legacy.userNumber,
  ) || null;
  const inferred = inferRole(legacy);
  const role = forcedRole
    || (!force && normalizeSharedRole(existingCommon.role) ? normalizeSharedRole(existingCommon.role) : inferred.role);
  const existingPermissions = normalizePermissions(existingApp.permissions);
  const legacyPermissions = normalizePermissions(legacy.permissions);
  const existingAllowedAccounts = normalizeArray(existingApp.allowedAccounts);
  const legacyAllowedAccounts = normalizeArray(legacy.allowedAccounts);
  const enabled = !force && typeof existingApp.enabled === 'boolean' ? existingApp.enabled : true;
  const active = normalizeEmail(email) === 'haitrinh@gmail.com'
    ? true
    : typeof legacy.active === 'boolean'
      ? legacy.active
      : legacy.disabled === true
        ? false
        : existingCommon.active !== false;

  return {
    uid,
    role,
    warning: inferred.warning,
    common: {
      uid,
      email,
      fullName,
      displayName,
      empID,
      role,
      department: getDepartmentFromRole(role),
      teamId: SHARED_TEAM_ID,
      active,
      photoURL: pickText(force ? '' : existingCommon.photoURL, legacy.photoURL, authUser.photoURL) || null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: UPDATED_BY,
    },
    app: {
      appId: DASHBOARD_APP_ID,
      enabled,
      allowedAccounts: pickExistingArray(existingAllowedAccounts, legacyAllowedAccounts),
      permissions: pickExistingObject(existingPermissions, legacyPermissions),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: UPDATED_BY,
    },
    claims: {
      ...(authUser.customClaims || {}),
      role,
      admin: role === 'ADMIN' || role === 'MANAGER',
    },
    sources: item.sources,
  };
};

const init = () => {
  loadEnv();
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY.');
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
  }
  return { db: getFirestore(), auth: getAuth() };
};

const runSelfCheck = () => {
  assert.equal(normalizeSharedRole('owner'), 'ADMIN');
  assert.equal(normalizeSharedRole('DS_FULFILL'), 'DS_FULFILL');
  assert.equal(normalizeSharedRole('admin'), 'ADMIN');
  assert.equal(inferRole({ permissions: { canManageUsers: true } }).role, 'MANAGER');
  assert.deepEqual(normalizeArray([' A@X.COM ', 'a@x.com', '', null]), ['a@x.com']);
  assert.deepEqual(normalizePermissions({ a: true, b: false, c: 'yes' }), { a: true, b: false });
  console.log('self-check passed');
};

const main = async () => {
  if (selfCheck) {
    runSelfCheck();
    return;
  }

  const { db, auth } = init();
  const legacyUsers = await collectLegacyUsers(db);
  let synced = 0;
  let skipped = 0;
  let warned = 0;

  for (const item of legacyUsers) {
    const record = await buildRecord(db, auth, item);
    if (record.skip) {
      skipped += 1;
      console.warn(`skip: ${record.skip}`);
      continue;
    }
    if (record.warning) {
      warned += 1;
      console.warn(`warn: ${record.uid} ${record.warning}`);
    }

    if (dryRun) {
      console.log(`dry-run: ${record.uid} ${record.email || record.common.email} role=${record.role} sources=${record.sources.join(',')}`);
      synced += 1;
      continue;
    }

    const batch = db.batch();
    batch.set(db.doc(`authentication/${record.uid}`), record.common, { merge: true });
    batch.set(db.doc(`authentication/${record.uid}/apps/${DASHBOARD_APP_ID}`), record.app, { merge: true });
    await batch.commit();
    await auth.setCustomUserClaims(record.uid, record.claims);
    console.log(`synced: ${record.uid} ${record.common.email} role=${record.role}`);
    synced += 1;
  }

  console.log(`done: synced=${synced} skipped=${skipped} warnings=${warned} dryRun=${dryRun} force=${force} role=${forcedRole || 'source'}`);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
