import { getDb } from './firebaseAdminHelper.js';
import { SHARED_USER_ID } from '../../src/constants.js';
import type { Account, Record as MailRecord } from './types.js';

// --- ENV ---
const LARK_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL || '';
const LARK_APP_ID = process.env.LARK_APP_ID || '';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || '';

// ==============================
// Types
// ==============================
export interface ReportData {
  dateString: string;
  totalOrders: number;
  totalRevenue: { [currency: string]: number };
  totalFunds: { [currency: string]: number };
  shops: {
    name: string;
    orders: number;
    revenue: { [currency: string]: number };
    funds: { [currency: string]: number };
  }[];
}

interface ShopAgg {
  orders: Set<string>; // Dùng Set để lưu Unique Order ID tránh trùng lặp
  revenue: { [currency: string]: number };
  funds: { [currency: string]: number };
}

// ==============================
// Helpers
// ==============================
const formatCurrency = (value: number, currency: string = 'USD'): string => {
  // Map biểu tượng tiền tệ cho gọn gàng
  const symbolMap: Record<string, string> = {
    'USD': '$', 'AUD': 'AUD$', 'NZD': 'NZD$', 'GBP': '£', 'EUR': '€', 'VND': '₫', 'CAD': 'CAD$'
  };
  const symbol = symbolMap[currency.toUpperCase()] || currency.toUpperCase() + ' ';

  const numberPart = new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

  return `${symbol}${numberPart}`;
};

/** IANA -> "+07:00" (Hàm tiện ích chuyển đổi timeZone sang offset string) */
export function ianaToUtcOffsetString(timeZone: string, date: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    const parts = fmt.formatToParts(date);
    const gmt = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const raw = gmt.replace('GMT', '');
    if (raw.includes(':')) {
      const [h, m] = raw.split(':');
      return `${h.slice(0, 1)}${h.slice(1).padStart(2, '0')}:${m}`;
    }
    return `${raw.slice(0, 1)}${raw.slice(1).padStart(2, '0')}:00`;
  } catch {
    return '+00:00';
  }
}

async function getLarkTenantAccessToken(): Promise<string> {
  if (!LARK_APP_ID || !LARK_APP_SECRET) throw new Error('Missing LARK_APP_ID or LARK_APP_SECRET');
  const resp = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  });
  const json = await resp.json();
  if (!json.tenant_access_token) throw new Error('Failed to get tenant_access_token');
  return json.tenant_access_token;
}

/** Reply vào thread (preview card hoặc text) */
async function sendLarkReply(messageId: string, body: object) {
  const token = await getLarkTenantAccessToken();
  const url = `https://open.larksuite.com/open-apis/im/v1/messages/${messageId}/reply`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const t = await resp.text();
  if (!resp.ok) console.error('[sendLarkReply] failed', resp.status, t);
  else console.log('[sendLarkReply] ok', t);
}

/** Tạo message interactive card vào phòng chat */
export async function sendLarkCardToChat(chat_id: string, cardPayload: object) {
  const token = await getLarkTenantAccessToken();
  const url = 'https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id';

  const body = {
    receive_id: chat_id,
    msg_type: 'interactive',
    content: JSON.stringify({ card: cardPayload })
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body),
  });
  const t = await resp.text();
  if (!resp.ok) console.error('[sendLarkCardToChat] failed', resp.status, t);
  else console.log('[sendLarkCardToChat] ok', t);
}

/** Text reply vào thread */
export async function sendLarkTextReply(messageId: string, text: string) {
  await sendLarkReply(messageId, { msg_type: 'text', content: JSON.stringify({ text }) });
}

/** (tuỳ chọn) Text vào phòng chat (không dùng thread) */
export async function sendLarkTextToChat(chat_id: string, text: string) {
  const token = await getLarkTenantAccessToken();
  const url = 'https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id';
  const body = { receive_id: chat_id, msg_type: 'text', content: JSON.stringify({ text }) };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const t = await resp.text();
  if (!resp.ok) console.error('[sendLarkTextToChat] failed', resp.status, t);
  else console.log('[sendLarkTextToChat] ok', t);
}

