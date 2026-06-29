import { collection, getDocs, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from './firebaseService';
import type { EtsyReview, Record as OrderRecord } from '../types';

type DateValue = string | number | Date | { seconds?: number; toDate?: () => Date } | null | undefined;

export interface ReportOrderItem {
  sku?: string | null;
  name?: string | null;
  quantity?: number | null;
  price?: number | null;
  image?: string | null;
}

export interface ReportOrderRecord {
  id?: string;
  dt_local: string;
  amount: number;
  order_id: string | null;
  currency: string | null;
  source: string;
  account: string;
  kind: OrderRecord['kind'];
  cost_total?: number;
  ff_code?: string;
  fulfill_provider?: string;
  status?: OrderRecord['status'];
  refundAmount?: number;
  items: ReportOrderItem[];
}

export interface ReportReview {
  id?: string;
  shop_id: string;
  rating: number | null;
  create_date: string;
}

export interface OperationUser {
  uid: string;
  empID?: string;
  displayName?: string;
  email?: string;
  role?: string;
  teamId?: string;
}

export interface OperationTask {
  id: string;
  readableId?: string | number;
  title?: string;
  sku?: string;
  status?: string;
  quantity?: number;
  createdBy?: string;
  designerId?: string | null;
  designerName?: string | null;
  cs_id?: string;
  idea_emp_id?: string;
  team?: string;
  account?: string;
  supplier?: string;
  fulfillment_id?: string;
  rejection_count?: number;
  created_at?: DateValue;
  updatedAt?: DateValue;
  fulfilled_at?: DateValue;
  design_submitted_at?: DateValue;
  collectionName?: 'tasks' | 'ideas';
}

export interface OperationReportData {
  tasksCreated: OperationTask[];
  tasksDesignSubmitted: OperationTask[];
  tasksFulfilled: OperationTask[];
  ideasCreated: OperationTask[];
  ideasDesignSubmitted: OperationTask[];
  ideasCompleted: OperationTask[];
  users: OperationUser[];
}

export interface DateRangeInput {
  from: string;
  to: string;
}

let cachedUsers: OperationUser[] | null = null;
let cachedUsersAt = 0;
const USERS_CACHE_MS = 30 * 60 * 1000;
const REPORT_CACHE_MS = 2 * 60 * 1000;
const MAX_OPERATION_REPORT_DAYS = 45;
const REPORT_QUERY_CHUNK_DAYS = 7;
const TEAM_DOCS_CACHE_LIMIT = 24;
const OPERATION_CACHE_LIMIT = 12;

const teamDocsCache = new Map<string, { createdAt: number; data: unknown[] }>();
const operationCache = new Map<string, { createdAt: number; data: OperationReportData }>();
const teamDocsInflight = new Map<string, Promise<unknown[]>>();
const operationInflight = new Map<string, Promise<OperationReportData>>();

const getFreshCache = <T,>(cache: Map<string, { createdAt: number; data: T }>, key: string, ttlMs: number): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return cached.data;
};

const setLimitedCache = <T,>(cache: Map<string, { createdAt: number; data: T }>, key: string, data: T, limit: number) => {
  cache.set(key, { createdAt: Date.now(), data });
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

const getRangeDayCount = (range: DateRangeInput) => {
  const from = new Date(range.from + 'T00:00:00Z');
  const to = new Date(range.to + 'T00:00:00Z');
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
};

const assertReportRangeSupported = (range: DateRangeInput) => {
  const dayCount = getRangeDayCount(range);
  if (dayCount <= 0) {
    throw new Error('Report date range khong hop le.');
  }
  if (dayCount > MAX_OPERATION_REPORT_DAYS) {
    throw new Error(`Report chi ho tro toi da ${MAX_OPERATION_REPORT_DAYS} ngay moi lan de tranh Out of Memory. Hay chon range ngan hon.`);
  }
};

const getTimezoneOffsetString = (timeZone: string, dateStr: string): string => {
  try {
    const date = new Date(`${dateStr}T12:00:00Z`);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset'
    });
    const offset = formatter.formatToParts(date).find(part => part.type === 'timeZoneName')?.value;
    return offset?.replace('GMT', '') || '+00:00';
  } catch (error) {
    console.warn('[Report] Could not resolve timezone offset:', error);
    return '+00:00';
  }
};

