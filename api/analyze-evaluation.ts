import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';

type Provider = '9router' | 'openai' | 'anthropic';
type StreamProgress = { current: number; total: number; stage: string; listingStart?: number; listingEnd?: number; listingTotal?: number };

export const config = { maxDuration: 600 };

const MAX_PROMPT_CHARS = 280_000;
const ANALYSIS_LOCK_MS = 15 * 60_000;
const PROVIDER_TIMEOUT_MS = 180_000;
const PROVIDER_TOTAL_TIMEOUT_MS = 240_000;
const AI_LIVE_MAX_CHARS = 40_000;
const AI_LIVE_WRITE_INTERVAL_MS = 750;
const ALLOWED_NINEROUTER_MODELS = ['cc/claude-fable-5', 'ag/gemini-3-flash-agent'];

function cleanEnvValue(value: string | undefined): string {
  return String(value || '').replace(/\uFEFF/g, '').trim();
}

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'strengths', 'weaknesses', 'findings', 'actions', 'report', 'listingAudit'],
  properties: {
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'evidence', 'recommendation', 'listingIds'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
          listingIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'priority', 'deadlineDays', 'kpi'],
        properties: {
          title: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          deadlineDays: { type: 'number' },
          kpi: { type: 'string' },
        },
      },
    },
    report: {
      type: 'object',
      additionalProperties: false,
      required: ['executiveAssessment', 'metrics', 'riskDistribution', 'sentiment', 'immediatePlan', 'sellerCapability', 'customerCare', 'operations', 'reviewInsights', 'adsAudit', 'developmentPlans'],
      properties: {
        executiveAssessment: { type: 'string' },
        metrics: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'value', 'evidence'],
            properties: { name: { type: 'string' }, value: { type: 'string' }, evidence: { type: 'string' } },
          },
        },
        riskDistribution: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['level', 'count', 'percentage', 'evidence'],
            properties: { level: { type: 'string' }, count: { type: 'string' }, percentage: { type: 'string' }, evidence: { type: 'string' } },
          },
        },
        sentiment: {
          type: 'object',
          additionalProperties: false,
          required: ['positive', 'neutral', 'negative', 'total', 'assessment'],
          properties: {
            positive: { type: 'string' }, neutral: { type: 'string' }, negative: { type: 'string' }, total: { type: 'string' }, assessment: { type: 'string' },
          },
        },
        immediatePlan: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['priority', 'action', 'reason', 'kpi', 'deadline'],
            properties: { priority: { type: 'string' }, action: { type: 'string' }, reason: { type: 'string' }, kpi: { type: 'string' }, deadline: { type: 'string' } },
          },
        },
        sellerCapability: {
          type: 'object',
          additionalProperties: false,
          required: ['level', 'score', 'assessment', 'axes', 'roadmap'],
          properties: {
            level: { type: 'string' },
            score: { type: 'number' },
            assessment: { type: 'string' },
            axes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['axis', 'score', 'assessment', 'evidence'],
                properties: { axis: { type: 'string' }, score: { type: 'number' }, assessment: { type: 'string' }, evidence: { type: 'string' } },
              },
            },
            roadmap: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['phase', 'actions', 'kpis'],
                properties: { phase: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } }, kpis: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        customerCare: {
          type: 'object',
          additionalProperties: false,
          required: ['level', 'score', 'assessment', 'strengths', 'gaps', 'cases'],
          properties: {
            level: { type: 'string' }, score: { type: 'number' }, assessment: { type: 'string' },
            strengths: { type: 'array', items: { type: 'string' } },
            gaps: { type: 'array', items: { type: 'string' } },
            cases: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['rating', 'product', 'issue', 'sentiment', 'recovery', 'evidence'],
                properties: { rating: { type: 'string' }, product: { type: 'string' }, issue: { type: 'string' }, sentiment: { type: 'string' }, recovery: { type: 'string' }, evidence: { type: 'string' } },
              },
            },
          },
        },
        operations: {
          type: 'object',
          additionalProperties: false,
          required: ['level', 'score', 'assessment', 'ordersAssessment', 'messagesAssessment', 'cases', 'recommendations'],
          properties: {
            level: { type: 'string' }, score: { type: 'number' }, assessment: { type: 'string' }, ordersAssessment: { type: 'string' }, messagesAssessment: { type: 'string' },
            cases: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['customer', 'topic', 'currentHandling', 'improvement', 'evidence'],
                properties: { customer: { type: 'string' }, topic: { type: 'string' }, currentHandling: { type: 'string' }, improvement: { type: 'string' }, evidence: { type: 'string' } },
              },
            },
            recommendations: { type: 'array', items: { type: 'string' } },
          },
        },
        reviewInsights: {
          type: 'object',
          additionalProperties: false,
          required: ['repeatedIssues', 'praisedThemes'],
          properties: {
            repeatedIssues: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['issue', 'count', 'evidence', 'rootCause', 'action'],
                properties: { issue: { type: 'string' }, count: { type: 'string' }, evidence: { type: 'string' }, rootCause: { type: 'string' }, action: { type: 'string' } },
              },
            },
            praisedThemes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['theme', 'count', 'evidence', 'howToUse'],
                properties: { theme: { type: 'string' }, count: { type: 'string' }, evidence: { type: 'string' }, howToUse: { type: 'string' } },
              },
            },
          },
        },
        adsAudit: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['listingId', 'title', 'impressions', 'clicks', 'ctr', 'orders', 'conversionRate', 'spend', 'revenue', 'roas', 'decision', 'diagnosis', 'action', 'evidence'],
            properties: {
              listingId: { type: 'string' }, title: { type: 'string' }, impressions: { type: 'string' }, clicks: { type: 'string' }, ctr: { type: 'string' }, orders: { type: 'string' }, conversionRate: { type: 'string' }, spend: { type: 'string' }, revenue: { type: 'string' }, roas: { type: 'string' }, decision: { type: 'string' }, diagnosis: { type: 'string' }, action: { type: 'string' }, evidence: { type: 'string' },
            },
          },
        },
        developmentPlans: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['listingId', 'title', 'whyInvest', 'strengths', 'risks', 'direction', 'milestones', 'expected30Days', 'evidence'],
            properties: {
              listingId: { type: 'string' }, title: { type: 'string' }, whyInvest: { type: 'string' }, strengths: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } }, direction: { type: 'string' },
              milestones: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['timeframe', 'action', 'kpi'],
                  properties: { timeframe: { type: 'string' }, action: { type: 'string' }, kpi: { type: 'string' } },
                },
              },
              expected30Days: { type: 'string' }, evidence: { type: 'string' },
            },
          },
        },
      },
    },
    listingAudit: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'listingId', 'title', 'url', 'price', 'risk', 'action', 'analysis', 'improvement', 'evidenceMaterials', 'policyFlags', 'seo'],
        properties: {
          index: { type: 'number' },
          listingId: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          price: { type: 'string' },
          risk: { type: 'string' },
          action: { type: 'string' },
          analysis: { type: 'string' },
          improvement: { type: 'string' },
          evidenceMaterials: { type: 'string' },
          policyFlags: { type: 'string' },
          seo: { type: 'string' },
        },
      },
    },
  },
};

const batchAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'strengths', 'weaknesses', 'findings', 'actions', 'listingAudit'],
  properties: {
    summary: analysisSchema.properties.summary,
    strengths: analysisSchema.properties.strengths,
    weaknesses: analysisSchema.properties.weaknesses,
    findings: analysisSchema.properties.findings,
    actions: analysisSchema.properties.actions,
    listingAudit: analysisSchema.properties.listingAudit,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed.' });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const { teamId, runId, provider = '9router', stream = false, model: requestedModelValue = '' } = req.body || {};
  const requestedModel = cleanEnvValue(String(requestedModelValue || ''));
  let streamStarted = false;
  let pendingDelta = '';
  let deltaFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let liveRunRef: FirebaseFirestore.DocumentReference | null = null;
  let livePreview = '';
  let liveModel: string | undefined;
  let liveProgress: StreamProgress | undefined;
  let liveStatus: 'connecting' | 'running' | 'completed' | 'failed' = 'connecting';
  let liveError: string | undefined;
  let liveWriteTimer: ReturnType<typeof setTimeout> | undefined;
  let liveWriteChain = Promise.resolve();
  const persistAiLive = async () => {
    if (liveWriteTimer) clearTimeout(liveWriteTimer);
    liveWriteTimer = undefined;
    if (!liveRunRef || !streamStarted) return;
    const payload = {
      status: liveStatus,
      text: livePreview,
      model: liveModel || null,
      progress: liveProgress || null,
      updatedAt: new Date().toISOString(),
      error: liveError || null,
    };
    liveWriteChain = liveWriteChain.then(async () => { await liveRunRef!.set({ aiLive: payload }, { merge: true }); }).catch(() => undefined);
    await liveWriteChain;
  };
  const scheduleAiLive = () => {
    if (!streamStarted || liveWriteTimer) return;
    liveWriteTimer = setTimeout(() => { void persistAiLive(); }, AI_LIVE_WRITE_INTERVAL_MS);
  };
  const flushDelta = () => {
    if (deltaFlushTimer) clearTimeout(deltaFlushTimer);
    deltaFlushTimer = undefined;
    if (!streamStarted || !pendingDelta) return;
    sendEvent(res, 'delta', { text: pendingDelta });
    pendingDelta = '';
  };
  const queueDelta = (delta: string) => {
    pendingDelta += delta;
    livePreview = `${livePreview}${delta}`.slice(-AI_LIVE_MAX_CHARS);
    liveStatus = 'running';
    scheduleAiLive();
    if (!deltaFlushTimer) deltaFlushTimer = setTimeout(flushDelta, 60);
  };
  if (!token || !teamId || !runId) return res.status(400).json({ message: 'Missing token, teamId or runId.' });
  if (!['9router', 'openai', 'anthropic'].includes(provider)) return res.status(400).json({ message: 'Unsupported provider.' });
  if (provider === '9router' && requestedModel && !ALLOWED_NINEROUTER_MODELS.includes(requestedModel)) return res.status(400).json({ message: 'Unsupported 9Router model.' });

  try {
    const app = initFirebaseAdmin();
    const decoded = await getAuth(app).verifyIdToken(token);
    const db = getDb();
    const roleDoc = await db.collection('user_roles').doc(decoded.uid).get();
    const profile = roleDoc.data();
    if (!roleDoc.exists || profile?.teamId !== teamId) return res.status(403).json({ message: 'Forbidden.' });

    const runRef = db.collection('user').doc(teamId).collection('evaluation_runs').doc(runId);
    liveRunRef = runRef;
    const runDoc = await runRef.get();
    if (!runDoc.exists) return res.status(404).json({ message: 'Evaluation run not found.' });
    const run = runDoc.data() || {};
    const hasFullAccess = profile?.role === 'owner' || profile?.permissions?.canManageSettings === true;
    const allowed = new Set(Array.isArray(profile?.allowedAccounts) ? profile.allowedAccounts.map(String) : []);
    if (!hasFullAccess && !allowed.has(String(run.accountId)) && !allowed.has(String(run.shopLabel))) {
      return res.status(403).json({ message: 'No access to this shop.' });
    }

    const analysisStartedAt = Date.parse(String(run.analysis?.startedAt || ''));
    if (run.analysis?.status === 'running' && Number.isFinite(analysisStartedAt) && Date.now() - analysisStartedAt < ANALYSIS_LOCK_MS) {
      return res.status(409).json({ message: 'Run is already being analyzed.' });
    }

    const [publicPageSnapshot, listingSnapshot, detailSnapshot, reviewSnapshot, sellerSnapshot] = await Promise.all([
      runRef.collection('public_pages').get(),
      runRef.collection('public_listings').get(),
      runRef.collection('listing_details').get(),
      runRef.collection('public_reviews').get(),
      runRef.collection('seller_pages').get(),
    ]);
    const publicPages = publicPageSnapshot.docs.map(document => compactValue({ id: document.id, ...document.data() }));
    const listings = listingSnapshot.docs.map(document => compactValue({ id: document.id, ...document.data() }));
    const listingDetails = detailSnapshot.docs.map(document => compactValue({ id: document.id, ...document.data() }));
    const reviews = reviewSnapshot.docs.map(document => compactValue({ id: document.id, ...document.data() }));
    const sellerPages = sellerSnapshot.docs.map(document => compactValue({ id: document.id, ...document.data() }));
    if (publicPages.length + listings.length + listingDetails.length + reviews.length + sellerPages.length === 0) {
      return res.status(400).json({ message: 'Run has no collected data to analyze.' });
    }

    if (stream) {
      startEventStream(res);
      streamStarted = true;
      sendEvent(res, 'status', { stage: 'connected', provider, model: provider === '9router' ? requestedModel || cleanEnvValue(process.env.NINEROUTER_EVALUATION_MODEL) || 'cc/claude-fable-5' : null });
    }

    const startedAt = new Date().toISOString();
    const requestStartedAt = Date.now();
    const providerBaseUrl = provider === '9router' ? (process.env.NINEROUTER_BASE_URL || 'http://13.212.110.229:20128/v1') : provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses';
    const providerModel = provider === '9router' ? requestedModel || cleanEnvValue(process.env.NINEROUTER_EVALUATION_MODEL) || 'cc/claude-fable-5' : provider === 'anthropic' ? cleanEnvValue(process.env.ANTHROPIC_EVALUATION_MODEL) || 'claude-sonnet-4-5' : cleanEnvValue(process.env.OPENAI_EVALUATION_MODEL) || 'gpt-5.4';
    liveModel = providerModel;
    await runRef.set({ analysis: { status: 'running', provider, startedAt, updatedAt: startedAt, progress: null, completedAt: null, error: null }, stage: 'automatic-analysis' }, { merge: true });
    if (streamStarted) await persistAiLive();
    await writeRunLog(runRef, { level: 'info', stage: 'analysis-start', message: 'AI analysis request started.', request: { method: 'POST', url: provider === '9router' ? providerEndpoint(providerBaseUrl, 'responses') : providerBaseUrl }, context: { provider, model: providerModel, streaming: Boolean(stream), scope: run.scope || null, customPromptProvided: Boolean(run.customPrompt), publicPages: publicPages.length, listings: listings.length, listingDetails: listingDetails.length, reviews: reviews.length, sellerPages: sellerPages.length } });
    const source = { publicPages, listings, listingDetails, reviews, sellerPages };
    const result = await analyzeAllSources(provider, run, source, async progress => {
      liveStatus = 'running';
      liveProgress = progress;
      const progressUpdatedAt = new Date().toISOString();
      await runRef.set({ analysis: { status: 'running', provider, progress, startedAt, updatedAt: progressUpdatedAt }, ...(!streamStarted ? { aiLive: { status: 'running', text: '', model: providerModel, progress, updatedAt: progressUpdatedAt, error: null } } : {}) }, { merge: true });
      if (streamStarted) await persistAiLive();
      await writeRunLog(runRef, { level: 'info', stage: progress.stage, message: `AI progress ${progress.current}/${progress.total}.`, request: { method: 'POST', url: provider === '9router' ? providerEndpoint(providerBaseUrl, 'responses') : providerBaseUrl, durationMs: Date.now() - requestStartedAt }, context: { provider, model: providerModel, ...progress } });
      if (streamStarted) sendEvent(res, 'progress', progress);
    }, streamStarted ? delta => queueDelta(delta) : undefined, providerModel);

    const listingAudit = Array.isArray(result.data.listingAudit) ? result.data.listingAudit : [];
    result.data.report = compactReport(result.data.report, 20);
    await replaceListingAudit(runRef, listingAudit);
    const { listingAudit: _listingAudit, ...reportResult } = result.data;

    const analysis = {
      status: 'completed',
      provider,
      model: result.model,
      result: reportResult,
      listingAuditCount: listingAudit.length,
      sourceCoverage: {
        listingsAvailable: Number(run.coverage?.listings || listings.length),
        listingsAnalyzed: listings.length,
        listingDetailsAnalyzed: listingDetails.length,
        reviewsAvailable: Number(run.coverage?.reviews || reviews.length),
        reviewsAnalyzed: reviews.length,
        publicPagesAnalyzed: publicPages.length,
        sellerPagesAnalyzed: sellerPages.length,
        batchesAnalyzed: result.batches,
      },
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: null,
      error: null,
    };
    await runRef.set({ analysis, stage: 'analysis-complete', updatedAt: analysis.updatedAt, ...(!streamStarted ? { aiLive: { status: 'completed', text: '', model: result.model, progress: null, updatedAt: analysis.updatedAt, error: null } } : {}) }, { merge: true });
    await writeRunLog(runRef, { level: 'info', stage: 'analysis-complete', message: 'AI analysis completed and passed schema validation.', request: { method: 'POST', url: provider === '9router' ? providerEndpoint(providerBaseUrl, 'responses') : providerBaseUrl, status: 200, durationMs: Date.now() - requestStartedAt }, context: { provider, model: result.model, batches: result.batches, listingAuditCount: listingAudit.length } });
    if (streamStarted) {
      flushDelta();
      liveStatus = 'completed';
      liveProgress = undefined;
      await persistAiLive();
      sendEvent(res, 'complete', { analysis });
      return res.end();
    }
    return res.status(200).json({ success: true, analysis });
  } catch (error: any) {
    console.error('[analyze-evaluation]', error?.message || error);
    try {
      if (teamId && runId) {
        const failedRunRef = getDb().collection('user').doc(teamId).collection('evaluation_runs').doc(runId);
        await writeRunLog(failedRunRef, { level: 'error', stage: 'analysis-failed', message: error?.message || 'Analysis failed.', error: { name: error?.name, message: error?.message, stack: error?.stack?.slice(0, 8_000) }, context: { provider } });
        const failedAt = new Date().toISOString();
        await failedRunRef.set({ analysis: { status: 'failed', provider, error: error?.message || 'Analysis failed.', completedAt: failedAt }, ...(!streamStarted ? { aiLive: { status: 'failed', text: '', model: liveModel || provider, progress: null, updatedAt: failedAt, error: error?.message || 'Analysis failed.' } } : {}) }, { merge: true });
        liveRunRef = failedRunRef;
        liveStatus = 'failed';
        liveError = error?.message || 'Analysis failed.';
        await persistAiLive();
      }
    } catch {}
    if (streamStarted) {
      flushDelta();
      sendEvent(res, 'error', { message: error?.message || 'Analysis failed.' });
      return res.end();
    }
    return res.status(500).json({ message: error?.message || 'Analysis failed.' });
  }
}

