// File: api/lark-events.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';
import { SHARED_USER_ID } from '../src/constants.js';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js';
import { Record as MailRecord } from './_lib/types.js';
import { markDailyCacheDirtyForISOValues } from './_lib/dailyCacheAdmin.js';
import { createBatchWriter, resolveOrderCreatedAt } from './_lib/orderService.js';
import {
  buildOrderTaskPayload,
  getOrderTaskDocumentId,
  normalizeOrderShippingAddress,
} from '../src/utils/orderTaskPayload.js';


/** Dedupe theo id; với card-action ưu tiên dùng uuid nếu có */
async function markOnceOrSkip(id: string): Promise<boolean> {
  const db = getDb();
  const docRef = db.collection('runtime').doc('lark_processed').collection('events').doc(id);
  try {
    await docRef.create({ created_at: new Date().toISOString(), ttl_hint_minutes: 120 });
    return true;
  } catch (e: any) {
    if (e?.code === 6 || /already exists/i.test(e?.message || '')) {
      console.log('[lark-events] Duplicate detected. Skip:', id);
      return false;
    }
    console.warn('[lark-events] markOnceOrSkip warning:', e?.message);
    return true;
  }
}

/** Phân loại request + chuẩn hoá trường dùng tiếp */
type Parsed =
  | { kind: 'challenge'; challenge: string }
  | {
    kind: 'text';
    verifyToken: string | undefined;
    messageId: string;
    chatId?: string;
    text: string;
    dedupeId: string;
  }
  | {
    kind: 'card';
    verifyToken: string | undefined;
    messageId: string; // open_message_id
    chatId?: string; // open_chat_id
    value: any; // button.value
    formValue: Record<string, any>;
    dedupeId: string; // uuid || messageId
  }
  | { kind: 'unknown'; verifyToken?: string | undefined };

function parse(reqBody: any): Parsed {
  // 0) URL verification
  if (reqBody?.challenge) {
    return { kind: 'challenge', challenge: reqBody.challenge };
  }

  // --- CARD ACTION (new interactive callback) ---
  if (
    reqBody?.type === 'interactive' &&
    (reqBody?.action || reqBody?.event?.action)
  ) {
    const verifyToken = reqBody?.token || reqBody?.header?.token;
    const act = reqBody?.action || reqBody?.event?.action || {};
    const form = reqBody?.form_value || reqBody?.event?.form_value || {};
    const messageId = reqBody?.open_message_id || reqBody?.event?.open_message_id || reqBody?.message_id || '';
    const chatId = reqBody?.open_chat_id || reqBody?.event?.open_chat_id || '';
    const uuid = reqBody?.uuid || reqBody?.event?.uuid || messageId || Math.random().toString(36).slice(2);
    return {
      kind: 'card',
      verifyToken,
      messageId,
      chatId,
      value: act?.value,
      formValue: form || {},
      dedupeId: `card:${uuid}`,
    };
  }

  // --- SCHEMA 2.0 MESSAGE EVENT ---
  if (reqBody?.schema === '2.0' && reqBody?.event?.message) {
    const token = reqBody?.header?.token;
    const msg = reqBody.event.message;
    let text = '';
    try {
      text = JSON.parse(msg.content || '{}').text || '';
    } catch { }
    const clean = (text || '').replace(/^@\S+\s+/, '').trim();
    const messageId = msg.message_id;
    const chatId = msg.chat_id;
    return {
      kind: 'text',
      verifyToken: token,
      messageId,
      chatId,
      text: clean,
      dedupeId: `msg:${messageId}`,
    };
  }

  // --- LEGACY event_callback (text + card_action) ---
  if (reqBody?.type === 'event_callback' && reqBody?.event) {
    const token = reqBody?.token;
    const e = reqBody.event;

    // text
    if ((e?.msg_type || e?.message_type) === 'text' && (e?.text || e?.text_without_at_bot)) {
      const text = (e.text_without_at_bot || e.text || '').replace(/^@\S+\s+/, '').trim();
      const messageId = e.open_message_id || e.message_id;
      const chatId = e.open_chat_id;
      return {
        kind: 'text',
        verifyToken: token,
        messageId,
        chatId,
        text,
        dedupeId: `msg:${messageId}`,
      };
    }

    // card action legacy
    if (e?.action) {
      const messageId = e.open_message_id || e.message_id;
      const chatId = e.open_chat_id;
      return {
        kind: 'card',
        verifyToken: token,
        messageId,
        chatId,
        value: e.action?.value,
        formValue: e.action?.form_value || {},
        dedupeId: `card:${messageId}`,
      };
    }
  }

  // Fallback
  const vt = reqBody?.header?.token || reqBody?.token;
  return { kind: 'unknown', verifyToken: vt };
}

