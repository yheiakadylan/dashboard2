import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { EtsyReview, Record as DashboardRecord } from '../types';
import { splitDateRange } from '../utils/dateChunking';

export type DailyCacheOffsetKey = 'p7' | 'm7' | 'm8';
type DailyCacheCollection = 'records' | 'reviews';
type CacheableData = DashboardRecord | EtsyReview;

interface DailyCacheMeta<T extends CacheableData> {
  version: number;
  teamId: string;
  date: string;
  offsetKey: DailyCacheOffsetKey;
  collectionName: DailyCacheCollection;
  field: 'dt_local' | 'create_date';
  fromISO: string;
  toISO: string;
  status: 'ready' | 'dirty' | 'failed';
  dirty?: boolean;
  dirtyReason?: string | null;
  itemCount: number;
  pageCount: number;
  itemsInline?: T[];
  builtAt?: string;
  updatedAt: string;
}

interface DaySegment {
  date: string;
  offsetKey: DailyCacheOffsetKey | null;
  fromISO: string;
  toISO: string;
  isToday: boolean;
}

interface LiveSegmentGroup {
  fromISO: string;
  toExclusiveISO: string;
  segments: DaySegment[];
}

interface FetchCachedRangeParams<T extends CacheableData> {
  db: Firestore;
  teamId: string;
  collectionName: DailyCacheCollection;
  field: 'dt_local' | 'create_date';
  startDate: string;
  endDate: string;
  timeZone: string;
  compactDoc?: (docSnap: QueryDocumentSnapshot<DocumentData>) => T;
}

const CACHE_VERSION = 1;
const CACHE_INLINE_LIMIT = 180;
const CACHE_PAGE_SIZE = 220;
const CACHE_READ_CONCURRENCY = 4;
const CACHE_SEGMENT_CONCURRENCY = 3;
const CACHE_WRITE_CONCURRENCY = 1;
const CACHE_WRITE_QUEUE_LIMIT = 30;
const CACHE_READ_TIMEOUT_MS = 20000;
const LIVE_DAY_QUERY_TIMEOUT_MS = 60000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EMPTY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const DAILY_CACHE_COLLECTION = 'daily_cache';
const SUPPORTED_OFFSET_KEYS: DailyCacheOffsetKey[] = ['p7', 'm7', 'm8'];

const OFFSET_BY_KEY: globalThis.Record<DailyCacheOffsetKey, string> = {
  p7: '+07:00',
  m7: '-07:00',
  m8: '-08:00',
};

const OFFSET_KEY_BY_VALUE: globalThis.Record<string, DailyCacheOffsetKey> = {
  '+07:00': 'p7',
  '-07:00': 'm7',
  '-08:00': 'm8',
};

const DEFAULT_CACHE_LOGS = new Set<string>();

const isVerboseCacheLogEnabled = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('dailyCacheVerbose') === '1';
  } catch {
    return false;
  }
};

const logCacheQuery = (message: string, details?: globalThis.Record<string, unknown>) => {
  if (!import.meta.env.DEV) return;
  if (!DEFAULT_CACHE_LOGS.has(message) && !isVerboseCacheLogEnabled()) return;
  console.info('[dailyCache]', message, details || '');
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let pendingCacheWrites = 0;
let droppedCacheWrites = 0;

const formatDateUTC = (date: Date): string => date.toISOString().slice(0, 10);

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
};

const addDays = (dateStr: string, amount: number): string => {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateUTC(date);
};

export const getTimezoneOffsetStringForDate = (timeZone: string, dateStr: string): string => {
  try {
    const date = new Date(`${dateStr}T12:00:00.000Z`);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
    const offset = formatter.formatToParts(date).find(part => part.type === 'timeZoneName')?.value;
    return offset?.replace('GMT', '') || '+00:00';
  } catch (error) {
    console.warn('[dailyCache] Failed to resolve timezone offset:', error);
    return '+00:00';
  }
};

const getTimezoneOffsetMinutesAtInstant = (timeZone: string, instant: Date): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const offset = formatter.formatToParts(instant).find(part => part.type === 'timeZoneName')?.value;
  const match = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
};

const getUtcForLocalMidnight = (timeZone: string, dateStr: string): Date => {
  const localMidnightAsUTC = Date.parse(`${dateStr}T00:00:00.000Z`);
  let utcMs = localMidnightAsUTC;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offsetMinutes = getTimezoneOffsetMinutesAtInstant(timeZone, new Date(utcMs));
    const nextUtcMs = localMidnightAsUTC - offsetMinutes * 60 * 1000;
    if (nextUtcMs === utcMs) break;
    utcMs = nextUtcMs;
  }

  return new Date(utcMs);
};