// ==============================
// Firestore -> Report Logic
// ==============================
export async function getReportDataForDate(
  dateISO: string,
  timeZoneOffset: string,
  accountEmail: string | null = null
): Promise<ReportData> {
  const db = getDb();

  const accountsRef = db.collection('user').doc(SHARED_USER_ID).collection('accounts');
  const recordsCol = db.collection('user').doc(SHARED_USER_ID).collection('records');

  // Query chính xác theo khoảng thời gian local của người dùng
  const fromDate = new Date(`${dateISO}T00:00:00.000${timeZoneOffset}`);
  const toDate = new Date(`${dateISO}T23:59:59.999${timeZoneOffset}`);

  let q = recordsCol
    .where('dt_local', '>=', fromDate.toISOString())
    .where('dt_local', '<=', toDate.toISOString());

  if (accountEmail && accountEmail !== 'all') q = q.where('account', '==', accountEmail);

  const [accSnap, recSnap] = await Promise.all([accountsRef.get(), q.get()]);

  const accounts: Account[] = accSnap.docs.map(d => d.data() as Account);
  const records: MailRecord[] = recSnap.docs.map(d => d.data() as MailRecord);
  const labelMap = new Map(accounts.map(a => [a.email, a.label || a.email]));

  // --- LOGIC MỚI: DEDUPLICATE REVENUE ---
  // Tách riêng records Order và Funds
  // Order: Cần lọc trùng order_id (chỉ lấy record có amount lớn nhất để làm đại diện)
  // Funds: Cộng dồn bình thường

  const uniqueOrderMap = new Map<string, MailRecord>(); // Key: order_id
  const fundRecords: MailRecord[] = [];

  for (const r of records) {
    const kind = (r.kind || '').toLowerCase();

    if (kind === 'order' && r.order_id) {
      // Logic: Nếu order_id đã tồn tại, chỉ giữ lại record có amount lớn hơn
      // Điều này giải quyết vấn đề nhiều email cho 1 order (Confirm, Update...) cùng chứa Total Amount
      const existing = uniqueOrderMap.get(r.order_id);
      const currentAmt = Number(r.amount) || 0;

      if (!existing || (Number(existing.amount) || 0) < currentAmt) {
        uniqueOrderMap.set(r.order_id, r);
      }
    } else if (kind === 'funds') {
      fundRecords.push(r);
    }
  }

  // Khởi tạo biến tổng hợp
  const totalRevenue: Record<string, number> = {};
  const totalFunds: Record<string, number> = {};
  const totalOrders = new Set<string>(); // Vẫn dùng Set cho an toàn
  const shopAgg: Record<string, ShopAgg> = {};

  const initShop = (name: string) => {
    if (!shopAgg[name]) shopAgg[name] = { orders: new Set(), revenue: {}, funds: {} };
  };

  // 1. Tính toán từ Unique Orders (Revenue & Order Count)
  uniqueOrderMap.forEach((r) => {
    const ccy = r.currency || 'USD';
    const shop = labelMap.get(r.account) || r.account;
    const amt = Number(r.amount) || 0;

    initShop(shop);

    if (amt > 0) {
      totalRevenue[ccy] = (totalRevenue[ccy] || 0) + amt;
      shopAgg[shop].revenue[ccy] = (shopAgg[shop].revenue[ccy] || 0) + amt;
    }

    // Đếm order
    totalOrders.add(r.order_id);
    shopAgg[shop].orders.add(r.order_id);
  });

  // 2. Tính toán từ Funds (Cộng dồn)
  for (const r of fundRecords) {
    const ccy = r.currency || 'USD';
    const shop = labelMap.get(r.account) || r.account;
    const amt = Number(r.amount) || 0;

    initShop(shop);

    if (amt !== 0) {
      const v = Math.abs(amt);
      totalFunds[ccy] = (totalFunds[ccy] || 0) + v;
      shopAgg[shop].funds[ccy] = (shopAgg[shop].funds[ccy] || 0) + v;
    }
  }

  // Chuyển đổi Set.size thành number khi return
  return {
    dateString: dateISO,
    totalOrders: totalOrders.size,
    totalRevenue,
    totalFunds,
    shops: Object.entries(shopAgg).map(([name, data]) => ({
      name,
      orders: data.orders.size,
      revenue: data.revenue,
      funds: data.funds
    })).sort((a, b) => b.orders - a.orders) // Xếp hạng shop theo số đơn
  };
}

