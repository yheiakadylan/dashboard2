import { collection, deleteField, doc, FieldPath, getDoc, getDocs, query, updateDoc, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db, getEtsyReviewsForDateRange, getRecordsForDateRange } from './firebaseService';
import type { EtsyListing, EtsyReview, Record as OrderRecord } from '../types';
import { getValueFromDB, saveValueToDB, STORE_OPERATION_REPORT_CACHE } from '../utils/indexedDB';
import { startMeasure } from '../utils/perfMarks';

type DateValue = string | number | Date | { seconds?: number; toDate?: () => Date } | null | undefined;

export interface ReportOrderItem {
  sku?: string | null;
  listingId?: string | null;
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
  financials?: {
    discount?: number;
    shipping?: number;
  };
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
  fullName?: string;
  displayName?: string;
  email?: string;
  role?: string;
  teamId?: string;
  photoURL?: string;
  active?: boolean;
  isActive?: boolean;
}

export interface OperationTask {
  id: string;
  readableId?: string | number;
  title?: string;
  sku?: string;
  status?: string;
  quantity?: number;
  personalization?: string;
  variant1?: string;
  variant2?: string;
  createdBy?: string;
  taskId?: string;
  orderId?: string;
  designerId?: string | null;
  designerName?: string | null;
  cs_id?: string;
  idea_emp_id?: string;
  team?: string;
  account?: string;
  supplier?: string;
  fulfillment_id?: string;
  rejection_count?: number;
  templateId?: string | string[];
  templatePointsSnapshot?: number;
  templatePointBreakdownSnapshot?: Record<string, number>;
  listingId?: string;
  saleCount?: number;
  created_at?: DateValue;
  updatedAt?: DateValue;
  fulfilled_at?: DateValue;
  design_submitted_at?: DateValue;
  assigned_to_designer_at?: DateValue;
  submitted_to_new_at?: DateValue;
  submitted_to_new_by?: string;
  fulfilled_by?: string;
  collectionName?: 'tasks' | 'ideas';
}

export interface ReportSkuMapping {
  id: string;
  etsy_sku: string;
  variant1?: string;
  variant2?: string;
  supplier?: string;
}

export interface OperationTemplate {
  id: string;
  name?: string;
  boardType?: 'fulfill' | 'idea' | 'all';
  points?: number;
  archived?: boolean;
}

export const OPERATION_TEMPLATE_POINT_CHANGE_EVENT = 'operation-template-point-change';

export interface OperationTemplatePointChange {
  templateId: string;
  points: number | null;
}

export interface OperationReportData {
  tasksCreated: OperationTask[];
  tasksSubmittedToNew: OperationTask[];
  tasksAssigned: OperationTask[];
  tasksDesignSubmitted: OperationTask[];
  tasksFulfilled: OperationTask[];
  ideasCreated: OperationTask[];
  ideasAssigned: OperationTask[];
  ideasDesignSubmitted: OperationTask[];
  ideasCompleted: OperationTask[];
  ideasMatchedToSales: OperationTask[];
  listings: EtsyListing[];
  listingsMatchedToSales: EtsyListing[];
  users: OperationUser[];
  templates: OperationTemplate[];
}

export interface DateRangeInput {
  from: string;
  to: string;
}

export type OperationReportProfile =
  | 'full'
  | 'report'
  | 'company-overview'
  | 'designer-idea'
  | 'designer-fulfillment'
  | 'designer-kpi'
  | 'configuration'
  | 'listing'
  | 'customer-service'
  | 'fulfillment'
  | 'fulfillment-kpi';

type OperationReportRequirements = {
  templates?: boolean;
  listings?: boolean;
  tasksCreated?: boolean;
  tasksSubmittedToNew?: boolean;
  tasksAssigned?: boolean;
  tasksDesignSubmitted?: boolean;
  tasksFulfilled?: boolean;
  ideasCreated?: boolean;
  ideasAssigned?: boolean;
  ideasDesignSubmitted?: boolean;
  ideasMatchedToSales?: boolean;
  listingsMatchedToSales?: boolean;
};