const buildIsoRangeForTimezoneDay = (date: string, timeZone: string) => {
  const from = getUtcForLocalMidnight(timeZone, date);
  const nextDayFrom = getUtcForLocalMidnight(timeZone, addDays(date, 1));
  return {
    fromISO: from.toISOString(),
    toISO: new Date(nextDayFrom.getTime() - 1).toISOString(),
  };
};

export const getSupportedOffsetKeyForDate = (timeZone: string, dateStr: string): DailyCacheOffsetKey | null => {
  return OFFSET_KEY_BY_VALUE[getTimezoneOffsetStringForDate(timeZone, dateStr)] || null;
};

export const getCacheDocId = (
  collectionName: DailyCacheCollection,
  offsetKey: DailyCacheOffsetKey,
  date: string,
) => `${collectionName}__${offsetKey}__${date}`;

export const buildIsoRangeForOffsetDay = (date: string, offsetKey: DailyCacheOffsetKey) => {
  const offset = OFFSET_BY_KEY[offsetKey];
  return {
    fromISO: new Date(`${date}T00:00:00.000${offset}`).toISOString(),
    toISO: new Date(`${date}T23:59:59.999${offset}`).toISOString(),
  };
};

const getTodayForOffset = (offsetKey: DailyCacheOffsetKey): string => {
  const now = new Date();
  const offsetHours = offsetKey === 'p7' ? 7 : offsetKey === 'm7' ? -7 : -8;
  return formatDateUTC(new Date(now.getTime() + offsetHours * 60 * 60 * 1000));
};

const splitRangeIntoDays = (startDate: string, endDate: string, timeZone: string): DaySegment[] => {
  const segments: DaySegment[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const range = buildIsoRangeForTimezoneDay(cursor, timeZone);
    const durationMs = new Date(range.toISO).getTime() + 1 - new Date(range.fromISO).getTime();
    const offsetKey = durationMs === 24 * 60 * 60 * 1000
      ? getSupportedOffsetKeyForDate(timeZone, cursor)
      : null;

    segments.push({
      date: cursor,
      offsetKey,
      fromISO: range.fromISO,
      toISO: range.toISO,
      isToday: offsetKey ? cursor >= getTodayForOffset(offsetKey) : false,
    });

    cursor = addDays(cursor, 1);
  }

  return segments;
};

const sortByFieldDesc = <T extends CacheableData>(items: T[], field: 'dt_local' | 'create_date') => {
  return [...items].sort((a, b) => String((b as any)[field] || '').localeCompare(String((a as any)[field] || '')));
};

const toExclusiveISO = (inclusiveToISO: string): string => {
  return new Date(new Date(inclusiveToISO).getTime() + 1).toISOString();
};

const groupContiguousLiveSegments = (segments: DaySegment[]): LiveSegmentGroup[] => {
  const groups: LiveSegmentGroup[] = [];

  segments.forEach(segment => {
    const segmentToExclusiveISO = toExclusiveISO(segment.toISO);
    const currentGroup = groups[groups.length - 1];

    if (currentGroup && currentGroup.toExclusiveISO === segment.fromISO) {
      currentGroup.segments.push(segment);
      currentGroup.toExclusiveISO = segmentToExclusiveISO;
      return;
    }

    groups.push({
      fromISO: segment.fromISO,
      toExclusiveISO: segmentToExclusiveISO,
      segments: [segment],
    });
  });

  return groups;
};

