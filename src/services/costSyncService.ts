import { CostData, Record } from '../types';
import { fetchCostsForRecords } from './fulfillmentService';
import { markRecordsDailyCacheDirty, updateRecordsInFirebase } from './firebaseService';

const DEFAULT_COST_FETCH_CHUNK_SIZE = 250;
const DEFAULT_UPDATE_BATCH_SIZE = 250;
const COST_FETCH_RETRY_COUNT = 2;
const fulfillmentCostSessionCache = new Map<string, CostData>();

export type CostSyncProgress =
  | {
      phase: 'prepare';
      message: string;
      totalOrders: number;
      eligibleOrders: number;
      completeOrders: number;
      skippedOrders: number;
    }
  | {
      phase: 'fetch';
      message: string;
      fromOrder: number;
      processedOrders: number;
      totalEligibleOrders: number;
      chunkSize: number;
    }
  | {
      phase: 'update';
      message: string;
      processedOrders: number;
      totalEligibleOrders: number;
      processedRecords: number;
      totalRecords: number;
      batchIndex: number;
      batchCount: number;
      writes: number;
    }
  | {
      phase: 'checked';
      message: string;
      processedOrders: number;
      totalEligibleOrders: number;
      updatedRecords: number;
    };

export type CostSyncResult = {
  costMap: Map<string, CostData>;
  totalOrders: number;
  eligibleOrders: number;
  completeOrders: number;
  skippedOrders: number;
  costsFound: number;
  updatedRecords: number;
  failedChunks: number;
};

type SyncFulfillmentCostsOptions = {
  teamId: string;
  recordsToScan: Record[];
  recordsToUpdate?: Record[];
  signal?: AbortSignal;
  chunkSize?: number;
  updateBatchSize?: number;
  updateExistingRecords?: boolean;
  markCacheDirty?: boolean;
  productNameFallback?: 'existing' | 'null';
  onProgress?: (progress: CostSyncProgress) => void;
  onRecordsUpdated?: (updatedRecordsById: Map<string, Record>) => void;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const isRefundNoticeRecord = (record: Record) => record.source === 'Etsy_Refunded';

export const hasFulfillmentCost = (record: Record) => (record.cost_total || 0) > 0;

export const shouldFetchFulfillmentCost = (record: Record) => (
  record.kind === 'order' &&
  Boolean(record.order_id) &&
  !isRefundNoticeRecord(record) &&
  (!record.ff_code || !hasFulfillmentCost(record))
);

const getUniqueOrderRecords = (records: Record[]) => {
  const seen = new Set<string>();
  const uniqueRecords: Record[] = [];

  records.forEach(record => {
    if (!record.order_id || seen.has(record.order_id)) return;
    seen.add(record.order_id);
    uniqueRecords.push(record);
  });

  return uniqueRecords;
};

const buildRecordsByOrderId = (records: Record[]) => {
  const map = new Map<string, Record[]>();

  records.forEach(record => {
    if (!record.order_id || isRefundNoticeRecord(record)) return;
    const matchedRecords = map.get(record.order_id) || [];
    matchedRecords.push(record);
    map.set(record.order_id, matchedRecords);
  });

  return map;
};

const getCostUpdatesForChunk = (
  costMap: Map<string, CostData>,
  recordsByOrderId: Map<string, Record[]>,
  productNameFallback: 'existing' | 'null',
) => {
  const updates: (Partial<Record> & { id: string })[] = [];
  const updatedRecordsById = new Map<string, Record>();

  costMap.forEach((costInfo, orderId) => {
    const matchedRecords = recordsByOrderId.get(orderId) || [];
    matchedRecords.forEach(record => {
      if (!record.id) return;

      const nextProductName = costInfo.product_name || (productNameFallback === 'existing' ? record.product_name : null);
      const hasChanged =
        record.cost_total !== costInfo.cost_total ||
        (record.ff_code || '') !== (costInfo.ff_code || '') ||
        (record.product_name || null) !== (nextProductName || null);

      if (!hasChanged) return;

      updates.push({
        id: record.id,
        dt_local: record.dt_local,
        cost_total: costInfo.cost_total,
        ff_code: costInfo.ff_code,
        product_name: nextProductName,
      });
      updatedRecordsById.set(record.id, {
        ...record,
        cost_total: costInfo.cost_total,
        ff_code: costInfo.ff_code,
        product_name: nextProductName || undefined,
      });
    });
  });

  return { updates, updatedRecordsById };
};

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const isWriteBackpressureError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /resource-exhausted|maximum allowed queued writes|backoff|overloading/i.test(message);
};

