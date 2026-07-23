import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';

type EvaluationScope = 'listings' | 'reviews' | 'seller' | 'full' | 'custom';
type EvaluationProvider = '9router' | 'anthropic';
type EvaluationTool =
  | 'collect_shop_overview'
  | 'collect_public_listings'
  | 'collect_listing_details'
  | 'collect_public_reviews'
  | 'collect_seller_stats'
  | 'collect_seller_ads'
  | 'collect_seller_orders'
  | 'collect_seller_messages';

const PROVIDER_TIMEOUT_MS = 120_000;
const MAX_CUSTOM_PROMPT_CHARS = 4_000;
const MAX_TOOL_NOTE_CHARS = 1_000;
const TOOL_ORDER: EvaluationTool[] = [
  'collect_shop_overview',
  'collect_public_listings',
  'collect_listing_details',
  'collect_public_reviews',
  'collect_seller_stats',
  'collect_seller_ads',
  'collect_seller_orders',
  'collect_seller_messages',
];

const REQUIRED_TOOLS: Record<Exclude<EvaluationScope, 'custom'>, EvaluationTool[]> = {
  listings: ['collect_shop_overview', 'collect_public_listings', 'collect_listing_details'],
  reviews: ['collect_shop_overview', 'collect_public_reviews'],
  seller: ['collect_seller_stats', 'collect_seller_ads', 'collect_seller_orders', 'collect_seller_messages'],
  full: TOOL_ORDER,
};

const ALLOWED_TOOLS: Record<EvaluationScope, EvaluationTool[]> = {
  listings: REQUIRED_TOOLS.listings,
  reviews: REQUIRED_TOOLS.reviews,
  seller: REQUIRED_TOOLS.seller,
  full: TOOL_ORDER,
  custom: TOOL_ORDER,
};

const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'tools'],
  properties: {
    summary: { type: 'string' },
    tools: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: TOOL_ORDER },
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed.' });

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const { teamId, accountId, scope = 'listings', prompt = '', periodDays = 1, provider = '9router', requestedTools = [], crawlLimits = {}, toolNotes = {} } = req.body || {};
  if (!token || !teamId || !accountId) return res.status(400).json({ message: 'Missing token, teamId or accountId.' });
  if (!['listings', 'reviews', 'seller', 'full', 'custom'].includes(scope)) return res.status(400).json({ message: 'Unsupported evaluation scope.' });
  if (!['9router', 'anthropic'].includes(provider)) return res.status(400).json({ message: 'Unsupported planner provider.' });

  const customPrompt = String(prompt || '').trim().slice(0, MAX_CUSTOM_PROMPT_CHARS);
  const explicitTools = TOOL_ORDER.filter(tool => Array.isArray(requestedTools) && requestedTools.includes(tool));
  if (explicitTools.length === 0) return res.status(400).json({ message: 'Select at least one crawl source.' });
  const normalizedLimits = normalizeCrawlLimits(crawlLimits);
  const normalizedNotes = Object.fromEntries(explicitTools.map(tool => [tool, String(toolNotes?.[tool] || '').trim().slice(0, MAX_TOOL_NOTE_CHARS)]).filter(([, note]) => note));

  try {
    const app = initFirebaseAdmin();
    const decoded = await getAuth(app).verifyIdToken(token);
    const db = getDb();
    const [roleDoc, accountDoc] = await Promise.all([
      db.collection('user_roles').doc(decoded.uid).get(),
      db.collection('user').doc(String(teamId)).collection('accounts').doc(String(accountId)).get(),
    ]);
    const profile = roleDoc.data();
    if (!roleDoc.exists || profile?.teamId !== teamId) return res.status(403).json({ message: 'Forbidden.' });
    if (!accountDoc.exists) return res.status(404).json({ message: 'Shop not found.' });

    const account = accountDoc.data() || {};
    const shopLabel = String(account.label || accountId);
    const hasFullAccess = profile?.role === 'owner' || profile?.permissions?.canManageSettings === true;
    const allowedAccounts = new Set(Array.isArray(profile?.allowedAccounts) ? profile.allowedAccounts.map(String) : []);
    if (!hasFullAccess && !allowedAccounts.has(String(accountId)) && !allowedAccounts.has(shopLabel) && !allowedAccounts.has(String(account.email || ''))) {
      return res.status(403).json({ message: 'No access to this shop.' });
    }

    const plannerPrompt = buildPlannerPrompt(scope as EvaluationScope, customPrompt, shopLabel, Number(periodDays || 1), explicitTools, normalizedLimits, normalizedNotes);
    const result = provider === 'anthropic'
      ? await planWithAnthropic(plannerPrompt)
      : await planWith9Router(plannerPrompt);
    const plan = normalizePlan(result.data, scope as EvaluationScope, explicitTools);

    return res.status(200).json({
      success: true,
      plan: {
        ...plan,
        scope,
        provider,
        model: result.model,
        createdAt: new Date().toISOString(),
        executionMode: 'browser-agent',
      },
    });
  } catch (error: any) {
    console.error('[plan-evaluation]', error?.message || error);
    return res.status(500).json({ message: error?.message || 'Evaluation planning failed.' });
  }
}