const queryLiveRange = async <T extends CacheableData>(
  db: Firestore,
  teamId: string,
  collectionName: DailyCacheCollection,
  field: 'dt_local' | 'create_date',
  fromISO: string,
  toExclusiveISO: string,
  compactDoc?: (docSnap: QueryDocumentSnapshot<DocumentData>) => T,
): Promise<T[]> => {
  const chunks = splitDateRange(new Date(fromISO), new Date(toExclusiveISO));
  const startedAt = nowMs();
  logCacheQuery('live-query:start', { collectionName, field, fromISO, toExclusiveISO, chunks: chunks.length });

  const chunkResults = await mapWithConcurrency(chunks, CACHE_SEGMENT_CONCURRENCY, async chunk => {
    const chunkFromISO = chunk.start.toISOString();
    const chunkToExclusiveISO = chunk.end.toISOString();
    const q = query(
      collection(db, 'user', teamId, collectionName),
      where(field, '>=', chunkFromISO),
      where(field, '<', chunkToExclusiveISO),
    );
    const snapshot = await getDocs(q);
    logCacheQuery('live-query:chunk-done', {
      collectionName,
      field,
      fromISO: chunkFromISO,
      toExclusiveISO: chunkToExclusiveISO,
      count: snapshot.size,
    });
    return snapshot.docs.map(docSnap => (
      compactDoc
        ? compactDoc(docSnap)
        : ({ ...(docSnap.data() as object), id: docSnap.id } as T)
    ));
  });

  const items = chunkResults.flat();
  logCacheQuery('live-query:done', {
    collectionName,
    field,
    fromISO,
    toExclusiveISO,
    chunks: chunks.length,
    count: items.length,
    elapsedMs: Math.round(nowMs() - startedAt),
  });
  return items;
};

const getCacheRefs = (
  db: Firestore,
  teamId: string,
  collectionName: DailyCacheCollection,
  offsetKey: DailyCacheOffsetKey,
  date: string,
) => {
  const docId = getCacheDocId(collectionName, offsetKey, date);
  const metaRef = doc(db, 'user', teamId, DAILY_CACHE_COLLECTION, docId);
  const pagesRef = collection(metaRef, 'pages');
  return { metaRef, pagesRef };
};

const readDailyCache = async <T extends CacheableData>(
  db: Firestore,
  teamId: string,
  collectionName: DailyCacheCollection,
  offsetKey: DailyCacheOffsetKey,
  date: string,
): Promise<T[] | null> => {
  const startedAt = nowMs();
  const { metaRef, pagesRef } = getCacheRefs(db, teamId, collectionName, offsetKey, date);
  const metaSnap = await getDoc(metaRef);
  if (!metaSnap.exists()) return null;

  const meta = metaSnap.data() as DailyCacheMeta<T>;
  if (
    meta.version !== CACHE_VERSION ||
    meta.status !== 'ready' ||
    meta.dirty ||
    meta.collectionName !== collectionName ||
    meta.offsetKey !== offsetKey ||
    meta.date !== date
  ) {
    return null;
  }

  const builtAtMs = Date.parse(meta.builtAt || meta.updatedAt || '');
  const cacheAgeMs = Date.now() - builtAtMs;
  const maxAgeMs = Number(meta.itemCount || 0) === 0 ? EMPTY_CACHE_MAX_AGE_MS : CACHE_MAX_AGE_MS;
  if (!Number.isFinite(builtAtMs) || cacheAgeMs > maxAgeMs) {
    logCacheQuery(Number(meta.itemCount || 0) === 0 ? 'cache-read:expired-empty' : 'cache-read:expired', {
      collectionName,
      date,
      offsetKey,
      builtAt: meta.builtAt || null,
      count: Number(meta.itemCount || 0),
      ageMs: Number.isFinite(cacheAgeMs) ? cacheAgeMs : null,
    });
    return null;
  }

  if (meta.pageCount === 0 && Array.isArray(meta.itemsInline)) {
    if (meta.itemsInline.length !== Number(meta.itemCount || 0)) {
      logCacheQuery('cache-read:invalid-inline-count', {
        collectionName,
        date,
        offsetKey,
        expected: Number(meta.itemCount || 0),
        actual: meta.itemsInline.length,
      });
      return null;
    }

    logCacheQuery('cache-read:done', {
      collectionName,
      date,
      offsetKey,
      mode: 'inline',
      count: meta.itemsInline.length,
      elapsedMs: Math.round(nowMs() - startedAt),
    });
    return meta.itemsInline;
  }

  const pageCount = Number(meta.pageCount || 0);
  const pageRefs = Array.from({ length: pageCount }, (_, pageIndex) => {
    const pageId = String(pageIndex).padStart(3, '0');
    return doc(pagesRef, pageId);
  });
  const items: T[] = [];

  for (let startIndex = 0; startIndex < pageRefs.length; startIndex += CACHE_READ_CONCURRENCY) {
    const currentPageRefs = pageRefs.slice(startIndex, startIndex + CACHE_READ_CONCURRENCY);
    const pageSnaps = await Promise.all(
      currentPageRefs.map(pageRef => getDoc(pageRef))
    );
    for (let pageIndex = 0; pageIndex < pageSnaps.length; pageIndex += 1) {
      const pageSnap = pageSnaps[pageIndex];
      if (!pageSnap.exists()) {
        logCacheQuery('cache-read:missing-page', {
          collectionName,
          date,
          offsetKey,
          pageId: currentPageRefs[pageIndex].id,
        });
        return null;
      }
      items.push(...((pageSnap.data().items || []) as T[]));
    }
  }

  if (items.length !== Number(meta.itemCount || 0)) {
    logCacheQuery('cache-read:invalid-page-count', {
      collectionName,
      date,
      offsetKey,
      expected: Number(meta.itemCount || 0),
      actual: items.length,
    });
    return null;
  }

  logCacheQuery('cache-read:done', {
    collectionName,
    date,
    offsetKey,
    mode: 'paged',
    pages: pageCount,
    count: items.length,
    elapsedMs: Math.round(nowMs() - startedAt),
  });
  return items;
};