function startEventStream(res: VercelResponse): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function sendEvent(res: VercelResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function writeRunLog(runRef: FirebaseFirestore.DocumentReference, entry: Record<string, unknown>): Promise<void> {
  try { await runRef.collection('logs').add(JSON.parse(JSON.stringify({ timestamp: new Date().toISOString(), source: 'ai-api', version: '1', ...entry }))); } catch {}
}

function redactPii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/(?:\+?\d[\s().-]*){8,}/g, '[PHONE]')
    .replace(/\b\d{1,5}\s+[A-Za-z0-9.' -]{3,40}\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b/gi, '[ADDRESS]');
}

async function replaceListingAudit(runRef: FirebaseFirestore.DocumentReference, rows: any[]): Promise<void> {
  const auditCollection = runRef.collection('listing_audit');
  const existing = await auditCollection.get();
  for (let offset = 0; offset < existing.docs.length; offset += 400) {
    const batch = runRef.firestore.batch();
    existing.docs.slice(offset, offset + 400).forEach(document => batch.delete(document.ref));
    await batch.commit();
  }
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = runRef.firestore.batch();
    rows.slice(offset, offset + 400).forEach((row, index) => {
      const fallbackId = String(offset + index + 1).padStart(6, '0');
      const documentId = String(row.listingId || fallbackId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120) || fallbackId;
      batch.set(auditCollection.doc(documentId), row);
    });
    await batch.commit();
  }
}

