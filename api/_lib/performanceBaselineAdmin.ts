import type { DocumentData, Firestore, Query } from 'firebase-admin/firestore';

export const PERFORMANCE_BASELINE_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const PERFORMANCE_BASELINE_CALCULATION_VERSION = 3;

const RUN_LEASE_MS = 15 * 60 * 1000;
const SUPPORT_COMPLETED_STATUSES = new Set(['new', 'doing', 'preview', 'in_review', 'need_fix', 'done', 'archived']);
const SECTION_BY_ROLE: Record<string, PerformanceBaselineSectionId> = {
  DS_IDEA: 'designer-idea',
  LEADDS_IDEA: 'designer-idea',
  DS_FULFILL: 'designer-fulfillment',
  LEADDS_FULFILL: 'designer-fulfillment',
  IDEA_RD: 'research-development',
  LEADIDEA_RD: 'research-development',
  IDEA_SCALE: 'scale',
  LEADIDEA_SCALE: 'scale',
};
const DESIGNER_SECTIONS = new Set<PerformanceBaselineSectionId>(['designer-idea', 'designer-fulfillment']);
const LISTING_SECTIONS = new Set<PerformanceBaselineSectionId>(['research-development', 'scale']);
const BASELINE_SECTIONS = new Set<PerformanceBaselineSectionId>([
  ...DESIGNER_SECTIONS,
  ...LISTING_SECTIONS,
  'customer-service',
  'fulfillment',
]);
const SUPPORT_ROLES = new Set(['CS_SUPPORT', 'LEADCS_SUPPORT']);
const FULFILLMENT_ROLES = new Set(['CS_FULFILL', 'LEADCS_FULFILL']);
const UNIT_BY_SECTION: Record<PerformanceBaselineSectionId, string> = {
  'designer-idea': 'points',
  'designer-fulfillment': 'points',
  'research-development': 'listings',
  scale: 'listings',
  'customer-service': 'orders',
  fulfillment: 'orders',
};

export type PerformanceBaselineSectionId =
  | 'designer-idea'
  | 'designer-fulfillment'
  | 'research-development'
  | 'scale'
  | 'customer-service'
  | 'fulfillment';

export interface PerformanceBaselineRange {
  from: string;
  to: string;
  quarterLabel: string;
}

export interface RefreshPerformanceBaselineOptions {
  teamId: string;
  rangeFrom?: string;
  rangeTo?: string;
  anchorDate?: Date;
  dryRun?: boolean;
  force?: boolean;
  finalize?: boolean;
  trigger?: 'cron' | 'cli' | 'manual';
}

interface EmployeeProfile {
  uid: string;
  empID: string;
  name: string;
  email: string;
  role: string;
}

interface BaselineBucket {
  sectionId: PerformanceBaselineSectionId;
  employeeId: string;
  employeeEmpID: string;
  employeeName: string;
  employeeRole: string;
  granularity: 'monthly';
  periodKey: string;
  outputTotal: number;
  outputCount: number;
  unit: string;
}

interface SourceStats {
  taskDesignerDocuments: number;
  taskSupportDocuments: number;
  taskSupportFallbackDocuments: number;
  taskFulfillmentDocuments: number;
  ideaDocuments: number;
  listingDocuments: number;
  mappedOutputs: number;
  unmatchedEmployee: number;
  missingDate: number;
  zeroOutput: number;
  roleMismatch: number;
  outOfRange: number;
}