export const buildIsoRangeForTimezone = (range: DateRangeInput, timeZone: string) => {
  const startOffset = getTimezoneOffsetString(timeZone, range.from);
  const endOffset = getTimezoneOffsetString(timeZone, range.to);

  return {
    fromISO: new Date(`${range.from}T00:00:00.000${startOffset}`).toISOString(),
    toISO: new Date(`${range.to}T23:59:59.999${endOffset}`).toISOString()
  };
};

const compactTaskDoc = (docSnap: QueryDocumentSnapshot<DocumentData>, collectionName: 'tasks' | 'ideas'): OperationTask => {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    readableId: data.readableId,
    title: data.title,
    sku: data.sku,
    status: data.status,
    quantity: data.quantity,
    createdBy: data.createdBy,
    designerId: data.designerId,
    designerName: data.designerName,
    cs_id: data.cs_id,
    idea_emp_id: data.idea_emp_id,
    team: data.team,
    account: data.account,
    supplier: data.supplier,
    fulfillment_id: data.fulfillment_id,
    rejection_count: data.rejection_count,
    created_at: data.created_at,
    updatedAt: data.updatedAt,
    fulfilled_at: data.fulfilled_at,
    design_submitted_at: data.design_submitted_at,
    collectionName
  };
};

const compactOrderRecordDoc = (docSnap: QueryDocumentSnapshot<DocumentData>): ReportOrderRecord => {
  const data = docSnap.data() as OrderRecord;
  return {
    id: docSnap.id,
    dt_local: data.dt_local,
    amount: Number(data.amount || 0),
    order_id: data.order_id || null,
    currency: data.currency || null,
    source: data.source || '',
    account: data.account || '',
    kind: data.kind,
    cost_total: data.cost_total,
    ff_code: data.ff_code,
    fulfill_provider: data.fulfill_provider,
    status: data.status,
    refundAmount: data.refund_details?.refundAmount,
    items: Array.isArray(data.details?.items)
      ? data.details.items.map(item => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        image: item.image
      }))
      : []
  };
};

const compactReviewDoc = (docSnap: QueryDocumentSnapshot<DocumentData>): ReportReview => {
  const data = docSnap.data() as EtsyReview;
  return {
    id: docSnap.id,
    shop_id: String(data.shop_id || 'Unknown'),
    rating: typeof data.rating === 'number' ? data.rating : null,
    create_date: data.create_date
  };
};

const fetchTasksByDateField = async (
  collectionName: 'tasks' | 'ideas',
  field: 'created_at' | 'design_submitted_at' | 'fulfilled_at',
  fromISO: string,
  toISO: string
): Promise<OperationTask[]> => {
  const q = query(
    collection(db, collectionName),
    where(field, '>=', fromISO),
    where(field, '<=', toISO)
  );
  const snap = await getDocs(q);
  return snap.docs.map(docSnap => compactTaskDoc(docSnap, collectionName));
};

const fetchTeamDocsByDateField = async <T,>(
  teamId: string,
  collectionName: 'records' | 'reviews',
  field: 'dt_local' | 'create_date',
  dateRange: DateRangeInput,
  timeZone: string,
  compactDoc: (docSnap: QueryDocumentSnapshot<DocumentData>) => T,
  forceRefresh = false
): Promise<T[]> => {
  assertReportRangeSupported(dateRange);
  const cacheKey = `${teamId}:${collectionName}:${field}:${dateRange.from}:${dateRange.to}:${timeZone}`;
  if (!forceRefresh) {
    const cached = getFreshCache(teamDocsCache, cacheKey, REPORT_CACHE_MS);
    if (cached) return cached as T[];

    const inflight = teamDocsInflight.get(cacheKey);
    if (inflight) return inflight as Promise<T[]>;
  }

  const request = (async () => {
    const { fromISO, toISO } = buildIsoRangeForTimezone(dateRange, timeZone);
    const startMs = new Date(fromISO).getTime();
    const endExclusiveMs = new Date(toISO).getTime() + 1;
    const chunkMs = REPORT_QUERY_CHUNK_DAYS * 86400000;
    const results: T[] = [];

    for (let cursorMs = startMs; cursorMs < endExclusiveMs; cursorMs += chunkMs) {
      const chunkEndMs = Math.min(cursorMs + chunkMs, endExclusiveMs);
      const q = query(
        collection(db, 'user', teamId, collectionName),
        where(field, '>=', new Date(cursorMs).toISOString()),
        where(field, '<', new Date(chunkEndMs).toISOString())
      );
      const snap = await getDocs(q);
      snap.forEach(docSnap => {
        results.push(compactDoc(docSnap));
      });
    }

    setLimitedCache(teamDocsCache, cacheKey, results as unknown[], TEAM_DOCS_CACHE_LIMIT);
    return results as unknown[];
  })();

  if (!forceRefresh) teamDocsInflight.set(cacheKey, request);

  try {
    return await request as T[];
  } finally {
    if (!forceRefresh) teamDocsInflight.delete(cacheKey);
  }
};