const OPERATION_REPORT_REQUIREMENTS: Record<OperationReportProfile, OperationReportRequirements> = {
  full: {
    templates: true,
    listings: true,
    tasksCreated: true,
    tasksSubmittedToNew: true,
    tasksAssigned: true,
    tasksDesignSubmitted: true,
    tasksFulfilled: true,
    ideasCreated: true,
    ideasAssigned: true,
    ideasDesignSubmitted: true,
    ideasMatchedToSales: true,
    listingsMatchedToSales: true,
  },
  report: {
    tasksDesignSubmitted: true,
    tasksFulfilled: true,
    ideasCreated: true,
    ideasDesignSubmitted: true,
  },
  'company-overview': {
    listings: true,
    tasksCreated: true,
    tasksSubmittedToNew: true,
    tasksDesignSubmitted: true,
    tasksFulfilled: true,
    ideasDesignSubmitted: true,
  },
  'designer-idea': {
    templates: true,
    tasksCreated: true,
    tasksAssigned: true,
    tasksDesignSubmitted: true,
    ideasAssigned: true,
    ideasDesignSubmitted: true,
    ideasMatchedToSales: true,
  },
  'designer-fulfillment': {
    templates: true,
    tasksAssigned: true,
    tasksDesignSubmitted: true,
    ideasAssigned: true,
    ideasDesignSubmitted: true,
  },
  'designer-kpi': {
    templates: true,
    tasksDesignSubmitted: true,
    ideasDesignSubmitted: true,
  },
  configuration: {
    templates: true,
  },
  listing: {
    listings: true,
  },
  'customer-service': {
    tasksCreated: true,
    tasksSubmittedToNew: true,
  },
  fulfillment: {
    tasksDesignSubmitted: true,
    tasksFulfilled: true,
  },
  'fulfillment-kpi': {
    tasksFulfilled: true,
  },
};

let cachedUsers: OperationUser[] | null = null;
let cachedUsersAt = 0;
let cachedTemplates: OperationTemplate[] | null = null;
let cachedTemplatesAt = 0;
const USERS_CACHE_MS = 30 * 60 * 1000;
const REPORT_CACHE_MS = 2 * 60 * 1000;
const MAX_OPERATION_REPORT_DAYS = 100;
const REPORT_QUERY_CHUNK_DAYS = 7;
const TEAM_DOCS_CACHE_LIMIT = 24;
const OPERATION_CACHE_LIMIT = 12;
const OPERATION_PERSISTENT_CACHE_ENABLED = false;
const OPERATION_PERSISTENT_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

const isReportVerboseLogEnabled = () => {
  try {
    return import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('reportVerbose') === '1';
  } catch {
    return false;
  }
};

const logReportVerbose = (message: string, details: globalThis.Record<string, unknown>) => {
  if (isReportVerboseLogEnabled()) {
    console.info('[Report]', message, details);
  }
};

const teamDocsCache = new Map<string, { createdAt: number; data: unknown[] }>();
const operationCache = new Map<string, { createdAt: number; data: OperationReportData }>();
const teamDocsInflight = new Map<string, Promise<unknown[]>>();
const operationInflight = new Map<string, Promise<OperationReportData>>();
const supplierMappingCache = new Map<string, { createdAt: number; data: ReportSkuMapping[] }>();
const fulfillmentRecordCache = new Map<string, { createdAt: number; data: ReportOrderRecord[] }>();
const fulfillmentRecordInflight = new Map<string, Promise<ReportOrderRecord[]>>();
const SUPPLIER_MAPPING_CACHE_MS = 30 * 60 * 1000;

interface OperationReportCacheEntry {
  createdAt: number;
  data: OperationReportData;
}

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

const toISODateValue = (value: DateValue): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  return undefined;
};

const getTodayKeyInTimezone = (timeZone: string) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

const isHistoricalRange = (range: DateRangeInput, timeZone: string) => {
  return range.to < getTodayKeyInTimezone(timeZone);
};

const getPersistentOperationCacheKey = (teamId: string, range: DateRangeInput, timeZone: string) => {
  return `operation-report:v5:${teamId}:${range.from}:${range.to}:${timeZone}`;
};