function verifyToken(kind: Parsed['kind'], incoming?: string): boolean {
  const msgToken = process.env.LARK_VERIFICATION_TOKEN || '';
  const cardToken = process.env.LARK_CARD_VERIFY_TOKEN || msgToken;
  if (!incoming) return false;
  if (kind === 'card') return incoming === cardToken || incoming === msgToken;
  if (kind === 'text') return incoming === msgToken || incoming === cardToken;
  return true;
}

async function verifyDashboardAuth(req: VercelRequest): Promise<boolean> {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : '';
  if (!token) return false;

  const decoded = await getAuth(initFirebaseAdmin()).verifyIdToken(token);
  const db = getDb();
  const [authenticationDoc, appDoc] = await Promise.all([
    db.collection('authentication').doc(decoded.uid).get(),
    db.doc(`authentication/${decoded.uid}/apps/dashboard`).get(),
  ]);
  const data = authenticationDoc.data() || {};
  return authenticationDoc.exists
    && data.active === true
    && data.teamId === SHARED_USER_ID
    && appDoc.exists
    && appDoc.data()?.enabled === true;
}

async function isAuthorizedDashboardAction(req: VercelRequest, secret: unknown): Promise<boolean> {
  const CRON_SECRET2 = process.env.CRON_SECRET2;
  if (CRON_SECRET2 && secret === CRON_SECRET2) return true;
  try {
    return await verifyDashboardAuth(req);
  } catch (error) {
    console.warn('[lark-events] Dashboard auth failed:', error instanceof Error ? error.message : String(error));
    return false;
  }
}
const INVALID_SKU_VALUES = new Set(['']);

function normalizeSkuForSync(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  return INVALID_SKU_VALUES.has(upper) ? '' : upper;
}

function normalizeCustomerFilesForSync(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const files = value
    .map(file => String(file ?? '').trim())
    .filter(Boolean);

  return Array.from(new Set(files));
}

function hasOwnField(value: unknown, field: string): boolean {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, field));
}

function taskTextForSync(value: unknown): string {
  return String(value ?? '');
}

function isPersonalizationVariationForSync(name: unknown): boolean {
  return /^(personalization|personalisation|personnalisation|wunschtext|personalizzazioni|personalizaci[o\u00f3]n|personaliza[c\u00e7][a\u00e3]o|personalisatie|peronalizacja|personaliz[a\u00e1]cia|personaliseer|personalized|personalised)$/i
    .test(taskTextForSync(name).trim());
}

function splitCombinedVariationsForSync(value: unknown): Array<{ name: string; value: string; text: string }> {
  const text = taskTextForSync(value).trim();
  if (!text) return [];

  return text
    .split(/\r?\n|\s*\|\s*|\s*;\s*|,\s*(?=[^,\n:]{1,80}:)/)
    .map(part => {
      const cleanPart = part.trim();
      const colonIndex = cleanPart.indexOf(':');
      const name = colonIndex >= 0 ? cleanPart.slice(0, colonIndex).trim() : '';
      const variationValue = colonIndex >= 0 ? cleanPart.slice(colonIndex + 1).trim() : cleanPart;
      return { name, value: variationValue, text: cleanPart };
    })
    .filter(variation => variation.text);
}

function variationEntriesForSync(value: unknown): Array<{ name: string; value: string; text: string }> {
  if (!Array.isArray(value)) return splitCombinedVariationsForSync(value);

  return value.flatMap((variation: unknown) => {
    if (!variation || typeof variation !== 'object') {
      return splitCombinedVariationsForSync(variation);
    }

    const variationRecord = variation as Record<string, unknown>;
    const name = taskTextForSync(variationRecord.name ?? variationRecord.property).trim();
    const variationValue = taskTextForSync(variationRecord.value).trim();
    const text = name && variationValue ? `${name}: ${variationValue}` : variationValue || name;
    return text ? [{ name, value: variationValue, text }] : [];
  });
}

