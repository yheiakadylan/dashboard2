import { Record as MailRecord } from './types.js';

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
          status: 'draft',
          isUrgent: false,
          createdBy: 'auto_sync',
          mockupUrl: item.image || '',
          created_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          account: accountId,      // Store Account ID for stable querying
          shopLabel: accountLabel, // Store Label for quick UI display
          listingId: item.listingId, // Will be updated by Extension
          collectionName: 'tasks'
        }, { merge: true });
      });
    }
  }
}

// Keep the old name as an alias for backward compatibility
export const processNewEtsyOrder = processNewOrder;
