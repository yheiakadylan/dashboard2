import { Record as MailRecord } from './types.js';

const SAFE_BATCH_WRITE_LIMIT = 450;

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
  accountInfoMap: Map<string, { id: string; label: string }>
) {
  const isEtsy = record.source === 'Etsy_Sales';
  const isEbay = record.source === 'Ebay_Sales';

  if ((isEtsy || isEbay) && record.order_id && record.account) {
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

    // 2. Stage 1 Sync: Create 'draft' tasks in central tasks collection for EACH item
    if (record.details && record.details.items && record.details.items.length > 0) {
      const tasksRef = db.collection('tasks');
      const info = accountInfoMap.get(record.account);
      const accountId = info?.id || record.account;
      const accountLabel = info?.label || record.account;
      const platformName = isEtsy ? 'Etsy' : 'eBay';

      record.details.items.forEach((item: any, index: number) => {
        // Append -1, -2 etc. for multi-item orders
        const taskId = record.details!.items.length > 1
          ? `${record.order_id}-${index + 1}`
          : record.order_id!;

        const taskDocRef = tasksRef.doc(taskId);
        batch.set(taskDocRef, {
          id: taskId,
          readableId: taskId, // Used for display
          orderId: record.order_id, // Faster querying for Extension
          title: record.product_name || item.name || `New ${platformName} Order`,
          sku: item.sku || '',
          variant1: item.variant1 || item.variant || '',
          variant2: item.variant2 || '',
          personalization: item.personalization || '',
          quantity: item.quantity || 1,
          transactionId: item.transactionId || '',
          status: 'draft',
          isUrgent: false,
          createdBy: 'auto_sync',
          mockupUrl: item.image || '',
          customerFiles: Array.isArray(item.customerFiles) ? item.customerFiles : [],
          created_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          account: accountId,      // Store Account ID for stable querying
          shopLabel: accountLabel, // Store Label for quick UI display
          listingId: item.listingId || '', // Will be updated by Extension
          collectionName: 'tasks'
        }, { merge: true });
      });
    }
  }
}

// Keep the old name as an alias for backward compatibility
export const processNewEtsyOrder = processNewOrder;