function variantFieldsForSync(item: Record<string, any>, fallbackItem?: Record<string, any>): { variant1: string; variant2: string; personalization?: string } {
  const explicitVariant1 = hasOwnField(item, 'variant1') ? taskTextForSync(item.variant1).trim() : '';
  const explicitVariant2 = hasOwnField(item, 'variant2') ? taskTextForSync(item.variant2).trim() : '';
  const explicitPersonalization = hasOwnField(item, 'personalization')
    ? taskTextForSync(item.personalization).trim()
    : undefined;
  const entries = explicitVariant1
    ? variationEntriesForSync(explicitVariant1)
    : variationEntriesForSync(item.variations);
  const personalizationEntries = entries.filter(entry => isPersonalizationVariationForSync(entry.name));
  const variantEntries = entries.filter(entry => !isPersonalizationVariationForSync(entry.name));
  const extractedPersonalization = personalizationEntries
    .map(entry => entry.value || entry.text)
    .filter(Boolean)
    .join('\n');

  if (explicitVariant2) {
    return {
      variant1: variantEntries[0]?.text || explicitVariant1,
      variant2: explicitVariant2,
      ...(explicitPersonalization !== undefined || extractedPersonalization
        ? { personalization: explicitPersonalization || extractedPersonalization }
        : {})
    };
  }

  return {
    variant1: variantEntries[0]?.text || explicitVariant1 || taskTextForSync(fallbackItem?.variant ?? '').trim(),
    variant2: variantEntries[1]?.text || taskTextForSync(fallbackItem?.variant2 ?? '').trim(),
    ...(explicitPersonalization !== undefined || extractedPersonalization
      ? { personalization: explicitPersonalization || extractedPersonalization }
      : {})
  };
}

function shouldPreferRecordForSkuSync(
  current: { data: any } | undefined,
  candidate: { ref: any; data: any },
): boolean {
  if (!current) return true;

  const currentHasItems = Array.isArray(current.data.details?.items) && current.data.details.items.length > 0;
  const candidateHasItems = Array.isArray(candidate.data.details?.items) && candidate.data.details.items.length > 0;
  if (candidateHasItems !== currentHasItems) return candidateHasItems;

  const currentIsRefund = current.data.source === 'Etsy_Refunded';
  const candidateIsRefund = candidate.data.source === 'Etsy_Refunded';
  if (candidateIsRefund !== currentIsRefund) return !candidateIsRefund;

  const currentIsSale = current.data.source === 'Etsy_Sales' || current.data.source === 'Ebay_Sales';
  const candidateIsSale = candidate.data.source === 'Etsy_Sales' || candidate.data.source === 'Ebay_Sales';
  return candidateIsSale && !currentIsSale;
}