function preserveMachineValue(key: string): boolean {
  return /(?:^|_)(?:id|url)$/i.test(key) || /(?:Id|Url)$/.test(key);
}

function compactValue(value: any, depth = 0, key = ''): any {
  if (value == null || depth > 8) return value;
  if (typeof value === 'string') return (preserveMachineValue(key) ? value : redactPii(value)).slice(0, 30_000);
  if (Array.isArray(value)) return value.slice(0, 1_000).map(item => compactValue(item, depth + 1, key));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([childKey]) => !['buyerName', 'email', 'phone', 'address', 'jsonData', 'jsonLd'].includes(childKey)).map(([childKey, item]) => [childKey, compactValue(item, depth + 1, childKey)]));
  }
  return value;
}

function buildPrompt(run: Record<string, any>, publicPages: any[], listings: any[], listingDetails: any[], reviews: any[], sellerPages: any[], batchLabel = 'all'): string {
  const scope = String(run.scope || 'full');
  const customPrompt = String(run.customPrompt || defaultEvaluationPrompt(scope)).trim().slice(0, 4_000);
  return `Bạn là chuyên gia audit Etsy shop. Đây là batch ${batchLabel}. Scope được chọn là ${scope}. Kỳ seller được yêu cầu là ${run.periodDays === 1 ? 'Yesterday/Hôm qua' : `${run.periodDays || 7} ngày`}. Chỉ dùng dữ liệu JSON được cung cấp, tuyệt đối không bịa. Nếu periodFilterApplied=false thì phải nêu rõ kỳ hiển thị chưa được xác minh.\n\nYÊU CẦU NGƯỜI DÙNG:\n${customPrompt}\n\nCẤU TRÚC BÁO CÁO CHI TIẾT:\n- report.executiveAssessment: nhận định điều hành ngắn, nêu ưu tiên số 1 và căn cứ số liệu.\n- report.metrics: KPI thực tế như tổng listing, listing có đơn nếu thấy, review, sale, impressions, clicks, CTR, orders, conversion, spend, revenue, ROAS. Không có dữ liệu thì không tự suy ra. Profit thật chỉ được tính khi có cả fund và cost, theo công thức profit = fund - cost.\n- report.riskDistribution: phân bổ HIGH/MEDIUM/LOW chỉ khi có thể đếm từ listingAudit; không đoán từ title đơn thuần.\n- report.sentiment và reviewInsights: phân loại review, vấn đề lặp, lời khen, nguyên nhân gốc, cách tận dụng; dẫn review thật nhưng không lộ PII.\n- report.immediatePlan: 4-10 việc ưu tiên trong khoảng 30 ngày, có lý do, KPI và hạn.\n- report.sellerCapability: chấm 0-10 theo các trục SEO, policy/IP, pricing, Ads, chất lượng/CX, quy mô danh mục; score=0 và ghi Không đủ dữ liệu nếu scope không có nguồn cần thiết.\n- report.customerCare: đánh giá review/message và từng ca tiêu cực quan trọng; không đoán cách shop đã xử lý nếu chưa thấy nội dung.\n- report.operations: đánh giá order/message, unread/help request, phản hồi và khuyến nghị; ẩn danh khách.\n- report.adsAudit: từng sản phẩm Ads có KPI, phán quyết DỪNG/GIẢM/GIỮ/NHÂN RỘNG/CHƯA ĐỦ DỮ LIỆU, chẩn đoán và hành động.\n- report.developmentPlans: chọn tối đa 20 listing có bằng chứng tốt nhất để phát triển; mỗi listing có lý do, điểm mạnh, rủi ro, hướng phát triển, mốc tuần 1/2/3-4 và kỳ vọng 30 ngày. Không chọn sản phẩm chỉ vì AI thấy ý tưởng hay.\n- Với phần không thuộc scope hoặc không có nguồn, dùng chuỗi Không đủ dữ liệu để đánh giá, mảng rỗng và score=0; tuyệt đối không lấp số liệu giả.\n\nYÊU CẦU QUAN TRỌNG CHO listingAudit:\n- Nếu LISTING CARDS có dữ liệu, trả đúng một dòng cho MỖI listing, không bỏ sót và không tạo thêm listing.\n- Nếu không có LISTING CARDS, trả listingAudit là mảng rỗng; không bịa listing để lấp dữ liệu.\n- Giữ nguyên listingId, title, url và price từ dữ liệu nguồn.\n- Các cột cần đánh giá: risk; action; analysis (điểm tốt, điểm yếu, nguyên nhân); improvement; evidenceMaterials; policyFlags; seo.\n- evidenceMaterials phải ghi căn cứ quan sát được và chất liệu nếu nguồn có.\n- policyFlags chỉ nêu cờ chính sách có căn cứ; nếu không thấy cờ thì ghi Không phát hiện từ dữ liệu hiện có.\n- seo đánh giá title, keyword, độ rõ intent và khả năng tìm kiếm dựa trên dữ liệu có thật.\n- Nếu một cột không đủ dữ liệu, ghi đúng Không đủ dữ liệu để đánh giá.\n- Không có cột Review và không có cột số sao trong listingAudit; review nằm ở report riêng.\n\nMỗi finding cấp shop phải dẫn listing ID hoặc bằng chứng cụ thể. Dữ liệu seller đã được xóa PII trước khi gửi provider.\n\nSHOP:\n${JSON.stringify({ shopLabel: run.shopLabel, publicUrl: run.publicUrl, periodDays: run.periodDays, scope: run.scope, coverage: run.coverage, agentPlan: run.agentPlan })}\n\nPUBLIC SHOP PAGES:\n${JSON.stringify(publicPages)}\n\nLISTING CARDS:\n${JSON.stringify(listings)}\n\nLISTING DETAILS:\n${JSON.stringify(listingDetails)}\n\nREVIEWS:\n${JSON.stringify(reviews)}\n\nSELLER PAGES:\n${JSON.stringify(sellerPages)}\n\nƯu tiên trả lời đúng yêu cầu người dùng và scope. Sau đó tổng kết, điểm mạnh, điểm yếu, findings và kế hoạch hành động có căn cứ.`;
}

