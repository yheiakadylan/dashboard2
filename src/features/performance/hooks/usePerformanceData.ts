import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDashboardAccess } from '../../../contexts/DashboardContext';
import { useUIFilters } from '../../../contexts/UIContext';
import {
  buildIsoRangeForTimezone,
    fetchOperationReportData,
    fetchFulfillmentRecordsForTasks,
    fetchReportRecords,
  fetchReportReviews,
  fetchSupplierMappingsForTasks,
  normalizeDateValue,
  OPERATION_TEMPLATE_POINT_CHANGE_EVENT,
  type OperationTemplatePointChange,
  type OperationReportData,
  type OperationReportProfile,
  type OperationTask,
  type ReportOrderRecord,
  type ReportReview,
  type ReportSkuMapping,
} from '../../../services/reportService';
import { DESIGNER_POINT_RULES, mockMetric } from '../config';
import { createConfiguredTemplatePointMap, resolveDesignerTaskPoints } from '../designerPoints';
import { getPrimaryKpiDefinition } from '../kpiTargets';
import { buildListingSaleObservationIndex, calculateListingCohortStats } from '../listingCohorts';
import { calculateKpiProgress, getEffectiveKpiPeriodWindow } from '../kpiProgress';
import { fetchKpiTargets } from '../services/kpiTargetService';
import { fetchPerformanceCalendar } from '../services/performanceCalendarService';
import {
  fetchPerformanceBaselineAggregate,
  type PerformanceBaselineAggregate,
} from '../services/performanceBaselineService';
import {
  calculateBusinessHours,
  DEFAULT_PERFORMANCE_CALENDAR,
  type PerformanceCalendarSettings,
} from '../businessCalendar';
import { buildPerformanceMetricHelp } from '../metricHelp';
import { buildAccountLabelMap, getAccountShopIdentifiers } from '../../../utils/accountLabels';
import { decodeHTMLEntities } from '../../../utils/htmlDecode';
import { calculateItemNetRevenue, getOrderItemRevenueContext } from '../../../utils/revenueUtils';
import type { Account, PODTeam } from '../../../types';
import type { EmployeeKpiBaselineSeries } from '../baseline';
import type {
  CompanyOverviewChartData,
  EmployeePerformanceRow,
  DesignerPointDataQuality,
  KpiTarget,
  PerformanceAccessLevel,
  PerformanceBreakdownItem,
  PerformanceMetric,
  PerformanceSectionId,
} from '../types';

const EMPTY_OPERATION_DATA: OperationReportData = {
  tasksCreated: [],
  tasksSubmittedToNew: [],
  tasksAssigned: [],
  tasksDesignSubmitted: [],
  tasksFulfilled: [],
  ideasCreated: [],
  ideasAssigned: [],
  ideasDesignSubmitted: [],
  ideasCompleted: [],
  ideasMatchedToSales: [],
  listings: [],
  listingsMatchedToSales: [],
  users: [],
  templates: [],
};

const getOperationReportProfile = (section: PerformanceSectionId): OperationReportProfile => {
  switch (section) {
    case 'company-overview': return 'company-overview';
    case 'designer-idea': return 'designer-idea';
    case 'designer-fulfillment': return 'designer-fulfillment';
    case 'research-development':
    case 'scale': return 'listing';
    case 'customer-service': return 'customer-service';
    case 'fulfillment': return 'fulfillment';
    default: return 'full';
  }
};

const getKpiProgressReportProfile = (section: PerformanceSectionId): OperationReportProfile => {
  switch (section) {
    case 'designer-idea':
    case 'designer-fulfillment': return 'designer-kpi';
    case 'research-development':
    case 'scale': return 'listing';
    case 'customer-service': return 'customer-service';
    case 'fulfillment': return 'fulfillment-kpi';
    default: return 'full';
  }
};

const realMetric = (metric: Omit<PerformanceMetric, 'source' | 'change'>): PerformanceMetric => ({
  ...metric,
  change: 0,
  source: 'real',
  comparisonAvailable: false,
});
const unavailableMetric = (code: string, label: string, target = 'Cần bổ sung dữ liệu') => mockMetric({ code, label, value: '—', target, progress: 0, change: 0, tone: 'gray' });
const INVALID_SKUS = new Set(['', '-', 'NULL', 'NULL_RATE_LIMIT']);
const normalizeSku = (sku?: string | null) => {
  const normalized = decodeHTMLEntities(String(sku || '').trim()).toUpperCase();
  return INVALID_SKUS.has(normalized) ? '' : normalized;
};
const getEmployeeIdFromSku = (sku?: string | null) => normalizeSku(sku).split('-')[1]?.trim().toLowerCase() || '';
const isActiveListing = (listing: PerformanceListing) => (
  listing.state === 0 || String(listing.state || '').trim().toLowerCase() === 'active'
);
const parseFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const formatRatingDelta = (value: number | null) => {
  if (value === null) return 'Chưa so sánh';
  if (Math.abs(value) < 0.005) return 'Không đổi';
  return `${value > 0 ? 'Tăng' : 'Giảm'} ${Math.abs(value).toFixed(2)}`;
};
const formatUsd = (value: number) => `$${new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value)}`;
type PerformanceListing = OperationReportData['listings'][number];

type PODPerformanceScope = {
  memberIds: Set<string>;
  memberIdentityKeys: Set<string>;
  accountKeys: Set<string>;
  keepAllUsers?: boolean;
};

const normalizeScopeKey = (value: unknown) => String(value || '').trim().toLowerCase();

const buildPODPerformanceScope = (
  team: PODTeam,
  accounts: Account[],
  users: OperationReportData['users'],
): PODPerformanceScope => {
  const memberIds = new Set(team.memberIds.map(normalizeScopeKey).filter(Boolean));
  const memberIdentityKeys = new Set(users
    .filter(operationUser => memberIds.has(normalizeScopeKey(operationUser.uid)))
    .flatMap(operationUser => [
      operationUser.uid,
      operationUser.empID,
      operationUser.email,
      operationUser.fullName,
      operationUser.displayName,
    ].map(normalizeScopeKey).filter(Boolean)));
  const allowedAccountEmails = new Set(team.allowedAccounts.map(normalizeScopeKey).filter(Boolean));
  const accountKeys = new Set<string>(allowedAccountEmails);
  accounts
    .filter(account => allowedAccountEmails.has(normalizeScopeKey(account.email)))
    .flatMap(getAccountShopIdentifiers)
    .map(normalizeScopeKey)
    .filter(Boolean)
    .forEach(key => accountKeys.add(key));

  return { memberIds, memberIdentityKeys, accountKeys };
};

const buildAccountPerformanceScope = (accounts: Account[]): PODPerformanceScope => {
  const accountKeys = new Set<string>();
  accounts.forEach(account => {
    [account.id, account.email, ...getAccountShopIdentifiers(account)]
      .map(normalizeScopeKey)
      .filter(Boolean)
      .forEach(key => accountKeys.add(key));
  });
  return { memberIds: new Set(), memberIdentityKeys: new Set(), accountKeys, keepAllUsers: true };
};

const matchesPODMember = (scope: PODPerformanceScope, ...values: unknown[]) => (
  values.some(value => scope.memberIdentityKeys.has(normalizeScopeKey(value)))
);

const matchesPODAccount = (scope: PODPerformanceScope, ...values: unknown[]) => (
  values.some(value => scope.accountKeys.has(normalizeScopeKey(value)))
);

const scopeTaskToPOD = (task: OperationTask, scope: PODPerformanceScope) => (
  matchesPODAccount(scope, task.account)
  || matchesPODMember(
    scope,
    task.createdBy,
    task.designerId,
    task.designerName,
    task.cs_id,
    task.idea_emp_id,
    task.submitted_to_new_by,
    task.fulfilled_by,
  )
);

const scopeOperationDataToPOD = (data: OperationReportData, scope: PODPerformanceScope | null): OperationReportData => {
  if (!scope) return data;
  const scopeTasks = (tasks: OperationTask[]) => tasks.filter(task => scopeTaskToPOD(task, scope));
  const scopeListings = (listings: OperationReportData['listings']) => listings.filter(listing => (
    matchesPODAccount(scope, listing.shop_id, listing.shop_label)
    || getListingEmployeeIds(listing).some(employeeId => scope.memberIdentityKeys.has(employeeId))
  ));

  return {
    tasksCreated: scopeTasks(data.tasksCreated),
    tasksSubmittedToNew: scopeTasks(data.tasksSubmittedToNew),
    tasksAssigned: scopeTasks(data.tasksAssigned),
    tasksDesignSubmitted: scopeTasks(data.tasksDesignSubmitted),
    tasksFulfilled: scopeTasks(data.tasksFulfilled),
    ideasCreated: scopeTasks(data.ideasCreated),
    ideasAssigned: scopeTasks(data.ideasAssigned),
    ideasDesignSubmitted: scopeTasks(data.ideasDesignSubmitted),
    ideasCompleted: scopeTasks(data.ideasCompleted),
    ideasMatchedToSales: scopeTasks(data.ideasMatchedToSales),
    listings: scopeListings(data.listings),
    listingsMatchedToSales: scopeListings(data.listingsMatchedToSales),
    users: scope.keepAllUsers ? data.users : data.users.filter(operationUser => scope.memberIds.has(normalizeScopeKey(operationUser.uid))),
    templates: data.templates,
  };
};

const getListingEmployeeIds = (listing: PerformanceListing) => Array.from(new Set([
  String(listing.employee_id || '').trim().toLowerCase(),
  getEmployeeIdFromSku(listing.sku),
].filter(Boolean)));

type EmployeeSkuSaleSummary = {
  quantity: number;
  revenueUsd: number;
  orderIds: Set<string>;
  skus: Map<string, {
    quantity: number;
    revenueUsd: number;
    orderIds: Set<string>;
    names: Set<string>;
  }>;
};

const getUniqueSaleOrders = (orders: ReportOrderRecord[]) => [...new Map(orders
  .filter(order => order.kind === 'order' && order.status !== 'Refunded' && order.source !== 'Etsy_Refunded')
  .map(order => [
    String(order.order_id || order.id || '').trim() || `row:${orders.indexOf(order)}`,
    order,
  ])).values()];

