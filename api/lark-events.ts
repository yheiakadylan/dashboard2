// File: api/lark-events.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getSavedReportForDate,
  sendLarkTextReply,
  sendLarkInteractiveReply,
  ianaToUtcOffsetString,
} from './_lib/larkHelper.js';
import { getDb } from './_lib/firebaseAdminHelper.js';
import { SHARED_USER_ID } from '../src/constants.js';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js';
import { Record as MailRecord } from './_lib/types.js';



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

/** Handlers */
async function onText(messageId: string, command: string) {
  const lowerCommand = command.toLowerCase();

  // --- /menu command ---
  if (lowerCommand === '/menu') {
    const helpText = [
      '👋 Hướng dẫn sử dụng Bot:',
      '1️⃣ /menu: Hiển thị hướng dẫn này.',
      '2️⃣ /report: Lấy báo cáo hôm nay (Today, UTC+7).',
      '3️⃣ /report [date] [timezone] [shop]: Lấy báo cáo tuỳ chỉnh.',
      '   • [date]: (required) dd/mm/yy hoặc dd/mm/yyyy.',
      '   • [timezone]: (optional) Ví dụ: UTC+7, GMT-5. Mặc định là UTC+7.',
      '   • [shop]: (optional) Tên của shop. Mặc định là "all".',
      '   • Ví dụ: /report 25/12/2024 UTC-5 MyShop'
    ].join('\n');
    await sendLarkTextReply(messageId, helpText);
    return;
  }

  // --- /report (default) command ---
  if (lowerCommand === '/report') {
    const timeZoneOffset = '+07:00';
    // Lấy ngày hôm nay theo giờ VN
    const dateISO = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().split('T')[0];
    const accountEmail = 'all';

    await sendLarkTextReply(messageId, `Roger. Processing default report for Today (${dateISO}, UTC+7)...`);
    try {
      const summaryData = await getSavedReportForDate(dateISO, timeZoneOffset, accountEmail);
      if (summaryData.totalOrders === 0 && Object.keys(summaryData.totalRevenue).length === 0 && Object.keys(summaryData.totalFunds).length === 0) {
        await sendLarkTextReply(messageId, `No data found for ${dateISO}.`);
      } else {
        await sendLarkInteractiveReply(messageId, summaryData, timeZoneOffset, { includeShopDetails: true });
      }
    } catch (e: any) {
      console.error(`Error generating default report:`, e);
      await sendLarkTextReply(messageId, `Sorry, an error occurred while generating the report. Details: ${e.message}`);
    }
    return;
  }
  // --- /report [date]... (regex) command ---
  const reportRegex = /^\/?report\s+(?<date>\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+(?<timezone>(?:utc|gmt)?[+-]\d{1,2}(?::\d{2})?))?(?:\s+(?<shop>.+))?/i;
  const match = command.match(reportRegex);

  if (match && match.groups) {
    const { date, timezone } = match.groups;
    const shopLabel = match.groups.shop?.trim();

    // 1. Parse date (dd/mm/yy or dd/mm/yyyy)
    const dateParts = date.split('/');
    if (dateParts.length !== 3) {
      await sendLarkTextReply(messageId, `Invalid date format: "${date}". Please use dd/mm/yy or dd/mm/yyyy.`);
      return;
    }
    const day = dateParts[0].padStart(2, '0');
    const month = dateParts[1].padStart(2, '0');
    const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
    const dateISO = `${year}-${month}-${day}`;

    const dateObj = new Date(dateISO + 'T12:00:00Z');
    if (isNaN(dateObj.getTime()) || dateObj.toISOString().slice(0, 10) !== dateISO) {
      await sendLarkTextReply(messageId, `Invalid date: "${date}".`);
      return;
    }

    // 2. Parse timezone offset
    let timeZoneOffset = '+07:00'; // Default to Vietnam time
    if (timezone) {
      const tzMatch = timezone.toLowerCase().match(/(?:utc|gmt)?([+-])(\d{1,2})(?::(\d{2}))?/);
      if (tzMatch) {
        const sign = tzMatch[1];
        const hours = tzMatch[2].padStart(2, '0');
        const minutes = tzMatch[3] || '00';
        timeZoneOffset = `${sign}${hours}:${minutes}`;
      } else {
        await sendLarkTextReply(messageId, `Invalid timezone format: "${timezone}". Please use format like UTC+7, GMT-5, etc.`);
        return;
      }
    }

    // 3. Get shop email from label
    let accountEmail = 'all';
    if (shopLabel) {
      const db = getDb();
      const accountsRef = db.collection('user').doc(SHARED_USER_ID).collection('accounts');
      const accSnap = await accountsRef.get();
      const accounts = accSnap.docs.map(d => d.data() as { email: string; label: string; });

      const foundAccount = accounts.find(acc => (acc.label || '').toLowerCase() === shopLabel.toLowerCase());

      if (foundAccount) {
        accountEmail = foundAccount.email;
      } else {
        await sendLarkTextReply(messageId, `Shop not found: "${shopLabel}". Please check the shop name.`);
        return;
      }
    }

    // 4. Generate and send report
    await sendLarkTextReply(messageId, `Roger. Processing report for ${dateISO} (Timezone offset: ${timeZoneOffset})...`);

    try {
      const summaryData = await getSavedReportForDate(dateISO, timeZoneOffset, accountEmail);
      if (summaryData.totalOrders === 0 && Object.keys(summaryData.totalRevenue).length === 0 && Object.keys(summaryData.totalFunds).length === 0) {
        await sendLarkTextReply(messageId, `No data found for ${dateISO}.`);
      } else {
        await sendLarkInteractiveReply(messageId, summaryData, timeZoneOffset, { includeShopDetails: true });
      }
    } catch (e: any) {
      console.error(`Error generating report for command "${command}":`, e);
      await sendLarkTextReply(messageId, `Sorry, an error occurred while generating the report. Details: ${e.message}`);
    }
  } else if (lowerCommand.startsWith('report')) {
    // Catch malformed report commands and give help.
    await sendLarkTextReply(messageId, 'Invalid command format. Please use: `/report dd/mm/yyyy [timezone] [shop]`\nExample: `/report 25/12/2023 UTC+7 My Awesome Shop`\nHoặc gõ `/menu` để xem chi tiết.');
  }
}

