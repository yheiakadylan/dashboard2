import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../../services/firebaseService';
import type { KpiApprovalStatus, KpiTarget } from '../types';
import { removeUndefinedFields } from '../firestorePayload';
import { getKpiPeriodWindow } from '../kpiProgress';

const getTargetsCollection = (teamId: string) => collection(db, 'user', teamId, 'kpi_targets');
const isLegacyApprovedTarget = (target: KpiTarget) => !target.status && target.active !== false;

const KPI_TARGET_CACHE_MS = 60 * 1000;
const targetHistoryCache = new Map<string, { loadedAt: number; targets: KpiTarget[] }>();
const targetHistoryInflight = new Map<string, Promise<KpiTarget[]>>();

const invalidateKpiTargetCache = (teamId: string) => {
  targetHistoryCache.delete(teamId);
  targetHistoryInflight.delete(teamId);
};

export const fetchKpiTargetHistory = async (teamId: string, forceRefresh = false): Promise<KpiTarget[]> => {
  if (!teamId) return [];
  if (!forceRefresh) {
    const cached = targetHistoryCache.get(teamId);
    if (cached && Date.now() - cached.loadedAt < KPI_TARGET_CACHE_MS) return cached.targets;
    const inflight = targetHistoryInflight.get(teamId);
    if (inflight) return inflight;
  }

  const request = getDocs(getTargetsCollection(teamId)).then(snapshot => {
    const targets = snapshot.docs
      .map(targetDoc => ({ id: targetDoc.id, ...targetDoc.data() } as KpiTarget))
      .sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')));
    targetHistoryCache.set(teamId, { loadedAt: Date.now(), targets });
    return targets;
  });

  if (!forceRefresh) targetHistoryInflight.set(teamId, request);
  try {
    return await request;
  } finally {
    if (!forceRefresh) targetHistoryInflight.delete(teamId);
  }
};

export const fetchKpiTargets = async (teamId: string): Promise<KpiTarget[]> => {
  const targets = await fetchKpiTargetHistory(teamId);
  return targets.filter(target => (
    target.active !== false && (target.status === 'approved' || isLegacyApprovedTarget(target))
  ));
};

export type CreateKpiProposalInput = Omit<
  KpiTarget,
  'id' | 'active' | 'status' | 'version' | 'createdAt' | 'updatedAt' | 'approvedAt' | 'approvedBy' | 'approvedByName' | 'rejectedAt' | 'rejectedBy' | 'rejectedByName' | 'rejectionReason'
>;

export const createKpiProposal = async (teamId: string, input: CreateKpiProposalInput) => {
  if (!input.effectiveFrom || !input.effectiveTo || input.effectiveFrom > input.effectiveTo) {
    throw new Error('Khoảng hiệu lực KPI không hợp lệ.');
  }
  const currentTargets = await fetchKpiTargetHistory(teamId);
  const sameTargetSnapshots = currentTargets.filter(target => (
    target.metricCode === input.metricCode
    && target.scope === input.scope
    && target.scopeId === input.scopeId
  ));
  const latestApproved = sameTargetSnapshots.find(target => target.status === 'approved' && target.active !== false)
    || sameTargetSnapshots.find(isLegacyApprovedTarget);
  const targetRef = doc(getTargetsCollection(teamId));
  const now = new Date().toISOString();
  const payload = removeUndefinedFields<KpiTarget>({
    ...input,
    id: targetRef.id,
    active: false,
    status: 'pending',
    version: Math.max(0, ...sameTargetSnapshots.map(target => Number(target.version || 0))) + 1,
    supersedesId: latestApproved?.id,
    createdAt: now,
    updatedAt: now,
  });
  await setDoc(targetRef, payload);
  invalidateKpiTargetCache(teamId);
  return payload;
};

type Reviewer = { uid: string; name: string };
const getPreviousDate = (dateValue: string) => {
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

export const reviewKpiProposal = async (
  teamId: string,
  proposal: KpiTarget,
  status: Extract<KpiApprovalStatus, 'approved' | 'rejected'>,
  reviewer: Reviewer,
  rejectionReason = ''
) => {
  if (proposal.status !== 'pending') throw new Error('Đề xuất này không còn ở trạng thái chờ duyệt.');
  if (proposal.proposerRole === 'leader' && proposal.createdBy === reviewer.uid) {
    throw new Error('Leader không thể tự duyệt đề xuất của chính mình.');
  }
  if (status === 'rejected' && !rejectionReason.trim()) {
    throw new Error('Từ chối KPI bắt buộc phải nhập lý do.');
  }

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  if (status === 'approved') {
    const requestedEffectiveTo = proposal.effectiveTo || getKpiPeriodWindow(proposal.period, proposal.effectiveFrom).to;
    if (proposal.effectiveFrom > requestedEffectiveTo) {
      throw new Error('Khoảng hiệu lực KPI không hợp lệ.');
    }
    const history = await fetchKpiTargetHistory(teamId);
    const sameTargetSnapshots = history.filter(target => (
      target.id !== proposal.id
      && target.metricCode === proposal.metricCode
      && target.scope === proposal.scope
      && target.scopeId === proposal.scopeId
      && (target.status === 'approved' || isLegacyApprovedTarget(target))
    ));
    const nextSnapshot = sameTargetSnapshots
      .filter(target => target.active !== false && target.effectiveFrom > proposal.effectiveFrom)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
    const nextSnapshotBoundary = nextSnapshot ? getPreviousDate(nextSnapshot.effectiveFrom) : null;
    const proposalEffectiveTo = nextSnapshotBoundary && nextSnapshotBoundary < requestedEffectiveTo
      ? nextSnapshotBoundary
      : requestedEffectiveTo;

    sameTargetSnapshots
      .filter(target => (
        target.active !== false
        && target.effectiveFrom <= proposal.effectiveFrom
        && (!target.effectiveTo || target.effectiveTo >= proposal.effectiveFrom)
      ))
      .forEach(target => {
        const replacesSamePeriod = target.effectiveFrom === proposal.effectiveFrom;
        batch.update(doc(getTargetsCollection(teamId), target.id), replacesSamePeriod ? {
          active: false,
          supersededById: proposal.id,
          updatedAt: now,
        } : {
          active: true,
          effectiveTo: getPreviousDate(proposal.effectiveFrom),
          supersededById: proposal.id,
          updatedAt: now,
        });
      });

    batch.update(doc(getTargetsCollection(teamId), proposal.id), {
      status,
      active: true,
      effectiveTo: proposalEffectiveTo,
      approvedAt: now,
      approvedBy: reviewer.uid,
      approvedByName: reviewer.name,
      updatedAt: now,
    });
    await batch.commit();
    invalidateKpiTargetCache(teamId);
    return;
  }

  batch.update(doc(getTargetsCollection(teamId), proposal.id), {
    status,
    active: false,
    rejectedAt: now,
    rejectedBy: reviewer.uid,
    rejectedByName: reviewer.name,
    rejectionReason: rejectionReason.trim(),
    updatedAt: now,
  });

  await batch.commit();
  invalidateKpiTargetCache(teamId);
};

// Kept for safe cleanup of accidental pending drafts; approved snapshots should never be deleted.
export const deleteKpiTarget = async (teamId: string, target: KpiTarget) => {
  if (target.status === 'approved' || isLegacyApprovedTarget(target)) {
    throw new Error('Không thể xóa snapshot KPI đã duyệt.');
  }
  await deleteDoc(doc(getTargetsCollection(teamId), target.id));
  invalidateKpiTargetCache(teamId);
};