export async function getSavedReportForDate(dateISO: string, timeZoneOffset: string, accountEmail?: string) {
  return getReportDataForDate(dateISO, timeZoneOffset, accountEmail ?? null);
}

// ==============================
// Card Builders
// ==============================
function buildLarkCard(
  data: ReportData,
  timeZoneOffset: string,
  options: { includeShopDetails: boolean } = { includeShopDetails: true }
) {
  const { dateString, totalOrders, totalRevenue, totalFunds, shops } = data;

  // Helper format
  const formatMoneyList = (record: Record<string, number>, defaultText = '0.00') => {
    const list = Object.entries(record || {})
      .filter(([_, amt]) => amt !== 0)
      .map(([ccy, amt]) => `${formatCurrency(amt, ccy)}`);

    return list.length > 0 ? list.join('\n') : defaultText;
  };

  const revText = formatMoneyList(totalRevenue, 'USD 0.00');
  const fndText = formatMoneyList(totalFunds, 'USD 0.00');

  // --- HEADER (TOTALS) ---
  const elements: any[] = [{
    tag: 'column_set',
    flex_mode: 'trisect',        // Ép buộc chia 3 cột đều nhau
    horizontal_spacing: 'small', // Giảm khoảng cách cột
    background_style: 'grey',    // (Tuỳ chọn) Thêm nền xám nhẹ để nổi bật phần Tổng
    columns: [
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'top',
        elements: [{
          tag: 'markdown',
          content: `**📦 Total Orders**\n${totalOrders}`,
          text_align: 'left'
        }]
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'top',
        elements: [{
          tag: 'markdown',
          content: `**💰 Total Revenue**\n${revText}`,
          text_align: 'left'
        }]
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'top',
        elements: [{
          tag: 'markdown',
          content: `**🏦 Total Funds**\n${fndText}`,
          text_align: 'left'
        }]
      }
    ]
  }];

  // --- SHOP DETAILS ---
  const activeShops = shops.filter(s => s.orders > 0 || Object.keys(s.revenue).length > 0 || Object.keys(s.funds).length > 0);

  if (options.includeShopDetails && activeShops.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**🛒 Shop Details**' } });

    for (const s of activeShops) {
      const r = formatMoneyList(s.revenue, '-');
      const f = formatMoneyList(s.funds, '-');

      // 1. Tên Shop
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: `**⭐${s.name}**` }
      });

      // 2. Dùng COLUMN_SET thay vì DIV FIELDS
      elements.push({
        tag: 'column_set',
        flex_mode: 'trisect', // QUAN TRỌNG: Ép buộc chia 3 cột đều nhau bất kể màn hình
        horizontal_spacing: 'small', // QUAN TRỌNG: Giảm khoảng cách giữa các cột
        background_style: 'default',
        columns: [
          {
            tag: 'column',
            width: 'weighted', // Chia theo tỷ trọng
            weight: 1,         // Tỷ trọng 1
            vertical_align: 'top',
            elements: [{
              tag: 'markdown',
              content: `**📦 Orders**\n${s.orders}`,
              text_align: 'left' // Căn trái cho thẳng hàng
            }]
          },
          {
            tag: 'column',
            width: 'weighted',
            weight: 1, // Tỷ trọng 1
            vertical_align: 'top',
            elements: [{
              tag: 'markdown',
              content: `**💰 Revenue**\n${r}`,
              text_align: 'left'
            }]
          },
          {
            tag: 'column',
            width: 'weighted',
            weight: 1, // Tỷ trọng 1
            vertical_align: 'top',
            elements: [{
              tag: 'markdown',
              content: `**🏦 Funds**\n${f}`,
              text_align: 'left'
            }]
          }
        ]
      });

      // Separator
      elements.push({ tag: 'hr' });
    }

    // Xóa hr thừa ở cuối
    if (elements[elements.length - 1].tag === 'hr') {
      elements.pop();
    }
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true
    },
    header: {
      title: { content: `📊 SALES REPORT (${dateString} ${timeZoneOffset})`, tag: 'plain_text' },
      template: 'blue'
    },
    elements
  };
}

