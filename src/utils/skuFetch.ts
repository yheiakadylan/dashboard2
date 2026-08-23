import type { Record as OrderRecord } from '../types';

const RETRYABLE_SKU_VALUES = new Set(['', 'NULL_RATE_LIMIT']);

export const shouldFetchSkuValue = (value?: string | null) => {
  const normalized = String(value || '').trim().toUpperCase();
  return RETRYABLE_SKU_VALUES.has(normalized);
};

export const recordNeedsSkuFetch = (record: Pick<OrderRecord, 'details'>) => {
  const items = record.details?.items;
  if (!items || items.length === 0) return true;
  return items.some(item => shouldFetchSkuValue(item.sku));
};