export interface RefreshPerformanceBaselineResult {
  status: 'completed' | 'dry-run' | 'skipped';
  reason?: 'already-running' | 'finalized';
  teamId: string;
  rangeFrom: string;
  rangeTo: string;
  quarterLabel: string;
  runId: string;
  bucketCount: number;
  deletedCount: number;
  finalized: boolean;
  stats: SourceStats;
  summaries: Record<string, { documents: number; outputTotal: number; outputCount: number }>;
}

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeRole = (value: unknown) => String(value || '').trim().toUpperCase();
const safeDocumentPart = (value: unknown) => String(value || '').replace(/[^A-Za-z0-9_-]/g, '_');
const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'number') {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateKey = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PERFORMANCE_BASELINE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const getNextDateKey = (dateValue: string) => {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const buildVietnamIsoRange = (from: string, to: string) => ({
  fromISO: new Date(`${from}T00:00:00+07:00`).toISOString(),
  toExclusiveISO: new Date(`${getNextDateKey(to)}T00:00:00+07:00`).toISOString(),
});

const getQuarterLabel = (from: string) => {
  const [year, month] = from.split('-').map(Number);
  return `Q${Math.floor((month - 1) / 3) + 1}/${year}`;
};

export const getPreviousPerformanceQuarterRange = (anchorDate = new Date()): PerformanceBaselineRange => {
  const anchorKey = toDateKey(anchorDate);
  const [anchorYear, anchorMonth] = anchorKey.split('-').map(Number);
  const currentQuarterIndex = Math.floor((anchorMonth - 1) / 3);
  const previousQuarterIndex = currentQuarterIndex === 0 ? 3 : currentQuarterIndex - 1;
  const year = currentQuarterIndex === 0 ? anchorYear - 1 : anchorYear;
  const startMonth = previousQuarterIndex * 3;
  const from = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { from, to, quarterLabel: `Q${previousQuarterIndex + 1}/${year}` };
};

export const getPerformanceBaselineRunDocumentId = (rangeFrom: string, rangeTo: string) => (
  `_run__${rangeFrom}__${rangeTo}`
);

const validateRange = (rangeFrom: string, rangeTo: string) => {
  if (!isDateKey(rangeFrom) || !isDateKey(rangeTo) || rangeFrom > rangeTo) {
    throw new Error('Invalid baseline range. Use YYYY-MM-DD and ensure from <= to.');
  }
};

const getTemplateIds = (value: unknown) => {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))];
};

const resolveTaskPoints = (task: DocumentData, board: 'idea' | 'fulfill', configuredPoints: Map<string, number>) => {
  const snapshot = Number(task.templatePointsSnapshot ?? task.template_points_snapshot);
  if (Number.isFinite(snapshot) && snapshot >= 0) return snapshot;
  const templateIds = getTemplateIds(task.templateId);
  if (!templateIds.length) return 0;
  const fallback = board === 'idea' ? 3 : 1;
  return templateIds.reduce((sum, templateId) => {
    const configured = configuredPoints.get(templateId);
    return sum + (Number.isFinite(configured) && configured >= 0 ? configured : fallback);
  }, 0);
};

const isActiveListing = (listing: DocumentData) => (
  listing.state === 0 || String(listing.state || '').trim().toLowerCase() === 'active'
);

const getListingEmployeeKeys = (listing: DocumentData) => {
  const sku = String(listing.sku || '').trim();
  return [listing.employee_id, sku.split('-')[1]];
};

const getOrderKey = (id: string, task: DocumentData) => String(task.orderId || task.taskId || id).trim();

const queryDateRange = async (
  baseQuery: Query<DocumentData>,
  field: string,
  fromValue: string,
  toExclusiveValue: string,
  fields: string[],
) => baseQuery.where(field, '>=', fromValue).where(field, '<', toExclusiveValue).select(...fields).get();

const commitInChunks = async <T>(
  db: Firestore,
  items: T[],
  applyOperation: (batch: FirebaseFirestore.WriteBatch, item: T) => void,
) => {
  for (let offset = 0; offset < items.length; offset += 400) {
    const batch = db.batch();
    items.slice(offset, offset + 400).forEach(item => applyOperation(batch, item));
    await batch.commit();
  }
};