export const writeDailyCache = async <T extends CacheableData>(
  db: Firestore,
  teamId: string,
  collectionName: DailyCacheCollection,
  field: 'dt_local' | 'create_date',
  offsetKey: DailyCacheOffsetKey,
  date: string,
  items: T[],
) => {
  const { metaRef, pagesRef } = getCacheRefs(db, teamId, collectionName, offsetKey, date);
  const { fromISO, toISO } = buildIsoRangeForOffsetDay(date, offsetKey);
  const nowISO = new Date().toISOString();
  const pageCount = items.length > CACHE_INLINE_LIMIT ? Math.ceil(items.length / CACHE_PAGE_SIZE) : 0;

  const meta: DailyCacheMeta<T> = {
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
  };

  if (pageCount === 0) {
    await setDoc(metaRef, meta);
    return;
  }

  const batch = writeBatch(db);
  batch.set(metaRef, meta);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageId = String(pageIndex).padStart(3, '0');
    batch.set(doc(pagesRef, pageId), {
      items: items.slice(pageIndex * CACHE_PAGE_SIZE, (pageIndex + 1) * CACHE_PAGE_SIZE),
      updatedAt: nowISO,
    });
  }
  await batch.commit();
};

const flushDailyCacheWrites = async <T extends CacheableData>(
  db: Firestore,
  teamId: string,
  collectionName: DailyCacheCollection,
  field: 'dt_local' | 'create_date',
  writes: Array<{ segment: DaySegment; items: T[] }>,
) => {
  const availableSlots = Math.max(0, CACHE_WRITE_QUEUE_LIMIT - pendingCacheWrites);
  const writesToRun = writes.slice(0, availableSlots);
  const skipped = writes.length - writesToRun.length;

  if (skipped > 0) {
    droppedCacheWrites += skipped;
    logCacheQuery('range:cache-write-skipped', {
      collectionName,
      skipped,
      droppedTotal: droppedCacheWrites,
      pending: pendingCacheWrites,
    });
  }

  if (writesToRun.length === 0) return;

  pendingCacheWrites += writesToRun.length;
  try {
    await mapWithConcurrency(writesToRun, CACHE_WRITE_CONCURRENCY, async ({ segment, items }) => {
      if (!segment.offsetKey) return;
      await writeDailyCache(db, teamId, collectionName, field, segment.offsetKey, segment.date, items);
      logCacheQuery('range:cache-write-done', {
        collectionName,
        date: segment.date,
        offsetKey: segment.offsetKey,
        count: items.length,
      });
    });
  } catch (error) {
    console.warn('[dailyCache] Cache write failed:', error);
  } finally {
    pendingCacheWrites = Math.max(0, pendingCacheWrites - writesToRun.length);
  }
};

