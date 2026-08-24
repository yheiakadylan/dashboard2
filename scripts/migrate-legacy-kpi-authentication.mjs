#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const TEAM_ID = 'jwnm5emo8mdG3gjIlh7CctiVvQO2';
const apply = process.argv.includes('--apply');
const selfCheck = process.argv.includes('--self-check');

const loadEnv = path => {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
};

const normalizeText = value => typeof value === 'string' ? value.trim() : '';
const normalizeTeams = value => Array.isArray(value)
  ? Array.from(new Set(value.map(normalizeText).filter(Boolean)))
  : [];
const hasKpiConfiguration = data => data.is_kpi === true
  || data.can_view_leaderboard === true
  || Boolean(normalizeText(data.kpi_team))
  || normalizeTeams(data.viewable_kpi_teams).length > 0;

if (selfCheck) {
  assert.equal(hasKpiConfiguration({ is_kpi: true }), true);
  assert.equal(hasKpiConfiguration({ is_kpi: false, can_view_leaderboard: false }), false);
  assert.deepEqual(normalizeTeams([' NH MEDIA ', 'NH MEDIA', '', null]), ['NH MEDIA']);
  console.log('self-check passed');
  process.exit(0);
}

loadEnv('.env');
loadEnv('.env.local');
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) throw new Error('Missing Firebase Admin credentials.');
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

const db = getFirestore();
const legacySnapshot = await db.collection('user_roles').where('teamId', '==', TEAM_ID).get();
const candidates = legacySnapshot.docs.filter(doc => hasKpiConfiguration(doc.data()));
const batch = db.batch();
let migrated = 0;
let skipped = 0;

for (const legacyDoc of candidates) {
  const authRef = db.doc(`authentication/${legacyDoc.id}`);
  const appRef = db.doc(`authentication/${legacyDoc.id}/apps/dashboard`);
  const [authSnapshot, appSnapshot] = await Promise.all([authRef.get(), appRef.get()]);
  if (!authSnapshot.exists || !appSnapshot.exists) {
    skipped += 1;
    continue;
  }

  const legacy = legacyDoc.data();
  const app = appSnapshot.data() || {};
  const kpiData = {
    isKpi: legacy.is_kpi === true,
    canViewLeaderboard: legacy.can_view_leaderboard === true,
    kpiTeam: normalizeText(legacy.kpi_team) || null,
    viewableKpiTeams: normalizeTeams(legacy.viewable_kpi_teams),
  };
  batch.set(appRef, {
    ...kpiData,
    legacyKpiMigrated: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'migration:legacy-kpi',
  }, { merge: true });
  batch.set(db.doc(`authentication/${legacyDoc.id}/kpi/profile`), {
    ...kpiData,
    allowedAccounts: Array.isArray(app.allowedAccounts) ? app.allowedAccounts : [],
    sharedRole: normalizeText(authSnapshot.data()?.role),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'migration:legacy-kpi',
  }, { merge: true });
  migrated += 1;
}

console.log(`${apply ? 'apply' : 'dry-run'}: candidates=${candidates.length} migrated=${migrated} skipped=${skipped}`);
if (apply && migrated > 0) await batch.commit();