function buildPlannerPrompt(scope: EvaluationScope, customPrompt: string, shopLabel: string, periodDays: number, requestedTools: EvaluationTool[], crawlLimits: Record<string, number>, toolNotes: Record<string, string>): string {
  return `Bạn là planner cho Etsy Evaluation Worker. Hãy chọn đúng các tool đọc dữ liệu cần thiết để đáp ứng yêu cầu. Extension chỉ được đọc dữ liệu; tuyệt đối không sửa listing, Ads, order, refund, gửi message hoặc thực hiện hành động phá hủy.

SHOP: ${shopLabel}
SCOPE: ${scope}
KỲ SELLER: ${periodDays === 1 ? 'Yesterday' : `${periodDays} ngày`}
YÊU CẦU NGƯỜI DÙNG: ${customPrompt || 'Không có yêu cầu bổ sung.'}
NGUỒN NGƯỜI DÙNG ĐÃ TICK (phải giữ đúng): ${requestedTools.join(', ')}
GIỚI HẠN CRAWL: ${JSON.stringify(crawlLimits)}
GHI CHÚ THEO NGUỒN: ${JSON.stringify(toolNotes)}

TOOL ĐƯỢC PHÉP:
- collect_shop_overview: thông tin tổng quan public của shop.
- collect_public_listings: toàn bộ listing card theo từng trang public, không mở từng listing.
- collect_listing_details: mở từng listing public đã thu thập, theo giới hạn riêng, để lấy description, materials, variations, personalization instructions, shipping/returns và images.
- collect_public_reviews: review public theo từng trang.
- collect_seller_stats: Etsy Shop Manager Stats.
- collect_seller_ads: Etsy Ads và KPI đang hiển thị.
- collect_seller_orders: trang order đã bán, chỉ đọc snapshot.
- collect_seller_messages: trang message, chỉ đọc snapshot và sẽ xóa PII trước khi gửi AI phân tích.

Quy tắc:
- Chỉ trả tool trong danh sách trên.
- Giữ đúng danh sách tool người dùng đã tick; không tự thêm hoặc bỏ nguồn.
- Không tạo selector, URL, script hoặc thao tác click tùy ý.
- summary mô tả ngắn dữ liệu sẽ lấy, không nói rằng đã lấy thành công.`;
}

function normalizePlan(value: any, scope: EvaluationScope, requestedTools: EvaluationTool[]): { summary: string; tools: EvaluationTool[] } {
  const requested = new Set(requestedTools);
  const tools = TOOL_ORDER.filter(tool => requested.has(tool));
  if (tools.length === 0) throw new Error('AI planner did not select any safe collection tool.');
  const summary = String(value?.summary || `Thu thập ${scope} bằng các tool đọc dữ liệu được phép.`).trim().slice(0, 1_000);
  return { summary, tools };
}