const getDateKeyInTimeZone = (value: OperationTask['created_at'], timeZone: string) => {
  const date = normalizeDateValue(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const isDateInRange = (value: OperationTask['created_at'], from: string, to: string, timeZone: string) => {
  const dateKey = getDateKeyInTimeZone(value, timeZone);
  return Boolean(dateKey && dateKey >= from && dateKey <= to);
};

const isListingDateInRange = (value: string | null | undefined, from: string, to: string, timeZone: string) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const dateKey = `${values.year}-${values.month}-${values.day}`;
  return dateKey >= from && dateKey <= to;
};

const getDateRangeKeys = (from: string, to: string) => {
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return [];
  const keys: string[] = [];
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
};

const formatTrendDateLabel = (dateKey: string) => {
  const [, month, day] = dateKey.split('-');
  return `${day}/${month}`;
};

const normalizeMappingSearch = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const getTaskProductKey = (task: OperationTask) => normalizeMappingSearch(String(task.sku || '').trim().split('-')[0]);

const SUPPLIER_LABELS: Record<string, string> = {
  merchize: 'Merchize',
  printway: 'Printway',
  interestprint: 'InterestPrint',
  customcat: 'CustomCat',
  printify: 'Printify',
  wecat: 'Wecat',
};

const formatSupplierLabel = (supplier: string) => SUPPLIER_LABELS[supplier.toLowerCase()] || supplier;

const resolveTaskSupplier = (
  task: OperationTask,
  mappingsByProduct: Map<string, ReportSkuMapping[]>,
) => {
  const candidates = mappingsByProduct.get(getTaskProductKey(task)) || [];
  const variant1 = normalizeMappingSearch(task.variant1);
  const variant2 = normalizeMappingSearch(task.variant2);
  const exactMapping = candidates.find(mapping => (
    normalizeMappingSearch(mapping.variant1) === variant1
    && normalizeMappingSearch(mapping.variant2) === variant2
  ));
  const exactSupplier = String(exactMapping?.supplier || '').trim();
  if (exactSupplier) return exactSupplier;

  const taskSupplier = String(task.supplier || '').trim();
  if (taskSupplier) return taskSupplier;
  if (candidates.length === 0 || variant1 || variant2) return '';

  const uniqueSuppliers = Array.from(new Set(candidates.map(mapping => String(mapping.supplier || '').trim()).filter(Boolean)));
  return uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : '';
};

const resolveRecordSupplier = (record: ReportOrderRecord) => {
  const provider = String(record.fulfill_provider || '').trim();
  if (provider && provider !== '-' && provider.toLowerCase() !== 'unknown') return formatSupplierLabel(provider);

  const fulfillmentCode = String(record.ff_code || '').trim();
  if (!fulfillmentCode || fulfillmentCode === '-' || fulfillmentCode.toLowerCase() === 'owner') return '';
  if (/^pwn/i.test(fulfillmentCode)) return 'Printway';
  if (/^printify/i.test(fulfillmentCode)) return 'Printify';
  return 'Merchize';
};

const ROLES_BY_SECTION: Record<PerformanceSectionId, string[]> = {
  'company-overview': [
    'DS_IDEA', 'LEADDS_IDEA', 'DS_FULFILL', 'LEADDS_FULFILL',
    'IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE',
    'CS_SUPPORT', 'CS_FULFILL', 'LEADCS_SUPPORT', 'LEADCS_FULFILL',
  ],
  'designer-idea': ['DS_IDEA', 'LEADDS_IDEA', 'DS_FULFILL', 'LEADDS_FULFILL'],
  'designer-fulfillment': ['DS_IDEA', 'LEADDS_IDEA', 'DS_FULFILL', 'LEADDS_FULFILL'],
  'research-development': ['IDEA_RD', 'LEADIDEA_RD'],
  scale: ['IDEA_SCALE', 'LEADIDEA_SCALE'],
  'customer-service': ['CS_SUPPORT', 'LEADCS_SUPPORT'],
  fulfillment: ['CS_FULFILL', 'LEADCS_FULFILL'],
  'kpi-assignment': [],
};

const TEAM_ROLES_BY_ROLE: Record<string, string[]> = {
  CS_SUPPORT: ['CS_SUPPORT'],
  CS_FULFILL: ['CS_FULFILL'],
  DS_FULFILL: ['DS_FULFILL'],
  DS_IDEA: ['DS_IDEA'],
  IDEA_RD: ['IDEA_RD'],
  IDEA_SCALE: ['IDEA_SCALE'],
  LEADCS_SUPPORT: ['LEADCS_SUPPORT', 'CS_SUPPORT'],
  LEADCS_FULFILL: ['LEADCS_FULFILL', 'CS_FULFILL'],
  LEADDS_FULFILL: ['LEADDS_FULFILL', 'DS_FULFILL'],
  LEADDS_IDEA: ['LEADDS_IDEA', 'DS_IDEA'],
  LEADIDEA_RD: ['LEADIDEA_RD', 'IDEA_RD'],
  LEADIDEA_SCALE: ['LEADIDEA_SCALE', 'IDEA_SCALE'],
};

const taskTemplatePoints = (
  task: OperationTask,
  board: 'fulfill' | 'idea',
  templatePoints: Map<string, number>
) => resolveDesignerTaskPoints(task, board, templatePoints).points;

const formatFirstSaleDuration = (hours: number | null) => {
  if (hours === null) return '—';
  if (hours < 24) return `${hours.toFixed(1)} giờ`;
  return `${(hours / 24).toFixed(1)} ngày`;
};

const formatPercentage = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

const getTaskOrderKey = (task: OperationTask) => String(task.orderId || task.taskId || task.id).trim();

const countUniqueTaskOrders = (tasks: OperationTask[]) => new Set(tasks.map(getTaskOrderKey).filter(Boolean)).size;

const getSupportIncomingFunnel = (
  tasks: OperationTask[],
  asOfValue: string,
  timeZone: string,
) => {
  const asOfTime = normalizeDateValue(asOfValue)?.getTime() ?? Date.now();
  const orders = new Map<string, { createdDate: string; submittedAt: number | null }>();

  tasks.forEach(task => {
    const orderKey = getTaskOrderKey(task);
    const createdDate = getDateKeyInTimeZone(task.created_at, timeZone);
    if (!orderKey || !createdDate) return;
    const submittedAt = normalizeDateValue(task.submitted_to_new_at)?.getTime() ?? null;
    const current = orders.get(orderKey);
    orders.set(orderKey, {
      createdDate: current && current.createdDate < createdDate ? current.createdDate : createdDate,
      submittedAt: submittedAt === null
        ? current?.submittedAt ?? null
        : current?.submittedAt === null || current?.submittedAt === undefined
          ? submittedAt
          : Math.min(current.submittedAt, submittedAt),
    });
  });

  const byDate = new Map<string, { total: number; processed: number }>();
  orders.forEach(order => {
    const row = byDate.get(order.createdDate) || { total: 0, processed: 0 };
    row.total += 1;
    if (order.submittedAt !== null && order.submittedAt <= asOfTime) row.processed += 1;
    byDate.set(order.createdDate, row);
  });
  const processed = [...byDate.values()].reduce((sum, row) => sum + row.processed, 0);

  return {
    total: orders.size,
    processed,
    pending: orders.size - processed,
    breakdown: [...byDate.entries()]
      .filter(([, row]) => row.total > row.processed)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, row]) => ({
        label: formatTrendDateLabel(date),
        value: `${row.total - row.processed} chưa chuyển New`,
        secondary: `${row.processed}/${row.total} order của ngày này đã chuyển New`,
      })),
  };
};

const getSupportCompletionOrigin = (tasks: OperationTask[], timeZone: string) => {
  const orders = new Map<string, { createdDate: string; submittedDate: string }>();
  tasks.forEach(task => {
    const orderKey = getTaskOrderKey(task);
    const createdDate = getDateKeyInTimeZone(task.created_at, timeZone);
    const submittedDate = getDateKeyInTimeZone(task.submitted_to_new_at, timeZone);
    if (!orderKey || !createdDate || !submittedDate) return;
    const current = orders.get(orderKey);
    orders.set(orderKey, {
      createdDate: current && current.createdDate < createdDate ? current.createdDate : createdDate,
      submittedDate: current && current.submittedDate > submittedDate ? current.submittedDate : submittedDate,
    });
  });

  const delayedByCreatedDate = new Map<string, number>();
  let sameDay = 0;
  orders.forEach(order => {
    if (order.createdDate === order.submittedDate) {
      sameDay += 1;
      return;
    }
    delayedByCreatedDate.set(order.createdDate, (delayedByCreatedDate.get(order.createdDate) || 0) + 1);
  });

  return {
    sameDay,
    fromPreviousDays: orders.size - sameDay,
    breakdown: [...delayedByCreatedDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, count]) => ({
        label: `Tạo ngày ${formatTrendDateLabel(date)}`,
        value: `${count} order chuyển New`,
        secondary: 'Được đưa cho Designer xử lý trong phạm vi đang xem',
      })),
  };
};

const getTaskOrderCustomization = (tasks: OperationTask[]) => {
  const customByOrder = new Map<string, boolean>();
  tasks.forEach(task => {
    const orderKey = getTaskOrderKey(task);
    if (!orderKey) return;
    const isCustom = String(task.personalization || '').trim().length > 0;
    customByOrder.set(orderKey, Boolean(customByOrder.get(orderKey)) || isCustom);
  });

  return customByOrder;
};

const countTaskOrdersByCustomization = (
  tasks: OperationTask[],
  customizationByOrder = getTaskOrderCustomization(tasks)
) => {
  const orderKeys = new Set(tasks.map(getTaskOrderKey).filter(Boolean));
  const custom = [...orderKeys].filter(orderKey => customizationByOrder.get(orderKey)).length;
  return { custom, nonCustom: orderKeys.size - custom };
};

const getSupportCompletedTasks = (
  data: OperationReportData,
  predicate: (task: OperationTask) => boolean = () => true
) => ({ tasks: data.tasksSubmittedToNew.filter(predicate) });

const calculateDurationStats = (
  tasks: OperationTask[],
  startValue: (task: OperationTask) => OperationTask['created_at'],
  endValue: (task: OperationTask) => OperationTask['created_at'],
  calendar: PerformanceCalendarSettings,
  startBoundary: 'earliest' | 'latest' = 'earliest',
) => {
  const orderWindows = new Map<string, { start: number; end: number }>();
  const selectStart = startBoundary === 'latest' ? Math.max : Math.min;
  tasks.forEach(task => {
    const start = normalizeDateValue(startValue(task))?.getTime();
    const end = normalizeDateValue(endValue(task))?.getTime();
    if (!start || !end || end < start) return;
    const key = getTaskOrderKey(task);
    const current = orderWindows.get(key);
    orderWindows.set(key, {
      start: current ? selectStart(current.start, start) : start,
      end: current ? Math.max(current.end, end) : end,
    });
  });
  const durations = [...orderWindows.values()]
    .flatMap(window => {
      const duration = calculateBusinessHours(window.start, window.end, calendar);
      return duration === null ? [] : [duration];
    })
    .sort((left, right) => left - right);
  const average = durations.length ? durations.reduce((sum, hours) => sum + hours, 0) / durations.length : null;
  return { average, durations };
};

const calculateTaskDurationStats = (
  tasks: OperationTask[],
  startValue: (task: OperationTask) => OperationTask['created_at'],
  endValue: (task: OperationTask) => OperationTask['created_at'],
  calendar: PerformanceCalendarSettings,
) => {
  const durations = tasks.flatMap(task => {
    const start = normalizeDateValue(startValue(task))?.getTime();
    const end = normalizeDateValue(endValue(task))?.getTime();
    if (!start || !end || end < start) return [];
    const duration = calculateBusinessHours(start, end, calendar);
    return duration === null ? [] : [duration];
  });
  const average = durations.length ? durations.reduce((sum, hours) => sum + hours, 0) / durations.length : null;
  return { average, durations };
};

interface UsePerformanceDataOptions {
  configurationMode?: boolean;
  templatePointMode?: boolean;
  enabled?: boolean;
}

const EMPTY_BASELINE_AGGREGATE: PerformanceBaselineAggregate = {
  buckets: [],
  updatedAt: null,
  rangeFrom: '',
  rangeTo: '',
  quarterLabel: '',
  available: false,
  refreshStatus: 'unknown',
  lastError: null,
};