export const markDailyCacheDirtyForDates = async (
  db: Firestore,
  teamId: string,
  collectionNames: DailyCacheCollection[],
  dates: string[],
  reason: string,
) => {
  const uniqueDates = Array.from(new Set(dates.filter(Boolean)));
  if (uniqueDates.length === 0) return;

  const nowISO = new Date().toISOString();
  const batches = [];
  let batch = writeBatch(db);
  let writeCount = 0;

  const rotateBatchIfNeeded = () => {
    if (writeCount < 450) return;
    batches.push(batch);
    batch = writeBatch(db);
    writeCount = 0;
  };

  uniqueDates.forEach(date => {
    collectionNames.forEach(collectionName => {
      SUPPORTED_OFFSET_KEYS.forEach(offsetKey => {
        rotateBatchIfNeeded();
        const { metaRef } = getCacheRefs(db, teamId, collectionName, offsetKey, date);
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

  if (writeCount > 0) {
    batches.push(batch);
  }
  await Promise.all(batches.map(pendingBatch => pendingBatch.commit()));
};

export const getAffectedCacheDatesForISO = (isoValue?: string | null): string[] => {
  if (!isoValue) return [];
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return [];

  return SUPPORTED_OFFSET_KEYS.map(offsetKey => {
    const offsetHours = offsetKey === 'p7' ? 7 : offsetKey === 'm7' ? -7 : -8;
    return formatDateUTC(new Date(date.getTime() + offsetHours * 60 * 60 * 1000));
  });
};

export const fetchCachedDateRange = async <T extends CacheableData>({
  db,
  teamId,
  collectionName,
  field,
  startDate,
  endDate,
  timeZone,
  compactDoc,
}: FetchCachedRangeParams<T>): Promise<T[]> => {
  const segments = splitRangeIntoDays(startDate, endDate, timeZone);
  const results: T[] = [];
  const cacheWrites: Array<{ segment: DaySegment; items: T[] }> = [];

  logCacheQuery('range:start', {
    collectionName,
    field,
    startDate,
    endDate,
    timeZone,
    days: segments.length,
  });

  const cacheResults = await mapWithConcurrency(segments, CACHE_SEGMENT_CONCURRENCY, async (segment) => {
    if (!segment.offsetKey || segment.isToday) {
      logCacheQuery('range:live-day', {
        collectionName,
        date: segment.date,
        offsetKey: segment.offsetKey || 'unsupported',
        reason: segment.offsetKey ? 'today-is-live' : 'unsupported-offset',
        fromISO: segment.fromISO,
        toISO: segment.toISO,
      });
      return { segment, items: null as T[] | null };
    }

    try {
      const cached = await withTimeout(
        readDailyCache<T>(db, teamId, collectionName, segment.offsetKey, segment.date),
        CACHE_READ_TIMEOUT_MS,
        `daily cache read ${collectionName}/${segment.offsetKey}/${segment.date}`,
      );
      if (cached) {
        logCacheQuery('range:cache-hit', {
          collectionName,
          date: segment.date,
          offsetKey: segment.offsetKey,
          count: cached.length,
        });
        return { segment, items: cached };
      }
      logCacheQuery('range:cache-miss', {
        collectionName,
        date: segment.date,
        offsetKey: segment.offsetKey,
        reason: 'missing-or-dirty',
      });
    } catch (error) {
      console.warn('[dailyCache] Cache read failed; falling back to live query:', error);
    }

    return { segment, items: null as T[] | null };
  });

  const liveSegments: DaySegment[] = [];
  cacheResults.forEach(({ segment, items }) => {
    if (items) {
      results.push(...items);
      return;
    }
    liveSegments.push(segment);
  });

  const liveGroups = groupContiguousLiveSegments(liveSegments);
  const liveGroupResults = await mapWithConcurrency(liveGroups, CACHE_SEGMENT_CONCURRENCY, async (group) => {
    logCacheQuery('range:live-group', {
      collectionName,
      field,
      fromISO: group.fromISO,
      toExclusiveISO: group.toExclusiveISO,
      days: group.segments.length,
    });

    const liveItems = await withTimeout(
      queryLiveRange(db, teamId, collectionName, field, group.fromISO, group.toExclusiveISO, compactDoc),
      LIVE_DAY_QUERY_TIMEOUT_MS,
      `daily live query ${collectionName}/${group.segments[0]?.date || group.fromISO}`,
    );

    return liveItems;
  });

  liveGroupResults.forEach((items, groupIndex) => {
    const group = liveGroups[groupIndex];
    group.segments.forEach(segment => {
      if (!segment.offsetKey || segment.isToday) return;
      const segmentItems = items.filter(item => {
        const value = String((item as any)[field] || '');
        return value >= segment.fromISO && value <= segment.toISO;
      });
      cacheWrites.push({ segment, items: segmentItems });
    });
  });

  for (const items of liveGroupResults) {
    results.push(...items);
  }

  const sorted = sortByFieldDesc(results, field);
  if (cacheWrites.length > 0) {
    void flushDailyCacheWrites(db, teamId, collectionName, field, cacheWrites);
  }
  logCacheQuery('range:done', { collectionName, field, count: sorted.length });
  return sorted;
};