export async function sendLarkInteractiveReply(
  messageId: string,
  data: ReportData,
  timeZoneOffset: string,
  options: { includeShopDetails: boolean }
) {
  const card = buildLarkCard(data, timeZoneOffset, options);
  await sendLarkReply(messageId, { msg_type: 'interactive', content: JSON.stringify(card) });
}

// ====== Report Builder Form (Interactive Form) ======
function buildReportBuilderForm(accounts: Account[]) {
  const shopOptions = [
    { text: { tag: 'plain_text', content: 'All Shops' }, value: 'all' },
    ...accounts.map(a => ({
      text: { tag: 'plain_text', content: a.label || a.email },
      value: a.email,
    })),
  ];

  const timezoneOptions = [
    { text: { tag: 'plain_text', content: '(UTC+07:00) Vietnam' }, value: 'Asia/Ho_Chi_Minh' },
    { text: { tag: 'plain_text', content: '(UTC-04:00) New York' }, value: 'America/New_York' },
    { text: { tag: 'plain_text', content: '(UTC-07:00) Los Angeles' }, value: 'America/Los_Angeles' },
    { text: { tag: 'plain_text', content: '(UTC+00:00) UTC' }, value: 'Etc/UTC' },
    { text: { tag: 'plain_text', content: '(UTC+01:00) London' }, value: 'Europe/London' },
  ];

  const today = new Date().toISOString().slice(0, 10);

  return {
    config: { wide_screen_mode: true },
    header: { title: { content: '🤖 Build a Sales Report', tag: 'plain_text' }, template: 'blue' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: 'Chọn tuỳ chọn rồi bấm **Get Report**.' } },
      {
        tag: 'action',
        actions: [
          { tag: 'date_picker', name: 'date_select', initial_value: today },
          { tag: 'select_static', name: 'shop_select', value: 'all', options: shopOptions },
          { tag: 'select_static', name: 'timezone_select', value: 'Asia/Ho_Chi_Minh', options: timezoneOptions },
          { tag: 'button', type: 'primary', name: 'submit', text: { tag: 'plain_text', content: 'Get Report' }, value: { "action": "build_report" } },
        ],
      },
    ],
  };
}

export async function sendReportBuilderCardToChat(chat_id: string) {
  const db = getDb();
  const accRef = db.collection('user').doc(SHARED_USER_ID).collection('accounts');
  const accSnap = await accRef.orderBy('order', 'asc').get();
  const accounts = accSnap.docs.map(d => d.data() as Account);
  const card = buildReportBuilderForm(accounts);
  console.log('[DEBUG] sending builder card');
  await sendLarkCardToChat(chat_id, card);
}

export async function sendLarkDailySummary(data: ReportData) {
  if (!LARK_WEBHOOK_URL) return;
  // Mặc định hiển thị label UTC-7 vì thường hàm này được gọi từ cron daily-summary
  const card = buildLarkCard(data, '(UTC-7)', { includeShopDetails: true });
  await fetch(LARK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'interactive', card }),
  }).catch(e => console.error('[larkHelper] webhook error', e));
}