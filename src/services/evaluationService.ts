import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { DocumentData, QueryConstraint, QuerySnapshot } from 'firebase/firestore';
import { auth, db } from './firebaseService';
import type { Account, EvaluationAgentPlan, EvaluationCrawlLimits, EvaluationJob, EvaluationListingRow, EvaluationLogEntry, EvaluationRawData, EvaluationRawDocument, EvaluationRun, EvaluationScope, EvaluationTool, EvaluationToolNotes } from '../types';

export const createAgentEvaluationJob = async (
  teamId: string,
  account: Account,
  options: {
    scope: EvaluationScope;
    customPrompt?: string;
    periodDays: number;
    provider: 'anthropic' | '9router';
    model?: string;
    requestedTools: EvaluationTool[];
    crawlLimits: EvaluationCrawlLimits;
    toolNotes: EvaluationToolNotes;
  },
): Promise<{ jobId: string; plan: EvaluationAgentPlan }> => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Bạn cần đăng nhập lại.');
  const response = await fetch('/api/plan-evaluation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      teamId,
      accountId: account.id,
      scope: options.scope,
      prompt: options.customPrompt || '',
      periodDays: options.periodDays,
      provider: options.provider,
      requestedTools: options.requestedTools,
      crawlLimits: options.crawlLimits,
      toolNotes: options.toolNotes,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || 'AI planner failed.');

  const plan = body.plan as EvaluationAgentPlan;
  const publicUrl = `https://www.etsy.com/shop/${account.label.replace(/\s+/g, '')}`;
  const jobRef = await addDoc(collection(db, 'user', teamId, 'evaluation_jobs'), {
    accountId: account.id,
    shopLabel: account.label,
    publicUrl,
    type: 'agent-evaluation',
    workerType: 'seller-extension',
    scope: options.scope,
    customPrompt: options.customPrompt?.trim() || null,
    periodDays: options.periodDays,
    agentPlan: plan,
    requestedTools: options.requestedTools,
    crawlLimits: options.crawlLimits,
    toolNotes: options.toolNotes,
    autoAnalyze: true,
    analysisModel: options.provider === '9router' ? options.model || null : null,
    schemaVersion: 4,
    requestedBy: auth.currentUser?.uid || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return { jobId: jobRef.id, plan };
};

export const createPublicEvaluationJob = async (teamId: string, account: Account): Promise<string> => {
  const publicUrl = `https://www.etsy.com/shop/${account.label.replace(/\s+/g, '')}`;
  const jobRef = await addDoc(collection(db, 'user', teamId, 'evaluation_jobs'), {
    accountId: account.id,
    shopLabel: account.label,
    publicUrl,
    type: 'collect-public-shop',
    workerType: 'seller-extension',
    schemaVersion: 2,
    requestedBy: auth.currentUser?.uid || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return jobRef.id;
};

export const createFullEvaluationJob = async (teamId: string, account: Account, periodDays: number): Promise<string> => {
  const publicUrl = `https://www.etsy.com/shop/${account.label.replace(/\s+/g, '')}`;
  const jobRef = await addDoc(collection(db, 'user', teamId, 'evaluation_jobs'), {
    accountId: account.id, shopLabel: account.label, publicUrl,
    type: 'full-shop-evaluation', workerType: 'seller-extension', periodDays,
    schemaVersion: 2, requestedBy: auth.currentUser?.uid || null,
    status: 'pending', createdAt: serverTimestamp(),
  });
  return jobRef.id;
};

export const listenForEvaluationRuns = (
  teamId: string,
  callback: (runs: EvaluationRun[]) => void,
): (() => void) => {
  const runsQuery = query(
    collection(db, 'user', teamId, 'evaluation_runs'),
    orderBy('createdAt', 'desc'),
    limit(30),
  );
  return onSnapshot(runsQuery, snapshot => {
    callback(snapshot.docs.map(runDoc => ({ id: runDoc.id, ...runDoc.data() } as EvaluationRun)));
  }, error => {
    console.error('Evaluation runs listener failed:', error);
    callback([]);
  });
};

export const listenForEvaluationJobs = (
  teamId: string,
  callback: (jobs: EvaluationJob[]) => void,
): (() => void) => {
  const jobsQuery = query(
    collection(db, 'user', teamId, 'evaluation_jobs'),
    where('status', 'in', ['pending', 'processing', 'failed']),
    limit(50),
  );
  return onSnapshot(jobsQuery, snapshot => {
    callback(snapshot.docs.map(jobDoc => ({ id: jobDoc.id, ...jobDoc.data() } as EvaluationJob)));
  }, error => {
    console.error('Evaluation jobs listener failed:', error);
    callback([]);
  });
};

export const cancelEvaluationJob = async (teamId: string, jobId: string): Promise<void> => {
  await updateDoc(doc(db, 'user', teamId, 'evaluation_jobs', jobId), {
    status: 'cancelled',
    cancelledBy: auth.currentUser?.uid || null,
    cancelledAt: serverTimestamp(),
    completedAt: new Date().toISOString(),
  });
};

export const reconcileEvaluationJob = async (
  teamId: string,
  jobId: string,
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  completedAt?: string,
  error?: string,
): Promise<void> => {
  await updateDoc(doc(db, 'user', teamId, 'evaluation_jobs', jobId), {
    status,
    runId,
    completedAt: completedAt || new Date().toISOString(),
    reconciledAt: serverTimestamp(),
    reconciliationReason: 'Dashboard matched a terminal evaluation run to a stale active job.',
    ...(error ? { error } : {}),
  });
};

export const analyzeEvaluationRun = async (
  teamId: string,
  runId: string,
  provider: 'anthropic' | '9router',
  model: string,
  callbacks?: {
    onStatus?: (status: { stage: string; provider?: string; model?: string }) => void;
    onProgress?: (progress: { current: number; total: number; stage: string; listingStart?: number; listingEnd?: number; listingTotal?: number }) => void;
    onDelta?: (text: string) => void;
  },
) => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Bạn cần đăng nhập lại.');
  const controller = new AbortController();
  let timeout = window.setTimeout(() => controller.abort(), 130_000);
  const resetTimeout = () => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => controller.abort(), 130_000);
  };
  let response: Response;
  try {
    response = await fetch('/api/analyze-evaluation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamId, runId, provider, model, stream: true }), signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('AI không phản hồi trong 130 giây. Có thể bấm phân tích lại sau khi trạng thái chuyển failed hoặc quá 15 phút.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body?.message || 'AI analysis failed.');
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    const body = await response.json();
    return body.analysis;
  }
  resetTimeout();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completedAnalysis: any;
  try {
    while (true) {
      const { value, done } = await reader.read();
      resetTimeout();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const event = block.split(/\r?\n/).find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
        const dataText = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!dataText) continue;
        const data = JSON.parse(dataText);
        if (event === 'status') callbacks?.onStatus?.(data);
        else if (event === 'progress') callbacks?.onProgress?.(data);
        else if (event === 'delta') callbacks?.onDelta?.(String(data.text || ''));
        else if (event === 'complete') completedAnalysis = data.analysis;
        else if (event === 'error') throw new Error(data.message || 'AI stream failed.');
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('AI stream không gửi dữ liệu mới trong 130 giây.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!completedAnalysis) throw new Error('AI stream kết thúc nhưng không có kết quả hoàn chỉnh.');
  return completedAnalysis;
};

export const queueEvaluationAnalysis = async (
  teamId: string,
  run: EvaluationRun,
  provider: 'anthropic' | '9router',
  model: string,
): Promise<string> => {
  const jobRef = await addDoc(collection(db, 'user', teamId, 'evaluation_analysis_jobs'), {
    runId: run.id,
    accountId: run.accountId,
    shopLabel: run.shopLabel,
    provider,
    model: model || null,
    requestedBy: auth.currentUser?.uid || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'user', teamId, 'evaluation_runs', run.id), {
    stage: 'analysis-queued',
    aiLive: { status: 'connecting', text: '', model: model || provider, progress: null, updatedAt: new Date().toISOString(), error: null },
  });
  return jobRef.id;
};

export const collectPublicEvaluationWithoutExtension = async (teamId: string, account: Account) => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Bạn cần đăng nhập lại.');
  const response = await fetch('/api/collect-public-evaluation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ teamId, accountId: account.id, shopLabel: account.label }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || 'Public crawler failed.');
  return body as { runId: string; status: string; listings: number; warnings?: string[] };
};

export const getEvaluationListingRows = async (teamId: string, runId: string): Promise<EvaluationListingRow[]> => {
  const runDocument = doc(db, 'user', teamId, 'evaluation_runs', runId);
  const [listingSnapshot, auditSnapshot] = await Promise.all([
    getDocs(collection(runDocument, 'public_listings')),
    getDocs(collection(runDocument, 'listing_audit')),
  ]);
  const auditById = new Map(auditSnapshot.docs.map(document => [String(document.data().listingId || document.id), document.data()]));
  return listingSnapshot.docs.map(document => {
    const listing = document.data();
    const listingId = String(listing.listingId || document.id);
    const audit = auditById.get(listingId) || {};
    return {
      listingId,
      title: String(listing.title || audit.title || ''),
      url: String(listing.url || audit.url || ''),
      price: String(listing.price || audit.price || '—'),
      imageUrl: listing.imageUrl || null,
      sourcePage: listing.sourcePage,
      firstSeenPage: listing.firstSeenPage,
      risk: audit.risk,
      action: audit.action,
      analysis: audit.analysis,
      improvement: audit.improvement,
      evidenceMaterials: audit.evidenceMaterials,
      policyFlags: audit.policyFlags,
      seo: audit.seo,
    };
  }).sort((left, right) => Number(left.sourcePage ?? left.firstSeenPage ?? 0) - Number(right.sourcePage ?? right.firstSeenPage ?? 0) || left.listingId.localeCompare(right.listingId));
};

export const getEvaluationRawData = async (teamId: string, runId: string): Promise<EvaluationRawData> => {
  const runDocument = doc(db, 'user', teamId, 'evaluation_runs', runId);
  const [listings, publicPagesSnapshot, detailSnapshot, reviewSnapshot, sellerSnapshot, logsSnapshot] = await Promise.all([
    getEvaluationListingRows(teamId, runId),
    getDocs(collection(runDocument, 'public_pages')),
    getDocs(collection(runDocument, 'listing_details')),
    getDocs(collection(runDocument, 'public_reviews')),
    getDocs(collection(runDocument, 'seller_pages')),
    getDocs(query(collection(runDocument, 'logs'), orderBy('timestamp', 'desc'), limit(20))),
  ]);
  const documents = (snapshot: QuerySnapshot<DocumentData>): EvaluationRawDocument[] => snapshot.docs
    .map(document => ({ id: document.id, ...document.data() } as EvaluationRawDocument))
    .sort((left, right) => String(left.pageIndex ?? left.sourcePage ?? left.id).localeCompare(String(right.pageIndex ?? right.sourcePage ?? right.id), undefined, { numeric: true }));
  return {
    publicPages: documents(publicPagesSnapshot),
    listings,
    listingDetails: documents(detailSnapshot),
    reviews: documents(reviewSnapshot),
    sellerPages: documents(sellerSnapshot),
    logs: logsSnapshot.docs
      .map(document => ({ id: document.id, ...document.data() } as EvaluationLogEntry))
      .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || ''))),
  };
};