const fetchCostChunkWithRetry = async (
  chunk: Record[],
  signal?: AbortSignal,
) => {
  const cachedCosts = new Map<string, CostData>();
  const recordsToFetch: Record[] = [];

  chunk.forEach(record => {
    const orderId = record.order_id;
    if (!orderId) return;
    const cachedCost = fulfillmentCostSessionCache.get(orderId);
    if (cachedCost) {
      cachedCosts.set(orderId, cachedCost);
    } else {
      recordsToFetch.push(record);
    }
  });

  if (recordsToFetch.length === 0) {
    return cachedCosts;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= COST_FETCH_RETRY_COUNT; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const fetchedCosts = await fetchCostsForRecords(recordsToFetch, { signal });
      fetchedCosts.forEach((costInfo, orderId) => {
        fulfillmentCostSessionCache.set(orderId, costInfo);
        cachedCosts.set(orderId, costInfo);
      });
      return cachedCosts;
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt < COST_FETCH_RETRY_COUNT) {
        await sleep(500 * (attempt + 1));
      }
    }
  }

  throw lastError;
};

const updateCostRecords = async (
  teamId: string,
  updates: (Partial<Record> & { id: string })[],
  updateBatchSize: number,
  onProgress?: SyncFulfillmentCostsOptions['onProgress'],
  progressContext?: { processedOrders: number; totalEligibleOrders: number },
) => {
  const affectedDates = new Set<string>();

  const runUpdate = async (batchSize: number) => updateRecordsInFirebase(teamId, updates, {
    batchSize,
    markDailyCacheDirty: false,
    onProgress: ({ processed, total, batchIndex, batchCount, writes }) => {
      onProgress?.({
        phase: 'update',
        message: `Committing cost batch ${batchIndex}/${batchCount} (${writes} writes), ${processed}/${total} records for ${progressContext?.processedOrders || 0}/${progressContext?.totalEligibleOrders || 0} orders...`,
        processedOrders: progressContext?.processedOrders || 0,
        totalEligibleOrders: progressContext?.totalEligibleOrders || 0,
        processedRecords: processed,
        totalRecords: total,
        batchIndex,
        batchCount,
        writes,
      });
    },
  });

  try {
    (await runUpdate(updateBatchSize)).forEach(date => affectedDates.add(date));
  } catch (error) {
    if (!isWriteBackpressureError(error) || updateBatchSize <= 100) throw error;
    (await runUpdate(100)).forEach(date => affectedDates.add(date));
  }

  return affectedDates;
};

export const getCostSyncSummary = (records: Record[]) => {
  const orderRecords = records.filter(record => record.kind === 'order');
  const refundNoticeCount = orderRecords.filter(isRefundNoticeRecord).length;
  const missingOrderIdCount = orderRecords.filter(record => !record.order_id).length;
  const alreadyCompleteCount = orderRecords.filter(record => (
    record.order_id &&
    !isRefundNoticeRecord(record) &&
    record.ff_code &&
    hasFulfillmentCost(record)
  )).length;
  const eligibleRecords = getUniqueOrderRecords(orderRecords.filter(shouldFetchFulfillmentCost));

  return {
    totalOrders: orderRecords.length,
    eligibleOrders: eligibleRecords.length,
    completeOrders: alreadyCompleteCount,
    skippedOrders: refundNoticeCount + missingOrderIdCount,
    eligibleRecords,
  };
};

