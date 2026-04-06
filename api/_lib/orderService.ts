import { Record as MailRecord } from './types.js';

/**
 * Handles post-processing for a new Etsy order.
 * Creates a SKU job and corresponding draft tasks.
 */
export async function processNewEtsyOrder(
  db: any, // Firestore instance (Backend)
  batch: any, // WriteBatch instance (Backend)
  teamId: string,
  record: MailRecord,
  accountLabelMap: Map<string, string>
) {
  if (record.source === 'Etsy_Sales' && record.order_id && record.account) {
    // 1. Push to SKU Job Queue
    const jobDocRef = db.collection('user').doc(teamId).collection('sku_jobs').doc(record.order_id);
    batch.set(jobDocRef, {
      order_id: record.order_id,
      account: record.account,
      status: 'pending',
      priority: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { merge: true });

    // 2. Stage 1 Sync: Create 'draft' tasks in central tasks collection for EACH item
    if (record.details && record.details.items && record.details.items.length > 0) {
      const tasksRef = db.collection('tasks');
      const accountLabel = accountLabelMap.get(record.account) || record.account;

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
          title: record.product_name || item.name || 'New Etsy Order',
          sku: item.sku || '',
          variant1: item.variant1 || item.variant || '',
          variant2: item.variant2 || '',
          personalization: item.personalization || '',
          quantity: item.quantity || 1,
          // Logic: Có nội dung personalization thực sự -> 'draft', ngược lại -> 'new'
          status: String(item.personalization || '').trim() !== '' ? 'draft' : 'new',
          isUrgent: false,
          createdBy: 'auto_sync',
          mockupUrl: item.image || '',
          created_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          account: accountLabel, // Shop Label
          collectionName: 'tasks'
        }, { merge: true });
      });
    }
  }
}