export const deleteEvaluationRun = async (teamId: string, runId: string) => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Bạn cần đăng nhập lại.');
  const response = await fetch('/api/delete-evaluation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ teamId, runId }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || 'Không xóa được evaluation run.');
  return body;
};

export const deleteAllEvaluationData = async (teamId: string) => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Bạn cần đăng nhập lại.');
  const response = await fetch('/api/delete-evaluation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ teamId, deleteAll: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || 'Không xóa được evaluation data.');
  return body as { jobsDeleted: number; runsDeleted: number };
};

export const listenForEvaluationLogs = (teamId: string, runId: string, callback: (logs: EvaluationLogEntry[]) => void, pageSize = 20): (() => void) => {
  const runDocument = doc(db, 'user', teamId, 'evaluation_runs', runId);
  const logsQuery = query(collection(runDocument, 'logs'), orderBy('timestamp', 'desc'), limit(pageSize));
  return onSnapshot(logsQuery, snapshot => callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() } as EvaluationLogEntry))), error => {
    console.error('Evaluation logs listener failed:', error);
    callback([]);
  });
};

export const getEvaluationLogs = async (teamId: string, runId: string, options: { pageSize?: number; beforeTimestamp?: string } = {}): Promise<{ logs: EvaluationLogEntry[]; hasMore: boolean }> => {
  const runDocument = doc(db, 'user', teamId, 'evaluation_runs', runId);
  const pageSize = Math.max(1, Math.min(100, options.pageSize || 20));
  const constraints: QueryConstraint[] = [orderBy('timestamp', 'desc')];
  if (options.beforeTimestamp) constraints.push(startAfter(options.beforeTimestamp));
  constraints.push(limit(pageSize + 1));
  const snapshot = await getDocs(query(collection(runDocument, 'logs'), ...constraints));
  return {
    logs: snapshot.docs.slice(0, pageSize).map(document => ({ id: document.id, ...document.data() } as EvaluationLogEntry)),
    hasMore: snapshot.docs.length > pageSize,
  };
};