export const syncFulfillmentCosts = async ({
  teamId,
  recordsToScan,
  recordsToUpdate = recordsToScan,
  signal,
  chunkSize = DEFAULT_COST_FETCH_CHUNK_SIZE,
  updateBatchSize = DEFAULT_UPDATE_BATCH_SIZE,
  updateExistingRecords = true,
  markCacheDirty = true,
  productNameFallback = 'null',
  onProgress,
  onRecordsUpdated,
}: SyncFulfillmentCostsOptions): Promise<CostSyncResult> => {
  const summary = getCostSyncSummary(recordsToScan);
  const costMap = new Map<string, CostData>();
  const affectedDates = new Set<string>();
  const recordsByOrderId = updateExistingRecords ? buildRecordsByOrderId(recordsToUpdate) : new Map<string, Record[]>();
  let costsFound = 0;
  let updatedRecords = 0;
  let failedChunks = 0;

  onProgress?.({
    phase: 'prepare',
    message: `Preparing cost fetch ${summary.eligibleOrders}/${summary.totalOrders} orders (${summary.completeOrders} complete, ${summary.skippedOrders} skipped)...`,
    totalOrders: summary.totalOrders,
    eligibleOrders: summary.eligibleOrders,
    completeOrders: summary.completeOrders,
    skippedOrders: summary.skippedOrders,
  });

  for (let i = 0; i < summary.eligibleRecords.length; i += chunkSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const chunk = summary.eligibleRecords.slice(i, i + chunkSize);
    const processedOrders = Math.min(i + chunk.length, summary.eligibleRecords.length);
    onProgress?.({
      phase: 'fetch',
      message: `Fetching costs ${i + 1}-${processedOrders}/${summary.eligibleOrders} orders...`,
      fromOrder: i + 1,
      processedOrders,
      totalEligibleOrders: summary.eligibleOrders,
      chunkSize: chunk.length,
    });

    let chunkCostMap: Map<string, CostData>;
    try {
      chunkCostMap = await fetchCostChunkWithRetry(chunk, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      failedChunks++;
      console.error('[costSync] Failed cost chunk:', error);
      onProgress?.({
        phase: 'checked',
        message: `Cost fetch skipped failed chunk ${i + 1}-${processedOrders}/${summary.eligibleOrders} orders...`,
        processedOrders,
        totalEligibleOrders: summary.eligibleOrders,
        updatedRecords,
      });
      continue;
    }

    chunkCostMap.forEach((costInfo, orderId) => costMap.set(orderId, costInfo));
    costsFound += chunkCostMap.size;

    if (updateExistingRecords && chunkCostMap.size > 0) {
      const { updates, updatedRecordsById } = getCostUpdatesForChunk(chunkCostMap, recordsByOrderId, productNameFallback);

      if (updates.length > 0) {
        const chunkDates = await updateCostRecords(teamId, updates, updateBatchSize, onProgress, {
          processedOrders,
          totalEligibleOrders: summary.eligibleOrders,
        });
        chunkDates.forEach(date => affectedDates.add(date));
        updatedRecords += updates.length;
        onRecordsUpdated?.(updatedRecordsById);
      }
    }

    onProgress?.({
      phase: 'checked',
      message: `Cost fetch checked ${processedOrders}/${summary.eligibleOrders} orders, updated ${updatedRecords} records...`,
      processedOrders,
      totalEligibleOrders: summary.eligibleOrders,
      updatedRecords,
    });
  }

  if (markCacheDirty && affectedDates.size > 0) {
    await markRecordsDailyCacheDirty(teamId, Array.from(affectedDates), 'records-updated');
  }

  return {
    costMap,
    totalOrders: summary.totalOrders,
    eligibleOrders: summary.eligibleOrders,
    completeOrders: summary.completeOrders,
    skippedOrders: summary.skippedOrders,
    costsFound,
    updatedRecords,
    failedChunks,
  };
};
