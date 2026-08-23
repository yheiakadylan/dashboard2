import type { Firestore, WriteBatch } from 'firebase-admin/firestore';

export type DailyCacheOffsetKey = 'p7' | 'm7' | 'm8';
export type DailyCacheCollection = 'records' | 'reviews';

interface BuildDailyCacheOptions {
  teamId: string;
  date: string;
  offsetKey: DailyCacheOffsetKey;
  collectionName: DailyCacheCollection;
  force?: boolean;
}

interface BuildDailyCacheResult {
  cacheKey: string;
  collectionName: DailyCacheCollection;
  date: string;
  offsetKey: DailyCacheOffsetKey;
  status: 'built' | 'skipped' | 'failed';
  itemCount: number;
  pageCount: number;
  reason?: string;
}

const CACHE_VERSION = 1;
const DAILY_CACHE_COLLECTION = 'daily_cache';
const CACHE_INLINE_LIMIT = 180;
const CACHE_PAGE_SIZE = 220;
const SUPPORTED_OFFSET_KEYS: DailyCacheOffsetKey[] = ['p7', 'm7', 'm8'];

const OFFSET_BY_KEY: Record<DailyCacheOffsetKey, string> = {
  p7: '+07:00',
  m7: '-07:00',
  m8: '-08:00',
};

const OFFSET_HOUR_BY_KEY: Record<DailyCacheOffsetKey, number> = {
  p7: 7,
  m7: -7,
  m8: -8,
};

export const TRANSITION_UTC_HOUR_BY_KEY: Record<DailyCacheOffsetKey, number> = {
  p7: 17,
  m7: 7,
  m8: 8,
};

const FIELD_BY_COLLECTION: Record<DailyCacheCollection, 'dt_local' | 'create_date'> = {
  records: 'dt_local',
  reviews: 'create_date',
};

const formatDateUTC = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (dateStr: string, amount: number): string => {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateUTC(date);
};

export const buildIsoRangeForOffsetDay = (date: string, offsetKey: DailyCacheOffsetKey) => {
  const offset = OFFSET_BY_KEY[offsetKey];
  return {
    fromISO: new Date(`${date}T00:00:00.000${offset}`).toISOString(),
    toISO: new Date(`${date}T23:59:59.999${offset}`).toISOString(),
  };
};

export const getTodayForOffset = (offsetKey: DailyCacheOffsetKey, now = new Date()): string => {
  const offsetHours = OFFSET_HOUR_BY_KEY[offsetKey];
  return formatDateUTC(new Date(now.getTime() + offsetHours * 60 * 60 * 1000));
};

export const getJustEndedDateForOffset = (offsetKey: DailyCacheOffsetKey, now = new Date()): string => {
  return addDays(getTodayForOffset(offsetKey, now), -1);
};

export const getCacheDocId = (
  collectionName: DailyCacheCollection,
  offsetKey: DailyCacheOffsetKey,
  date: string,
) => `${collectionName}__${offsetKey}__${date}`;

export const parseOffsetKeys = (raw?: string | string[]): DailyCacheOffsetKey[] => {
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const parsed = values
    .map(value => value.trim())
    .filter((value): value is DailyCacheOffsetKey => SUPPORTED_OFFSET_KEYS.includes(value as DailyCacheOffsetKey));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : SUPPORTED_OFFSET_KEYS;
};

export const listDates = (from: string, to: string): string[] => {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
};

export const getDueOffsetsForCurrentUtcHour = (now = new Date()): DailyCacheOffsetKey[] => {
  const currentHour = now.getUTCHours();
  return SUPPORTED_OFFSET_KEYS.filter(offsetKey => TRANSITION_UTC_HOUR_BY_KEY[offsetKey] === currentHour);
};

const sanitizeItems = (items: any[]) => {
  return items.map(item => {
    const { id, ...data } = item;
    return { id, ...data };
  });
};

