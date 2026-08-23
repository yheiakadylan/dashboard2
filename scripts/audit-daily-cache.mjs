import fs from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
//lenh va loi npm run audit:daily-cache -- --from=2026-06-29 --to=2026-07-12 --offsets=p7,m7,m8 --collections=records,reviews --fix
const TEAM_ID = 'jwnm5emo8mdG3gjIlh7CctiVvQO2';
const CACHE_VERSION = 1;
const CACHE_INLINE_LIMIT = 180;
const CACHE_PAGE_SIZE = 220;
const OFFSET_BY_KEY = { p7: '+07:00', m7: '-07:00', m8: '-08:00' };
const FIELD_BY_COLLECTION = { records: 'dt_local', reviews: 'create_date' };

const loadEnv = (path) => {
  if (!fs.existsSync(path)) return;
  for (const rawLine of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
};

const getArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const listDates = (from, to) => {
  const dates = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    const date = new Date(`${cursor}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    cursor = date.toISOString().slice(0, 10);
  }
  return dates;
};

const buildRange = (date, offsetKey) => {
  const offset = OFFSET_BY_KEY[offsetKey];
  return {
    fromISO: new Date(`${date}T00:00:00.000${offset}`).toISOString(),
    toISO: new Date(`${date}T23:59:59.999${offset}`).toISOString(),
  };
};

const readCachedIds = async (metaRef, cache) => {
  if (!cache) return [];
  if (Number(cache.pageCount || 0) === 0) {
    return Array.isArray(cache.itemsInline) ? cache.itemsInline.map(item => String(item.id || '')).sort() : [];
  }
  const pages = await metaRef.collection('pages').orderBy('__name__').get();
  return pages.docs.flatMap(page => page.data().items || []).map(item => String(item.id || '')).sort();
};

const rebuildCache = async (db, { teamId, collectionName, offsetKey, date, liveDocs }) => {
  const cacheKey = `${collectionName}__${offsetKey}__${date}`;
  const metaRef = db.collection('user').doc(teamId).collection('daily_cache').doc(cacheKey);
  const existingPages = await metaRef.collection('pages').listDocuments();
  const items = liveDocs.map(doc => ({ id: doc.id, ...doc.data() }));
  const pageCount = items.length > CACHE_INLINE_LIMIT ? Math.ceil(items.length / CACHE_PAGE_SIZE) : 0;
  const field = FIELD_BY_COLLECTION[collectionName];
  const { fromISO, toISO } = buildRange(date, offsetKey);
  const nowISO = new Date().toISOString();
  const writes = [];
  let batch = db.batch();
  let writeCount = 0;
  const flush = () => {
    if (!writeCount) return;
    writes.push(batch.commit());
    batch = db.batch();
    writeCount = 0;
  };

  for (const pageRef of existingPages) {
    if (writeCount >= 450) flush();
    batch.delete(pageRef);
    writeCount += 1;
  }

  if (writeCount >= 450) flush();
  batch.set(metaRef, {
    version: CACHE_VERSION,
    teamId,
    date,
    offsetKey,
    collectionName,
    field,
    fromISO,
    toISO,
    status: 'ready',
    dirty: false,
    dirtyReason: null,
    itemCount: items.length,
    pageCount,
    builtAt: nowISO,
    updatedAt: nowISO,
    ...(pageCount === 0 ? { itemsInline: items } : {}),
  });
  writeCount += 1;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (writeCount >= 450) flush();
    batch.set(metaRef.collection('pages').doc(String(pageIndex).padStart(3, '0')), {
      items: items.slice(pageIndex * CACHE_PAGE_SIZE, (pageIndex + 1) * CACHE_PAGE_SIZE),
      updatedAt: nowISO,
    });
    writeCount += 1;
  }

  flush();
  await Promise.all(writes);
};

loadEnv('.env.local');
const from = getArg('from');
const to = getArg('to');
const fix = process.argv.includes('--fix');
const teamId = getArg('teamId', TEAM_ID);
const offsets = getArg('offsets', 'p7,m7,m8').split(',').filter(key => key in OFFSET_BY_KEY);
const collections = getArg('collections', 'records').split(',').filter(key => key in FIELD_BY_COLLECTION);
if (!from || !to) throw new Error('Required: --from=YYYY-MM-DD --to=YYYY-MM-DD');
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  throw new Error('Missing Firebase Admin credentials');
}

const app = getApps()[0] || initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore(app);
db.settings({ preferRest: true });

const results = [];
for (const date of listDates(from, to)) {
  for (const offsetKey of offsets) {
    for (const collectionName of collections) {
      const field = FIELD_BY_COLLECTION[collectionName];
      const { fromISO, toISO } = buildRange(date, offsetKey);
      const liveSnapshot = await db.collection('user').doc(teamId).collection(collectionName)
        .where(field, '>=', fromISO)
        .where(field, '<=', toISO)
        .get();
      const cacheKey = `${collectionName}__${offsetKey}__${date}`;
      const cacheRef = db.collection('user').doc(teamId).collection('daily_cache').doc(cacheKey);
      const cacheSnapshot = await cacheRef.get();
      const cache = cacheSnapshot.exists ? cacheSnapshot.data() : null;
      const cacheCount = cache ? Number(cache.itemCount || 0) : null;
      const liveIds = liveSnapshot.docs.map(doc => doc.id).sort();
      const cachedIds = await readCachedIds(cacheRef, cache);
      const idsMatch = liveIds.length === cachedIds.length && liveIds.every((id, index) => id === cachedIds[index]);
      const valid = Boolean(cache && cache.status === 'ready' && cache.dirty !== true && cache.version === CACHE_VERSION && cacheCount === liveSnapshot.size && idsMatch);
      let action = valid ? 'ok' : 'mismatch';
      if (!valid && fix) {
        await rebuildCache(db, { teamId, collectionName, offsetKey, date, liveDocs: liveSnapshot.docs });
        action = 'rebuilt';
      }
      results.push({ cacheKey, liveCount: liveSnapshot.size, cacheCount, status: cache?.status || 'missing', action });
      console.log(`${action.padEnd(8)} ${cacheKey} live=${liveSnapshot.size} cache=${cacheCount ?? 'missing'}`);
    }
  }
}

const summary = results.reduce((acc, result) => {
  acc[result.action] = (acc[result.action] || 0) + 1;
  return acc;
}, {});
console.log('SUMMARY', summary);