function defaultEvaluationPrompt(scope: string): string {
  if (scope === 'listings') return 'Đánh giá toàn bộ listing theo bảng Listings: rủi ro, hành động, phân tích tốt/yếu/nguyên nhân, cải thiện, căn cứ/chất liệu, cờ chính sách và SEO. Tổng hợp KPI, lỗi lặp, cơ hội và chọn tối đa 20 listing có bằng chứng tốt nhất để lập kế hoạch phát triển 30 ngày.';
  if (scope === 'reviews') return 'Đánh giá toàn bộ review public: sentiment, vấn đề lặp, lời khen, nguyên nhân gốc, chất lượng chăm sóc khách, từng ca tiêu cực quan trọng và hành động cứu khách. Không suy đoán nội dung message hoặc dữ liệu seller chưa được thu thập.';
  if (scope === 'seller') return 'Đánh giá dữ liệu seller theo kỳ đã chọn: năng lực seller, Stats, Ads theo từng sản phẩm, Orders, Messages, vận hành và CSKH. KPI nào không thấy phải ghi không đủ dữ liệu; profit chỉ tính bằng fund - cost khi có đủ hai số.';
  return 'Tạo báo cáo audit Etsy đầy đủ theo các sheet: Executive Overview; KPI & Risk; Immediate 30-day Plan; Seller Capability và lộ trình 0-30/30-60/60-90 ngày; Customer Care; Orders & Messages; Review Insights; Ads Audit; Product Development Plans; Listing Audit; Findings & Actions. Mỗi số liệu và nhận định phải dẫn căn cứ từ dữ liệu crawl thực tế. Không được tự suy diễn hoặc bịa giá trị; phần nào thiếu nguồn phải ghi đúng "Không đủ dữ liệu".';
}

function parseJsonOutput(value: string, requireFullReport = true): any {
  const parsed = tryParseJsonObject(value);
  const candidate = parsed?.result && typeof parsed.result === 'object'
    ? parsed.result
    : parsed?.analysis && typeof parsed.analysis === 'object'
      ? parsed.analysis
      : parsed;
  const markdownFallback = !candidate || typeof candidate !== 'object';
  const summary = markdownFallback
    ? value.trim().slice(0, 30_000)
    : String(candidate.summary || candidate.executiveSummary || candidate.report?.executiveAssessment || '').trim();
  const normalized: any = {
    ...(markdownFallback ? {} : candidate),
    summary: summary || 'AI đã hoàn thành phân tích nhưng không trả phần tóm tắt riêng.',
    strengths: Array.isArray(candidate?.strengths) ? candidate.strengths : [],
    weaknesses: Array.isArray(candidate?.weaknesses) ? candidate.weaknesses : [],
    findings: Array.isArray(candidate?.findings) ? candidate.findings : [],
    actions: Array.isArray(candidate?.actions) ? candidate.actions : [],
    listingAudit: Array.isArray(candidate?.listingAudit) ? candidate.listingAudit : [],
  };
  if (requireFullReport) normalized.report = normalizeReport(candidate?.report, normalized.summary);
  return normalized;
}

