import { Record as MailRecord } from './types.js';
import {
  buildOrderTaskPayload,
  getOrderTaskDocumentId,
  normalizeOrderShippingAddress,
} from '../../src/utils/orderTaskPayload.js';

const SAFE_BATCH_WRITE_LIMIT = 450;

export function resolveOrderCreatedAt(value: unknown, fallback = new Date().toISOString()): string {
  if (!value) return fallback;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function isTaskEligibleOrder(record: Partial<MailRecord> & { source?: string; account?: string }): boolean {
  const itemCount = record.details?.items?.length || 0;
  return (
    (record.source === 'Etsy_Sales' || record.source === 'Ebay_Sales') &&
    Boolean(record.order_id) &&
    Boolean(record.account) &&
    itemCount > 0
  );
}

export function estimateRecordWrites(record: Partial<MailRecord> & { source?: string; account?: string }): number {
  return 1 + (isTaskEligibleOrder(record) ? 1 + (record.details?.items?.length || 0) : 0);
}

export function createBatchWriter(db: any, limit: number = SAFE_BATCH_WRITE_LIMIT) {
  let batch = db.batch();
  let writeCount = 0;
  let commitCount = 0;

  const commit = async () => {
    if (writeCount === 0) return;
    await batch.commit();
    commitCount += 1;
    batch = db.batch();
    writeCount = 0;
  };

  return {
    async ensureCapacity(additionalWrites: number = 1) {
      if (writeCount > 0 && writeCount + additionalWrites > limit) {
        await commit();
      }
    },
    set(ref: any, data: any, options?: any) {
      if (options) batch.set(ref, data, options);
      else batch.set(ref, data);
      writeCount += 1;
      return this;
    },
    create(ref: any, data: any) {
      batch.create(ref, data);
      writeCount += 1;
      return this;
    },
    update(ref: any, data: any) {
      batch.update(ref, data);
      writeCount += 1;
      return this;
    },
    delete(ref: any) {
      batch.delete(ref);
      writeCount += 1;
      return this;
    },
    async commit() {
      await commit();
    },
    getCommitCount() {
      return commitCount;
    },
  };
}

/**
 * Handles post-processing for a new order (Etsy or eBay).
 * Creates a SKU job and corresponding tasks.
 */
export async function processNewOrder(
  db: any, // Firestore instance (Backend)
  batch: any, // WriteBatch instance (Backend)
  teamId: string,
  record: MailRecord,
  accountInfoMap: Map<string, { id: string; label: string }>,
  onlyTaskIds?: ReadonlySet<string>,
) {
  const isEtsy = record.source === 'Etsy_Sales';
  const isEbay = record.source === 'Ebay_Sales';

  if ((isEtsy || isEbay) && record.order_id && record.account) {
    const orderCreatedAt = resolveOrderCreatedAt(record.dt_local);
    // 1. Push to SKU Job Queue
    const jobDocRef = db.collection('user').doc(teamId).collection('sku_jobs').doc(record.order_id);
    batch.set(jobDocRef, {
      order_id: record.order_id,
      account: record.account, // Email (for backward compatibility in jobs if needed)
      status: 'pending',
      priority: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { merge: true });


    // 2. Create one task per item; personalized items stay in draft for CS review.
    if (record.details && record.details.items && record.details.items.length > 0) {
      const tasksRef = db.collection('tasks');
      const info = accountInfoMap.get(record.account);
      const accountId = info?.id || record.account;
      const accountLabel = info?.label || record.account;
      const shippingAddress = normalizeOrderShippingAddress(record.details);
      const updatedAt = new Date().toISOString();

      const taskInputs = record.details.items
        .map((item: any, index: number) => ({
          item,
          taskId: getOrderTaskDocumentId(record.order_id, index, record.details!.items.length),
        }))
        .filter(({ taskId }) => !onlyTaskIds || onlyTaskIds.has(taskId));
      const existingTaskIds = new Set<string>();
      if (taskInputs.length > 0) {
        const snapshots = await db.getAll(...taskInputs.map(({ taskId }) => tasksRef.doc(taskId)));
        snapshots.forEach((snapshot: any) => {
          if (snapshot.exists) existingTaskIds.add(snapshot.id);
        });
      }

      taskInputs.forEach(({ item, taskId }) => {
        // Append -1, -2 etc. for multi-item orders
        if (existingTaskIds.has(taskId)) return;

        const taskDocRef = tasksRef.doc(taskId);
        batch.create(taskDocRef, buildOrderTaskPayload({
          taskId,
          orderId: record.order_id!,
          source: record.source,
          productName: record.product_name,
          item,
          accountId,
          shopLabel: accountLabel,
          createdAt: orderCreatedAt,
          updatedAt,
          shippingAddress,
        }));
      });
    }
  }
}

// Keep the old name as an alias for backward compatibility
export const processNewEtsyOrder = processNewOrder;