export const fetchReportRecords = (teamId: string, dateRange: DateRangeInput, timeZone: string, forceRefresh = false): Promise<ReportOrderRecord[]> =>
  fetchTeamDocsByDateField<ReportOrderRecord>(teamId, 'records', 'dt_local', dateRange, timeZone, compactOrderRecordDoc, forceRefresh);

export const fetchReportReviews = (teamId: string, dateRange: DateRangeInput, timeZone: string, forceRefresh = false): Promise<ReportReview[]> =>
  fetchTeamDocsByDateField<ReportReview>(teamId, 'reviews', 'create_date', dateRange, timeZone, compactReviewDoc, forceRefresh);

const fetchOperationUsers = async (forceRefresh = false): Promise<OperationUser[]> => {
  const now = Date.now();
  if (!forceRefresh && cachedUsers && now - cachedUsersAt < USERS_CACHE_MS) {
    return cachedUsers;
  }

  try {
    const snap = await getDocs(collection(db, 'users'));
    cachedUsers = snap.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        empID: data.empID,
        displayName: data.displayName,
        email: data.email,
        role: data.role,
        teamId: data.teamId
      };
    });
    cachedUsersAt = now;
    return cachedUsers;
  } catch (error) {
    console.warn('[Report] Could not fetch operation users:', error);
    return cachedUsers || [];
  }
};

export const fetchOperationReportData = async (
  dateRange: DateRangeInput,
  timeZone: string,
  forceRefresh = false
): Promise<OperationReportData> => {
  assertReportRangeSupported(dateRange);
  const cacheKey = `${dateRange.from}:${dateRange.to}:${timeZone}`;
  if (!forceRefresh) {
    const cached = getFreshCache(operationCache, cacheKey, REPORT_CACHE_MS);
    if (cached) return cached;

    const inflight = operationInflight.get(cacheKey);
    if (inflight) return inflight;
  }

  const request = (async () => {
    const { fromISO, toISO } = buildIsoRangeForTimezone(dateRange, timeZone);
    const users = await fetchOperationUsers(forceRefresh);

    // Keep this sequential. Holding several Firestore snapshots at once was the main OOM trigger.
    const tasksDesignSubmitted = await fetchTasksByDateField('tasks', 'design_submitted_at', fromISO, toISO);
    const tasksFulfilled = await fetchTasksByDateField('tasks', 'fulfilled_at', fromISO, toISO);
    const ideasCreated = await fetchTasksByDateField('ideas', 'created_at', fromISO, toISO);
    const ideasDesignSubmitted = await fetchTasksByDateField('ideas', 'design_submitted_at', fromISO, toISO);

    const data = {
      tasksCreated: [],
      tasksDesignSubmitted,
      tasksFulfilled: tasksFulfilled.filter(task => task.status === 'done'),
      ideasCreated,
      ideasDesignSubmitted,
      ideasCompleted: [],
      users
    };

    setLimitedCache(operationCache, cacheKey, data, OPERATION_CACHE_LIMIT);
    return data;
  })();

  if (!forceRefresh) operationInflight.set(cacheKey, request);

  try {
    return await request;
  } finally {
    if (!forceRefresh) operationInflight.delete(cacheKey);
  }
};

export const normalizeDateValue = (value: DateValue): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};