function tryParseJsonObject(value: string): any | null {
  const trimmed = value.trim();
  const candidates = [
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || '',
    trimmed.includes('{') && trimmed.includes('}') ? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1) : '',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function normalizeReport(value: any, fallbackAssessment: string): any {
  const unavailable = 'Không đủ dữ liệu để đánh giá';
  const report = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...report,
    executiveAssessment: String(report.executiveAssessment || fallbackAssessment || unavailable).slice(0, 30_000),
    metrics: Array.isArray(report.metrics) ? report.metrics : [],
    riskDistribution: Array.isArray(report.riskDistribution) ? report.riskDistribution : [],
    sentiment: report.sentiment && typeof report.sentiment === 'object' ? report.sentiment : { positive: '0', neutral: '0', negative: '0', total: '0', assessment: unavailable },
    immediatePlan: Array.isArray(report.immediatePlan) ? report.immediatePlan : [],
    sellerCapability: report.sellerCapability && typeof report.sellerCapability === 'object' ? report.sellerCapability : { level: unavailable, score: 0, assessment: unavailable, axes: [], roadmap: [] },
    customerCare: report.customerCare && typeof report.customerCare === 'object' ? report.customerCare : { level: unavailable, score: 0, assessment: unavailable, strengths: [], gaps: [], cases: [] },
    operations: report.operations && typeof report.operations === 'object' ? report.operations : { level: unavailable, score: 0, assessment: unavailable, ordersAssessment: unavailable, messagesAssessment: unavailable, cases: [], recommendations: [] },
    reviewInsights: report.reviewInsights && typeof report.reviewInsights === 'object' ? report.reviewInsights : { repeatedIssues: [], praisedThemes: [] },
    adsAudit: Array.isArray(report.adsAudit) ? report.adsAudit : [],
    developmentPlans: Array.isArray(report.developmentPlans) ? report.developmentPlans : [],
  };
}

async function callProvider(provider: Provider, prompt: string, onDelta?: (delta: string) => void, schema: any = analysisSchema, requireFullReport = true, modelOverride = '') {
  if (provider === '9router') return analyzeWith9RouterStream(prompt, onDelta || (() => undefined), schema, requireFullReport, modelOverride);
  return provider === 'anthropic' ? analyzeWithAnthropic(prompt, schema, requireFullReport) : provider === 'openai' ? analyzeWithOpenAI(prompt, schema, requireFullReport) : analyzeWith9Router(prompt, schema, requireFullReport);
}

async function callProviderWithRetry(provider: Provider, prompt: string, onDelta?: (delta: string) => void, schema: any = analysisSchema, requireFullReport = true, modelOverride = '') {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const retryPrompt = attempt === 1 ? prompt : `${prompt}\n\nRETRY ${attempt}/3: Lần trả lời trước bị ngắt. Hãy thực hiện lại đầy đủ batch này từ đầu và kết thúc đúng JSON schema.`;
      if (attempt > 1) onDelta?.(`\n[AI bị ngắt; đang thử lại batch, lần ${attempt}/3]\n`);
      return await callProvider(provider, retryPrompt, onDelta, schema, requireFullReport, modelOverride);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function analyzeAllSources(provider: Provider, run: Record<string, any>, source: { publicPages: any[]; listings: any[]; listingDetails: any[]; reviews: any[]; sellerPages: any[] }, onProgress: (progress: StreamProgress) => Promise<void>, onDelta?: (delta: string) => void, modelOverride = '') {
  const fullPrompt = buildPrompt(run, source.publicPages, source.listings, source.listingDetails, source.reviews, source.sellerPages);
  if (fullPrompt.length <= MAX_PROMPT_CHARS && source.listings.length <= 40) {
    await onProgress(source.listings.length > 0
      ? { current: 1, total: 1, stage: 'analyzing', listingStart: 1, listingEnd: source.listings.length, listingTotal: source.listings.length }
      : { current: 1, total: 1, stage: 'analyzing' });
    const direct = await callProviderWithRetry(provider, fullPrompt, onDelta, analysisSchema, true, modelOverride);
    direct.data.listingAudit = normalizeListingAudit(source.listings, direct.data.listingAudit);
    return { ...direct, batches: 1 };
  }

  const chunks: Array<{ publicPages: any[]; listings: any[]; listingDetails: any[]; reviews: any[]; sellerPages: any[] }> = [];
  const listingChunkSize = 40;
  const reviewChunkSize = 150;
  const count = Math.max(Math.ceil(source.listings.length / listingChunkSize), Math.ceil(source.reviews.length / reviewChunkSize), 1);
  for (let index = 0; index < count; index += 1) {
    chunks.push({
      publicPages: index === 0 ? source.publicPages : [],
      listings: source.listings.slice(index * listingChunkSize, (index + 1) * listingChunkSize),
      listingDetails: source.listingDetails.slice(index * listingChunkSize, (index + 1) * listingChunkSize),
      reviews: source.reviews.slice(index * reviewChunkSize, (index + 1) * reviewChunkSize),
      sellerPages: index === 0 ? source.sellerPages : [],
    });
  }
  const partials: any[] = new Array(chunks.length);
  const auditRowsByChunk: any[][] = new Array(chunks.length);
  let nextChunkIndex = 0;
  let completedChunks = 0;
  const analyzeNextChunk = async () => {
    while (true) {
      const index = nextChunkIndex;
      nextChunkIndex += 1;
      if (index >= chunks.length) return;
      const chunk = chunks[index];
      const prompt = buildPrompt(run, chunk.publicPages, chunk.listings, chunk.listingDetails, chunk.reviews, chunk.sellerPages, `${index + 1}/${chunks.length}`);
      const partial = (await callProviderWithRetry(provider, `${prompt}\n\nBATCH MODE: Chỉ trả summary, strengths, weaknesses, findings, actions và listingAudit theo schema batch. Không tạo report đầy đủ ở bước này; viết ngắn gọn và giữ nguyên mọi listing ID.`, index === 0 ? onDelta : undefined, batchAnalysisSchema, false, modelOverride)).data;
      auditRowsByChunk[index] = normalizeListingAudit(chunk.listings, partial.listingAudit);
      partials[index] = {
        summary: String(partial.summary || '').slice(0, 4_000),
        strengths: Array.isArray(partial.strengths) ? partial.strengths.slice(0, 10) : [],
        weaknesses: Array.isArray(partial.weaknesses) ? partial.weaknesses.slice(0, 10) : [],
        findings: Array.isArray(partial.findings) ? partial.findings.slice(0, 15) : [],
        actions: Array.isArray(partial.actions) ? partial.actions.slice(0, 15) : [],
        listingAudit: [],
      };
      completedChunks += 1;
      await onProgress(source.listings.length > 0
        ? { current: completedChunks, total: chunks.length + 1, stage: 'analyzing-batch', listingStart: index * listingChunkSize + 1, listingEnd: Math.min((index + 1) * listingChunkSize, source.listings.length), listingTotal: source.listings.length }
        : { current: completedChunks, total: chunks.length + 1, stage: 'analyzing-batch' });
    }
  };
  const concurrency = Math.min(3, chunks.length);
  await Promise.all(Array.from({ length: concurrency }, () => analyzeNextChunk()));
  const listingAuditRows = auditRowsByChunk.flat();
  await onProgress({ current: chunks.length + 1, total: chunks.length + 1, stage: 'synthesizing' });
  const synthesisPrompt = `Bạn là chuyên gia audit Etsy. Hợp nhất các kết quả batch dưới đây thành một báo cáo duy nhất theo đúng JSON schema. Chỉ giữ finding có evidence trong batch, gộp trùng lặp, không thêm dữ liệu mới. Trả listingAudit là mảng rỗng vì server sẽ gắn bảng listing đã phân tích theo từng batch. Scope: ${run.scope || 'legacy/full'}. Yêu cầu người dùng: ${String(run.customPrompt || 'Không có').slice(0, 4_000)}. Coverage thực tế: ${JSON.stringify(run.coverage)}.\n\nBATCH RESULTS:\n${JSON.stringify(partials)}`;
  const synthesis = await callProviderWithRetry(provider, synthesisPrompt, onDelta, analysisSchema, true, modelOverride);
  synthesis.data.listingAudit = normalizeListingAudit(source.listings, listingAuditRows);
  return { ...synthesis, batches: chunks.length };
}

function providerEndpoint(baseUrl: string, resource: 'responses' | 'chat/completions'): string {
  const normalized = baseUrl.replace(/\/$/, '');
  return normalized.endsWith('/v1') ? `${normalized}/${resource}` : `${normalized}/v1/${resource}`;
}

function normalizeListingAudit(listings: any[], rows: any[]): any[] {
  const rowById = new Map<string, any>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const listingId = String(row?.listingId || '');
    if (listingId && !rowById.has(listingId)) rowById.set(listingId, row);
  }
  return listings.map((listing, index) => {
    const listingId = String(listing.listingId || listing.id || '');
    const row = rowById.get(listingId) || {};
    const unavailable = 'Không đủ dữ liệu để đánh giá';
    return {
      index: index + 1,
      listingId,
      title: String(listing.title || row.title || ''),
      url: String(listing.url || row.url || ''),
      price: String(listing.price || row.price || 'Không đủ dữ liệu'),
      risk: String(row.risk || unavailable),
      action: String(row.action || unavailable),
      analysis: String(row.analysis || unavailable),
      improvement: String(row.improvement || unavailable),
      evidenceMaterials: String(row.evidenceMaterials || unavailable),
      policyFlags: String(row.policyFlags || 'Không phát hiện từ dữ liệu hiện có'),
      seo: String(row.seo || unavailable),
    };
  });
}