const readPersistentOperationCache = async (teamId: string, range: DateRangeInput, timeZone: string): Promise<OperationReportData | null> => {
  try {
    const entry = await getValueFromDB<OperationReportCacheEntry>(STORE_OPERATION_REPORT_CACHE, getPersistentOperationCacheKey(teamId, range, timeZone));
    if (!entry) return null;
    if (Date.now() - entry.createdAt > OPERATION_PERSISTENT_CACHE_MS) return null;
    logReportVerbose('operation-cache:persistent-hit', { range, timeZone });
    return entry.data;
  } catch (error) {
    logReportVerbose('operation-cache:persistent-read-failed', { error });
    return null;
  }
};

const writePersistentOperationCache = async (teamId: string, range: DateRangeInput, timeZone: string, data: OperationReportData) => {
  try {
    await saveValueToDB(STORE_OPERATION_REPORT_CACHE, getPersistentOperationCacheKey(teamId, range, timeZone), {
      createdAt: Date.now(),
      data
    } satisfies OperationReportCacheEntry);
    logReportVerbose('operation-cache:persistent-write', { range, timeZone });
  } catch (error) {
    logReportVerbose('operation-cache:persistent-write-failed', { error });
  }
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
    personalization: data.personalization,
    variant1: data.variant1,
    variant2: data.variant2,
    createdBy: data.createdBy,
    taskId: data.taskId,
    orderId: data.orderId,
    designerId: data.designerId,
    designerName: data.designerName,
    cs_id: data.cs_id,
    idea_emp_id: data.idea_emp_id,
    team: data.team,
    account: data.account,
    supplier: data.supplier,
    fulfillment_id: data.fulfillment_id,
    rejection_count: data.rejection_count,
    templateId: data.templateId,
    templatePointsSnapshot: data.templatePointsSnapshot ?? data.template_points_snapshot,
    templatePointBreakdownSnapshot: data.templatePointBreakdownSnapshot ?? data.template_point_breakdown_snapshot,
    listingId: data.listingId,
    saleCount: data.saleCount,
    created_at: toISODateValue(data.created_at),
    updatedAt: toISODateValue(data.updatedAt),
    fulfilled_at: toISODateValue(data.fulfilled_at),
    design_submitted_at: toISODateValue(data.design_submitted_at),
    assigned_to_designer_at: toISODateValue(data.assigned_to_designer_at),
    submitted_to_new_at: toISODateValue(data.submitted_to_new_at),
    submitted_to_new_by: data.submitted_to_new_by,
    fulfilled_by: data.fulfilled_by,
    collectionName
  };
};

const normalizeMappingSearch = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const getTaskProductKey = (task: OperationTask) => {
  const productType = String(task.sku || '').trim().split('-')[0];
  return normalizeMappingSearch(productType);
};

export const fetchSupplierMappingsForTasks = async (
  tasks: OperationTask[],
  forceRefresh = false,
): Promise<ReportSkuMapping[]> => {
  const productKeys = Array.from(new Set(tasks.map(getTaskProductKey).filter(Boolean))).sort();
  if (productKeys.length === 0) return [];
  const cacheKey = productKeys.join('|');
  if (!forceRefresh) {
    const cached = getFreshCache(supplierMappingCache, cacheKey, SUPPLIER_MAPPING_CACHE_MS);
    if (cached) return cached;
  }

  const chunks: string[][] = [];
  for (let index = 0; index < productKeys.length; index += 30) {
    chunks.push(productKeys.slice(index, index + 30));
  }
  const snapshots = await Promise.all(chunks.map(chunk => getDocs(query(
    collection(db, 'sku_mappings'),
    where('etsy_sku_search', 'in', chunk),
  ))));
  const mappings = [...new Map(snapshots.flatMap(snapshot => snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return [docSnap.id, {
      id: docSnap.id,
      etsy_sku: String(data.etsy_sku || ''),
      variant1: data.variant1,
      variant2: data.variant2,
      supplier: data.supplier,
    } satisfies ReportSkuMapping] as const;
  }))).values()];

  setLimitedCache(supplierMappingCache, cacheKey, mappings, OPERATION_CACHE_LIMIT);
  return mappings;
};