function normalizeCrawlLimits(value: any): Record<string, number> {
  const clamp = (input: unknown, fallback: number, maximum: number) => Math.max(1, Math.min(maximum, Math.round(Number(input) || fallback)));
  return {
    listingPages: clamp(value?.listingPages, 5, 30),
    listings: clamp(value?.listings, 100, 2_000),
    listingDetails: clamp(value?.listingDetails, 20, 200),
    reviewPages: clamp(value?.reviewPages, 5, 50),
    reviews: clamp(value?.reviews, 100, 2_000),
  };
}

function providerEndpoint(baseUrl: string, resource: 'responses' | 'chat/completions'): string {
  const normalized = baseUrl.replace(/\/$/, '');
  return normalized.endsWith('/v1') ? `${normalized}/${resource}` : `${normalized}/v1/${resource}`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`AI planner timeout after ${PROVIDER_TIMEOUT_MS / 1_000} seconds.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function planWith9Router(prompt: string): Promise<{ model: string; data: any }> {
  const apiKey = process.env.NINEROUTER_API_KEY;
  if (!apiKey) throw new Error('Missing NINEROUTER_API_KEY.');
  const baseUrl = process.env.NINEROUTER_BASE_URL || 'http://13.212.110.229:20128/v1';
  const model = process.env.NINEROUTER_PLANNER_MODEL || process.env.NINEROUTER_EVALUATION_MODEL || 'cx/gpt-5.6-sol';
  const response = await fetchWithTimeout(providerEndpoint(baseUrl, 'responses'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: 'json_schema', name: 'etsy_evaluation_plan', strict: true, schema: planSchema } },
    }),
  });
  if (!response.ok && [404, 405, 501].includes(response.status)) return planWith9RouterChat(prompt, baseUrl, apiKey, model);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `9Router API ${response.status}`);
  const outputText = extractResponseText(body);
  if (!outputText) throw new Error('9Router planner returned no structured output.');
  return { model, data: parsePlan(outputText) };
}

async function planWith9RouterChat(prompt: string, baseUrl: string, apiKey: string, model: string): Promise<{ model: string; data: any }> {
  const response = await fetchWithTimeout(providerEndpoint(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Return only valid JSON matching the supplied schema.' },
        { role: 'user', content: `${prompt}\n\nJSON schema:\n${JSON.stringify(planSchema)}` },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `9Router chat API ${response.status}`);
  const outputText = body?.choices?.[0]?.message?.content;
  if (!outputText) throw new Error('9Router planner returned no output.');
  return { model, data: parsePlan(outputText) };
}

async function planWithAnthropic(prompt: string): Promise<{ model: string; data: any }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY.');
  const model = process.env.ANTHROPIC_PLANNER_MODEL || process.env.ANTHROPIC_EVALUATION_MODEL || 'claude-sonnet-4-5';
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 1_500,
      system: 'Return only valid JSON matching the requested schema. Do not use markdown fences.',
      messages: [{ role: 'user', content: `${prompt}\n\nJSON schema:\n${JSON.stringify(planSchema)}` }],
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Anthropic API ${response.status}`);
  const outputText = body?.content?.find((item: any) => item.type === 'text')?.text;
  if (!outputText) throw new Error('Anthropic planner returned no output.');
  return { model, data: parsePlan(outputText) };
}

function extractResponseText(body: any): string {
  return body?.output_text
    || body?.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text
    || body?.choices?.[0]?.message?.content
    || '';
}

function parsePlan(value: string): any {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed.summary !== 'string' || !Array.isArray(parsed.tools)) throw new Error('AI planner output does not match schema.');
  return parsed;
}