function compactReport(report: any, developmentLimit: number): any {
  if (!report || typeof report !== 'object') return report;
  return {
    ...report,
    metrics: Array.isArray(report.metrics) ? report.metrics.slice(0, 40) : [],
    riskDistribution: Array.isArray(report.riskDistribution) ? report.riskDistribution.slice(0, 10) : [],
    immediatePlan: Array.isArray(report.immediatePlan) ? report.immediatePlan.slice(0, 10) : [],
    sellerCapability: {
      ...(report.sellerCapability || {}),
      axes: Array.isArray(report.sellerCapability?.axes) ? report.sellerCapability.axes.slice(0, 10) : [],
      roadmap: Array.isArray(report.sellerCapability?.roadmap) ? report.sellerCapability.roadmap.slice(0, 5) : [],
    },
    customerCare: {
      ...(report.customerCare || {}),
      strengths: Array.isArray(report.customerCare?.strengths) ? report.customerCare.strengths.slice(0, 15) : [],
      gaps: Array.isArray(report.customerCare?.gaps) ? report.customerCare.gaps.slice(0, 15) : [],
      cases: Array.isArray(report.customerCare?.cases) ? report.customerCare.cases.slice(0, 20) : [],
    },
    operations: {
      ...(report.operations || {}),
      cases: Array.isArray(report.operations?.cases) ? report.operations.cases.slice(0, 20) : [],
      recommendations: Array.isArray(report.operations?.recommendations) ? report.operations.recommendations.slice(0, 20) : [],
    },
    reviewInsights: {
      repeatedIssues: Array.isArray(report.reviewInsights?.repeatedIssues) ? report.reviewInsights.repeatedIssues.slice(0, 20) : [],
      praisedThemes: Array.isArray(report.reviewInsights?.praisedThemes) ? report.reviewInsights.praisedThemes.slice(0, 20) : [],
    },
    adsAudit: Array.isArray(report.adsAudit) ? report.adsAudit.slice(0, 200) : [],
    developmentPlans: Array.isArray(report.developmentPlans) ? report.developmentPlans.slice(0, developmentLimit) : [],
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`AI provider timeout after ${PROVIDER_TIMEOUT_MS / 1000} seconds.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWith9Router(prompt: string, schema = analysisSchema, requireFullReport = true): Promise<{ model: string; data: any }> {
  const apiKey = cleanEnvValue(process.env.NINEROUTER_API_KEY);
  if (!apiKey) throw new Error('Missing NINEROUTER_API_KEY.');
  const baseUrl = (process.env.NINEROUTER_BASE_URL || 'http://13.212.110.229:20128/v1').replace(/\/$/, '');
  const model = cleanEnvValue(process.env.NINEROUTER_EVALUATION_MODEL) || 'cc/claude-fable-5';
  const response = await fetchWithTimeout(providerEndpoint(baseUrl, 'responses'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: 'json_schema', name: requireFullReport ? 'etsy_shop_evaluation' : 'etsy_listing_batch', strict: true, schema } },
    }),
  });
  const body = await response.json();
  if (!response.ok && [404, 405, 501].includes(response.status)) return analyzeWith9RouterChat(prompt, baseUrl, apiKey, model, schema, requireFullReport);
  if (!response.ok) throw new Error(body?.error?.message || `9Router API ${response.status}`);
  const outputText = body.output_text || body.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error('9Router returned no structured output.');
  return { model, data: parseJsonOutput(outputText, requireFullReport) };
}

async function analyzeWith9RouterStream(prompt: string, onDelta: (delta: string) => void, schema = analysisSchema, requireFullReport = true, modelOverride = ''): Promise<{ model: string; data: any }> {
  const apiKey = cleanEnvValue(process.env.NINEROUTER_API_KEY);
  if (!apiKey) throw new Error('Missing NINEROUTER_API_KEY.');
  const baseUrl = (process.env.NINEROUTER_BASE_URL || 'http://13.212.110.229:20128/v1').replace(/\/$/, '');
  const model = cleanEnvValue(modelOverride) || cleanEnvValue(process.env.NINEROUTER_EVALUATION_MODEL) || 'cc/claude-fable-5';
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const totalTimeout = setTimeout(() => controller.abort(), PROVIDER_TOTAL_TIMEOUT_MS);
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  };
  resetTimeout();
  try {
    const response = await fetch(providerEndpoint(baseUrl, 'responses'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: prompt,
        stream: true,
        text: { format: { type: 'json_schema', name: requireFullReport ? 'etsy_shop_evaluation' : 'etsy_listing_batch', strict: true, schema } },
      }),
    });
    if (!response.ok && [404, 405, 501].includes(response.status)) return analyzeWith9RouterChat(prompt, baseUrl, apiKey, model, schema, requireFullReport);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(parseProviderError(errorBody) || `9Router API ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      const body = await response.json();
      const outputText = extractResponseText(body);
      if (!outputText) throw new Error('9Router returned no structured output.');
      onDelta(outputText);
      return { model, data: parseJsonOutput(outputText, requireFullReport) };
    }
    if (!response.body) throw new Error('9Router streaming response has no body.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let outputText = '';
    while (true) {
      const { value, done } = await reader.read();
      resetTimeout();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event: any;
        try { event = JSON.parse(data); } catch { continue; }
        if (event.type === 'response.created') onDelta(`\n[9Router đã nhận request ${event.response?.id || ''}]\n`);
        const outputDelta = extractOutputDelta(event);
        const displayDelta = outputDelta || extractReasoningDelta(event);
        if (outputDelta) outputText += outputDelta;
        if (displayDelta) onDelta(displayDelta);
        if (!outputText && event.type === 'response.completed') outputText = extractResponseText(event.response) || '';
        if (event.type === 'error') throw new Error(event.error?.message || event.message || '9Router stream error.');
      }
    }
    if (buffer.trim()) {
      const data = buffer.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (data && data !== '[DONE]') {
        try {
          const event = JSON.parse(data);
          const outputDelta = extractOutputDelta(event);
          const displayDelta = outputDelta || extractReasoningDelta(event);
          if (outputDelta) outputText += outputDelta;
          if (displayDelta) onDelta(displayDelta);
          if (!outputText) outputText = extractResponseText(event.response || event) || '';
        } catch {}
      }
    }
    if (!outputText) throw new Error('9Router stream completed without output text.');
    return { model, data: parseJsonOutput(outputText, requireFullReport) };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`9Router stream im lặng quá ${PROVIDER_TIMEOUT_MS / 1000} giây.`);
    throw error;
  } finally {
    clearTimeout(timeout!);
    clearTimeout(totalTimeout);
  }
}