export const usePerformanceData = (
  section: PerformanceSectionId,
  {
    configurationMode = false,
    templatePointMode = false,
    enabled = true,
  }: UsePerformanceDataOptions = {},
) => {
  const {
    teamId,
    role: dashboardRole,
    permissions,
    user,
    boards,
    selectedBoardId,
    accounts,
    exchangeRates,
  } = useDashboardAccess();
  const { filterDateRange, timeZone } = useUIFilters();
  const [rawOperationData, setOperationData] = useState<OperationReportData>(EMPTY_OPERATION_DATA);
  const [rawKpiOperationData, setKpiOperationData] = useState<OperationReportData>(EMPTY_OPERATION_DATA);
  const [rawOrders, setOrders] = useState<ReportOrderRecord[]>([]);
  const [rawReviews, setReviews] = useState<ReportReview[]>([]);
  const [supplierMappings, setSupplierMappings] = useState<ReportSkuMapping[]>([]);
  const [kpiTargets, setKpiTargets] = useState<KpiTarget[]>([]);
  const [performanceCalendar, setPerformanceCalendar] = useState<PerformanceCalendarSettings>(DEFAULT_PERFORMANCE_CALENDAR);
  const [baselineAggregate, setBaselineAggregate] = useState<PerformanceBaselineAggregate>(EMPTY_BASELINE_AGGREGATE);
  const [isBaselineLoading, setIsBaselineLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequestRef = useRef(0);
  const filterFrom = filterDateRange.from;
  const filterTo = filterDateRange.to;
  const currentPerformanceDate = getDateKeyInTimeZone(new Date(), DEFAULT_PERFORMANCE_CALENDAR.timeZone);
  const kpiAnchorDate = configurationMode ? currentPerformanceDate : filterTo;

  const refresh = useCallback(async (forceRefresh = false) => {
    const requestId = ++latestRequestRef.current;
    if (!enabled || !teamId) {
      setIsLoading(false);
      setIsBaselineLoading(false);
      return;
    }
    setIsLoading(true);
    setIsBaselineLoading(section !== 'company-overview');
    setError('');
    try {
      const selectedDateRange = { from: filterFrom, to: filterTo };
      const performanceTimeZone = DEFAULT_PERFORMANCE_CALENDAR.timeZone;
      const needsEmployeeKpiData = section !== 'company-overview';
      const operationPromise = fetchOperationReportData(
        teamId,
        selectedDateRange,
        timeZone,
        forceRefresh,
        configurationMode || templatePointMode
          ? getKpiProgressReportProfile(section)
          : getOperationReportProfile(section),
      );
      const primaryKpi = getPrimaryKpiDefinition(section);
      const kpiTargetsPromise = needsEmployeeKpiData && !templatePointMode
        ? fetchKpiTargets(teamId)
        : Promise.resolve([]);
      const needsSaleOrders = !configurationMode && (section === 'research-development' || section === 'scale');
      const needsFulfillmentRecords = !configurationMode && (section === 'company-overview' || section === 'fulfillment');
      const needsReviews = !configurationMode && (section === 'company-overview' || section === 'customer-service');
      const needsSupplierMappings = !configurationMode && (section === 'company-overview' || section === 'fulfillment');
      const orderPromise = needsSaleOrders
        ? fetchReportRecords(teamId, selectedDateRange, timeZone, forceRefresh)
        : needsFulfillmentRecords
          ? operationPromise.then(data => fetchFulfillmentRecordsForTasks(teamId, data.tasksFulfilled, forceRefresh))
          : Promise.resolve([]);
      const kpiOperationPromise = kpiTargetsPromise.then(targets => {
        if (templatePointMode) return operationPromise;
        const relevantTargets = primaryKpi ? targets.filter(target => (
          target.active !== false
          && target.metricCode === primaryKpi.code
          && target.effectiveFrom <= kpiAnchorDate
          && (!target.effectiveTo || target.effectiveTo >= kpiAnchorDate)
        )) : [];
        if (relevantTargets.length === 0) return operationPromise;

        const progressWindows = relevantTargets.map(target => (
          getEffectiveKpiPeriodWindow(
            target.period,
            kpiAnchorDate,
            target.effectiveFrom,
            target.effectiveTo,
          )
        ));
        const progressFrom = progressWindows.reduce(
          (earliest, window) => window.from < earliest ? window.from : earliest,
          progressWindows[0].from,
        );
        const requestedAsOf = kpiAnchorDate < currentPerformanceDate
          ? kpiAnchorDate
          : currentPerformanceDate;
        if (requestedAsOf < progressFrom) return operationPromise;

        const progressDateRange = { from: progressFrom, to: requestedAsOf };
        const selectedRangeCoversProgress = timeZone === performanceTimeZone
          && filterFrom <= progressDateRange.from
          && filterTo >= progressDateRange.to;
        return selectedRangeCoversProgress
          ? operationPromise
          : fetchOperationReportData(
            teamId,
            progressDateRange,
            performanceTimeZone,
            forceRefresh,
            getKpiProgressReportProfile(section),
          );
      });
      const supplierMappingsPromise = needsSupplierMappings
        ? operationPromise.then(data => fetchSupplierMappingsForTasks(data.tasksFulfilled, forceRefresh))
        : Promise.resolve([]);
      const baselinePromise = section === 'company-overview' || templatePointMode
        ? Promise.resolve(EMPTY_BASELINE_AGGREGATE)
        : fetchPerformanceBaselineAggregate(teamId, section, {
          from: configurationMode ? kpiAnchorDate : selectedDateRange.from,
          to: configurationMode ? kpiAnchorDate : selectedDateRange.to,
        }, forceRefresh).catch(baselineError => {
          console.warn('[Performance] Could not load persisted baseline aggregate:', baselineError);
          return EMPTY_BASELINE_AGGREGATE;
        });
      const [nextOperationData, nextKpiOperationData, nextOrders, nextReviews, nextSupplierMappings, nextKpiTargets, nextPerformanceCalendar, nextBaselineAggregate] = await Promise.all([
        operationPromise,
        kpiOperationPromise,
        orderPromise,
        needsReviews ? fetchReportReviews(teamId, selectedDateRange, timeZone, forceRefresh) : Promise.resolve([]),
        supplierMappingsPromise,
        kpiTargetsPromise,
        fetchPerformanceCalendar(teamId, forceRefresh).catch(calendarError => {
          console.warn('[Performance] Could not load business calendar, using defaults:', calendarError);
          return DEFAULT_PERFORMANCE_CALENDAR;
        }),
        baselinePromise,
      ]);
      if (latestRequestRef.current !== requestId) return;
      setOperationData(nextOperationData);
      setKpiOperationData(nextKpiOperationData);
      setOrders(nextOrders);
      setReviews(nextReviews);
      setSupplierMappings(nextSupplierMappings);
      setKpiTargets(nextKpiTargets);
      setPerformanceCalendar(nextPerformanceCalendar);
      setBaselineAggregate(nextBaselineAggregate);
    } catch (loadError) {
      if (latestRequestRef.current !== requestId) return;
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu KPI.');
    } finally {
      if (latestRequestRef.current === requestId) {
        setIsLoading(false);
        setIsBaselineLoading(false);
      }
    }
  }, [configurationMode, currentPerformanceDate, enabled, filterFrom, filterTo, kpiAnchorDate, section, teamId, templatePointMode, timeZone]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const handleTargetsChange = () => {
      if (!teamId || section === 'company-overview') return;
      void fetchKpiTargets(teamId).then(setKpiTargets).catch(loadError => {
        setError(loadError instanceof Error ? loadError.message : 'Không tải được KPI Targets.');
      });
    };
    window.addEventListener('kpi-targets-change', handleTargetsChange);
    return () => window.removeEventListener('kpi-targets-change', handleTargetsChange);
  }, [section, teamId]);

  useEffect(() => {
    const handleCalendarChange = () => {
      if (!teamId) return;
      void fetchPerformanceCalendar(teamId, true).then(setPerformanceCalendar).catch(loadError => {
        setError(loadError instanceof Error ? loadError.message : 'Không tải được lịch làm việc.');
      });
    };
    window.addEventListener('performance-calendar-change', handleCalendarChange);
    return () => window.removeEventListener('performance-calendar-change', handleCalendarChange);
  }, [teamId]);

  useEffect(() => {
    const handleTemplatePointChange = (event: Event) => {
      const change = (event as CustomEvent<OperationTemplatePointChange>).detail;
      if (!change?.templateId) return;
      const applyChange = (current: OperationReportData): OperationReportData => ({
        ...current,
        templates: current.templates.map(template => {
          if (template.id !== change.templateId) return template;
          if (change.points === null) {
            const { points: previousPoints, ...templateWithoutPoints } = template;
            void previousPoints;
            return templateWithoutPoints;
          }
          return { ...template, points: change.points };
        }),
      });
      setOperationData(applyChange);
      setKpiOperationData(applyChange);
    };
    window.addEventListener(OPERATION_TEMPLATE_POINT_CHANGE_EVENT, handleTemplatePointChange);
    return () => window.removeEventListener(OPERATION_TEMPLATE_POINT_CHANGE_EVENT, handleTemplatePointChange);
  }, []);

  const selectedPODTeam = useMemo(
    () => boards.find(board => board.uid === selectedBoardId) || null,
    [boards, selectedBoardId],
  );
  const podScope = useMemo(
    () => selectedPODTeam
      ? buildPODPerformanceScope(selectedPODTeam, accounts, rawOperationData.users)
      : null,
    [accounts, rawOperationData.users, selectedPODTeam],
  );
  const accountScope = useMemo(
    () => buildAccountPerformanceScope(accounts),
    [accounts],
  );
  const performanceScope = podScope || accountScope;
  const kpiPodScope = useMemo(
    () => selectedPODTeam
      ? buildPODPerformanceScope(selectedPODTeam, accounts, rawKpiOperationData.users)
      : null,
    [accounts, rawKpiOperationData.users, selectedPODTeam],
  );
  const operationData = useMemo(
    () => scopeOperationDataToPOD(rawOperationData, performanceScope),
    [performanceScope, rawOperationData],
  );
  const kpiOperationData = useMemo(
    () => scopeOperationDataToPOD(rawKpiOperationData, kpiPodScope || accountScope),
    [accountScope, kpiPodScope, rawKpiOperationData],
  );
  const activeListings = useMemo(
    () => [...new Map(operationData.listings
      .filter(isActiveListing)
      .map(listing => [listing.listing_id, listing])).values()],
    [operationData.listings],
  );
  const activeKpiListings = useMemo(
    () => [...new Map(kpiOperationData.listings
      .filter(isActiveListing)
      .map(listing => [listing.listing_id, listing])).values()],
    [kpiOperationData.listings],
  );
  const orders = useMemo(
    () => rawOrders.filter(order => matchesPODAccount(performanceScope, order.account)),
    [performanceScope, rawOrders],
  );
  const reviews = useMemo(
    () => rawReviews.filter(review => matchesPODAccount(performanceScope, review.shop_id)),
    [performanceScope, rawReviews],
  );
  const performanceAccounts = useMemo(
    () => accounts.filter(account => getAccountShopIdentifiers(account).some(value => (
      performanceScope.accountKeys.has(normalizeScopeKey(value))
    ))),
    [accounts, performanceScope],
  );
  const performanceAccountLabelMap = useMemo(
    () => buildAccountLabelMap(performanceAccounts),
    [performanceAccounts],
  );

  const templatePoints = useMemo(
    () => createConfiguredTemplatePointMap(operationData.templates),
    [operationData.templates]
  );

  const kpiTemplatePoints = useMemo(
    () => createConfiguredTemplatePointMap(kpiOperationData.templates),
    [kpiOperationData.templates]
  );

  const designerPointDataQuality = useMemo<DesignerPointDataQuality | null>(() => {
    if (section !== 'designer-idea' && section !== 'designer-fulfillment') return null;
    const taskResolutions = [
      ...operationData.tasksDesignSubmitted.map(task => resolveDesignerTaskPoints(task, 'fulfill', templatePoints)),
      ...operationData.ideasDesignSubmitted.map(task => resolveDesignerTaskPoints(task, 'idea', templatePoints)),
    ];

    return taskResolutions.reduce<DesignerPointDataQuality>((summary, resolution) => ({
      totalCompletedTasks: summary.totalCompletedTasks + 1,
      snapshottedTasks: summary.snapshottedTasks + (resolution.source === 'snapshot' ? 1 : 0),
      configuredTasks: summary.configuredTasks + (resolution.source === 'configured' ? 1 : 0),
      fallbackTasks: summary.fallbackTasks + (resolution.source === 'fallback' ? 1 : 0),
      tasksWithoutTemplate: summary.tasksWithoutTemplate + (resolution.source === 'none' ? 1 : 0),
    }), {
      totalCompletedTasks: 0,
      snapshottedTasks: 0,
      configuredTasks: 0,
      fallbackTasks: 0,
      tasksWithoutTemplate: 0,
    });
  }, [operationData.ideasDesignSubmitted, operationData.tasksDesignSubmitted, section, templatePoints]);

  const stats = useMemo(() => {
    const validRatings = reviews
      .map(review => Number(review.rating))
      .filter(rating => Number.isFinite(rating) && rating >= 1 && rating <= 5);
    const averageRating = validRatings.length
      ? validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length
      : 0;
    const positiveReviewCount = validRatings.filter(rating => rating >= 4).length;
    const lowReviewCount = validRatings.filter(rating => rating <= 3).length;
    const positiveReviewRate = validRatings.length ? positiveReviewCount / validRatings.length * 100 : null;
    const shopHealthByKey = new Map<string, { label: string; average: number; count: number | null }>();
    const lifetimeShopRatings = performanceAccounts.flatMap(account => {
      const average = parseFiniteNumber(account.etsy_review_average);
      if (average === null || average < 1 || average > 5) return [];
      const health = {
        label: account.label || account.shopName || account.etsyShopName || account.email || account.id,
        average,
        count: parseFiniteNumber(account.etsy_review_count),
      };
      getAccountShopIdentifiers(account)
        .map(normalizeScopeKey)
        .filter(Boolean)
        .forEach(key => shopHealthByKey.set(key, health));
      return [health];
    });
    const lifetimeReviewCount = lifetimeShopRatings.reduce((sum, shop) => (
      sum + (shop.count && shop.count > 0 ? shop.count : 0)
    ), 0);
    const lifetimeReviewAverage = lifetimeShopRatings.length === 0
      ? null
      : lifetimeReviewCount > 0
        ? lifetimeShopRatings.reduce((sum, shop) => sum + shop.average * Math.max(0, shop.count || 0), 0) / lifetimeReviewCount
        : lifetimeShopRatings.reduce((sum, shop) => sum + shop.average, 0) / lifetimeShopRatings.length;
    const reviewAverageDelta = validRatings.length && lifetimeReviewAverage !== null
      ? averageRating - lifetimeReviewAverage
      : null;
    const rangeRatingsByShop = new Map<string, { label: string; ratings: number[]; lifetimeAverage: number | null }>();
    reviews.forEach(review => {
      const rating = parseFiniteNumber(review.rating);
      if (rating === null || rating < 1 || rating > 5) return;
      const health = shopHealthByKey.get(normalizeScopeKey(review.shop_id));
      const label = health?.label || review.shop_id || 'Unknown shop';
      const current = rangeRatingsByShop.get(label) || { label, ratings: [], lifetimeAverage: health?.average ?? null };
      current.ratings.push(rating);
      rangeRatingsByShop.set(label, current);
    });
    const ratingComparison = [...rangeRatingsByShop.values()]
      .map(shop => {
        const rangeAverage = shop.ratings.reduce((sum, rating) => sum + rating, 0) / shop.ratings.length;
        return {
          name: shop.label,
          rangeAverage,
          lifetimeAverage: shop.lifetimeAverage,
          reviewCount: shop.ratings.length,
        };
      })
      .sort((left, right) => right.reviewCount - left.reviewCount || left.name.localeCompare(right.name));
    const ratingBreakdown = ratingComparison.map(shop => {
      const delta = shop.lifetimeAverage === null ? null : shop.rangeAverage - shop.lifetimeAverage;
      return {
        label: shop.name,
        value: `${shop.rangeAverage.toFixed(2)} ★ trong kỳ`,
        secondary: `${shop.reviewCount.toLocaleString()} review · Toàn shop ${shop.lifetimeAverage === null ? '—' : `${shop.lifetimeAverage.toFixed(2)} ★`} · ${formatRatingDelta(delta)}`,
      };
    });
    const supportCompleted = getSupportCompletedTasks(operationData);
    const fulfillmentDuration = calculateDurationStats(
      operationData.tasksFulfilled,
      task => task.design_submitted_at,
      task => task.fulfilled_at,
      performanceCalendar,
      'latest',
    );
    const designerDuration = calculateTaskDurationStats(
      [...operationData.ideasDesignSubmitted, ...operationData.tasksDesignSubmitted],
      task => task.assigned_to_designer_at,
      task => task.design_submitted_at,
      performanceCalendar,
    );
    const recordSuppliersByOrder = new Map<string, Set<string>>();
    orders.forEach(record => {
      const orderKey = String(record.order_id || '').trim();
      const supplier = resolveRecordSupplier(record);
      if (!orderKey || !supplier) return;
      const suppliers = recordSuppliersByOrder.get(orderKey) || new Set<string>();
      suppliers.add(supplier);
      recordSuppliersByOrder.set(orderKey, suppliers);
    });
    const suppliersByOrder = new Map<string, Set<string>>();
    const supplierDetailsByOrder = new Map<string, { shops: Set<string>; skus: Set<string> }>();
    const mappingsByProduct = new Map<string, ReportSkuMapping[]>();
    supplierMappings.forEach(mapping => {
      const productKey = normalizeMappingSearch(String(mapping.etsy_sku || '').trim().split('-')[0]);
      if (!productKey) return;
      const mappings = mappingsByProduct.get(productKey) || [];
      mappings.push(mapping);
      mappingsByProduct.set(productKey, mappings);
    });
    operationData.tasksFulfilled.forEach(task => {
      const orderKey = getTaskOrderKey(task);
      const suppliers = suppliersByOrder.get(orderKey) || new Set(recordSuppliersByOrder.get(orderKey) || []);
      const details = supplierDetailsByOrder.get(orderKey) || { shops: new Set<string>(), skus: new Set<string>() };
      const supplier = resolveTaskSupplier(task, mappingsByProduct);
      if (supplier) suppliers.add(formatSupplierLabel(supplier));
      const account = String(task.account || '').trim();
      const sku = String(task.sku || '').trim();
      if (account) details.shops.add(performanceAccountLabelMap.get(normalizeScopeKey(account)) || account);
      if (sku) details.skus.add(sku);
      suppliersByOrder.set(orderKey, suppliers);
      supplierDetailsByOrder.set(orderKey, details);
    });
    const supplierCounts = new Map<string, number>();
    let ordersWithSupplier = 0;
    suppliersByOrder.forEach(suppliers => {
      if (suppliers.size > 0) ordersWithSupplier += 1;
      const supplierLabel = suppliers.size === 0
        ? 'Thiếu mapping supplier'
        : suppliers.size === 1
          ? [...suppliers][0]
          : 'Nhiều supplier';
      supplierCounts.set(supplierLabel, (supplierCounts.get(supplierLabel) || 0) + 1);
    });
    const fulfillmentSupplierRows = [...supplierCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, value]) => ({ name, value }));
    const fulfillmentMissingSupplierBreakdown = [...suppliersByOrder.entries()]
      .filter(([, suppliers]) => suppliers.size === 0)
      .map(([orderKey]) => {
        const details = supplierDetailsByOrder.get(orderKey);
        const shops = [...(details?.shops || [])];
        const skus = [...(details?.skus || [])];
        return {
          label: `#${orderKey}`,
          value: shops.join(', ') || 'Không rõ shop',
          secondary: skus.length
            ? `SKU: ${skus.slice(0, 3).join(', ')}${skus.length > 3 ? ` +${skus.length - 3}` : ''}`
            : 'Không có SKU',
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    const fulfillmentSupplierCount = new Set([...suppliersByOrder.values()].flatMap(suppliers => [...suppliers])).size;
    return {
      averageRating,
      reviewCount: validRatings.length,
      positiveReviewCount,
      lowReviewCount,
      positiveReviewRate,
      lifetimeReviewAverage,
      reviewAverageDelta,
      ratingBreakdown,
      ratingComparison,
      supportCompleted,
      fulfillmentDuration,
      designerDuration,
      fulfillmentDataCoverage: suppliersByOrder.size ? ordersWithSupplier / suppliersByOrder.size * 100 : null,
      fulfillmentOrderCount: suppliersByOrder.size,
      fulfillmentOrdersWithSupplier: ordersWithSupplier,
      fulfillmentSupplierCount,
      fulfillmentMissingSupplierBreakdown,
      fulfillmentSupplierRows,
    };
  }, [operationData.ideasDesignSubmitted, operationData.tasksCreated, operationData.tasksDesignSubmitted, operationData.tasksFulfilled, operationData.tasksSubmittedToNew, orders, performanceAccountLabelMap, performanceAccounts, performanceCalendar, reviews, supplierMappings]);

  const saleOrders = useMemo(() => getUniqueSaleOrders(orders), [orders]);
  const employeeSkuSales = useMemo(() => {
    const salesByEmployeeId = new Map<string, EmployeeSkuSaleSummary>();

    saleOrders.forEach(order => {
      const orderId = String(order.order_id || order.id || '').trim();
      const currency = String(order.currency || 'USD').trim().toUpperCase() || 'USD';
      const revenueContext = getOrderItemRevenueContext(order.items, order.financials);
      order.items.forEach(item => {
        const sku = normalizeSku(item.sku);
        const employeeId = getEmployeeIdFromSku(sku);
        const quantity = Math.max(0, Number(item.quantity || 0));
        if (!sku || !employeeId || quantity <= 0) return;
        const itemRevenue = calculateItemNetRevenue(item, revenueContext);
        const revenueUsd = currency === 'USD'
          ? itemRevenue
          : itemRevenue * (exchangeRates?.[currency] || 1);

        const employeeSales = salesByEmployeeId.get(employeeId) || {
          quantity: 0,
          revenueUsd: 0,
          orderIds: new Set<string>(),
          skus: new Map<string, { quantity: number; revenueUsd: number; orderIds: Set<string>; names: Set<string> }>(),
        };
        const skuSales = employeeSales.skus.get(sku) || {
          quantity: 0,
          revenueUsd: 0,
          orderIds: new Set<string>(),
          names: new Set<string>(),
        };

        employeeSales.quantity += quantity;
        employeeSales.revenueUsd += revenueUsd;
        skuSales.quantity += quantity;
        skuSales.revenueUsd += revenueUsd;
        if (orderId) {
          employeeSales.orderIds.add(orderId);
          skuSales.orderIds.add(orderId);
        }
        const productName = String(item.name || '').trim();
        if (productName) skuSales.names.add(productName);
        employeeSales.skus.set(sku, skuSales);
        salesByEmployeeId.set(employeeId, employeeSales);
      });
    });

    return salesByEmployeeId;
  }, [exchangeRates, saleOrders]);
  const listingCohortIndex = useMemo(
    () => buildListingSaleObservationIndex(saleOrders, activeListings),
    [activeListings, saleOrders]
  );
  const selectedRangeEndIso = useMemo(() => buildIsoRangeForTimezone({
    from: filterDateRange.to,
    to: filterDateRange.to,
  }, timeZone).toISO, [filterDateRange.to, timeZone]);

  const listingStats = useMemo(() => {
    const from = new Date(`${filterDateRange.from.slice(0, 10)}T00:00:00Z`).getTime();
    const to = new Date(`${filterDateRange.to.slice(0, 10)}T00:00:00Z`).getTime();
    const dayCount = Number.isFinite(from) && Number.isFinite(to) ? Math.max(1, Math.floor((to - from) / 86400000) + 1) : 1;
    const allowedRoles = new Set(ROLES_BY_SECTION[section]);
    const employeeKeys = new Set(operationData.users
      .filter(operationUser => allowedRoles.has(String(operationUser.role || '').toUpperCase()))
      .flatMap(operationUser => [operationUser.uid, operationUser.empID, operationUser.email]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)));
    const sectionListings = activeListings.filter(listing => (
      getListingEmployeeIds(listing).some(employeeId => employeeKeys.has(employeeId))
    ));
    const cohort = calculateListingCohortStats(sectionListings, listingCohortIndex, selectedRangeEndIso);
    const listingsWithSales = cohort.listingsWithFirstSale;
    const knownEmployeeKeys = new Set(operationData.users.flatMap(operationUser => (
      [operationUser.uid, operationUser.empID, operationUser.email]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )));
    const employeeDisplayNameByKey = new Map<string, string>();
    operationData.users.forEach(operationUser => {
      const displayName = String(operationUser.displayName || operationUser.fullName || '').trim();
      if (!displayName) return;
      [operationUser.uid, operationUser.empID, operationUser.email]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .forEach(key => employeeDisplayNameByKey.set(key, displayName));
    });
    const unmappedCount = activeListings.filter(listing => (
      !getListingEmployeeIds(listing).some(employeeId => knownEmployeeKeys.has(employeeId))
    )).length;
    const listingBreakdown = sectionListings
      .slice()
      .sort((a, b) => b.create_date.localeCompare(a.create_date))
      .slice(0, 100)
      .map(listing => {
        const employeeName = getListingEmployeeIds(listing)
          .map(employeeId => employeeDisplayNameByKey.get(employeeId))
          .find(Boolean) || '----';
        const shopIdKey = String(listing.shop_id || '').trim().toLowerCase();
        const shopLabelKey = String(listing.shop_label || '').trim().toLowerCase();
        const shopLabel = performanceAccountLabelMap.get(shopIdKey)
          || performanceAccountLabelMap.get(shopLabelKey)
          || listing.shop_label
          || listing.shop_id
          || '----';
        return {
          label: listing.title || `Listing #${listing.listing_id}`,
          value: `#${listing.listing_id}`,
          secondary: `${employeeName} · ${shopLabel}`,
        };
      });

    return {
      listedCount: sectionListings.length,
      listedPerDay: sectionListings.length / dayCount,
      listingsWithSales,
      averageFirstSaleHours: cohort.averageFirstSaleHours,
      firstSaleCohort: cohort.firstSaleDurationsHours.length,
      firstSaleDurationsHours: cohort.firstSaleDurationsHours,
      firstSaleD7Eligible: cohort.d7Eligible,
      firstSaleD7Converted: cohort.d7Converted,
      firstSaleD7Rate: cohort.d7Rate,
      firstSaleD14Eligible: cohort.d14Eligible,
      firstSaleD14Converted: cohort.d14Converted,
      firstSaleD14Rate: cohort.d14Rate,
      firstSaleD30Eligible: cohort.d30Eligible,
      firstSaleD30Converted: cohort.d30Converted,
      firstSaleD30Rate: cohort.d30Rate,
      unmappedCount,
      listingBreakdown,
    };
  }, [activeListings, filterDateRange.from, filterDateRange.to, listingCohortIndex, operationData.users, performanceAccountLabelMap, section, selectedRangeEndIso]);

  const designerTotals = useMemo(() => ({
    ideaReceived: operationData.ideasAssigned.length,
    ideaCompleted: operationData.ideasDesignSubmitted.length,
    ideaPoints: operationData.ideasDesignSubmitted.reduce((sum, task) => sum + taskTemplatePoints(task, 'idea', templatePoints), 0),
    fulfillReceived: operationData.tasksAssigned.length,
    fulfillCompleted: operationData.tasksDesignSubmitted.length,
    fulfillPoints: operationData.tasksDesignSubmitted.reduce((sum, task) => sum + taskTemplatePoints(task, 'fulfill', templatePoints), 0),
  }), [operationData.ideasAssigned, operationData.ideasDesignSubmitted, operationData.tasksAssigned, operationData.tasksDesignSubmitted, templatePoints]);

  const ideaSaleStats = useMemo(() => {
    const salesBySku = new Map<string, number>();
    rawOperationData.tasksCreated.forEach(task => {
      const sku = normalizeSku(task.sku);
      if (sku) salesBySku.set(sku, (salesBySku.get(sku) || 0) + 1);
    });

    const soldSkus = new Set(
      (operationData.ideasMatchedToSales || []).map(idea => normalizeSku(idea.sku)).filter(Boolean)
    );
    const soldSkuRows = [...soldSkus]
      .map(sku => ({ sku, sales: salesBySku.get(sku) || 0 }))
      .filter(item => item.sales > 0)
      .sort((a, b) => b.sales - a.sales || a.sku.localeCompare(b.sku));
    return {
      salesBySku,
      ideasWithSalesCount: soldSkuRows.length,
      totalSales: soldSkuRows.reduce((sum, item) => sum + item.sales, 0),
      skuBreakdown: soldSkuRows.map(item => ({
        label: item.sku,
        value: `${item.sales.toLocaleString()} lượt sale`,
        secondary: 'Số task Fulfill khớp SKU trong kỳ',
      })),
    };
  }, [operationData.ideasMatchedToSales, rawOperationData.tasksCreated]);

  const allEmployees = useMemo<EmployeePerformanceRow[]>(() => {
    const allowedRoles = new Set(ROLES_BY_SECTION[section]);
    const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
    const matches = (keys: Set<string>, ...values: unknown[]) => values.some(value => keys.has(normalize(value)));
    const isDesignerSection = section === 'designer-idea' || section === 'designer-fulfillment';
    const supportOrderCustomization = getTaskOrderCustomization(getSupportCompletedTasks(operationData).tasks);

    const rows = operationData.users.filter(operationUser => {
      const isActive = operationUser.active !== false && operationUser.isActive !== false;
      return isActive && allowedRoles.has(String(operationUser.role || '').toUpperCase());
    }).map(operationUser => {
      const keys = new Set([operationUser.uid, operationUser.empID, operationUser.email, operationUser.displayName, operationUser.fullName].map(normalize).filter(Boolean));
      const ideas = operationData.ideasCreated.filter(task => matches(keys, task.idea_emp_id, task.createdBy)).length;
      const employeeListings = activeListings.filter(listing => (
        getListingEmployeeIds(listing).some(employeeId => keys.has(employeeId))
      ));
      const fulfillCompletedTasks = operationData.tasksDesignSubmitted.filter(task => matches(keys, task.designerId, task.designerName));
      const ideaCompletedTasks = operationData.ideasDesignSubmitted.filter(task => matches(keys, task.designerId, task.designerName));
      const fulfillReceivedTasks = operationData.tasksAssigned.filter(task => matches(keys, task.designerId, task.designerName));
      const ideaReceivedTasks = operationData.ideasAssigned.filter(task => matches(keys, task.designerId, task.designerName));
      const saleAttributedIdeas = (operationData.ideasMatchedToSales || []).filter(task => (
        section === 'research-development' || section === 'scale'
          ? matches(keys, task.idea_emp_id, task.createdBy)
          : matches(keys, task.designerId, task.designerName)
      ));
      const ideaSoldSkus = new Set(
        saleAttributedIdeas
          .map(task => normalizeSku(task.sku))
          .filter(Boolean)
      );
      const ideaSaleRows = [...ideaSoldSkus]
        .map(sku => ({ sku, sales: ideaSaleStats.salesBySku.get(sku) || 0 }))
        .filter(item => item.sales > 0)
        .sort((a, b) => b.sales - a.sales || a.sku.localeCompare(b.sku));
      const ideaSales = ideaSaleRows.reduce((sum, item) => sum + item.sales, 0);
      const ideaSaleBreakdown = ideaSaleRows.map(item => ({
        label: item.sku,
        value: `${item.sales.toLocaleString()} lượt sale`,
        secondary: 'Số task Fulfill khớp SKU trong kỳ',
      }));
      const employeeSales = employeeSkuSales.get(normalize(operationUser.empID));
      const saleBreakdown = employeeSales
        ? [...employeeSales.skus.entries()]
          .sort(([, left], [, right]) => right.quantity - left.quantity)
          .map(([sku, item]) => ({
            label: sku,
            value: `${item.quantity.toLocaleString()} qty · ${formatUsd(item.revenueUsd)}`,
            secondary: `${item.orderIds.size.toLocaleString()} orders${item.names.size ? ` · ${[...item.names].slice(0, 2).join(' · ')}` : ''}`,
          }))
        : [];
      const employeeCohort = calculateListingCohortStats(employeeListings, listingCohortIndex, selectedRangeEndIso);
      const completedTasks = section === 'designer-idea'
        ? ideaCompletedTasks
        : section === 'designer-fulfillment'
          ? fulfillCompletedTasks
          : [...fulfillCompletedTasks, ...ideaCompletedTasks];
      const receivedTasks = section === 'designer-idea'
        ? ideaReceivedTasks
        : section === 'designer-fulfillment'
          ? fulfillReceivedTasks
          : [...fulfillReceivedTasks, ...ideaReceivedTasks];
      const createdCustomerTasks = operationData.tasksCreated.filter(task => matches(keys, task.cs_id, task.createdBy));
      const supportCompletion = getSupportCompletedTasks(operationData, task => (
        task.submitted_to_new_by
          ? matches(keys, task.submitted_to_new_by)
          : matches(keys, task.cs_id, task.createdBy)
      ));
      const closedCustomerTasks = supportCompletion.tasks;
      const fulfilledTasks = operationData.tasksFulfilled.filter(task => (
        task.fulfilled_by
          ? matches(keys, task.fulfilled_by)
          : matches(keys, task.cs_id, task.createdBy)
      ));
      const fulfilled = countUniqueTaskOrders(fulfilledTasks);
      const points = section === 'designer-idea'
        ? ideaCompletedTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'idea', templatePoints), 0)
        : section === 'designer-fulfillment'
          ? fulfillCompletedTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'fulfill', templatePoints), 0)
          : fulfillCompletedTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'fulfill', templatePoints), 0)
            + ideaCompletedTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'idea', templatePoints), 0);
      const ideaPoints = ideaCompletedTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'idea', templatePoints), 0);
      const fulfillPoints = fulfillCompletedTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'fulfill', templatePoints), 0);
      const normalizedRole = String(operationUser.role || '').toUpperCase();
      const normalizedTeam = String(operationUser.teamId || '').toUpperCase();
      const designerHomeSection = normalizedRole.endsWith('_FULFILL')
        ? 'designer-fulfillment'
        : normalizedRole.endsWith('_IDEA')
          ? 'designer-idea'
          : normalizedTeam.includes('FULFILL') || normalizedTeam.endsWith('_FF')
            ? 'designer-fulfillment'
            : normalizedTeam.includes('IDEA')
              ? 'designer-idea'
              : ideaPoints >= fulfillPoints
                ? 'designer-idea'
                : 'designer-fulfillment';
      const isIdeaHome = designerHomeSection === 'designer-idea';
      const supportCompleted = isIdeaHome ? fulfillCompletedTasks.length : ideaCompletedTasks.length;
      const supportPoints = isIdeaHome ? fulfillPoints : ideaPoints;
      const supportOrderCount = countUniqueTaskOrders(closedCustomerTasks);
      const customerOrderTypes = countTaskOrdersByCustomization(closedCustomerTasks, supportOrderCustomization);
      const customCustomerTasks = closedCustomerTasks.filter(task => supportOrderCustomization.get(getTaskOrderKey(task)) === true);
      const nonCustomCustomerTasks = closedCustomerTasks.filter(task => supportOrderCustomization.get(getTaskOrderKey(task)) !== true);
      const customCycleStats = section === 'customer-service'
        ? calculateDurationStats(customCustomerTasks, task => task.created_at, task => task.submitted_to_new_at, performanceCalendar)
        : { average: null, durations: [] as number[] };
      const nonCustomCycleStats = section === 'customer-service'
        ? calculateDurationStats(nonCustomCustomerTasks, task => task.created_at, task => task.submitted_to_new_at, performanceCalendar)
        : { average: null, durations: [] as number[] };
      const received = section === 'customer-service'
        ? countUniqueTaskOrders(createdCustomerTasks)
        : receivedTasks.length;
      const completed = section === 'customer-service'
        ? supportOrderCount
        : section === 'fulfillment'
          ? fulfilled
          : completedTasks.length;
      const customerCycleDurations = [...customCycleStats.durations, ...nonCustomCycleStats.durations]
        .sort((left, right) => left - right);
      const cycleStats = section === 'customer-service'
        ? {
          average: customerCycleDurations.length
            ? customerCycleDurations.reduce((sum, hours) => sum + hours, 0) / customerCycleDurations.length
            : null,
          durations: customerCycleDurations,
        }
        : section === 'fulfillment'
          ? calculateDurationStats(fulfilledTasks, task => task.design_submitted_at, task => task.fulfilled_at, performanceCalendar, 'latest')
          : { average: null, durations: [] as number[] };
      const output = section === 'research-development' || section === 'scale'
        ? employeeListings.length
        : section === 'customer-service'
          ? supportOrderCount
          : section === 'fulfillment'
            ? fulfilled
          : isDesignerSection
            ? completed
            : ideas + completed + fulfilled;
      return {
        id: operationUser.uid,
        name: operationUser.displayName || operationUser.empID || operationUser.email || operationUser.uid,
        role: operationUser.role || 'Chưa gán role',
        teamId: operationUser.teamId,
        ideas,
        designs: completed,
        fulfilled,
        received,
        completed,
        customOrdersCompleted: customerOrderTypes.custom,
        nonCustomOrdersCompleted: customerOrderTypes.nonCustom,
        points,
        supportCompleted,
        supportPoints,
        supportBoard: isIdeaHome ? 'Designer Fulfillment' as const : 'Designer Idea' as const,
        creditedPoints: isDesignerSection ? points + supportPoints : points,
        designerHomeSection,
        ideasWithSales: ideaSaleRows.length,
        ideaSales,
        ideaSaleBreakdown,
        listings: employeeListings.length,
        listingsWithSales: employeeCohort.listingsWithFirstSale,
        soldSkus: employeeSales?.skus.size || 0,
        saleQuantity: employeeSales?.quantity || 0,
        saleRevenueUsd: employeeSales?.revenueUsd || 0,
        saleOrders: employeeSales?.orderIds.size || 0,
        saleBreakdown,
        averageFirstSaleHours: employeeCohort.averageFirstSaleHours,
        firstSaleCohort: employeeCohort.firstSaleDurationsHours.length,
        firstSaleHoursTotal: employeeCohort.firstSaleDurationsHours.reduce((sum, hours) => sum + hours, 0),
        firstSaleDurationsHours: employeeCohort.firstSaleDurationsHours,
        firstSaleD7Eligible: employeeCohort.d7Eligible,
        firstSaleD7Converted: employeeCohort.d7Converted,
        firstSaleD7Rate: employeeCohort.d7Rate,
        firstSaleD14Eligible: employeeCohort.d14Eligible,
        firstSaleD14Converted: employeeCohort.d14Converted,
        firstSaleD14Rate: employeeCohort.d14Rate,
        firstSaleD30Eligible: employeeCohort.d30Eligible,
        firstSaleD30Converted: employeeCohort.d30Converted,
        firstSaleD30Rate: employeeCohort.d30Rate,
        averageCycleHours: cycleStats.average,
        cycleDurationsHours: cycleStats.durations,
        averageCustomCycleHours: customCycleStats.average,
        averageNonCustomCycleHours: nonCustomCycleStats.average,
        output,
      };
    }).filter(row => !isDesignerSection || row.designerHomeSection === section);

    const primaryKpi = getPrimaryKpiDefinition(section);
    const attachKpi = (row: typeof rows[number]): EmployeePerformanceRow => {
      const matchingTargets = primaryKpi
        ? kpiTargets
          .filter(target => (
            target.active !== false
            && target.metricCode === primaryKpi.code
            && target.effectiveFrom <= kpiAnchorDate
            && (!target.effectiveTo || target.effectiveTo >= kpiAnchorDate)
          ))
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')))
        : [];
      const assignedTarget = matchingTargets.find(target => target.scope === 'employee' && target.scopeId === row.id)
        || matchingTargets.find(target => target.scope === 'role' && target.scopeId.toUpperCase() === row.role.toUpperCase())
        || matchingTargets.find(target => target.scope === 'department' && (
          target.scopeId === section || target.sectionId === section || target.departmentId === section
        ));
      let actual = primaryKpi?.getActual(row) ?? row.output;
      let kpiProgress = assignedTarget
        ? calculateKpiProgress(assignedTarget.period, assignedTarget.targetValue, actual, kpiAnchorDate, performanceCalendar.timeZone, assignedTarget.effectiveFrom, assignedTarget.effectiveTo, performanceCalendar)
        : null;

      if (assignedTarget) {
        const periodWindow = getEffectiveKpiPeriodWindow(assignedTarget.period, kpiAnchorDate, assignedTarget.effectiveFrom, assignedTarget.effectiveTo);
        const progressTo = kpiProgress?.asOf || periodWindow.to;
        const progressUser = kpiOperationData.users.find(operationUser => operationUser.uid === row.id);
        const progressKeys = new Set([
          row.id,
          row.name,
          progressUser?.empID,
          progressUser?.email,
          progressUser?.displayName,
          progressUser?.fullName,
        ].map(normalize).filter(Boolean));
        const inProgressRange = (task: OperationTask, field: keyof Pick<OperationTask, 'created_at' | 'design_submitted_at' | 'fulfilled_at' | 'submitted_to_new_at'>) => (
          isDateInRange(task[field], periodWindow.from, progressTo, performanceCalendar.timeZone)
        );

        if (isDesignerSection) {
          const fulfillTasks = kpiOperationData.tasksDesignSubmitted.filter(task => (
            inProgressRange(task, 'design_submitted_at') && matches(progressKeys, task.designerId, task.designerName)
          ));
          const ideaTasks = kpiOperationData.ideasDesignSubmitted.filter(task => (
            inProgressRange(task, 'design_submitted_at') && matches(progressKeys, task.designerId, task.designerName)
          ));
          actual = fulfillTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'fulfill', kpiTemplatePoints), 0)
            + ideaTasks.reduce((sum, task) => sum + taskTemplatePoints(task, 'idea', kpiTemplatePoints), 0);
        } else if (section === 'research-development' || section === 'scale') {
          const progressListings = activeKpiListings.filter(listing => (
            isListingDateInRange(listing.create_date, periodWindow.from, progressTo, performanceCalendar.timeZone)
            && getListingEmployeeIds(listing).some(employeeId => progressKeys.has(employeeId))
          ));
          actual = progressListings.length;
        } else if (section === 'customer-service') {
          const exactTasks = kpiOperationData.tasksSubmittedToNew.filter(task => (
            inProgressRange(task, 'submitted_to_new_at')
            && (task.submitted_to_new_by
              ? matches(progressKeys, task.submitted_to_new_by)
              : matches(progressKeys, task.cs_id, task.createdBy))
          ));
          actual = countUniqueTaskOrders(exactTasks);
        } else if (section === 'fulfillment') {
          actual = countUniqueTaskOrders(kpiOperationData.tasksFulfilled.filter(task => (
            inProgressRange(task, 'fulfilled_at')
            && (task.fulfilled_by
              ? matches(progressKeys, task.fulfilled_by)
              : matches(progressKeys, task.cs_id, task.createdBy))
          )));
        }

        kpiProgress = calculateKpiProgress(assignedTarget.period, assignedTarget.targetValue, actual, kpiAnchorDate, performanceCalendar.timeZone, assignedTarget.effectiveFrom, assignedTarget.effectiveTo, performanceCalendar);
      }

      const effectiveTarget = assignedTarget?.targetValue ?? null;

      return {
        ...row,
        kpiCode: primaryKpi?.code || '',
        kpiLabel: primaryKpi?.label || 'Output',
        kpiTarget: effectiveTarget,
        kpiActual: actual,
        kpiCompletion: kpiProgress?.completion ?? null,
        kpiUnit: assignedTarget?.unit || primaryKpi?.unit || '',
        kpiTargetSource: assignedTarget?.scope || null,
        kpiProgress,
      };
    };

    return rows.map(attachKpi).sort((a, b) => isDesignerSection
      ? b.creditedPoints - a.creditedPoints || b.completed - a.completed || a.name.localeCompare(b.name)
      : section === 'research-development' || section === 'scale'
        ? b.listings - a.listings || b.saleQuantity - a.saleQuantity || b.soldSkus - a.soldSkus || a.name.localeCompare(b.name)
        : b.kpiActual - a.kpiActual || b.completed - a.completed || a.name.localeCompare(b.name));
  }, [activeKpiListings, activeListings, employeeSkuSales, ideaSaleStats.salesBySku, kpiAnchorDate, kpiOperationData, kpiTargets, kpiTemplatePoints, listingCohortIndex, operationData, performanceCalendar, section, selectedRangeEndIso, templatePoints, timeZone]);

  const viewer = useMemo(() => {
    const email = String(user.email || '').trim().toLowerCase();
    return rawOperationData.users.find(operationUser => operationUser.uid === user.uid)
      || rawOperationData.users.find(operationUser => String(operationUser.email || '').trim().toLowerCase() === email);
  }, [rawOperationData.users, user.email, user.uid]);
  const accessLevel = useMemo<PerformanceAccessLevel>(() => {
    const businessRole = String(viewer?.role || '').toUpperCase();
    if (dashboardRole === 'owner' || permissions.viewAllPerformanceData === true || businessRole === 'ADMIN' || businessRole === 'MANAGER') return 'manager';
    if (permissions.viewTeamPerformanceData === true) return 'leader';
    return 'employee';
  }, [dashboardRole, permissions.viewAllPerformanceData, permissions.viewTeamPerformanceData, viewer?.role]);
  const employees = useMemo(() => {
    if (accessLevel === 'employee') {
      return permissions.viewOwnPerformanceData === false
        ? []
        : allEmployees.filter(employee => employee.id === user.uid);
    }
    if (accessLevel === 'leader') {
      const viewerRole = String(viewer?.role || '').toUpperCase();
      const teamRoles = TEAM_ROLES_BY_ROLE[viewerRole];
      return teamRoles
        ? allEmployees.filter(employee => teamRoles.includes(String(employee.role || '').toUpperCase()))
        : allEmployees.filter(employee => employee.id === user.uid);
    }
    return allEmployees;
  }, [accessLevel, allEmployees, permissions.viewOwnPerformanceData, user.uid, viewer?.role]);

  const attributedOperationStats = useMemo(() => {
    const visibleEmployeeIds = new Set(employees.map(employee => employee.id));
    const identityKeys = new Set(operationData.users
      .filter(operationUser => visibleEmployeeIds.has(operationUser.uid))
      .flatMap(operationUser => [
        operationUser.uid,
        operationUser.empID,
        operationUser.email,
        operationUser.displayName,
        operationUser.fullName,
      ].map(normalizeScopeKey).filter(Boolean)));
    const matchesVisibleEmployee = (...values: unknown[]) => (
      values.some(value => identityKeys.has(normalizeScopeKey(value)))
    );
    const supportCompleted = getSupportCompletedTasks(operationData, task => (
      task.submitted_to_new_by
        ? matchesVisibleEmployee(task.submitted_to_new_by)
        : matchesVisibleEmployee(task.cs_id, task.createdBy)
    ));
    const fulfilledTasks = operationData.tasksFulfilled.filter(task => (
      task.fulfilled_by
        ? matchesVisibleEmployee(task.fulfilled_by)
        : matchesVisibleEmployee(task.cs_id, task.createdBy)
    ));

    return {
      supportCompleted,
      fulfilledTasks,
      fulfillmentDuration: calculateDurationStats(
        fulfilledTasks,
        task => task.design_submitted_at,
        task => task.fulfilled_at,
        performanceCalendar,
        'latest',
      ),
    };
  }, [employees, operationData, performanceCalendar]);

  const liveBaselineSeries = useMemo<EmployeeKpiBaselineSeries[]>(() => {
    const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
    const employeeIdByKey = new Map<string, string>();
    const valuesByEmployee = new Map<string, { daily: Map<string, number>; monthly: Map<string, number> }>();
    const usersById = new Map(operationData.users.map(operationUser => [operationUser.uid, operationUser]));
    const seenDailyOutputs = new Set<string>();

    employees.forEach(employee => {
      valuesByEmployee.set(employee.id, { daily: new Map(), monthly: new Map() });
      const operationUser = usersById.get(employee.id);
      [employee.id, employee.name, operationUser?.empID, operationUser?.email, operationUser?.displayName, operationUser?.fullName]
        .map(normalize)
        .filter(Boolean)
        .forEach(key => employeeIdByKey.set(key, employee.id));
    });

    const addValue = (keys: unknown[], dateValue: unknown, value: number, uniqueKey?: string) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const employeeId = keys.map(normalize).find(key => employeeIdByKey.has(key));
      if (!employeeId) return;
      const buckets = valuesByEmployee.get(employeeId);
      const dayKey = getDateKeyInTimeZone(dateValue as OperationTask['created_at'], timeZone);
      if (!buckets || !dayKey) return;
      const dedupeKey = uniqueKey ? `${employeeId}:${dayKey}:${uniqueKey}` : '';
      if (dedupeKey && seenDailyOutputs.has(dedupeKey)) return;
      if (dedupeKey) seenDailyOutputs.add(dedupeKey);
      buckets.daily.set(dayKey, (buckets.daily.get(dayKey) || 0) + value);
      const monthKey = dayKey.slice(0, 7);
      buckets.monthly.set(monthKey, (buckets.monthly.get(monthKey) || 0) + value);
    };

    if (section === 'designer-idea' || section === 'designer-fulfillment') {
      operationData.tasksDesignSubmitted.forEach(task => addValue(
        [task.designerId, task.designerName],
        task.design_submitted_at,
        taskTemplatePoints(task, 'fulfill', templatePoints)
      ));
      operationData.ideasDesignSubmitted.forEach(task => addValue(
        [task.designerId, task.designerName],
        task.design_submitted_at,
        taskTemplatePoints(task, 'idea', templatePoints)
      ));
    } else if (section === 'research-development' || section === 'scale') {
      activeListings.forEach(listing => addValue(
        getListingEmployeeIds(listing),
        listing.create_date,
        1
      ));
    } else if (section === 'customer-service') {
      getSupportCompletedTasks(operationData).tasks.forEach(task => addValue(
        [task.submitted_to_new_by, task.cs_id, task.createdBy],
        task.submitted_to_new_at || task.created_at,
        1,
        getTaskOrderKey(task)
      ));
    } else if (section === 'fulfillment') {
      operationData.tasksFulfilled.forEach(task => addValue(
        [task.fulfilled_by, ...(task.fulfilled_by ? [] : [task.cs_id, task.createdBy])],
        task.fulfilled_at,
        1,
        getTaskOrderKey(task)
      ));
    }

    return employees.map(employee => {
      const values = valuesByEmployee.get(employee.id);
      return {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        dailyValues: values ? [...values.daily.values()] : [],
        monthlyValues: values ? [...values.monthly.values()] : [],
        d7Rate: employee.firstSaleD7Rate,
        d14Rate: employee.firstSaleD14Rate,
        d30Rate: employee.firstSaleD30Rate,
      };
    });
  }, [activeListings, employees, operationData, section, templatePoints, timeZone]);

  const persistedBaselineSeries = useMemo<EmployeeKpiBaselineSeries[]>(() => {
    const bucketsByEmployee = new Map<string, { daily: number[]; monthly: number[] }>();
    baselineAggregate.buckets.forEach(bucket => {
      const values = bucketsByEmployee.get(bucket.employeeId) || { daily: [], monthly: [] };
      values[bucket.granularity].push(bucket.outputTotal);
      bucketsByEmployee.set(bucket.employeeId, values);
    });
    return employees.map(employee => {
      const values = bucketsByEmployee.get(employee.id);
      return {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        dailyValues: values?.daily || [],
        monthlyValues: values?.monthly || [],
        d7Rate: employee.firstSaleD7Rate,
        d14Rate: employee.firstSaleD14Rate,
        d30Rate: employee.firstSaleD30Rate,
      };
    });
  }, [baselineAggregate.buckets, employees]);
  const hasPersistedBaseline = baselineAggregate.available;
  const canUseLiveBaseline = baselineAggregate.rangeFrom === filterFrom && baselineAggregate.rangeTo === filterTo;
  const baselineSeries = hasPersistedBaseline
    ? persistedBaselineSeries
    : canUseLiveBaseline ? liveBaselineSeries : [];

  const visibleListingStats = useMemo(() => {
    const from = new Date(`${filterDateRange.from.slice(0, 10)}T00:00:00Z`).getTime();
    const to = new Date(`${filterDateRange.to.slice(0, 10)}T00:00:00Z`).getTime();
    const dayCount = Number.isFinite(from) && Number.isFinite(to) ? Math.max(1, Math.floor((to - from) / 86400000) + 1) : 1;
    const listedCount = employees.reduce((sum, employee) => sum + employee.listings, 0);
    const firstSaleCohort = employees.reduce((sum, employee) => sum + employee.firstSaleCohort, 0);
    const firstSaleHoursTotal = employees.reduce((sum, employee) => sum + employee.firstSaleHoursTotal, 0);
    const d7Eligible = employees.reduce((sum, employee) => sum + employee.firstSaleD7Eligible, 0);
    const d7Converted = employees.reduce((sum, employee) => sum + employee.firstSaleD7Converted, 0);
    const d14Eligible = employees.reduce((sum, employee) => sum + employee.firstSaleD14Eligible, 0);
    const d14Converted = employees.reduce((sum, employee) => sum + employee.firstSaleD14Converted, 0);
    const d30Eligible = employees.reduce((sum, employee) => sum + employee.firstSaleD30Eligible, 0);
    const d30Converted = employees.reduce((sum, employee) => sum + employee.firstSaleD30Converted, 0);
    return {
      listedCount,
      listedPerDay: listedCount / dayCount,
      listingsWithSales: employees.reduce((sum, employee) => sum + employee.listingsWithSales, 0),
      averageFirstSaleHours: firstSaleCohort ? firstSaleHoursTotal / firstSaleCohort : null,
      firstSaleCohort,
      d7Eligible,
      d7Converted,
      d7Rate: d7Eligible ? d7Converted / d7Eligible * 100 : null,
      d14Eligible,
      d14Converted,
      d14Rate: d14Eligible ? d14Converted / d14Eligible * 100 : null,
      d30Eligible,
      d30Converted,
      d30Rate: d30Eligible ? d30Converted / d30Eligible * 100 : null,
      unmappedCount: accessLevel === 'manager' ? listingStats.unmappedCount : 0,
      listingBreakdown: accessLevel === 'manager' ? listingStats.listingBreakdown : [],
    };
  }, [accessLevel, employees, filterDateRange.from, filterDateRange.to, listingStats.listingBreakdown, listingStats.unmappedCount]);

  const companyOverviewCharts = useMemo<CompanyOverviewChartData>(() => {
    if (section !== 'company-overview') {
      return {
        activityTrend: [],
        supplierBreakdown: [],
        supplierCoverage: null,
        ratingComparison: [],
      };
    }
    const activityTrend = getDateRangeKeys(filterDateRange.from, filterDateRange.to).map(date => ({
      date,
      label: formatTrendDateLabel(date),
      listings: 0,
      designerIdea: 0,
      designerFulfillment: 0,
      csCompleted: 0,
      fulfilled: 0,
    }));
    const rowsByDate = new Map(activityTrend.map(row => [row.date, row]));
    type ActivityMetric = 'listings' | 'designerIdea' | 'designerFulfillment' | 'csCompleted' | 'fulfilled';
    const addActivity = (value: OperationTask['created_at'] | string | null | undefined, metric: ActivityMetric) => {
      const dateKey = getDateKeyInTimeZone(value, timeZone);
      const row = rowsByDate.get(dateKey);
      if (row) row[metric] += 1;
    };

    [...new Map(operationData.listings
      .filter(listing => isListingDateInRange(listing.create_date, filterDateRange.from, filterDateRange.to, timeZone))
      .map(listing => [listing.listing_id, listing])).values()]
      .forEach(listing => addActivity(listing.create_date, 'listings'));
    operationData.ideasDesignSubmitted.forEach(task => addActivity(task.design_submitted_at, 'designerIdea'));
    operationData.tasksDesignSubmitted.forEach(task => addActivity(task.design_submitted_at, 'designerFulfillment'));

    const addUniqueOrderActivity = (
      tasks: OperationTask[],
      getValue: (task: OperationTask) => OperationTask['created_at'],
      metric: 'csCompleted' | 'fulfilled',
      useLatest: boolean,
    ) => {
      const eventByOrder = new Map<string, { timestamp: number; value: OperationTask['created_at'] }>();
      tasks.forEach(task => {
        const value = getValue(task);
        const timestamp = normalizeDateValue(value)?.getTime();
        if (!timestamp) return;
        const orderKey = getTaskOrderKey(task);
        const current = eventByOrder.get(orderKey);
        if (!current || (useLatest ? timestamp > current.timestamp : timestamp < current.timestamp)) {
          eventByOrder.set(orderKey, { timestamp, value });
        }
      });
      eventByOrder.forEach(event => addActivity(event.value, metric));
    };

    addUniqueOrderActivity(
      stats.supportCompleted.tasks,
      task => task.submitted_to_new_at || task.created_at,
      'csCompleted',
      false,
    );
    addUniqueOrderActivity(operationData.tasksFulfilled, task => task.fulfilled_at, 'fulfilled', true);

    const supplierRows = stats.fulfillmentSupplierRows;
    const supplierBreakdown = supplierRows.length <= 8
      ? supplierRows
      : [
        ...supplierRows.slice(0, 7),
        { name: 'Khác', value: supplierRows.slice(7).reduce((sum, item) => sum + item.value, 0) },
      ];

    return {
      activityTrend,
      supplierBreakdown,
      supplierCoverage: stats.fulfillmentDataCoverage,
      ratingComparison: stats.ratingComparison.slice(0, 12),
    };
  }, [filterDateRange.from, filterDateRange.to, operationData.ideasDesignSubmitted, operationData.listings, operationData.tasksDesignSubmitted, operationData.tasksFulfilled, section, stats.fulfillmentDataCoverage, stats.fulfillmentSupplierRows, stats.ratingComparison, stats.supportCompleted.tasks, timeZone]);

  const metrics = useMemo<PerformanceMetric[]>(() => {
    const listingTarget = `Trung bình ${visibleListingStats.listedPerDay.toFixed(1)} listing/ngày`;
    const cohortTarget = `Có sale trong 7 ngày: ${formatPercentage(visibleListingStats.d7Rate)} · 14 ngày: ${formatPercentage(visibleListingStats.d14Rate)} · 30 ngày: ${formatPercentage(visibleListingStats.d30Rate)}`;
    const sectionSoldSkuTotal = employees.reduce((sum, employee) => sum + employee.soldSkus, 0);
    const sectionSalesTotal = employees.reduce((sum, employee) => sum + employee.saleQuantity, 0);
    const sectionSaleRevenueUsd = employees.reduce((sum, employee) => sum + employee.saleRevenueUsd, 0);
    const sectionSaleBreakdown = employees
      .filter(employee => employee.saleQuantity > 0)
      .sort((a, b) => b.saleQuantity - a.saleQuantity)
      .flatMap(employee => employee.saleBreakdown.map(item => ({
        ...item,
        secondary: `${employee.name}${item.secondary ? ` · ${item.secondary}` : ''}`,
      })));
    const rawSupportOrderCount = countUniqueTaskOrders(stats.supportCompleted.tasks);
    const rawFulfillmentOrderCount = countUniqueTaskOrders(operationData.tasksFulfilled);
    const attributedSupportOrderCount = countUniqueTaskOrders(attributedOperationStats.supportCompleted.tasks);
    const attributedFulfillmentOrderCount = countUniqueTaskOrders(attributedOperationStats.fulfilledTasks);
    const supportTasks = accessLevel === 'manager'
      ? stats.supportCompleted.tasks
      : attributedOperationStats.supportCompleted.tasks;
    const supportOrderCount = accessLevel === 'manager' ? rawSupportOrderCount : attributedSupportOrderCount;
    const fulfillmentOrderCount = accessLevel === 'manager' ? rawFulfillmentOrderCount : attributedFulfillmentOrderCount;
    const operationalCompleted = section === 'customer-service'
      ? supportOrderCount
      : section === 'fulfillment'
        ? fulfillmentOrderCount
        : employees.reduce((sum, employee) => sum + employee.output, 0);
    const customerOrderTypes = countTaskOrdersByCustomization(supportTasks);
    const customOrdersCompleted = section === 'customer-service'
      ? customerOrderTypes.custom
      : employees.reduce((sum, employee) => sum + employee.customOrdersCompleted, 0);
    const nonCustomOrdersCompleted = section === 'customer-service'
      ? customerOrderTypes.nonCustom
      : employees.reduce((sum, employee) => sum + employee.nonCustomOrdersCompleted, 0);
    const { customCsDuration, nonCustomCsDuration, customCompletionOrigin, nonCustomCompletionOrigin } = section === 'customer-service'
      ? (() => {
        const supportCustomization = getTaskOrderCustomization(supportTasks);
        const customSupportTasks = supportTasks.filter(task => supportCustomization.get(getTaskOrderKey(task)) === true);
        const nonCustomSupportTasks = supportTasks.filter(task => supportCustomization.get(getTaskOrderKey(task)) !== true);
        return {
          customCsDuration: calculateDurationStats(customSupportTasks, task => task.created_at, task => task.submitted_to_new_at, performanceCalendar),
          nonCustomCsDuration: calculateDurationStats(nonCustomSupportTasks, task => task.created_at, task => task.submitted_to_new_at, performanceCalendar),
          customCompletionOrigin: getSupportCompletionOrigin(customSupportTasks, timeZone),
          nonCustomCompletionOrigin: getSupportCompletionOrigin(nonCustomSupportTasks, timeZone),
        };
      })()
      : {
        customCsDuration: { average: null, durations: [] as number[] },
        nonCustomCsDuration: { average: null, durations: [] as number[] },
        customCompletionOrigin: { sameDay: 0, fromPreviousDays: 0, breakdown: [] as PerformanceBreakdownItem[] },
        nonCustomCompletionOrigin: { sameDay: 0, fromPreviousDays: 0, breakdown: [] as PerformanceBreakdownItem[] },
      };
    const customCsTimeCoverage = customOrdersCompleted
      ? Math.min(100, customCsDuration.durations.length / customOrdersCompleted * 100)
      : null;
    const nonCustomCsTimeCoverage = nonCustomOrdersCompleted
      ? Math.min(100, nonCustomCsDuration.durations.length / nonCustomOrdersCompleted * 100)
      : null;
    const incomingFunnel = getSupportIncomingFunnel(operationData.tasksCreated, selectedRangeEndIso, timeZone);
    const operationalDurations = section === 'customer-service'
      ? [...customCsDuration.durations, ...nonCustomCsDuration.durations].sort((left, right) => left - right)
      : section === 'fulfillment'
        ? (accessLevel === 'manager' ? stats.fulfillmentDuration.durations : attributedOperationStats.fulfillmentDuration.durations)
        : employees.flatMap(employee => employee.cycleDurationsHours).sort((left, right) => left - right);
    const operationalAverageHours = operationalDurations.length
      ? operationalDurations.reduce((sum, hours) => sum + hours, 0) / operationalDurations.length
      : null;
    const operationalTimeCoverage = operationalCompleted
      ? Math.min(100, operationalDurations.length / operationalCompleted * 100)
      : null;
    const selectedPod = boards.find(board => board.uid === selectedBoardId);
    const accessLabel = accessLevel === 'manager'
      ? 'Toàn bộ nhân sự được phép xem'
      : accessLevel === 'leader'
        ? 'Nhân sự thuộc role/team Leader phụ trách'
        : 'Chỉ dữ liệu của tài khoản đang đăng nhập';

    const sectionMetrics: PerformanceMetric[] = (() => {
      switch (section) {
      case 'company-overview':
        {
          const listingCount = companyOverviewCharts.activityTrend.reduce((sum, row) => sum + row.listings, 0);
          const lifetimeRating = stats.lifetimeReviewAverage === null ? '—' : `${stats.lifetimeReviewAverage.toFixed(2)} ★`;
          return [
            realMetric({ code: 'COMPANY_IDEA_NEW', label: 'Idea mới (listing)', value: listingCount.toLocaleString(), target: 'Listing duy nhất có create_date trong phạm vi', progress: 100, tone: listingCount ? 'green' : 'gray' }),
            realMetric({ code: 'COMPANY_DS_IDEA_SUBMITTED', label: 'Designer Idea submit', value: operationData.ideasDesignSubmitted.length.toLocaleString(), target: 'Task Idea có design_submitted_at trong phạm vi', progress: 100, tone: operationData.ideasDesignSubmitted.length ? 'green' : 'gray' }),
            realMetric({ code: 'COMPANY_DS_FULFILL_SUBMITTED', label: 'Designer Fulfill submit', value: operationData.tasksDesignSubmitted.length.toLocaleString(), target: 'Task Fulfill có design_submitted_at trong phạm vi', progress: 100, tone: operationData.tasksDesignSubmitted.length ? 'green' : 'gray' }),
            realMetric({ code: 'COMPANY_DS_TIME', label: 'TB thời gian Designer', value: formatFirstSaleDuration(stats.designerDuration.average), secondaryValue: 'Từ lúc nhận task đến lúc submit file', target: `${stats.designerDuration.durations.length}/${operationData.ideasDesignSubmitted.length + operationData.tasksDesignSubmitted.length} task đủ mốc · Theo lịch làm việc VN`, progress: 100, tone: stats.designerDuration.average === null ? 'gray' : 'green' }),
            realMetric({ code: 'COMPANY_CS_CLOSED', label: 'Đơn CS đã xử lý', value: countUniqueTaskOrders(stats.supportCompleted.tasks).toLocaleString(), target: 'Order duy nhất hoàn tất bước CS trong phạm vi', progress: 100, tone: stats.supportCompleted.tasks.length ? 'green' : 'gray' }),
            realMetric({ code: 'COMPANY_FULFILLED', label: 'Đơn đã Fulfill', value: countUniqueTaskOrders(operationData.tasksFulfilled).toLocaleString(), target: `Theo fulfilled_at trong phạm vi · Supplier coverage ${formatPercentage(stats.fulfillmentDataCoverage)}`, progress: 100, tone: operationData.tasksFulfilled.length ? 'green' : 'gray' }),
            realMetric({ code: 'COMPANY_FF_TIME', label: 'TB thời gian Fulfill', value: formatFirstSaleDuration(stats.fulfillmentDuration.average), secondaryValue: 'Giờ làm việc thực tế', target: 'Từ design_submitted_at đến fulfilled_at; loại giờ nghỉ trưa, ngoài ca, ngày nghỉ và holiday', progress: 100, tone: stats.fulfillmentDuration.average === null ? 'gray' : 'green' }),
            realMetric({ code: 'COMPANY_RATING', label: 'Rating trung bình', value: stats.reviewCount ? `${stats.averageRating.toFixed(2)} ★` : '—', secondaryValue: `Toàn thời gian: ${lifetimeRating} · ${formatRatingDelta(stats.reviewAverageDelta)}`, target: `${stats.reviewCount.toLocaleString()} review trong phạm vi · So sánh với rating toàn thời gian`, progress: stats.positiveReviewRate || 0, tone: stats.reviewCount === 0 ? 'gray' : stats.reviewAverageDelta !== null && stats.reviewAverageDelta < -0.1 ? 'red' : stats.averageRating >= 4.5 ? 'green' : 'amber', breakdown: stats.ratingBreakdown, drillDownLabel: stats.reviewCount ? 'Xem rating theo shop' : undefined }),
          ];
        }
      case 'designer-idea':
        return [
          realMetric({ code: 'DS_IDEA_RECEIVED', label: 'File đã nhận', value: designerTotals.ideaReceived.toLocaleString(), target: 'Theo assigned_to_designer_at', progress: 100, tone: 'green' }),
          realMetric({ code: 'DS_IDEA_COMPLETED', label: 'File đã hoàn thành', value: designerTotals.ideaCompleted.toLocaleString(), target: 'Theo design_submitted_at', progress: 100, tone: 'green' }),
          realMetric({ code: 'DS_IDEA_POINTS', label: 'Tổng điểm', value: designerTotals.ideaPoints.toLocaleString(), target: `Điểm template Idea; mặc định ${DESIGNER_POINT_RULES.defaultIdeaPointsPerTemplate} điểm/template`, progress: 100, tone: 'green' }),
          realMetric({ code: 'IDEA_SALES', label: 'SKU Idea phát sinh sale', value: `${ideaSaleStats.ideasWithSalesCount.toLocaleString()} SKU · ${ideaSaleStats.totalSales.toLocaleString()} lượt`, target: 'SKU = số Idea duy nhất có sale · Lượt = số task Fulfill khớp các SKU đó trong kỳ', progress: 100, tone: ideaSaleStats.ideasWithSalesCount ? 'green' : 'gray', drillDownLabel: 'Xem SKU và số lượt sale', breakdown: ideaSaleStats.skuBreakdown }),
        ];
      case 'designer-fulfillment':
        return [
          realMetric({ code: 'DS_FF_RECEIVED', label: 'File đã nhận', value: designerTotals.fulfillReceived.toLocaleString(), target: 'Theo assigned_to_designer_at', progress: 100, tone: 'green' }),
          realMetric({ code: 'DS_FF_COMPLETED', label: 'File đã hoàn thành', value: designerTotals.fulfillCompleted.toLocaleString(), target: 'Theo design_submitted_at', progress: 100, tone: 'green' }),
          realMetric({ code: 'DS_FF_POINTS', label: 'Tổng điểm', value: designerTotals.fulfillPoints.toLocaleString(), target: `Điểm template Fulfill; mặc định ${DESIGNER_POINT_RULES.defaultFulfillmentPointsPerTemplate} điểm/template`, progress: 100, tone: 'green' }),
          unavailableMetric('DS_WRONG_TEMPLATE_RATE', 'Tỷ lệ sai template', 'Cần rejectReason chuẩn WRONG_TEMPLATE'),
        ];
      case 'research-development':
        return [
          realMetric({ code: 'RND_LISTINGS_CREATED', label: 'Active listing đã lên', value: visibleListingStats.listedCount.toLocaleString(), target: `${listingTarget} · Chỉ tính state Active`, progress: 100, tone: visibleListingStats.listedCount ? 'green' : 'gray', drillDownLabel: visibleListingStats.listingBreakdown.length ? 'Xem active listing trong kỳ' : undefined, breakdown: visibleListingStats.listingBreakdown }),
          realMetric({ code: 'RND_SOLD_SKUS', label: 'SKU có sale', value: sectionSoldSkuTotal.toLocaleString(), target: `${visibleListingStats.listingsWithSales.toLocaleString()}/${visibleListingStats.listedCount.toLocaleString()} active listing đã có sale · Thời gian có sale đầu tiên trung bình ${formatFirstSaleDuration(visibleListingStats.averageFirstSaleHours)} · ${cohortTarget}`, progress: visibleListingStats.d30Rate || 0, tone: sectionSoldSkuTotal ? 'green' : 'gray' }),
          realMetric({ code: 'RND_SALE_QUANTITY', label: 'Qty sold', value: sectionSalesTotal.toLocaleString(), target: 'Theo order items khớp SKU nhân sự', progress: 100, tone: sectionSalesTotal ? 'green' : 'gray', breakdown: sectionSaleBreakdown, drillDownLabel: sectionSaleBreakdown.length ? 'Xem SKU và số lượng sale' : undefined }),
          realMetric({ code: 'RND_SALE_REVENUE', label: 'Doanh thu sale', value: formatUsd(sectionSaleRevenueUsd), target: 'Net revenue quy đổi USD · Đã phân bổ discount và shipping theo từng item', progress: 100, tone: sectionSaleRevenueUsd > 0 ? 'green' : 'gray', breakdown: sectionSaleBreakdown, drillDownLabel: sectionSaleBreakdown.length ? 'Xem doanh thu theo SKU' : undefined }),
        ];
      case 'scale':
        return [
          realMetric({ code: 'SCALE_LISTINGS_CREATED', label: 'Active listing đã lên', value: visibleListingStats.listedCount.toLocaleString(), target: `${listingTarget} · Chỉ tính state Active`, progress: 100, tone: visibleListingStats.listedCount ? 'green' : 'gray', drillDownLabel: visibleListingStats.listingBreakdown.length ? 'Xem active listing trong kỳ' : undefined, breakdown: visibleListingStats.listingBreakdown }),
          realMetric({ code: 'SCALE_SOLD_SKUS', label: 'SKU có sale', value: sectionSoldSkuTotal.toLocaleString(), target: `${visibleListingStats.listingsWithSales.toLocaleString()}/${visibleListingStats.listedCount.toLocaleString()} active listing đã có sale · Thời gian có sale đầu tiên trung bình ${formatFirstSaleDuration(visibleListingStats.averageFirstSaleHours)} · ${cohortTarget}`, progress: visibleListingStats.d30Rate || 0, tone: sectionSoldSkuTotal ? 'green' : 'gray' }),
          realMetric({ code: 'SCALE_SALE_QUANTITY', label: 'Qty sold', value: sectionSalesTotal.toLocaleString(), target: 'Theo order items khớp SKU nhân sự', progress: 100, tone: sectionSalesTotal ? 'green' : 'gray', breakdown: sectionSaleBreakdown, drillDownLabel: sectionSaleBreakdown.length ? 'Xem SKU và số lượng sale' : undefined }),
          realMetric({ code: 'SCALE_SALE_REVENUE', label: 'Doanh thu sale', value: formatUsd(sectionSaleRevenueUsd), target: 'Net revenue quy đổi USD · Đã phân bổ discount và shipping theo từng item', progress: 100, tone: sectionSaleRevenueUsd > 0 ? 'green' : 'gray', breakdown: sectionSaleBreakdown, drillDownLabel: sectionSaleBreakdown.length ? 'Xem doanh thu theo SKU' : undefined }),
        ];
      case 'customer-service':
        return [
          realMetric({ code: 'CS_ORDERS_CREATED', label: 'Tổng Đơn ', value: incomingFunnel.total.toLocaleString(), secondaryValue: `Đã chuyển cho Designer ${incomingFunnel.processed}`, target: `Order duy nhất theo created_at; trạng thái xử lý được chốt tại cuối ngày ${filterDateRange.to}`, progress: incomingFunnel.total ? incomingFunnel.processed / incomingFunnel.total * 100 : 0, tone: incomingFunnel.total ? 'green' : 'gray' }),
          realMetric({ code: 'CS_PENDING_NEW', label: 'Chưa chuyển', value: incomingFunnel.pending.toLocaleString(), secondaryValue: `Chưa đưa Designer xử lý tính đến cuối ngày ${filterDateRange.to}`, target: 'Lấy từ tập Đơn vào CS trong phạm vi và nhóm theo ngày created_at', progress: incomingFunnel.total ? incomingFunnel.pending / incomingFunnel.total * 100 : 0, tone: incomingFunnel.pending ? 'amber' : 'green', breakdown: incomingFunnel.breakdown.length ? incomingFunnel.breakdown : undefined, drillDownLabel: incomingFunnel.breakdown.length ? 'Xem số còn lại theo ngày tạo' : undefined }),
          realMetric({ code: 'CS_CUSTOM_ORDERS_CLOSED', label: 'Đơn custom đã chuyển New', value: customOrdersCompleted.toLocaleString(), secondaryValue: `TB ${formatFirstSaleDuration(customCsDuration.average)} · Cùng ngày ${customCompletionOrigin.sameDay} · Từ ngày trước ${customCompletionOrigin.fromPreviousDays}`, target: 'Chuyển New = đưa cho Designer xử lý; order có ít nhất một task có personalization', progress: customCsTimeCoverage || 0, tone: customOrdersCompleted ? 'green' : 'gray', breakdown: customCompletionOrigin.breakdown.length ? customCompletionOrigin.breakdown : undefined, drillDownLabel: customCompletionOrigin.breakdown.length ? 'Xem order từ ngày trước' : undefined }),
          realMetric({ code: 'CS_NON_CUSTOM_ORDERS_CLOSED', label: 'Đơn non-custom đã chuyển New', value: nonCustomOrdersCompleted.toLocaleString(), secondaryValue: `TB ${formatFirstSaleDuration(nonCustomCsDuration.average)} · Cùng ngày ${nonCustomCompletionOrigin.sameDay} · Từ ngày trước ${nonCustomCompletionOrigin.fromPreviousDays}`, target: 'Chuyển New = đưa cho Designer xử lý; order không có personalization', progress: nonCustomCsTimeCoverage || 0, tone: nonCustomOrdersCompleted ? 'green' : 'gray', breakdown: nonCustomCompletionOrigin.breakdown.length ? nonCustomCompletionOrigin.breakdown : undefined, drillDownLabel: nonCustomCompletionOrigin.breakdown.length ? 'Xem order từ ngày trước' : undefined }),
          realMetric({ code: 'CS_CUSTOMER_REVIEWS', label: 'Đánh giá khách hàng', value: stats.reviewCount ? `${stats.averageRating.toFixed(2)} ★` : '—', target: `Toàn shop ${stats.lifetimeReviewAverage === null ? '—' : `${stats.lifetimeReviewAverage.toFixed(2)} ★`} · ${formatRatingDelta(stats.reviewAverageDelta)} · ${stats.reviewCount.toLocaleString()} review trong kỳ`, progress: stats.positiveReviewRate || 0, tone: stats.reviewCount === 0 ? 'gray' : stats.reviewAverageDelta !== null && stats.reviewAverageDelta < -0.1 ? 'red' : stats.averageRating >= 4.5 ? 'green' : 'amber', breakdown: stats.ratingBreakdown, drillDownLabel: stats.reviewCount ? 'Xem rating theo shop' : undefined }),
        ];
      case 'fulfillment':
        return [
          realMetric({ code: 'FF_READY', label: 'Đơn sẵn sàng Fulfill', value: accessLevel === 'employee' ? '—' : countUniqueTaskOrders(operationData.tasksDesignSubmitted).toLocaleString(), target: accessLevel === 'employee' ? 'Chỉ hiển thị ở phạm vi team' : 'Order duy nhất có design_submitted_at trong kỳ', progress: 100, tone: accessLevel === 'employee' ? 'gray' : 'green' }),
          realMetric({ code: 'FF_DONE', label: 'Đơn đã Fulfill', value: operationalCompleted.toLocaleString(), target: accessLevel === 'manager' ? 'Tổng order theo fulfilled_at; không loại dữ liệu chưa map nhân sự' : 'Order theo fulfilled_at đã map vào nhân sự trong phạm vi xem', progress: 100, tone: operationalCompleted ? 'green' : 'gray' }),
          realMetric({ code: 'FF_AVERAGE_PROCESS_TIME', label: 'Thời gian Fulfill TB', value: formatFirstSaleDuration(operationalAverageHours), target: `${operationalDurations.length}/${operationalCompleted} order đủ mốc thời gian`, progress: operationalTimeCoverage || 0, tone: operationalAverageHours === null ? 'gray' : 'green' }),
          accessLevel === 'employee'
            ? realMetric({ code: 'FF_TIME_COVERAGE', label: 'Coverage thời gian', value: formatPercentage(operationalTimeCoverage), target: 'Tỷ lệ order có đủ design_submitted_at và fulfilled_at', progress: operationalTimeCoverage || 0, tone: operationalTimeCoverage === null ? 'gray' : operationalTimeCoverage >= 95 ? 'green' : 'amber' })
            : realMetric({ code: 'FF_SUPPLIER_COVERAGE', label: 'Coverage dữ liệu', value: formatPercentage(stats.fulfillmentDataCoverage), secondaryValue: `${stats.fulfillmentSupplierCount.toLocaleString()} nhà cung cấp đã xác định`, target: `Đã map supplier ${stats.fulfillmentOrdersWithSupplier}/${stats.fulfillmentOrderCount} order · Thiếu ${stats.fulfillmentMissingSupplierBreakdown.length}`, progress: stats.fulfillmentDataCoverage || 0, tone: stats.fulfillmentDataCoverage === null ? 'gray' : stats.fulfillmentDataCoverage >= 95 ? 'green' : 'amber', breakdown: stats.fulfillmentMissingSupplierBreakdown, drillDownLabel: stats.fulfillmentMissingSupplierBreakdown.length ? 'Xem order thiếu supplier' : undefined }),
        ];
      case 'kpi-assignment':
        return [];
      }
    })();

    return sectionMetrics.map(metric => ({
      ...metric,
      help: buildPerformanceMetricHelp(metric.code, {
        currentSummary: metric.target,
        dateFrom: filterDateRange.from,
        dateTo: filterDateRange.to,
        timeZone,
        accessLabel,
        podLabel: selectedPod?.displayName || 'Tất cả POD trong phạm vi được phép xem',
      }),
    }));
  }, [accessLevel, attributedOperationStats, boards, companyOverviewCharts.activityTrend, designerTotals, employees, filterDateRange.from, filterDateRange.to, ideaSaleStats, operationData, reviews.length, section, selectedBoardId, selectedRangeEndIso, stats, timeZone, visibleListingStats]);

  return {
    metrics,
    employees,
    companyOverviewCharts,
    baselineSeries,
    baselineDataSource: hasPersistedBaseline
      ? 'aggregate' as const
      : canUseLiveBaseline ? 'live' as const : 'unavailable' as const,
    baselineUpdatedAt: baselineAggregate.updatedAt,
    baselineRefreshStatus: baselineAggregate.refreshStatus,
    baselineRefreshError: baselineAggregate.lastError,
    baselineRange: {
      from: baselineAggregate.rangeFrom || filterFrom,
      to: baselineAggregate.rangeTo || filterTo,
      label: baselineAggregate.quarterLabel,
    },
    isBaselineLoading,
    templates: operationData.templates,
    designerPointDataQuality,
    accessLevel,
    isLoading,
    error,
  };
};
