import {
  collection,
  doc,
  documentId,
  endAt,
  getDoc,
  getDocs,
  orderBy,
  query,
  startAt,
} from 'firebase/firestore';
import { db } from '../../../services/firebaseService';
import type { PerformanceSectionId } from '../types';

export type PerformanceBaselineGranularity = 'daily' | 'monthly';
export type PerformanceBaselineRefreshStatus = 'ready' | 'running' | 'failed' | 'finalized' | 'unknown';

export interface PerformanceBaselineBucket {
  id: string;
  sectionId: PerformanceSectionId;
  employeeId: string;
  granularity: PerformanceBaselineGranularity;
  periodKey: string;
  outputTotal: number;
  outputCount: number;
  unit: string;
  updatedAt: string | null;
}

export interface PerformanceBaselineAggregate {
  buckets: PerformanceBaselineBucket[];
  updatedAt: string | null;
  rangeFrom: string;
  rangeTo: string;
  quarterLabel: string;
  available: boolean;
  refreshStatus: PerformanceBaselineRefreshStatus;
  lastError: string | null;
}

interface BaselineDateRange {
  from: string;
  to: string;
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { loadedAt: number; data: PerformanceBaselineAggregate }>();

const getRunDocumentId = (from: string, to: string) => `_run__${from}__${to}`;

export const getPreviousQuarterRange = (anchorValue: string) => {
  const anchor = new Date(`${anchorValue.slice(0, 10)}T00:00:00Z`);
  const safeAnchor = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  const currentQuarterIndex = Math.floor(safeAnchor.getUTCMonth() / 3);
  const previousQuarterIndex = currentQuarterIndex === 0 ? 3 : currentQuarterIndex - 1;
  const year = currentQuarterIndex === 0 ? safeAnchor.getUTCFullYear() - 1 : safeAnchor.getUTCFullYear();
  const startMonth = previousQuarterIndex * 3;
  const from = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { from, to, quarterLabel: `Q${previousQuarterIndex + 1}/${year}` };
};

const normalizeIso = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
};

const fetchBucketsByGranularity = async (
  teamId: string,
  sectionId: PerformanceSectionId,
  granularity: PerformanceBaselineGranularity,
  from: string,
  to: string,
) => {
  const prefix = `${sectionId}__${granularity}__`;
  const snapshot = await getDocs(query(
    collection(db, 'user', teamId, 'performance_baseline_buckets'),
    orderBy(documentId()),
    startAt(`${prefix}${from}`),
    endAt(`${prefix}${to}\uf8ff`),
  ));

  return snapshot.docs.flatMap(bucketDoc => {
    const data = bucketDoc.data();
    const outputTotal = Number(data.outputTotal);
    const outputCount = Number(data.outputCount);
    if (!data.employeeId || !Number.isFinite(outputTotal)) return [];
    return [{
      id: bucketDoc.id,
      sectionId,
      employeeId: String(data.employeeId),
      granularity,
      periodKey: String(data.periodKey || ''),
      outputTotal,
      outputCount: Number.isFinite(outputCount) ? outputCount : 0,
      unit: String(data.unit || ''),
      updatedAt: normalizeIso(data.updatedAt),
    } satisfies PerformanceBaselineBucket];
  });
};

export const fetchPerformanceBaselineAggregate = async (
  teamId: string,
  sectionId: PerformanceSectionId,
  dateRange: BaselineDateRange,
  forceRefresh = false,
): Promise<PerformanceBaselineAggregate> => {
  const quarter = getPreviousQuarterRange(dateRange.to || new Date().toISOString());
  if (!teamId || sectionId === 'company-overview') {
    return {
      buckets: [],
      updatedAt: null,
      rangeFrom: quarter.from,
      rangeTo: quarter.to,
      quarterLabel: quarter.quarterLabel,
      available: false,
      refreshStatus: 'unknown',
      lastError: null,
    };
  }
  const { from, to, quarterLabel } = quarter;
  const cacheKey = `${teamId}:${sectionId}:${from}:${to}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.data;

  const [buckets, runSnapshot] = await Promise.all([
    fetchBucketsByGranularity(
      teamId,
      sectionId,
      'monthly',
      from.slice(0, 7),
      to.slice(0, 7),
    ),
    getDoc(doc(db, 'user', teamId, 'performance_baseline_buckets', getRunDocumentId(from, to))),
  ]);
  const runData = runSnapshot.exists() ? runSnapshot.data() : null;
  const rawStatus = String(runData?.status || 'unknown');
  const refreshStatus: PerformanceBaselineRefreshStatus = ['ready', 'running', 'failed', 'finalized'].includes(rawStatus)
    ? rawStatus as PerformanceBaselineRefreshStatus
    : 'unknown';
  const bucketUpdatedAt = buckets.reduce<string | null>((latest, bucket) => (
    bucket.updatedAt && (!latest || bucket.updatedAt > latest) ? bucket.updatedAt : latest
  ), null);
  const updatedAt = normalizeIso(runData?.completedAt) || normalizeIso(runData?.updatedAt) || bucketUpdatedAt;
  const available = buckets.length > 0 || refreshStatus === 'ready' || refreshStatus === 'finalized';
  const data = {
    buckets,
    updatedAt,
    rangeFrom: from,
    rangeTo: to,
    quarterLabel,
    available,
    refreshStatus,
    lastError: typeof runData?.lastError === 'string' && runData.lastError.trim() ? runData.lastError : null,
  };
  cache.set(cacheKey, { loadedAt: Date.now(), data });
  return data;
};