function extractOutputDelta(event: any): string {
  if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') return event.delta;
  if (typeof event?.choices?.[0]?.delta?.content === 'string') return event.choices[0].delta.content;
  return '';
}

function extractReasoningDelta(event: any): string {
  if (typeof event?.type === 'string' && event.type.includes('reasoning') && typeof event.delta === 'string') return event.delta;
  if (typeof event?.type === 'string' && event.type.includes('reasoning') && typeof event.delta?.text === 'string') return event.delta.text;
  return '';
}

function extractResponseText(body: any): string {
  return body?.output_text
    || body?.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text
    || body?.choices?.[0]?.message?.content
    || '';
}

function parseProviderError(value: string): string {
  try { const body = JSON.parse(value); return body?.error?.message || body?.message || ''; } catch { return value.slice(0, 500); }
}

async function analyzeWith9RouterChat(prompt: string, baseUrl: string, apiKey: string, model: string, schema = analysisSchema, requireFullReport = true): Promise<{ model: string; data: any }> {
  const response = await fetchWithTimeout(providerEndpoint(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: 'Return only valid JSON matching the supplied schema.' }, { role: 'user', content: `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}` }], response_format: { type: 'json_object' } }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `9Router chat API ${response.status}`);
  const outputText = body.choices?.[0]?.message?.content;
  if (!outputText) throw new Error('9Router chat returned no output.');
  return { model, data: parseJsonOutput(outputText, requireFullReport) };
}
async function analyzeWithOpenAI(prompt: string, schema = analysisSchema, requireFullReport = true): Promise<{ model: string; data: any }> {
  const apiKey = cleanEnvValue(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY.');
  const model = process.env.OPENAI_EVALUATION_MODEL || 'gpt-5.4';
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: requireFullReport ? 'etsy_shop_evaluation' : 'etsy_listing_batch',
          strict: true,
          schema,
        },
      },
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI API ${response.status}`);
  const outputText = body.output_text || body.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error('OpenAI returned no structured output.');
  return { model, data: parseJsonOutput(outputText, requireFullReport) };
}

async function analyzeWithAnthropic(prompt: string, schema = analysisSchema, requireFullReport = true): Promise<{ model: string; data: any }> {
  const apiKey = cleanEnvValue(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY.');
  const model = process.env.ANTHROPIC_EVALUATION_MODEL || 'claude-sonnet-4-5';
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: 'Return only valid JSON matching the requested keys. Do not use markdown fences.',
      messages: [{ role: 'user', content: `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}` }],
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Anthropic API ${response.status}`);
  const outputText = body.content?.find((item: any) => item.type === 'text')?.text;
  if (!outputText) throw new Error('Anthropic returned no output.');
  return { model, data: parseJsonOutput(outputText, requireFullReport) };
}