/** MAIN */
export default async function handler(req: VercelRequest, res: VercelResponse) {

  // Lấy các tham số query để xử lý các action đặc biệt (Test Push, Get Order Detail)
  const action = req.query.action || req.body?.action;
  const secret = req.query.secret || req.body?.secret;
  const type = req.query.type || req.body?.type || 'order'; // Mặc định là order

  // Cho phép CORS cho Tampermonkey (nếu gọi action đặc biệt)
  if (action) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // =====================================================================
  // 🟢 HIJACK 1: LẤY CHI TIẾT ĐƠN HÀNG 
  // Gọi bằng: /api/lark-events?action=get-order-detail&secret=<CRON_SECRET2>&orderId=...
  // =====================================================================
  if (action === 'get-order-detail') {
    const CRON_SECRET2 = process.env.CRON_SECRET2;
    if (!CRON_SECRET2) {
      console.error('[lark-events] CRON_SECRET2 not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!secret || secret !== CRON_SECRET2) {
      console.warn('[lark-events] Unauthorized get-order-detail attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const orderId = (req.query.orderId || req.body?.orderId) as string;
    if (!orderId) {
      return res.status(400).json({ message: 'Missing orderId' });
    }

    try {
      const db = getDb();
      const recordsRef = db.collection('user').doc(SHARED_USER_ID).collection('records');

      // Tìm record theo order_id
      const q = recordsRef.where('order_id', '==', orderId.trim());
      const snapshot = await q.get();

      if (snapshot.empty) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Lấy record tốt nhất (có details)
      let bestRecord: MailRecord | null = null;
      snapshot.forEach(doc => {
        const data = doc.data() as MailRecord;
        if (!bestRecord) bestRecord = data;
        if (data.details) bestRecord = data;
      });

      if (!bestRecord || !bestRecord.details) {
        return res.status(404).json({ message: 'Order found but no shipping details' });
      }

      const shippingAddress: any = bestRecord.details.shippingAddress || {};
      const customerEmail = bestRecord.details.customerEmail || '';
      const customerName = bestRecord.details.customerName || '';
      const nameParts = (shippingAddress.name || customerName || '').split(' ');
      const lastName = nameParts.pop() || '';
      const firstName = nameParts.join(' ') || '';

      let accountLabel = bestRecord.account;
      if (accountLabel && accountLabel !== "all") {
        try {
          const accountsRef = db.collection('user').doc(SHARED_USER_ID).collection('accounts');
          const accSnap = await accountsRef.get();
          const accounts = accSnap.docs.map(d => d.data() as { email: string; label: string; });
          const foundAccount = accounts.find(acc => acc.email === bestRecord?.account);
          if (foundAccount && foundAccount.label) {
            accountLabel = foundAccount.label;
          }
        } catch (e) {
          console.error("[lark-events] Failed to fetch account label", e);
        }
      }

      return res.status(200).json({
        order_id: bestRecord.order_id,
        orderDate: bestRecord.dt_local,
        account: accountLabel,
        firstName,
        lastName,
        email: customerEmail || '',
        phone: shippingAddress.phone || '',
        address1: shippingAddress.address1,
        address2: shippingAddress.address2 || '',
        city: shippingAddress.city,
        state: shippingAddress.state,
        zipCode: shippingAddress.zip,
        countryCode: shippingAddress.country,
        items: bestRecord.details.items || []
      });

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[API get-order-detail] Error:', err);
      return res.status(500).json({ message: errorMessage });
    }
  }

  // =====================================================================
  // 🟢 HIJACK 2: TRIGGER SKU FETCH VIA EXTENSION
  // POST /api/lark-events with body: { action: 'trigger-sku-fetch', secret: <CRON_SECRET2>, orderId: ..., account: ... }
  // =====================================================================
  if (action === 'trigger-sku-fetch') {
    // Reject GET requests, only allow POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    }

    if (!(await isAuthorizedDashboardAction(req, secret))) {
      console.warn('[lark-events] Unauthorized trigger-sku-fetch attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const orderId = (req.query.orderId || req.body?.orderId) as string;
    const account = (req.query.account || req.body?.account) as string;

    if (!orderId || !account) {
      return res.status(400).json({ message: 'Missing orderId or account' });
    }

    try {
      const db = getDb();
      const teamId = SHARED_USER_ID;

      // Check if job already exists
      const jobsRef = db.collection('user').doc(teamId).collection('sku_jobs');
      const q = jobsRef.where('order_id', '==', orderId).where('status', '==', 'pending');
      const snapshot = await q.get();

      if (!snapshot.empty) {
        return res.status(200).json({ message: 'SKU fetch already in progress', jobId: snapshot.docs[0].id });
      }

      // Create new SKU job
      const jobDocRef = jobsRef.doc(orderId);
      await jobDocRef.set({
        order_id: orderId,
        account: account,
        status: 'pending',
        priority: true, // High priority for manual triggers
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      console.log(`[trigger-sku-fetch] Created SKU job for order ${orderId}, account ${account}`);

      return res.status(200).json({
        message: 'SKU fetch triggered successfully',
        jobId: jobDocRef.id,
        orderId,
        account
      });

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[API trigger-sku-fetch] Error:', err);
      return res.status(500).json({ message: errorMessage });
    }
  }


  // =====================================================================
  // 🟢 HIJACK 2B: BULK TRIGGER SKU FETCH VIA EXTENSION
  // POST /api/lark-events with body: { action: 'bulk-trigger-sku-fetch', secret: <CRON_SECRET2>, orders: [...] }
  // =====================================================================
  if (action === 'bulk-trigger-sku-fetch') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    }

    if (!(await isAuthorizedDashboardAction(req, secret))) {
      console.warn('[lark-events] Unauthorized bulk-trigger-sku-fetch attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const orders = req.body?.orders as { orderId: string; account: string; }[];
    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ message: 'Missing orders array' });
    }

    try {
      const db = getDb();
      const teamId = SHARED_USER_ID;
      const jobsRef = db.collection('user').doc(teamId).collection('sku_jobs');
      const batchWriter = createBatchWriter(db);
      let count = 0;

      for (const order of orders) {
        const { orderId, account } = order;
        if (!orderId || !account) continue;

        await batchWriter.ensureCapacity(1);
        const jobDocRef = jobsRef.doc(orderId);
        batchWriter.set(jobDocRef, {
          order_id: orderId,
          account: account,
          status: 'pending',
          priority: true,
          sku: '',
          error: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { merge: true });

        count++;
      }

      if (count > 0) {
        await batchWriter.commit();
      }

      return res.status(200).json({
        success: true,
        message: `Successfully triggered SKU fetch for ${count} orders.`
      });

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[API bulk-trigger-sku-fetch] Error:', err);
      return res.status(500).json({ message: errorMessage });
    }
  }


  // =====================================================================
  // 🟢 HIJACK 2C: BULK SYNC SKU TO TASKS VIA EXTENSION
  // POST /api/lark-events with body: { action: 'bulk-sync-sku-to-tasks', secret: <CRON_SECRET2>, orders: [...] }
  // =====================================================================
  if (action === 'bulk-sync-sku-to-tasks') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    }

    if (!(await isAuthorizedDashboardAction(req, secret))) {
      console.warn('[lark-events] Unauthorized bulk-sync-sku-to-tasks attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const orders = req.body?.orders as {
      orderId: string;
      orderDate?: string;
      skuString: string;
      items: {
        title: string;
        sku: string;
        image?: string;
        listingId?: string;
        transactionId?: string;
        category_code?: string;
        customerFiles?: string[];
        variant1?: string;
        variant2?: string;
        personalization?: string;
        variations?: string[];
        quantity?: number;
      }[];
    }[];

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ message: 'Missing orders array' });
    }

    try {
      const db = getDb();
      const teamId = SHARED_USER_ID;
      const batchWriter = createBatchWriter(db);

      const accountsRef = db.collection('user').doc(teamId).collection('accounts');
      const accSnap = await accountsRef.get();
      const accountsMap = new Map<string, { id: string; label: string }>();
      accSnap.docs.forEach(d => {
        const data = d.data();
        const info = {
          id: d.id,
          label: String(data.label || data.email || d.id).trim(),
        };
        [d.id, data.email, data.label]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(Boolean)
          .forEach(key => accountsMap.set(key, info));
      });

      const uniqueOrderIds = Array.from(new Set(orders.map(o => o.orderId).filter(Boolean)));
      const recordsMap = new Map<string, { ref: any; data: any }>();
      if (uniqueOrderIds.length > 0) {
        const recordsCol = db.collection('user').doc(teamId).collection('records');
        const IN_QUERY_LIMIT = 30;
        for (let i = 0; i < uniqueOrderIds.length; i += IN_QUERY_LIMIT) {
          const chunk = uniqueOrderIds.slice(i, i + IN_QUERY_LIMIT);
          const snap = await recordsCol.where('order_id', 'in', chunk).get();
          snap.docs.forEach(doc => {
            const data = doc.data();
            if (data.order_id) {
              const candidate = { ref: doc.ref, data };
              const current = recordsMap.get(data.order_id);
              if (shouldPreferRecordForSkuSync(current, candidate)) {
                recordsMap.set(data.order_id, candidate);
              }
            }
          });
        }
      }

      const taskIds: string[] = [];
      orders.forEach(order => {
        const itemsCount = order.items ? order.items.length : 0;
        (order.items || []).forEach((_, index) => {
          const taskId = getOrderTaskDocumentId(order.orderId, index, itemsCount);
          taskIds.push(taskId);
        });
      });

      const existingTaskIds = new Set<string>();
      if (taskIds.length > 0) {
        const tasksCol = db.collection('tasks');
        const GET_ALL_LIMIT = 300;
        for (let i = 0; i < taskIds.length; i += GET_ALL_LIMIT) {
          const chunk = taskIds.slice(i, i + GET_ALL_LIMIT);
          const snapshots = await db.getAll(...chunk.map(taskId => tasksCol.doc(taskId)));
          snapshots.forEach((taskSnapshot: any) => {
            if (taskSnapshot.exists) existingTaskIds.add(taskSnapshot.id);
          });
        }
      }

      let taskCreatedCount = 0;
      const updatedRecordDates: Array<string | null | undefined> = [];
      for (const order of orders) {
        const { orderId, orderDate, items } = order;
        if (!orderId || !items || !Array.isArray(items)) continue;

        const recordInfo = recordsMap.get(orderId);
        const recordData = recordInfo?.data;
        const recordRef = recordInfo?.ref;
        const orderCreatedAtSource = recordData?.dt_local || orderDate;
        const orderCreatedAt = orderCreatedAtSource
          ? resolveOrderCreatedAt(orderCreatedAtSource)
          : null;
        const estimatedWrites = (recordRef && recordData ? 1 : 0) + items.length + 1;
        await batchWriter.ensureCapacity(estimatedWrites);

        if (recordRef && recordData) {
          const existingDetails = recordData.details || {};
          const existingItems = existingDetails.items || [];
          const updatedItems = items.map((payloadItem, index) => {
            const existingItem = existingItems[index] || {};
            const nextSku = normalizeSkuForSync(payloadItem.sku) || normalizeSkuForSync(existingItem.sku);
            const payloadCustomerFiles = normalizeCustomerFilesForSync(payloadItem.customerFiles);
            const { variant1, variant2, personalization } = variantFieldsForSync(payloadItem, existingItem);
            return {
              ...existingItem,
              name: payloadItem.title || existingItem.name || "",
              sku: nextSku || "",
              variant: variant1,
              variant2,
              ...(personalization !== undefined
                ? { personalization }
                : {}),
              quantity: existingItem.quantity || payloadItem.quantity || 1,
              price: existingItem.price || 0,
              ...(payloadItem.listingId ? { listingId: payloadItem.listingId } : {}),
              ...(payloadItem.transactionId ? { transactionId: payloadItem.transactionId } : {}),
              ...(payloadCustomerFiles !== undefined ? { customerFiles: payloadCustomerFiles } : {})
            };
          });
          batchWriter.update(recordRef, {
            "details.items": updatedItems
          });
          updatedRecordDates.push(recordData.dt_local);
        }

        const itemsCount = items.length;
        const taskShippingAddress = normalizeOrderShippingAddress(recordData?.details);
        const accountKey = String(recordData?.account || '').trim().toLowerCase();
        const accountInfo = accountsMap.get(accountKey) || {
          id: String(recordData?.account || '').trim(),
          label: String(recordData?.account || '').trim(),
        };
        const updatedAt = new Date().toISOString();

        items.forEach((item, index) => {
          const taskId = getOrderTaskDocumentId(orderId, index, itemsCount);
          if (existingTaskIds.has(taskId)) return;

          const existingRecordItem = recordData?.details?.items?.[index] || {};
          const cleanSku = normalizeSkuForSync(item.sku) || normalizeSkuForSync(existingRecordItem.sku);
          const payloadCustomerFiles = normalizeCustomerFilesForSync(item.customerFiles);
          const recordCustomerFiles = normalizeCustomerFilesForSync(existingRecordItem.customerFiles);
          const customerFilesToSync = payloadCustomerFiles ?? recordCustomerFiles;
          const { variant1, variant2, personalization } = variantFieldsForSync(item, existingRecordItem);

          const taskDocRef = db.collection('tasks').doc(taskId);
          const sourceItem = {
            ...existingRecordItem,
            ...item,
            sku: cleanSku,
            variant1,
            variant2,
            ...(personalization !== undefined ? { personalization } : {}),
            ...(customerFilesToSync !== undefined ? { customerFiles: customerFilesToSync } : {}),
          };
          const canonicalTask = buildOrderTaskPayload({
            taskId,
            orderId,
            source: recordData?.source,
            productName: recordData?.product_name,
            item: sourceItem,
            accountId: accountInfo.id,
            shopLabel: accountInfo.label,
            createdAt: orderCreatedAt || updatedAt,
            updatedAt,
            shippingAddress: taskShippingAddress,
          });

          batchWriter.create(taskDocRef, canonicalTask);
          taskCreatedCount++;
        });

        const jobDocRef = db.collection('user').doc(teamId).collection('sku_jobs').doc(orderId);
        batchWriter.delete(jobDocRef); // Xóa hẳn sau khi sync xong
      }

      await batchWriter.commit();
      if (updatedRecordDates.length > 0) {
        await markDailyCacheDirtyForISOValues(
          db,
          teamId,
          ['records'],
          updatedRecordDates,
          'lark-sku-sync'
        ).catch(error => console.warn('[lark-events] Failed to mark daily cache dirty:', error));
      }

      return res.status(200).json({
        success: true,
        createdCount: taskCreatedCount,
        message: `Successfully created ${taskCreatedCount} missing tasks.`
      });

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[API bulk-sync-sku-to-tasks] Error:', err);
      return res.status(500).json({ message: errorMessage });
    }
  }


  // =====================================================================
  // 🟢 HIJACK 2: TEST NOTIFICATION HANDLER
  // Gọi bằng: /api/lark-events?action=test-push&secret=<CRON_SECRET2>&type=order|funds|summary|login
  // =====================================================================
  if (action === 'test-push') {
    const CRON_SECRET2 = process.env.CRON_SECRET2;
    if (!CRON_SECRET2) {
      console.error('[lark-events] CRON_SECRET2 not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!secret || secret !== CRON_SECRET2) {
      console.warn('[lark-events] Unauthorized test-push attempt');
      return res.status(401).json({ error: 'Unauthorized Test' });
    }

    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard2-alpha-bay.vercel.app';

      const createTabLink = (tab: string) => {
        try {
          const u = new URL(baseUrl);
          u.searchParams.set('tab', tab);
          return u.toString();
        } catch { return baseUrl; }
      };

      const targetTeam = SHARED_USER_ID;
      console.log(`[Lark-API] Manually triggering push notification test (${type})`);

      let payload = { title: '', body: '', url: '/' };
      let notificationData: any = null; // Data for Notification Center

      if (type === 'order') {
        payload = {
          title: '🔔 New Order (Test)',
          body: 'New Order: #TEST-123 - $50.00 (Test Shop)',
          url: createTabLink('Order List') // Deep link to Order List
        };
        notificationData = {
          type: 'NEW_ORDER',
          title: 'New Order Received',
          content: 'Order #TEST-123 for $50.00 has been successfully parsed.',
          metadata: {
            order_id: 'TEST-123',
            order_total: 50.00,
            currency: 'USD',
          }
        };
      } else if (type === 'funds') {
        payload = {
          title: '💰 Funds Received (Test)',
          body: 'Funds Received: $1,000.00 USD (Test Shop)',
          url: createTabLink('Overview') // Deep link to Overview
        };
        notificationData = {
          type: 'FUND',
          title: 'Funds Received',
          content: 'Payout of $1,000.00 has been deposited to your account.',
          metadata: {
            fund_id: 'FUND-TEST-001',
            fund_amount: 1000.00,
          }
        };
      } else if (type === 'summary') {
        const revMap = { USD: 2500.00, AUD: 150.00, GBP: 50.00 }; // Test Data with multiple currencies

        payload = {
          title: '📊 Daily Summary (Test)',
          body: `📅 ${new Date().toISOString().split('T')[0]}\nOrders: 25\nTap to view full report.`,
          url: createTabLink('Overview') // Deep link to Overview
        };
        notificationData = {
          type: 'SUMMARY',
          title: 'Daily Sales Summary',
          content: '25 orders processed on ' + new Date().toISOString().split('T')[0] + '. Tap to view full report.',
          metadata: {
            summary_data: {
              date: new Date().toISOString().split('T')[0],
              totalOrders: 25, /* Consistent with payload */
              totalRevenue: revMap, /* Use the multi-currency map */
              shops: [
                { name: 'Etsy Store A', orders: 15, revenue: { USD: 2500.00 } },
                { name: 'eBay Store B', orders: 7, revenue: { AUD: 150.00 } },
                { name: 'Amazon Store C', orders: 3, revenue: { GBP: 50.00 } },
              ]
            }
          }
        };
      } else if (type === 'login') {
        payload = {
          title: '🔔 User Login (Test)',
          body: 'testuser@example.com đã đăng nhập vào dashboard',
          url: baseUrl // Deep link to home
        };
        notificationData = {
          type: 'LOGIN',
          title: 'Team Member Login',
          content: 'Test User logged into the dashboard.',
          metadata: {
            login_info: {
              user_name: 'Test User',
              user_email: 'testuser@example.com',
              ip_address: '192.168.1.100',
              device: 'Chrome on Windows',
              location: 'Ho Chi Minh City, VN',
              timestamp: new Date().toISOString(),
            }
          }
        };
      } else if (type === 'case') {
        payload = {
          title: '⚖️ Case Alert (Test)',
          body: 'Case Opened: Order #CASE-999 (Test Shop)',
          url: createTabLink('Support')
        };
        notificationData = {
          type: 'CASE',
          title: 'Case Alert',
          content: 'A new case has been opened for Order #CASE-999.',
          metadata: {
            // Include minimal fields to match what notification center expects
            order_id: 'CASE-999',
            shopName: 'Test Shop',
            case_msg: 'Buyer says: Item not received',
          }
        };
      } else if (type === 'help') {
        payload = {
          title: '🆘 Help Request (Test)',
          body: 'Help Request: Order #HELP-888 - Item arrived damaged (Test Shop)',
          url: createTabLink('Support')
        };
        notificationData = {
          type: 'HELP',
          title: 'Help Request',
          content: 'Buyer needs help with Order #HELP-888.',
          metadata: {
            order_id: 'HELP-888',
            shopName: 'Test Shop',
            help_kind: 'Item arrived damaged',
          }
        };
      } else {
        payload = {
          title: '🔔 Test Notification',
          body: `Test push sent at ${new Date().toLocaleTimeString()}.`,
          url: baseUrl
        };
      }

      // ✅ Send FCM Push Notification
      await sendPushNotificationToUsers(targetTeam, type as any, payload);

      // ✅ Save to Firestore for Notification Center
      if (notificationData) {
        const db = getDb();
        const notificationsRef = db.collection('user').doc(targetTeam).collection('notifications');
        await notificationsRef.add({
          ...notificationData,
          createdAt: new Date().toISOString(),
          isRead: false,
        });
        console.log('[Lark-API] Notification saved to Firestore for Notification Center');
      }

      return res.status(200).json({
        success: true,
        message: `Push notification (${type}) sent and saved to Notification Center.`,
        target: targetTeam,
        notificationData: notificationData
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[Lark-API] Test push failed:', err);
      return res.status(500).json({ success: false, error: errorMessage });
    }
  }

  // =====================================================================
  // � HIJACK 3: LOGIN NOTIFICATION (Migrated from api/lark-login-notify.ts)
  // Gọi bằng: /api/lark-events?action=login-notify
  // =====================================================================
  if (action === 'login-notify') {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Only POST requests are allowed.' });
    }

    const { email, role, teamId, displayName } = req.body;

    // 1. Chỉ gửi nếu là 'user'
    if (role !== 'user') {
      return res.status(200).json({ message: 'Notification skipped for owner.' });
    }

    // 2. Chuẩn bị nội dung
    const userEmail = email || 'Không rõ email';
    const userName = displayName || email || 'Nhân viên';

    // 3. Gửi FCM Push Notification
    try {
      if (teamId) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard2-alpha-bay.vercel.app/';

        const { createNotificationDocument } = await import('./_lib/notificationHelper.js');
        const notificationId = await createNotificationDocument({
          teamId,
          type: 'LOGIN',
          title: 'Team Member Login',
          content: `${userName} (${userEmail}) logged into the dashboard`,
          metadata: {
            login_info: {
              user_name: userName,
              user_email: userEmail,
              user_role: role,
              timestamp: new Date().toISOString(),
            },
          },
        });

        await sendPushNotificationToUsers(teamId, 'login', {
          title: '🔔 User Login',
          body: `${userName} đã đăng nhập vào dashboard`,
          url: `${appUrl}?notification=${notificationId}` // Deep link to notification detail
        });
        console.log('[lark-events/login-notify] FCM notification sent successfully');
      } else {
        console.warn('[lark-events/login-notify] No teamId provided, skipping FCM notification');
      }
    } catch (err: any) {
      console.error('[lark-events/login-notify] Failed to send FCM notification:', err);
    }

    return res.status(200).json({ message: 'Notifications sent.' });
  }

  // =====================================================================
  // �🔴 LARK WEBHOOK LOGIC (Code gốc xử lý Lark)
  // =====================================================================

  console.log('[lark-events] Received body:', JSON.stringify(req.body, null, 2));

  const parsed = parse(req.body);

  // 1) URL verification
  if (parsed.kind === 'challenge') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({ challenge: parsed.challenge }));
  }

  // 2) Token check
  if (!verifyToken(parsed.kind, (parsed as any).verifyToken)) {
    return res.status(401).send('Unauthorized (Invalid Token)');
  }

  // 3) Route by kind
  try {
    if (parsed.kind === 'text') {
      // dedupe
      if (!(await markOnceOrSkip(parsed.dedupeId))) {
        return res.status(200).send('OK (duplicate ignored)');
      }
      return res.status(200).send('OK');
    }

    if (parsed.kind === 'card') {
      // dedupe theo uuid nếu có
      if (!(await markOnceOrSkip(parsed.dedupeId))) {
        // Card callback DÙ duplicate cũng nên trả code:0 để UI không báo lỗi
        return res.status(200).json({ code: 0, msg: 'ok (duplicate ignored)' });
      }
      // QUAN TRỌNG: card callback phải trả JSON thành công
      return res.status(200).json({ code: 0, msg: 'success' });
    }

    // unknown
    return res.status(200).send('OK');

  } catch (e: any) {
    console.error('[lark-events] ERROR:', e?.message, e?.stack);
    // Với card callback: vẫn trả code:0 để tránh 200672
    if (parsed.kind === 'card') {
      return res.status(200).json({ code: 0, msg: 'handled' });
    }
    return res.status(200).send('OK (Error handled)');
  }
}