const compactOrderRecordDoc = (docSnap: QueryDocumentSnapshot<DocumentData>): ReportOrderRecord => {
  const data = docSnap.data() as OrderRecord;
  return compactOrderRecord(data, docSnap.id);
};

const compactOrderRecord = (data: OrderRecord, id?: string): ReportOrderRecord => {
  return {
    id,
    dt_local: toISODateValue(data.dt_local) || '',
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
    financials: data.details?.financials
      ? {
        discount: Number(data.details.financials.discount || 0),
        shipping: Number(data.details.financials.shipping || 0)
      }
      : undefined,
    items: Array.isArray(data.details?.items)
      ? data.details.items.map(item => ({
        sku: item.sku,
        listingId: item.listingId,
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
  return compactReview(data, docSnap.id);
};

const compactReview = (data: EtsyReview, id?: string): ReportReview => {
  return {
    id,
    shop_id: String(data.shop_id || 'Unknown'),
    rating: typeof data.rating === 'number' ? data.rating : null,
    create_date: toISODateValue(data.create_date) || ''
  };
};

const compactListingDoc = (docSnap: QueryDocumentSnapshot<DocumentData>): EtsyListing => {
  const data = docSnap.data();
  const state = data.state === null || data.state === undefined || data.state === '' ? null : Number(data.state);
  return {
    id: docSnap.id,
    listing_id: String(data.listing_id || docSnap.id),
    title: String(data.title || ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    images: Array.isArray(data.images) ? data.images.map(String).filter(Boolean) : [],
    sku: String(data.sku || ''),
    product_type: data.product_type || null,
    employee_id: data.employee_id || null,
    create_date: toISODateValue(data.create_date) || '',
    update_date: toISODateValue(data.update_date) || '',
    shop_id: String(data.shop_id || ''),
    shop_label: String(data.shop_label || data.shop_id || ''),
    state: Number.isInteger(state) ? state : null,
    url: data.url || null,
    first_sale_date: toISODateValue(data.first_sale_date) || null,
    first_sale_order_id: data.first_sale_order_id || null,
    last_sale_date: toISODateValue(data.last_sale_date) || null,
  };
};

const fetchTasksByDateField = async (
  collectionName: 'tasks' | 'ideas',
  field: 'created_at' | 'design_submitted_at' | 'fulfilled_at' | 'assigned_to_designer_at' | 'submitted_to_new_at',
  fromISO: string,
  toISO: string
): Promise<OperationTask[]> => {
  logReportVerbose('task-query:start', { collectionName, field, fromISO, toISO });
  const startMs = new Date(fromISO).getTime();
  const endExclusiveMs = new Date(toISO).getTime() + 1;
  const chunkMs = REPORT_QUERY_CHUNK_DAYS * 86400000;
  const tasksById = new Map<string, OperationTask>();

  for (let cursorMs = startMs; cursorMs < endExclusiveMs; cursorMs += chunkMs) {
    const chunkEndMs = Math.min(cursorMs + chunkMs, endExclusiveMs);
    const snapshot = await getDocs(query(
      collection(db, collectionName),
      where(field, '>=', new Date(cursorMs).toISOString()),
      where(field, '<', new Date(chunkEndMs).toISOString())
    ));
    snapshot.docs.forEach(docSnap => tasksById.set(docSnap.id, compactTaskDoc(docSnap, collectionName)));
  }

  logReportVerbose('task-query:done', { collectionName, field, count: tasksById.size });
  return [...tasksById.values()];
};

const fetchIdeasBySkus = async (skus: Array<string | null | undefined>): Promise<OperationTask[]> => {
  const skuVariants = [...new Set(skus.flatMap(sku => {
    const raw = String(sku || '').trim();
    return raw ? [raw, raw.toUpperCase(), raw.toLowerCase()] : [];
  }))];
  if (!skuVariants.length) return [];

  const ideasById = new Map<string, OperationTask>();
  for (let index = 0; index < skuVariants.length; index += 30) {
    const skuChunk = skuVariants.slice(index, index + 30);
    const snapshot = await getDocs(query(collection(db, 'ideas'), where('sku', 'in', skuChunk)));
    snapshot.docs.forEach(docSnap => ideasById.set(docSnap.id, compactTaskDoc(docSnap, 'ideas')));
  }
  return [...ideasById.values()];
};

const fetchListingsBySkus = async (teamId: string, skus: Array<string | null | undefined>): Promise<EtsyListing[]> => {
  const normalizedSkus = [...new Set(skus.map(sku => String(sku || '').trim().toUpperCase()).filter(Boolean))];
  if (!normalizedSkus.length) return [];

  const listingsById = new Map<string, EtsyListing>();
  for (let index = 0; index < normalizedSkus.length; index += 30) {
    const skuChunk = normalizedSkus.slice(index, index + 30);
    const snapshot = await getDocs(query(
      collection(db, 'user', teamId, 'listings'),
      where('sku', 'in', skuChunk)
    ));
    snapshot.docs.forEach(docSnap => listingsById.set(docSnap.id, compactListingDoc(docSnap)));
  }
  return [...listingsById.values()];
};

const fetchTeamDocsByDateField = async <T,>(
  teamId: string,
  collectionName: 'records' | 'reviews' | 'listings',
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

export const fetchReportRecords = async (teamId: string, dateRange: DateRangeInput, timeZone: string, forceRefresh = false): Promise<ReportOrderRecord[]> => {
  if (forceRefresh) {
    return fetchTeamDocsByDateField<ReportOrderRecord>(teamId, 'records', 'dt_local', dateRange, timeZone, compactOrderRecordDoc, true);
  }
  assertReportRangeSupported(dateRange);
  const records = await getRecordsForDateRange(teamId, dateRange.from, dateRange.to, timeZone);
  return records.map(record => compactOrderRecord(record, record.id));
};

export const fetchFulfillmentRecordsForTasks = async (
  teamId: string,
  tasks: OperationTask[],
  forceRefresh = false,
): Promise<ReportOrderRecord[]> => {
  const orderIds = [...new Set(tasks.map(task => {
    const orderId = String(task.orderId || '').trim();
    if (orderId) return orderId;
    const taskId = String(task.taskId || task.id || '').trim();
    return taskId.match(/^(\d+)(?:-\d+)?$/)?.[1] || taskId;
  }).filter(Boolean))].sort();
  if (!orderIds.length) return [];

  const cacheKey = `${teamId}:${orderIds.join('|')}`;
  if (!forceRefresh) {
    const cached = getFreshCache(fulfillmentRecordCache, cacheKey, REPORT_CACHE_MS);
    if (cached) return cached;
    const inflight = fulfillmentRecordInflight.get(cacheKey);
    if (inflight) return inflight;
  }

  const request = (async () => {
    const recordsRef = collection(db, 'user', teamId, 'records');
    const snapshots = await Promise.all(Array.from(
      { length: Math.ceil(orderIds.length / 30) },
      (_, index) => getDocs(query(recordsRef, where('order_id', 'in', orderIds.slice(index * 30, index * 30 + 30))))
    ));
    const records = [...new Map(snapshots.flatMap(snapshot => snapshot.docs.map(docSnap => (
      [docSnap.id, compactOrderRecordDoc(docSnap)] as const
    )))).values()];
    setLimitedCache(fulfillmentRecordCache, cacheKey, records, OPERATION_CACHE_LIMIT);
    return records;
  })();

  if (!forceRefresh) fulfillmentRecordInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (!forceRefresh) fulfillmentRecordInflight.delete(cacheKey);
  }
};

export const fetchReportReviews = async (teamId: string, dateRange: DateRangeInput, timeZone: string, forceRefresh = false): Promise<ReportReview[]> => {
  if (forceRefresh) {
    return fetchTeamDocsByDateField<ReportReview>(teamId, 'reviews', 'create_date', dateRange, timeZone, compactReviewDoc, true);
  }
  assertReportRangeSupported(dateRange);
  const reviews = await getEtsyReviewsForDateRange(teamId, dateRange.from, dateRange.to, timeZone);
  return reviews.map(review => compactReview(review, review.id));
};

export const fetchReportListings = async (teamId: string, dateRange: DateRangeInput, timeZone: string, forceRefresh = false): Promise<EtsyListing[]> => {
  return fetchTeamDocsByDateField<EtsyListing>(teamId, 'listings', 'create_date', dateRange, timeZone, compactListingDoc, forceRefresh);
};

export const fetchOperationUsers = async (forceRefresh = false): Promise<OperationUser[]> => {
  const now = Date.now();
  if (!forceRefresh && cachedUsers && now - cachedUsersAt < USERS_CACHE_MS) {
    return cachedUsers;
  }

  try {
    const snap = await getDocs(collection(db, 'authentication'));
    cachedUsers = snap.docs
      .filter(docSnap => docSnap.id !== '_settings')
      .map(docSnap => {
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        empID: data.empID,
        fullName: data.fullName,
        displayName: data.displayName,
        email: data.email,
        role: data.role,
        teamId: data.teamId,
        photoURL: data.photoURL,
        active: data.active,
        isActive: data.isActive
      };
    });
    cachedUsersAt = now;
    return cachedUsers;
  } catch (error) {
    console.warn('[Report] Could not fetch operation users:', error);
    if (cachedUsers) return cachedUsers;
    throw error;
  }
};

const fetchOperationTemplates = async (forceRefresh = false): Promise<OperationTemplate[]> => {
  const now = Date.now();
  if (!forceRefresh && cachedTemplates && now - cachedTemplatesAt < USERS_CACHE_MS) {
    return cachedTemplates;
  }

  try {
    const snapshot = await getDoc(doc(db, 'settings', 'templates'));
    if (!snapshot.exists()) return cachedTemplates || [];
    cachedTemplates = Object.entries(snapshot.data()).map(([id, value]) => ({
      id,
      ...(value as Omit<OperationTemplate, 'id'>)
    }));
    cachedTemplatesAt = now;
    return cachedTemplates;
  } catch (error) {
    console.warn('[Report] Could not fetch operation templates:', error);
    if (cachedTemplates) return cachedTemplates;
    throw error;
  }
};

const applyTemplatePointChange = (
  templates: OperationTemplate[],
  change: OperationTemplatePointChange,
) => templates.map(template => {
  if (template.id !== change.templateId) return template;
  if (change.points === null) {
    const { points: previousPoints, ...templateWithoutPoints } = template;
    void previousPoints;
    return templateWithoutPoints;
  }
  return { ...template, points: change.points };
});

export const saveOperationTemplatePoint = async (templateId: string, points: number | null) => {
  const normalizedTemplateId = templateId.trim();
  if (!normalizedTemplateId) throw new Error('Template ID không hợp lệ.');
  if (points !== null && (!Number.isFinite(points) || points < 0)) {
    throw new Error('Điểm template phải là số lớn hơn hoặc bằng 0.');
  }

  await updateDoc(
    doc(db, 'settings', 'templates'),
    new FieldPath(normalizedTemplateId, 'points'),
    points === null ? deleteField() : points,
  );

  const change: OperationTemplatePointChange = { templateId: normalizedTemplateId, points };
  if (cachedTemplates) {
    cachedTemplates = applyTemplatePointChange(cachedTemplates, change);
    cachedTemplatesAt = Date.now();
  }
  operationCache.forEach((entry, key) => {
    operationCache.set(key, {
      ...entry,
      data: { ...entry.data, templates: applyTemplatePointChange(entry.data.templates, change) },
    });
  });
  window.dispatchEvent(new CustomEvent<OperationTemplatePointChange>(OPERATION_TEMPLATE_POINT_CHANGE_EVENT, { detail: change }));
};

export const fetchOperationReportData = async (
  teamId: string,
  dateRange: DateRangeInput,
  timeZone: string,
  forceRefresh = false,
  profile: OperationReportProfile = 'full'
): Promise<OperationReportData> => {
  assertReportRangeSupported(dateRange);
  const requirements = OPERATION_REPORT_REQUIREMENTS[profile];
  const cacheKey = `${teamId}:${dateRange.from}:${dateRange.to}:${timeZone}:${profile}`;
  const canUsePersistentCache = profile === 'full'
    && OPERATION_PERSISTENT_CACHE_ENABLED
    && !forceRefresh
    && isHistoricalRange(dateRange, timeZone);
  if (!forceRefresh) {
    const cached = getFreshCache(operationCache, cacheKey, REPORT_CACHE_MS);
    if (cached) return cached;

    const inflight = operationInflight.get(cacheKey);
    if (inflight) return inflight;

    if (canUsePersistentCache) {
      const persistentCached = await readPersistentOperationCache(teamId, dateRange, timeZone);
      if (persistentCached) {
        setLimitedCache(operationCache, cacheKey, persistentCached, OPERATION_CACHE_LIMIT);
        return persistentCached;
      }
    }
  }

  const request = (async () => {
    const endMeasure = startMeasure('report:operation-fetch', {
      from: dateRange.from,
      to: dateRange.to,
      timeZone,
      forceRefresh,
      profile,
    });
    const { fromISO, toISO } = buildIsoRangeForTimezone(dateRange, timeZone);
    const [users, templates, listings] = await Promise.all([
      fetchOperationUsers(forceRefresh),
      requirements.templates ? fetchOperationTemplates(forceRefresh) : Promise.resolve([]),
      requirements.listings ? fetchReportListings(teamId, dateRange, timeZone, forceRefresh) : Promise.resolve([]),
    ]);

    // Keep required snapshots sequential to cap browser memory on long KPI periods.
    const tasksCreated = requirements.tasksCreated ? await fetchTasksByDateField('tasks', 'created_at', fromISO, toISO) : [];
    const ideasMatchedToSales = requirements.ideasMatchedToSales ? await fetchIdeasBySkus(tasksCreated.map(task => task.sku)) : [];
    const listingsMatchedToSales = requirements.listingsMatchedToSales ? await fetchListingsBySkus(teamId, tasksCreated.map(task => task.sku)) : [];
    const tasksSubmittedToNew = requirements.tasksSubmittedToNew ? await fetchTasksByDateField('tasks', 'submitted_to_new_at', fromISO, toISO) : [];
    const tasksAssigned = requirements.tasksAssigned ? await fetchTasksByDateField('tasks', 'assigned_to_designer_at', fromISO, toISO) : [];
    const tasksDesignSubmitted = requirements.tasksDesignSubmitted ? await fetchTasksByDateField('tasks', 'design_submitted_at', fromISO, toISO) : [];
    const tasksFulfilled = requirements.tasksFulfilled ? await fetchTasksByDateField('tasks', 'fulfilled_at', fromISO, toISO) : [];
    const ideasCreated = requirements.ideasCreated ? await fetchTasksByDateField('ideas', 'created_at', fromISO, toISO) : [];
    const ideasAssigned = requirements.ideasAssigned ? await fetchTasksByDateField('ideas', 'assigned_to_designer_at', fromISO, toISO) : [];
    const ideasDesignSubmitted = requirements.ideasDesignSubmitted ? await fetchTasksByDateField('ideas', 'design_submitted_at', fromISO, toISO) : [];

    const data = {
      tasksCreated,
      tasksSubmittedToNew,
      tasksAssigned,
      tasksDesignSubmitted,
      tasksFulfilled: tasksFulfilled.filter(task => task.status === 'done'),
      ideasCreated,
      ideasAssigned,
      ideasDesignSubmitted,
      ideasCompleted: [],
      ideasMatchedToSales,
      listings,
      listingsMatchedToSales,
      users,
      templates
    };

    setLimitedCache(operationCache, cacheKey, data, OPERATION_CACHE_LIMIT);
    endMeasure({
      tasksCreated: tasksCreated.length,
      tasksSubmittedToNew: tasksSubmittedToNew.length,
      tasksAssigned: tasksAssigned.length,
      tasksDesignSubmitted: tasksDesignSubmitted.length,
      tasksFulfilled: data.tasksFulfilled.length,
      ideasCreated: ideasCreated.length,
      ideasAssigned: ideasAssigned.length,
      ideasDesignSubmitted: ideasDesignSubmitted.length,
      ideasMatchedToSales: ideasMatchedToSales.length,
      listings: listings.length,
      listingsMatchedToSales: listingsMatchedToSales.length
    });
    if (profile === 'full' && OPERATION_PERSISTENT_CACHE_ENABLED && isHistoricalRange(dateRange, timeZone)) {
      writePersistentOperationCache(teamId, dateRange, timeZone, data);
    }
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