export async function buildDailyCacheForDay(
  db: Firestore,
  options: BuildDailyCacheOptions,
): Promise<BuildDailyCacheResult> {
  const { teamId, date, offsetKey, collectionName, force = false } = options;
  const cacheKey = getCacheDocId(collectionName, offsetKey, date);
  const metaRef = db.collection('user').doc(teamId).collection(DAILY_CACHE_COLLECTION).doc(cacheKey);
  const field = FIELD_BY_COLLECTION[collectionName];

  console.log(`[dailyCacheAdmin] start ${cacheKey} force=${force}`);

  if (date >= getTodayForOffset(offsetKey)) {
    console.log(`[dailyCacheAdmin] skip ${cacheKey} reason=today-is-live`);
    return { cacheKey, collectionName, date, offsetKey, status: 'skipped', itemCount: 0, pageCount: 0, reason: 'today-is-live' };
  }

  if (!force) {
    const current = await metaRef.get();
    if (current.exists) {
      const data = current.data() || {};
      if (data.version === CACHE_VERSION && data.status === 'ready' && data.dirty !== true) {
        console.log(`[dailyCacheAdmin] skip ${cacheKey} reason=cache-ready count=${Number(data.itemCount || 0)} pages=${Number(data.pageCount || 0)}`);
        return {
          cacheKey,
          collectionName,
          date,
          offsetKey,
          status: 'skipped',
          itemCount: Number(data.itemCount || 0),
          pageCount: Number(data.pageCount || 0),
          reason: 'cache-ready',
        };
      }
    }
  }

  const { fromISO, toISO } = buildIsoRangeForOffsetDay(date, offsetKey);
  console.log(`[dailyCacheAdmin] live-query ${cacheKey} field=${field} from=${fromISO} to=${toISO}`);
  const snap = await db.collection('user').doc(teamId).collection(collectionName)
    .where(field, '>=', fromISO)
    .where(field, '<=', toISO)
    .get();

  const items = sanitizeItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  const pageCount = items.length > CACHE_INLINE_LIMIT ? Math.ceil(items.length / CACHE_PAGE_SIZE) : 0;
  const nowISO = new Date().toISOString();

  const existingPages = await metaRef.collection('pages').listDocuments();
  const batch = db.batch();
  existingPages.forEach(pageRef => batch.delete(pageRef));

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

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageId = String(pageIndex).padStart(3, '0');
    batch.set(metaRef.collection('pages').doc(pageId), {
      items: items.slice(pageIndex * CACHE_PAGE_SIZE, (pageIndex + 1) * CACHE_PAGE_SIZE),
      updatedAt: nowISO,
    });
  }

  await batch.commit();

  console.log(`[dailyCacheAdmin] built ${cacheKey} count=${items.length} pages=${pageCount}`);
  return { cacheKey, collectionName, date, offsetKey, status: 'built', itemCount: items.length, pageCount };
}

export async function markDailyCacheDirtyForISOValues(
  db: Firestore,
  teamId: string,
  collectionNames: DailyCacheCollection[],
  isoValues: Array<string | null | undefined>,
  reason: string,
) {
  console.log(`[dailyCacheAdmin] dirty:start reason=${reason} collections=${collectionNames.join(',')} values=${isoValues.length}`);
  const datesByOffset = new Map<DailyCacheOffsetKey, Set<string>>();

  isoValues.forEach(isoValue => {
    if (!isoValue) return;
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return;

    SUPPORTED_OFFSET_KEYS.forEach(offsetKey => {
      const offsetHours = OFFSET_HOUR_BY_KEY[offsetKey];
      const cacheDate = formatDateUTC(new Date(date.getTime() + offsetHours * 60 * 60 * 1000));
      if (!datesByOffset.has(offsetKey)) datesByOffset.set(offsetKey, new Set());
      datesByOffset.get(offsetKey)!.add(cacheDate);
    });
  });

  const nowISO = new Date().toISOString();
  const writes: WriteBatch[] = [];
  let batch = db.batch();
  let writeCount = 0;

  const commitIfNeeded = () => {
    if (writeCount === 0) return;
    writes.push(batch);
    batch = db.batch();
    writeCount = 0;
  };

  datesByOffset.forEach((dates, offsetKey) => {
    dates.forEach(date => {
      collectionNames.forEach(collectionName => {
        if (writeCount >= 450) commitIfNeeded();
        const cacheKey = getCacheDocId(collectionName, offsetKey, date);
        const metaRef = db.collection('user').doc(teamId).collection(DAILY_CACHE_COLLECTION).doc(cacheKey);
        batch.set(metaRef, {
          version: CACHE_VERSION,
          teamId,
          date,
          offsetKey,
          collectionName,
          status: 'dirty',
          dirty: true,
          dirtyReason: reason,
          updatedAt: nowISO,
        }, { merge: true });
        writeCount += 1;
      });
    });
  });

  commitIfNeeded();
  await Promise.all(writes.map(pendingBatch => pendingBatch.commit()));
  console.log(`[dailyCacheAdmin] dirty:done batches=${writes.length}`);
}