async function onCardAction(messageId: string, value: any, form: Record<string, any>) {
  const action = typeof value === 'string' ? value : value?.action;
  if (action !== 'build_report') {
    await sendLarkTextReply(messageId, `Unknown action: ${JSON.stringify(value)}`);
    return;
  }

  const accountEmail = form.shop_select || 'all';
  const timezoneIANA = form.timezone_select || 'Asia/Ho_Chi_Minh';
  const dateISO = form.date_select;

  if (!dateISO) {
    await sendLarkTextReply(messageId, 'Vui lòng chọn ngày.');
    return;
  }

  const tzOffset = ianaToUtcOffsetString(timezoneIANA, new Date(dateISO));
  await sendLarkTextReply(messageId, `Processing report for ${dateISO} (${tzOffset})...`);

  const summaryData = await getSavedReportForDate(dateISO, tzOffset, accountEmail);
  // có nhiều shop → phân trang ở larkHelper.sendAllShopsAsCards nếu muốn
  await sendLarkInteractiveReply(messageId, summaryData as any, tzOffset, { includeShopDetails: true });
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
  // 🟢 HIJACK 1: LẤY CHI TIẾT ĐƠN HÀNG CHO TAMPERMONKEY
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

      const { shippingAddress, customerEmail, customerName } = bestRecord.details;
      const nameParts = (shippingAddress.name || customerName || '').split(' ');
      const lastName = nameParts.pop() || '';
      const firstName = nameParts.join(' ') || '';

      return res.status(200).json({
        firstName,
        lastName,
        email: customerEmail || '',
        phone: '',
        address1: shippingAddress.address1,
        address2: shippingAddress.address2 || '',
        city: shippingAddress.city,
        state: shippingAddress.state,
        zipCode: shippingAddress.zip,
        countryCode: shippingAddress.country
      });

    } catch (err: any) {
      console.error('[API get-order-detail] Error:', err);
      return res.status(500).json({ message: err.message });
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
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboardvikcom.vercel.app/';
      const targetTeam = SHARED_USER_ID;
      console.log(`[Lark-API] Manually triggering push notification test (${type})`);

      let payload = { title: '', body: '', url: '/' };
      let notificationData: any = null; // Data for Notification Center

      if (type === 'order') {
        payload = {
          title: '🔔 New Order (Test)',
          body: 'New Order: #TEST-123 - $50.00 (Test Shop)',
          url: `${appUrl}/?tab=Order+List` // Deep link to Order List
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
          url: `${appUrl}/?tab=Overview` // Deep link to Overview
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
        payload = {
          title: '📊 Daily Summary (Test)',
          body: 'Your daily sales summary is ready!',
          url: `${appUrl}/?tab=Overview` // Deep link to Overview
        };
        notificationData = {
          type: 'SUMMARY',
          title: 'Daily Sales Summary',
          content: '25 orders totaling $2,500.00 for ' + new Date().toISOString().split('T')[0],
          metadata: {
            summary_data: {
              date: new Date().toISOString().split('T')[0],
              totalOrders: 25,
              totalRevenue: 2500.00,
              shops: [
                { name: 'Etsy Store A', orders: 15, revenue: 1500.00 },
                { name: 'eBay Store B', orders: 7, revenue: 700.00 },
                { name: 'Amazon Store C', orders: 3, revenue: 300.00 },
              ]
            }
          }
        };
      } else if (type === 'login') {
        payload = {
          title: '🔔 User Login (Test)',
          body: 'testuser@example.com đã đăng nhập vào dashboard',
          url: `${appUrl}/` // Deep link to home
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
      } else {
        payload = {
          title: '🔔 Test Notification',
          body: `Test push sent at ${new Date().toLocaleTimeString()}.`,
          url: `${appUrl}/`
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
    } catch (err: any) {
      console.error('[Lark-API] Test push failed:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // =====================================================================
  // 🔴 LARK WEBHOOK LOGIC (Code gốc xử lý Lark)
  // =====================================================================

  console.log('[lark-events] Received body:', JSON.stringify(req.body, null, 2));

  const parsed = parse(req.body);

  // 1) URL verification
  if (parsed.kind === 'challenge') {
    return res.status(200).json({ challenge: parsed.challenge });
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
      await onText(parsed.messageId, parsed.text);
      return res.status(200).send('OK');
    }

    if (parsed.kind === 'card') {
      // dedupe theo uuid nếu có
      if (!(await markOnceOrSkip(parsed.dedupeId))) {
        // Card callback DÙ duplicate cũng nên trả code:0 để UI không báo lỗi
        return res.status(200).json({ code: 0, msg: 'ok (duplicate ignored)' });
      }
      await onCardAction(parsed.messageId, parsed.value, parsed.formValue);
      // QUAN TRỌNG: card callback phải trả JSON thành công
      return res.status(200).json({ code: 0, msg: 'success' });
    }

    // unknown
    return res.status(200).send('OK');

  } catch (e: any) {
    console.error('[lark-events] ERROR:', e?.message, e?.stack);
    // Best effort: nếu có messageId trong parsed thì reply lỗi vào thread
    try {
      if ((parsed as any).messageId) {
        await sendLarkTextReply((parsed as any).messageId, `[BOT ERROR]\n${e?.message || e}`);
      }
    } catch { }
    // Với card callback: vẫn trả code:0 để tránh 200672
    if (parsed.kind === 'card') {
      return res.status(200).json({ code: 0, msg: 'handled' });
    }
    return res.status(200).send('OK (Error handled)');
  }
}