export const refreshPerformanceBaseline = async (
  db: Firestore,
  options: RefreshPerformanceBaselineOptions,
): Promise<RefreshPerformanceBaselineResult> => {
  const defaultRange = getPreviousPerformanceQuarterRange(options.anchorDate);
  const rangeFrom = options.rangeFrom || defaultRange.from;
  const rangeTo = options.rangeTo || defaultRange.to;
  validateRange(rangeFrom, rangeTo);

  const teamId = String(options.teamId || '').trim();
  if (!teamId) throw new Error('Missing teamId.');

  const quarterLabel = getQuarterLabel(rangeFrom);
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const trigger = options.trigger || 'manual';
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const collectionRef = db.collection('user').doc(teamId).collection('performance_baseline_buckets');
  const runRef = collectionRef.doc(getPerformanceBaselineRunDocumentId(rangeFrom, rangeTo));
  let wasFinalized = false;

  if (!dryRun) {
    const lockResult = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(runRef);
      const data = snapshot.data() || {};
      const now = new Date();
      const leaseExpiresAt = toDate(data.leaseExpiresAt);
      const finalized = data.status === 'finalized' || data.finalized === true;
      if (finalized && !force) return { acquired: false as const, reason: 'finalized' as const, finalized };
      if (data.status === 'running' && leaseExpiresAt && leaseExpiresAt.getTime() > now.getTime() && !force) {
        return { acquired: false as const, reason: 'already-running' as const, finalized };
      }

      const nowISO = now.toISOString();
      transaction.set(runRef, {
        documentType: 'performance_baseline_run',
        teamId,
        rangeFrom,
        rangeTo,
        quarterLabel,
        timeZone: PERFORMANCE_BASELINE_TIME_ZONE,
        calculationVersion: PERFORMANCE_BASELINE_CALCULATION_VERSION,
        status: 'running',
        finalized,
        runId,
        trigger,
        startedAt: nowISO,
        lastAttemptAt: nowISO,
        leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS).toISOString(),
        lastError: null,
      }, { merge: true });
      return { acquired: true as const, finalized };
    });

    wasFinalized = lockResult.finalized;
    if (!lockResult.acquired) {
      return {
        status: 'skipped',
        reason: lockResult.reason,
        teamId,
        rangeFrom,
        rangeTo,
        quarterLabel,
        runId,
        bucketCount: 0,
        deletedCount: 0,
        finalized: lockResult.finalized,
        stats: {
          taskDesignerDocuments: 0,
          taskSupportDocuments: 0,
          taskSupportFallbackDocuments: 0,
          taskFulfillmentDocuments: 0,
          ideaDocuments: 0,
          listingDocuments: 0,
          mappedOutputs: 0,
          unmatchedEmployee: 0,
          missingDate: 0,
          zeroOutput: 0,
          roleMismatch: 0,
          outOfRange: 0,
        },
        summaries: {},
      };
    }
  }

  const stats: SourceStats = {
    taskDesignerDocuments: 0,
    taskSupportDocuments: 0,
    taskSupportFallbackDocuments: 0,
    taskFulfillmentDocuments: 0,
    ideaDocuments: 0,
    listingDocuments: 0,
    mappedOutputs: 0,
    unmatchedEmployee: 0,
    missingDate: 0,
    zeroOutput: 0,
    roleMismatch: 0,
    outOfRange: 0,
  };

  try {
    const authenticationSnapshot = await db.collection('authentication').get();
    const profiles = new Map<string, EmployeeProfile>();
    const employeeIdByIdentity = new Map<string, string>();
    authenticationSnapshot.docs.forEach(profileDoc => {
      if (profileDoc.id === '_settings') return;
      const data = profileDoc.data();
      if (data.teamId && data.teamId !== teamId) return;
      if (data.active === false || data.isActive === false) return;
      const profile: EmployeeProfile = {
        uid: profileDoc.id,
        empID: String(data.empID || ''),
        name: String(data.displayName || data.fullName || data.email || profileDoc.id),
        email: String(data.email || ''),
        role: normalizeRole(data.role),
      };
      profiles.set(profile.uid, profile);
      [profile.uid, profile.empID, profile.name, profile.email, data.fullName, data.displayName]
        .map(normalize)
        .filter(Boolean)
        .forEach(identity => employeeIdByIdentity.set(identity, profile.uid));
    });

    const resolveProfile = (keys: unknown[]) => {
      const identity = keys.map(normalize).find(key => employeeIdByIdentity.has(key));
      return identity ? profiles.get(employeeIdByIdentity.get(identity) || '') || null : null;
    };

    const resolveProfileForRoles = (keys: unknown[], allowedRoles: Set<string>) => {
      const profile = resolveProfile(keys);
      if (!profile || allowedRoles.has(profile.role)) return profile;
      stats.roleMismatch += 1;
      return null;
    };

    const templatesSnapshot = await db.collection('settings').doc('templates').get();
    const configuredTemplatePoints = new Map<string, number>();
    if (templatesSnapshot.exists) {
      Object.entries(templatesSnapshot.data() || {}).forEach(([templateId, template]) => {
        const points = Number((template as DocumentData)?.points);
        if (Number.isFinite(points) && points >= 0) configuredTemplatePoints.set(templateId, points);
      });
    }

    const buckets = new Map<string, BaselineBucket>();
    const seenSources = new Set<string>();
    const supportOrderOutputs = new Map<string, { profile: EmployeeProfile; date: Date; sourceKey: string }>();
    const fulfillmentOrderOutputs = new Map<string, { profile: EmployeeProfile; date: Date; sourceKey: string }>();

    const collectOrderOutput = (
      outputs: Map<string, { profile: EmployeeProfile; date: Date; sourceKey: string }>,
      profile: EmployeeProfile | null,
      dateValue: unknown,
      sourceKey: string,
      useLatest: boolean,
    ) => {
      if (!profile) {
        stats.unmatchedEmployee += 1;
        return;
      }
      const date = toDate(dateValue);
      if (!date) {
        stats.missingDate += 1;
        return;
      }
      const key = `${profile.uid}:${sourceKey}`;
      const current = outputs.get(key);
      if (!current || (useLatest ? date > current.date : date < current.date)) {
        outputs.set(key, { profile, date, sourceKey });
      }
    };

    const addBucketValue = ({
      sectionId,
      profile,
      dateValue,
      output,
      sourceKey,
    }: {
      sectionId: PerformanceBaselineSectionId;
      profile: EmployeeProfile | null;
      dateValue: unknown;
      output: number;
      sourceKey: string;
    }) => {
      const dateKey = toDateKey(dateValue);
      if (!dateKey) {
        stats.missingDate += 1;
        return;
      }
      if (dateKey < rangeFrom || dateKey > rangeTo) {
        stats.outOfRange += 1;
        return;
      }
      if (!profile) {
        stats.unmatchedEmployee += 1;
        return;
      }
      if (!Number.isFinite(output) || output <= 0) {
        stats.zeroOutput += 1;
        return;
      }
      const dedupeKey = `${sectionId}:${profile.uid}:${dateKey}:${sourceKey}`;
      if (seenSources.has(dedupeKey)) return;
      seenSources.add(dedupeKey);
      stats.mappedOutputs += 1;

      const periodKey = dateKey.slice(0, 7);
      const key = `${sectionId}__monthly__${periodKey}__${safeDocumentPart(profile.uid)}`;
      const current = buckets.get(key) || {
        sectionId,
        employeeId: profile.uid,
        employeeEmpID: profile.empID,
        employeeName: profile.name,
        employeeRole: profile.role,
        granularity: 'monthly' as const,
        periodKey,
        outputTotal: 0,
        outputCount: 0,
        unit: UNIT_BY_SECTION[sectionId],
      };
      current.outputTotal += output;
      current.outputCount += 1;
      buckets.set(key, current);
    };

    const { fromISO, toExclusiveISO } = buildVietnamIsoRange(rangeFrom, rangeTo);
    const taskCollection = db.collection('tasks');
    const ideaCollection = db.collection('ideas');
    const listingCollection = db.collection('user').doc(teamId).collection('listings');

    const [designerTaskSnapshot, supportTaskSnapshot, supportFallbackSnapshot, fulfillmentTaskSnapshot, ideaSnapshot, listingSnapshot] = await Promise.all([
      queryDateRange(taskCollection, 'design_submitted_at', fromISO, toExclusiveISO, [
        'designerId', 'designerName', 'templateId', 'templatePointsSnapshot', 'template_points_snapshot', 'design_submitted_at',
      ]),
      queryDateRange(taskCollection, 'submitted_to_new_at', fromISO, toExclusiveISO, [
        'orderId', 'taskId', 'submitted_to_new_at', 'submitted_to_new_by', 'cs_id', 'createdBy',
      ]),
      queryDateRange(taskCollection, 'created_at', fromISO, toExclusiveISO, [
        'orderId', 'taskId', 'status', 'created_at', 'submitted_to_new_at', 'submitted_to_new_by', 'cs_id', 'createdBy',
      ]),
      queryDateRange(taskCollection, 'fulfilled_at', fromISO, toExclusiveISO, [
        'orderId', 'taskId', 'status', 'fulfilled_at', 'fulfilled_by', 'cs_id', 'createdBy',
      ]),
      queryDateRange(ideaCollection, 'design_submitted_at', fromISO, toExclusiveISO, [
        'designerId', 'designerName', 'templateId', 'templatePointsSnapshot', 'template_points_snapshot', 'design_submitted_at',
      ]),
      queryDateRange(listingCollection, 'create_date', rangeFrom, getNextDateKey(rangeTo), [
        'employee_id', 'sku', 'state', 'create_date',
      ]),
    ]);

    stats.taskDesignerDocuments = designerTaskSnapshot.size;
    stats.taskSupportDocuments = supportTaskSnapshot.size;
    stats.taskSupportFallbackDocuments = supportFallbackSnapshot.size;
    stats.taskFulfillmentDocuments = fulfillmentTaskSnapshot.size;
    stats.ideaDocuments = ideaSnapshot.size;
    stats.listingDocuments = listingSnapshot.size;

    designerTaskSnapshot.docs.forEach(taskDoc => {
      const task = taskDoc.data();
      const profile = resolveProfile([task.designerId, task.designerName]);
      const sectionId = profile ? SECTION_BY_ROLE[profile.role] : null;
      if (!sectionId || !DESIGNER_SECTIONS.has(sectionId)) {
        stats.unmatchedEmployee += 1;
        return;
      }
      addBucketValue({
        sectionId,
        profile,
        dateValue: task.design_submitted_at,
        output: resolveTaskPoints(task, 'fulfill', configuredTemplatePoints),
        sourceKey: `task:${taskDoc.id}`,
      });
    });

    ideaSnapshot.docs.forEach(ideaDoc => {
      const idea = ideaDoc.data();
      const profile = resolveProfile([idea.designerId, idea.designerName]);
      const sectionId = profile ? SECTION_BY_ROLE[profile.role] : null;
      if (!sectionId || !DESIGNER_SECTIONS.has(sectionId)) {
        stats.unmatchedEmployee += 1;
        return;
      }
      addBucketValue({
        sectionId,
        profile,
        dateValue: idea.design_submitted_at,
        output: resolveTaskPoints(idea, 'idea', configuredTemplatePoints),
        sourceKey: `idea:${ideaDoc.id}`,
      });
    });

    supportTaskSnapshot.docs.forEach(taskDoc => {
      const task = taskDoc.data();
      collectOrderOutput(
        supportOrderOutputs,
        resolveProfileForRoles([task.submitted_to_new_by, task.cs_id, task.createdBy], SUPPORT_ROLES),
        task.submitted_to_new_at,
        `order:${getOrderKey(taskDoc.id, task)}`,
        false,
      );
    });

    supportFallbackSnapshot.docs.forEach(taskDoc => {
      const task = taskDoc.data();
      if (task.submitted_to_new_at || !SUPPORT_COMPLETED_STATUSES.has(String(task.status || '').toLowerCase())) return;
      collectOrderOutput(
        supportOrderOutputs,
        resolveProfileForRoles([task.submitted_to_new_by, task.cs_id, task.createdBy], SUPPORT_ROLES),
        task.created_at,
        `order:${getOrderKey(taskDoc.id, task)}`,
        false,
      );
    });

    fulfillmentTaskSnapshot.docs.forEach(taskDoc => {
      const task = taskDoc.data();
      if (String(task.status || '').trim().toLowerCase() !== 'done') return;
      collectOrderOutput(
        fulfillmentOrderOutputs,
        resolveProfileForRoles([task.fulfilled_by, ...(task.fulfilled_by ? [] : [task.cs_id, task.createdBy])], FULFILLMENT_ROLES),
        task.fulfilled_at,
        `order:${getOrderKey(taskDoc.id, task)}`,
        true,
      );
    });

    supportOrderOutputs.forEach(output => addBucketValue({
      sectionId: 'customer-service',
      profile: output.profile,
      dateValue: output.date,
      output: 1,
      sourceKey: output.sourceKey,
    }));

    fulfillmentOrderOutputs.forEach(output => addBucketValue({
      sectionId: 'fulfillment',
      profile: output.profile,
      dateValue: output.date,
      output: 1,
      sourceKey: output.sourceKey,
    }));

    listingSnapshot.docs.forEach(listingDoc => {
      const listing = listingDoc.data();
      if (!isActiveListing(listing)) return;
      const profile = resolveProfile(getListingEmployeeKeys(listing));
      const sectionId = profile ? SECTION_BY_ROLE[profile.role] : null;
      if (!sectionId || !LISTING_SECTIONS.has(sectionId)) {
        stats.unmatchedEmployee += 1;
        return;
      }
      addBucketValue({
        sectionId,
        profile,
        dateValue: listing.create_date,
        output: 1,
        sourceKey: `listing:${listingDoc.id}`,
      });
    });

    const summaries: RefreshPerformanceBaselineResult['summaries'] = {};
    buckets.forEach(bucket => {
      const summary = summaries[bucket.sectionId] || { documents: 0, outputTotal: 0, outputCount: 0 };
      summary.documents += 1;
      summary.outputTotal += bucket.outputTotal;
      summary.outputCount += bucket.outputCount;
      summaries[bucket.sectionId] = summary;
    });

    let deletedCount = 0;
    const finalized = options.finalize === true || wasFinalized;
    if (!dryRun) {
      const now = new Date().toISOString();
      await commitInChunks(db, [...buckets.entries()], (batch, [documentId, bucket]) => {
        batch.set(collectionRef.doc(documentId), {
          ...bucket,
          outputTotal: Math.round(bucket.outputTotal * 10) / 10,
          rangeFrom,
          rangeTo,
          quarterLabel,
          calculationVersion: PERFORMANCE_BASELINE_CALCULATION_VERSION,
          timeZone: PERFORMANCE_BASELINE_TIME_ZONE,
          updatedAt: now,
          runId,
        });
      });

      const fromMonth = rangeFrom.slice(0, 7);
      const toMonth = rangeTo.slice(0, 7);
      const existingRefs = await collectionRef.listDocuments();
      const staleRefs = existingRefs.filter(existingRef => {
        const [sectionId, granularity, periodKey] = existingRef.id.split('__');
        return BASELINE_SECTIONS.has(sectionId as PerformanceBaselineSectionId)
          && granularity === 'monthly'
          && periodKey >= fromMonth
          && periodKey <= toMonth
          && !buckets.has(existingRef.id);
      });
      await commitInChunks(db, staleRefs, (batch, staleRef) => batch.delete(staleRef));
      deletedCount = staleRefs.length;

      await runRef.set({
        documentType: 'performance_baseline_run',
        teamId,
        rangeFrom,
        rangeTo,
        quarterLabel,
        timeZone: PERFORMANCE_BASELINE_TIME_ZONE,
        calculationVersion: PERFORMANCE_BASELINE_CALCULATION_VERSION,
        status: finalized ? 'finalized' : 'ready',
        finalized,
        finalizedAt: finalized ? now : null,
        runId,
        trigger,
        completedAt: now,
        updatedAt: now,
        leaseExpiresAt: null,
        bucketCount: buckets.size,
        deletedCount,
        stats,
        summaries,
        lastError: null,
      }, { merge: true });
    }

    return {
      status: dryRun ? 'dry-run' : 'completed',
      teamId,
      rangeFrom,
      rangeTo,
      quarterLabel,
      runId,
      bucketCount: buckets.size,
      deletedCount,
      finalized,
      stats,
      summaries,
    };
  } catch (error) {
    if (!dryRun) {
      const failedAt = new Date().toISOString();
      await runRef.set({
        status: 'failed',
        finalized: wasFinalized,
        runId,
        trigger,
        failedAt,
        updatedAt: failedAt,
        leaseExpiresAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      }, { merge: true }).catch(statusError => {
        console.error('[performance-baseline] Could not store failed status:', statusError);
      });
    }
    throw error;
  }
};
