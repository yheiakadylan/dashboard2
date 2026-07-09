import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, ClipboardCheck, DollarSign, FileImage, Package, RefreshCw, Star, Truck, Users } from 'lucide-react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUIFilters } from '../../contexts/UIContext';
import DateRangePicker from '../ui/DateRangePicker';
import { fetchOperationReportData, fetchReportRecords, fetchReportReviews, normalizeDateValue, type OperationReportData, type OperationTask, type OperationUser, type ReportOrderRecord, type ReportReview } from '../../services/reportService';
import { buildAccountLabelMap, getAccountShopIdentifiers, resolveAccountLabel } from '../../utils/accountLabels';
import { startMeasure } from '../../utils/perfMarks';
import { calculateItemNetRevenue, getOrderItemRevenueContext } from '../../utils/revenueUtils';

const ReportTrendChart = React.lazy(() => import('./report/ReportCharts').then(module => ({ default: module.ReportTrendChart })));
const ReportSupplierPieChart = React.lazy(() => import('./report/ReportCharts').then(module => ({ default: module.ReportSupplierPieChart })));

const EMPTY_OPERATION_DATA: OperationReportData = {
  tasksCreated: [],
  tasksDesignSubmitted: [],
  tasksFulfilled: [],
  ideasCreated: [],
  ideasDesignSubmitted: [],
  ideasCompleted: [],
  users: []
};

type LeaderRow = { name: string; createdIdeas: number; completedIdeas: number; salesTasks: number; salesQty: number };
type DesignerRow = { name: string; fulfillSubmitted: number; ideaSubmitted: number; totalSubmitted: number; rejections: number };
type CsRow = { name: string; fulfilled: number };
type TopSkuRow = { sku: string; name: string; quantity: number; orders: number; revenueUSD: number; shops: string[]; image?: string };
type TopSkuAccumulator = Omit<TopSkuRow, 'orders' | 'shops'> & { orderIds: Set<string>; shopSet: Set<string> };
type ShopRatingRow = {
  shop: string;
  avg: number;
  count: number;
  shopReviewAverage: number | null;
  shopReviewCount: number | null;
  suspended: boolean;
};

const formatMoney = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatNumber = (value: number) => value.toLocaleString('en-US');
const normalizeShopKey = (value?: string | number | null) => String(value || '').trim().toLowerCase();
const parseFiniteNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const getRatingToneText = (rating?: number | null) => {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return 'text-gray-400 dark:text-gray-500';
  if (rating > 4.5) return 'text-emerald-600 dark:text-emerald-400';
  if (rating >= 4.0) return 'text-amber-500 dark:text-amber-300';
  return 'text-rose-700 dark:text-rose-400';
};
const getRatingDelta = (current?: number | null, baseline?: number | null) => {
  if (typeof current !== 'number' || typeof baseline !== 'number') return null;
  const delta = current - baseline;
  return Math.abs(delta) < 0.005 ? 0 : delta;
};
const RatingArrow = ({ up }: { up: boolean }) => (
  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    {up ? (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 10l7-7m0 0l7 7m-7-7v18" />
    ) : (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    )}
  </svg>
);
const renderRatingValue = (rating?: number | null, delta?: number | null) => {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return <span className="font-semibold text-gray-400">-</span>;
  const hasDelta = typeof delta === 'number' && delta !== 0;
  const isUp = (delta || 0) > 0;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className={`inline-flex items-center gap-1 font-black ${getRatingToneText(rating)}`}>
        <Star className="h-3 w-3 fill-current" /> {rating.toFixed(2)}
      </span>
      {hasDelta && (
        <span
          className={`inline-flex items-center text-[11px] font-black ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
          title={`${isUp ? 'Higher' : 'Lower'} than Shop Avg`}
        >
          <RatingArrow up={isUp} />
        </span>
      )}
    </span>
  );
};
const logReportInfo = (message: string, details: globalThis.Record<string, unknown>) => {
  try {
    if (import.meta.env.DEV && localStorage.getItem('reportVerbose') === '1') {
      console.info('[Report]', message, details);
    }
  } catch {
    // Ignore logging failures.
  }
};

const getDateKey = (dateInput: string | Date | null | undefined, timeZone: string) => {
  if (!dateInput) return '';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

const getDayLabel = (dateInput: string | Date, timeZone: string) => {
  const date = dateInput instanceof Date ? dateInput : new Date(`${dateInput}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: '2-digit' }).format(date);
};

const buildTrendMap = (from: string, to: string, timeZone: string) => {
  const trendMap = new Map<string, { date: string; label: string; orders: number; designs: number; fulfilled: number; reviews: number }>();
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    trendMap.set(date, { date, label: getDayLabel(date, timeZone), orders: 0, designs: 0, fulfilled: 0, reviews: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return trendMap;
};

const isRefundRecord = (record: ReportOrderRecord) => record.source === 'Etsy_Refunded' || record.status === 'Refunded' || Boolean(record.refundAmount);
const isRefundNoticeRecord = (record: ReportOrderRecord) => record.source === 'Etsy_Refunded';
const isOrderSale = (record: ReportOrderRecord) => record.kind === 'order' && !isRefundNoticeRecord(record);
const normalizeSku = (sku?: string | null, fallback?: string | null) => (sku || fallback || '').trim().toUpperCase() || 'UNKNOWN';
const parseIdeaCodeFromSku = (sku: string) => sku.split('-').map(part => part.trim()).filter(Boolean)[1] || '';
const getTaskDateKey = (task: OperationTask, field: 'created_at' | 'design_submitted_at' | 'fulfilled_at', timeZone: string) => getDateKey(normalizeDateValue(task[field]), timeZone);
const getReportItemRevenue = (record: ReportOrderRecord, item: ReportOrderRecord['items'][number]) => {
  return calculateItemNetRevenue(item, getOrderItemRevenueContext(record.items, record.financials));
};
const normalizeSupplierName = (supplier?: string | null) => {
  const key = String(supplier || '').trim().toLowerCase();
  if (!key) return 'Unknown';
  if (key === 'printway') return 'Printway';
  if (key === 'merchize') return 'Merchize';
  if (key === 'printify') return 'Printify';
  if (key === 'customcat') return 'CustomCat';
  if (key === 'interestprint') return 'InterestPrint';
  if (key === 'supplier api') return 'Supplier API';
  return supplier || 'Unknown';
};

const buildUserResolver = (users: OperationUser[]) => {
  const map = new Map<string, string>();
  const userByKey = new Map<string, OperationUser>();
  users.forEach(user => {
    const label = user.displayName || user.empID || user.email || user.uid;
    [user.uid, user.empID, user.email].forEach(key => {
      if (!key) return;
      const normalizedKey = String(key).trim().toLowerCase();
      map.set(normalizedKey, label);
      userByKey.set(normalizedKey, user);
    });
  });

  const resolve = (id?: string | null, fallback = 'Unknown') => (id ? map.get(String(id).trim().toLowerCase()) || id : fallback);
  const resolveKnown = (...ids: Array<string | null | undefined>) => {
    for (const id of ids) {
      if (!id) continue;
      const match = map.get(String(id).trim().toLowerCase());
      if (match) return match;
    }
    return null;
  };

  const resolveKnownByRoles = (roles: string[], ...ids: Array<string | null | undefined>) => {
    const allowed = new Set(roles.map(role => role.toUpperCase()));
    for (const id of ids) {
      if (!id) continue;
      const key = String(id).trim().toLowerCase();
      const match = map.get(key);
      if (!match) continue;
      const user = userByKey.get(key);
      if (user?.role && allowed.has(String(user.role).toUpperCase())) return match;
    }
    return null;
  };

  return { resolve, resolveKnown, resolveKnownByRoles };
};

const StatCard: React.FC<{ title: string; value: string; subtitle?: string; icon: React.ReactNode; tone: string; valueClassName?: string }> = ({ title, value, subtitle, icon, tone, valueClassName }) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
        <p className={`mt-2 text-2xl font-bold truncate ${valueClassName || 'text-gray-950 dark:text-white'}`}>{value}</p>
        {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>}
      </div>
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tone}`}>{icon}</div>
    </div>
  </div>
);

const ChartSkeleton: React.FC<{ className?: string }> = ({ className = 'h-56' }) => (
  <div className={`${className} animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900/50`} />
);

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise
      .then(value => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch(error => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
};

const formatDateISO = (date: Date) => date.toISOString().slice(0, 10);

const getTodayInTimezoneDate = (timeZone: string): Date => {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [year, month, day] = formatter.format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const getMondayWeekStart = (date: Date): Date => {
  const start = new Date(date);
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  return start;
};

const getReportDefaultRange = (timeZone: string) => {
  const today = getTodayInTimezoneDate(timeZone);
  const day = today.getUTCDay();
  const thisWeekStart = getMondayWeekStart(today);

  if (day === 1 || day === 2) {
    const to = new Date(thisWeekStart);
    to.setUTCDate(to.getUTCDate() - 1);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: formatDateISO(from), to: formatDateISO(to) };
  }

  return { from: formatDateISO(thisWeekStart), to: formatDateISO(today) };
};

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; description?: string; action?: React.ReactNode }> = ({ title, icon, children, description, action }) => (
  <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">{icon}{title}</h2>
        {description && <p className="mt-1 text-xs font-normal text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
      {action}
    </div>
    <div className="p-4">{children}</div>
  </section>
);

const ReportTab: React.FC = () => {
  const { accounts, exchangeRates, role, permissions, teamId } = useDashboard();
  const { timeZone } = useUIFilters();
  const [reportRange, setReportRange] = useState(() => getReportDefaultRange(timeZone));
  const [reportRecords, setReportRecords] = useState<ReportOrderRecord[]>([]);
  const [reportReviews, setReportReviews] = useState<ReportReview[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [operationData, setOperationData] = useState<OperationReportData>(EMPTY_OPERATION_DATA);
  const [isLoadingOps, setIsLoadingOps] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const latestRequestRef = useRef(0);
  const isMountedRef = useRef(true);
  const canViewCost = role === 'owner' || permissions.viewKpiCost;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchReportRecordsPayload = React.useCallback(async (forceRefresh = false) => {
    if (!teamId) return { records: [] as ReportOrderRecord[], reviews: [] as ReportReview[] };

    const [records, reviews] = await Promise.all([
      fetchReportRecords(teamId, reportRange, timeZone, forceRefresh),
      fetchReportReviews(teamId, reportRange, timeZone, forceRefresh)
    ]);
    logReportInfo('records-loaded', { records: records.length, reviews: reviews.length, range: reportRange, timeZone });
    return { records, reviews };
  }, [reportRange, teamId, timeZone]);

  const applyReportRecordsPayload = React.useCallback((payload: Awaited<ReturnType<typeof fetchReportRecordsPayload>>) => {
    setReportRecords(payload.records);
    setReportReviews(payload.reviews);
    setLastLoadedAt(new Date());
  }, []);

  const loadReportData = React.useCallback(async (forceRefresh = false) => {
    const requestId = ++latestRequestRef.current;
    const endMeasure = startMeasure('report:load', { range: reportRange, timeZone, forceRefresh });
    setIsLoadingOps(true);
    setOperationError(null);

    const [recordsResult, operationResult] = await Promise.allSettled([
      fetchReportRecordsPayload(forceRefresh),
      withTimeout(fetchOperationReportData(reportRange, timeZone, forceRefresh), 30000, 'Operation report')
    ]);

    if (!isMountedRef.current || latestRequestRef.current !== requestId) {
      endMeasure({ ignored: true });
      return;
    }

    const errors: string[] = [];

    if (recordsResult.status === 'fulfilled') {
      applyReportRecordsPayload(recordsResult.value);
    } else {
      console.error('[Report] Failed to fetch records/reviews:', recordsResult.reason);
      setReportRecords([]);
      setReportReviews([]);
      errors.push(recordsResult.reason instanceof Error ? recordsResult.reason.message : 'Cannot load report records');
    }

    if (operationResult.status === 'fulfilled') {
      logReportInfo('operation-loaded', {
        tasksDesignSubmitted: operationResult.value.tasksDesignSubmitted.length,
        tasksFulfilled: operationResult.value.tasksFulfilled.length,
        ideasCreated: operationResult.value.ideasCreated.length,
        ideasDesignSubmitted: operationResult.value.ideasDesignSubmitted.length,
      });
      setOperationData(operationResult.value);
    } else {
      console.error('[Report] Failed to fetch operation data:', operationResult.reason);
      setOperationData(EMPTY_OPERATION_DATA);
      errors.push(operationResult.reason instanceof Error ? operationResult.reason.message : 'Cannot load operation data');
    }

    setOperationError(errors.length > 0 ? errors.join(' | ') : null);
    setIsLoadingOps(false);
    endMeasure({
      records: recordsResult.status === 'fulfilled' ? recordsResult.value.records.length : 0,
      reviews: recordsResult.status === 'fulfilled' ? recordsResult.value.reviews.length : 0,
      hasError: errors.length > 0
    });
  }, [applyReportRecordsPayload, fetchReportRecordsPayload, reportRange, timeZone]);

  const loadOperationData = React.useCallback(async () => {
    loadReportData(true);
  }, [loadReportData]);

  useEffect(() => {
    loadReportData(false);
  }, [loadReportData]);

  const reportData = useMemo(() => {
    const accountLabelMap = buildAccountLabelMap(accounts);
    const getCanonicalShopKey = (shopId?: string | number | null) => {
      const label = resolveAccountLabel(accountLabelMap, shopId, '');
      return normalizeShopKey(label || shopId || 'Unknown Shop');
    };
    const permittedAccounts = new Set(accounts.map(account => account.email));
    const permittedShopKeys = new Set(
      accounts.flatMap(getAccountShopIdentifiers)
        .map(normalizeShopKey)
        .filter(Boolean)
    );
    const hasAccountScope = permittedAccounts.size > 0;
    const shopHealthByKey = new Map<string, { reviewAverage: number | null; reviewCount: number | null; suspended: boolean }>();
    accounts.forEach(account => {
      const health = {
        reviewAverage: parseFiniteNumber(account.etsy_review_average),
        reviewCount: parseFiniteNumber(account.etsy_review_count),
        suspended: account.etsy_suspended === true
      };

      getAccountShopIdentifiers(account)
        .map(normalizeShopKey)
        .filter(Boolean)
        .forEach(key => shopHealthByKey.set(key, health));
    });

    const { resolve: userName, resolveKnown: knownUserName, resolveKnownByRoles } = buildUserResolver(operationData.users);
    const trendMap = buildTrendMap(reportRange.from, reportRange.to, timeZone);
    const currencyToUsd = (amount: number, currency?: string | null) => currency === 'USD' || !currency ? amount : (exchangeRates?.[currency] ? amount * exchangeRates[currency] : amount);

    let salesOrderCount = 0;
    let cancelCount = 0;
    let totalRevenueUSD = 0;
    let totalFulfillCost = 0;
    let fulfilledOrderCount = 0;
    const refundOrderIds = new Set<string>();
    const skuMap = new Map<string, TopSkuAccumulator>();
    const ideaSaleMap = new Map<string, { orderIds: Set<string>; qty: number }>();
    const providerMap = new Map<string, number>();

    reportRecords.forEach(record => {
      if (hasAccountScope && !permittedAccounts.has(record.account)) return;
      if (/cancel/i.test(record.source || '') || /cancel/i.test(record.status || '')) cancelCount += 1;
      if (record.kind === 'order' && isRefundRecord(record) && record.order_id) refundOrderIds.add(record.order_id);
      if (!isOrderSale(record)) return;

      salesOrderCount += 1;
      totalRevenueUSD += currencyToUsd(record.amount || 0, record.currency);
      const trendRow = trendMap.get(getDateKey(record.dt_local, timeZone));
      if (trendRow) trendRow.orders += 1;

      if (record.cost_total && record.cost_total > 0) totalFulfillCost += record.cost_total;
      if (record.ff_code || record.fulfill_provider || (record.cost_total && record.cost_total > 0)) {
        fulfilledOrderCount += 1;
        const provider = record.fulfill_provider || (record.ff_code?.startsWith('PWN') ? 'Printway' : record.ff_code ? 'Merchize/Other' : 'Unknown');
        providerMap.set(provider, (providerMap.get(provider) || 0) + 1);
      }

      record.items.forEach(item => {
        const sku = normalizeSku(item.sku, item.name);
        let row = skuMap.get(sku);
        if (!row) {
          row = { sku, name: item.name || sku, quantity: 0, revenueUSD: 0, image: item.image, orderIds: new Set<string>(), shopSet: new Set<string>() };
          skuMap.set(sku, row);
        }
        const qty = Number(item.quantity || 0);
        row.quantity += qty;
        row.revenueUSD += currencyToUsd(getReportItemRevenue(record, item), record.currency);
        if (record.order_id) row.orderIds.add(record.order_id);
        row.shopSet.add(resolveAccountLabel(accountLabelMap, record.account));
        if (!row.image && item.image) row.image = item.image;

        const ideaName = knownUserName(parseIdeaCodeFromSku(sku));
        if (ideaName) {
          let sale = ideaSaleMap.get(ideaName);
          if (!sale) {
            sale = { orderIds: new Set<string>(), qty: 0 };
            ideaSaleMap.set(ideaName, sale);
          }
          if (record.order_id) sale.orderIds.add(record.order_id);
          sale.qty += qty;
        }
      });
    });

    const topSkus: TopSkuRow[] = Array.from(skuMap.values())
      .map(({ orderIds, shopSet, ...row }) => ({ ...row, orders: orderIds.size, shops: Array.from(shopSet).slice(0, 3) }))
      .sort((a, b) => b.quantity - a.quantity || b.orders - a.orders)
      .slice(0, 20);

    const shopRatingsMap = new Map<string, { total: number; count: number }>();
    accounts.forEach(account => {
      if (parseFiniteNumber(account.etsy_review_average) === null) return;
      const shop = account.label || account.email || account.id;
      if (!shopRatingsMap.has(shop)) {
        shopRatingsMap.set(shop, { total: 0, count: 0 });
      }
    });

    let totalRating = 0;
    let totalRatedReviews = 0;
    reportReviews.forEach((review: ReportReview) => {
      if (!review.rating) return;
      const shopKey = getCanonicalShopKey(review.shop_id);
      if (hasAccountScope && !permittedShopKeys.has(shopKey)) return;
      const shop = resolveAccountLabel(accountLabelMap, review.shop_id);
      const current = shopRatingsMap.get(shop) || { total: 0, count: 0 };
      current.total += review.rating;
      current.count += 1;
      shopRatingsMap.set(shop, current);
      totalRating += review.rating;
      totalRatedReviews += 1;
      const trendRow = trendMap.get(getDateKey(review.create_date, timeZone));
      if (trendRow) trendRow.reviews += 1;
    });

    const shopRatings: ShopRatingRow[] = Array.from(shopRatingsMap.entries())
      .map(([shop, stats]) => {
        const shopHealth = shopHealthByKey.get(normalizeShopKey(shop));
        return {
          shop,
          avg: stats.count > 0 ? stats.total / stats.count : 0,
          count: stats.count,
          shopReviewAverage: shopHealth?.reviewAverage ?? null,
          shopReviewCount: shopHealth?.reviewCount ?? null,
          suspended: shopHealth?.suspended === true
        };
      })
      .sort((a, b) =>
        b.count - a.count ||
        (b.shopReviewAverage ?? 0) - (a.shopReviewAverage ?? 0) ||
        b.avg - a.avg ||
        a.shop.localeCompare(b.shop)
      );

    const ideaMap = new Map<string, LeaderRow>();
    const ensureIdeaRow = (key: string) => {
      const name = key || 'Unknown';
      if (!ideaMap.has(name)) ideaMap.set(name, { name, createdIdeas: 0, completedIdeas: 0, salesTasks: 0, salesQty: 0 });
      return ideaMap.get(name)!;
    };
    operationData.ideasCreated.forEach(task => {
      const name = knownUserName(task.idea_emp_id, task.createdBy);
      if (!name) return;
      const row = ensureIdeaRow(name);
      row.createdIdeas += 1;
      if (task.status === 'done') row.completedIdeas += 1;
    });
    ideaSaleMap.forEach((sale, name) => {
      const row = ensureIdeaRow(name);
      row.salesTasks += sale.orderIds.size;
      row.salesQty += sale.qty;
    });
    const allIdeaRows = Array.from(ideaMap.values()).sort((a, b) => (b.completedIdeas + b.salesQty) - (a.completedIdeas + a.salesQty));
    const ideaRows = allIdeaRows.slice(0, 20);

    const designerMap = new Map<string, DesignerRow>();
    const ensureDesignerRow = (id?: string | null, fallback?: string | null) => {
      const name = resolveKnownByRoles(['DS', 'LEADDS'], id);
      if (!name) return null;
      if (!designerMap.has(name)) designerMap.set(name, { name, fulfillSubmitted: 0, ideaSubmitted: 0, totalSubmitted: 0, rejections: 0 });
      return designerMap.get(name)!;
    };
    operationData.tasksDesignSubmitted.forEach(task => {
      const row = ensureDesignerRow(task.designerId, task.designerName);
      if (!row) return;
      row.fulfillSubmitted += 1;
      row.totalSubmitted += 1;
      row.rejections += Number(task.rejection_count || 0);
      const trendRow = trendMap.get(getTaskDateKey(task, 'design_submitted_at', timeZone));
      if (trendRow) trendRow.designs += 1;
    });
    operationData.ideasDesignSubmitted.forEach(task => {
      const row = ensureDesignerRow(task.designerId, task.designerName);
      if (!row) return;
      row.ideaSubmitted += 1;
      row.totalSubmitted += 1;
      row.rejections += Number(task.rejection_count || 0);
      const trendRow = trendMap.get(getTaskDateKey(task, 'design_submitted_at', timeZone));
      if (trendRow) trendRow.designs += 1;
    });
    const allDesignerRows = Array.from(designerMap.values()).sort((a, b) => b.totalSubmitted - a.totalSubmitted);
    const designerRows = allDesignerRows.slice(0, 20);

    const ideaSummary = allIdeaRows.reduce(
      (summary, row) => ({
        created: summary.created + row.createdIdeas,
        completed: summary.completed + row.completedIdeas,
        salesQty: summary.salesQty + row.salesQty
      }),
      { created: 0, completed: 0, salesQty: 0 }
    );
    const designerSummary = allDesignerRows.reduce(
      (summary, row) => ({
        totalSubmitted: summary.totalSubmitted + row.totalSubmitted,
        fulfillSubmitted: summary.fulfillSubmitted + row.fulfillSubmitted,
        ideaSubmitted: summary.ideaSubmitted + row.ideaSubmitted
      }),
      { totalSubmitted: 0, fulfillSubmitted: 0, ideaSubmitted: 0 }
    );
    const shopsWithRangeReviews = shopRatings.filter(shop => shop.count > 0);
    const shopsWithShopAverage = shopRatings.filter(shop => typeof shop.shopReviewAverage === 'number' && !shop.suspended);
    const highestRatingShop = shopsWithRangeReviews.reduce<typeof shopRatings[number] | null>((best, shop) => (!best || shop.avg > best.avg ? shop : best), null);
    const lowestRatingShop = shopsWithRangeReviews.reduce<typeof shopRatings[number] | null>((best, shop) => (!best || shop.avg < best.avg ? shop : best), null);
    const highestShopAverageShop = shopsWithShopAverage.reduce<typeof shopRatings[number] | null>(
      (best, shop) => (!best || (shop.shopReviewAverage ?? 0) > (best.shopReviewAverage ?? 0) ? shop : best),
      null
    );
    const lowestShopAverageShop = shopsWithShopAverage.reduce<typeof shopRatings[number] | null>(
      (best, shop) => (!best || (shop.shopReviewAverage ?? 0) < (best.shopReviewAverage ?? 0) ? shop : best),
      null
    );

    const csMap = new Map<string, CsRow>();
    const supplierMap = new Map<string, number>();
    operationData.tasksFulfilled.forEach(task => {
      const name = userName(task.cs_id || task.createdBy, 'Unknown');
      if (!csMap.has(name)) csMap.set(name, { name, fulfilled: 0 });
      csMap.get(name)!.fulfilled += 1;
      const supplier = normalizeSupplierName(task.supplier || (task.fulfillment_id ? 'Supplier API' : 'Unknown'));
      supplierMap.set(supplier, (supplierMap.get(supplier) || 0) + 1);
      const trendRow = trendMap.get(getTaskDateKey(task, 'fulfilled_at', timeZone));
      if (trendRow) trendRow.fulfilled += 1;
    });

    return {
      salesOrderCount,
      refundCount: refundOrderIds.size,
      cancelCount,
      totalRevenueUSD,
      totalFulfillCost,
      fulfilledOrderCount,
      topSkus,
      shopRatings,
      avgRating: totalRatedReviews > 0 ? totalRating / totalRatedReviews : 0,
      highestRatingShop,
      lowestRatingShop,
      highestShopAverageShop,
      lowestShopAverageShop,
      ideaSummary,
      ideaRows,
      designerSummary,
      designerRows,
      csRows: Array.from(csMap.values()).sort((a, b) => b.fulfilled - a.fulfilled).slice(0, 20),
      operationSupplierData: Array.from(supplierMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      emailProviderData: Array.from(providerMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      trendData: Array.from(trendMap.values()),
      totalDesigns: designerSummary.totalSubmitted,
      totalIdeaCompleted: ideaSummary.completed,
      totalOperationalFulfilled: operationData.tasksFulfilled.length
    };
  }, [accounts, exchangeRates, operationData, reportRange, reportRecords, reportReviews, timeZone]);

  const supplierPieData = reportData.operationSupplierData.length ? reportData.operationSupplierData : reportData.emailProviderData;
  const loadedLabel = lastLoadedAt ? lastLoadedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chua load';

  return (
    <div className="p-3 md:p-6 space-y-5 overflow-y-auto">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-950 dark:text-white flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            Weekly Operations Report
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Report range: {reportRange.from} -&gt; {reportRange.to} - Cap nhat {loadedLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DateRangePicker align="right" value={reportRange} onChange={setReportRange} timeZone={timeZone} />
          <button onClick={loadOperationData} disabled={isLoadingOps} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${isLoadingOps ? 'animate-spin' : ''}`} />{isLoadingOps ? 'Dang tai...' : 'Reload report'}</button>
        </div>
      </div>

      {operationError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          Khong doc duoc du lieu van hanh tu tasks/ideas/users. Report van hien du lieu order/review hien co. Loi: {operationError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard title="Orders sale" value={formatNumber(reportData.salesOrderCount)} subtitle="Mail bao don trong range" icon={<Package className="h-5 w-5" />} tone="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300" />
        <StatCard title="Top SKU" value={reportData.topSkus[0]?.sku || '-'} subtitle={reportData.topSkus[0] ? `${reportData.topSkus[0].quantity} qty / ${reportData.topSkus[0].orders} orders` : 'Chua co order'} icon={<ClipboardCheck className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" />
        <StatCard title="Design submit" value={formatNumber(reportData.totalDesigns)} subtitle="Fulfill + Idea board" icon={<FileImage className="h-5 w-5" />} tone="bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300" />
        <StatCard title="Refunded" value={formatNumber(reportData.refundCount)} subtitle="Distinct refunded orders" icon={<AlertTriangle className="h-5 w-5" />} tone="bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300" />
        <StatCard title="Avg rating" value={reportData.avgRating ? reportData.avgRating.toFixed(2) : '-'} subtitle={`${reportReviews.length} reviews`} icon={<Star className="h-5 w-5 fill-current" />} tone="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300" valueClassName={getRatingToneText(reportData.avgRating || null)} />
      </div>

      <Section title="Nhip van hanh theo ngay" icon={<BarChart3 className="h-4 w-4 text-blue-600" />}>
        <div className="h-72">
          <React.Suspense fallback={<ChartSkeleton className="h-72" />}>
            <ReportTrendChart data={reportData.trendData} />
          </React.Suspense>
        </div>
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Section title="Top 20 SKU dang ra don" description="SKU ban chay trong range dang chon, xep theo qty ban." icon={<Package className="h-4 w-4 text-emerald-600" />}>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs uppercase text-gray-500 dark:text-gray-400"><tr className="border-b border-gray-200 dark:border-gray-700"><th className="py-2 text-left">SKU</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Orders</th><th className="py-2 text-right">Revenue</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {reportData.topSkus.map((item, index) => <tr key={item.sku}><td className="py-3 pr-3"><div className="flex items-center gap-2 min-w-[220px]"><span className="w-5 text-xs text-gray-400">{index + 1}</span>{item.image ? <img src={item.image} alt="" className="h-9 w-9 rounded object-cover border border-gray-200 dark:border-gray-700" /> : <div className="h-9 w-9 rounded bg-gray-100 dark:bg-gray-700" />}<div className="min-w-0"><div className="font-semibold text-gray-900 dark:text-white truncate">{item.sku}</div><div className="text-xs text-gray-500 truncate">{item.shops.join(', ') || item.name}</div></div></div></td><td className="py-3 text-right font-semibold text-gray-900 dark:text-white">{formatNumber(item.quantity)}</td><td className="py-3 text-right">{formatNumber(item.orders)}</td><td className="py-3 text-right">{formatMoney(item.revenueUSD)}</td></tr>)}
            {reportData.topSkus.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-500">Chua co SKU trong range nay.</td></tr>}
          </tbody></table></div>
        </Section>

        <Section title="Idea performance" description="Hieu suat nhan su idea dua tren Idea board va sale qty tu SKU." icon={<Users className="h-4 w-4 text-violet-600" />} action={isLoadingOps ? <span className="text-xs text-gray-500">Loading...</span> : null}>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500">Created</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(reportData.ideaSummary.created)}</p></div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500">Complete</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(reportData.ideaSummary.completed)}</p></div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500">Sale qty</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(reportData.ideaSummary.salesQty)}</p></div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs uppercase text-gray-500 dark:text-gray-400"><tr className="border-b border-gray-200 dark:border-gray-700"><th className="py-2 text-left">Nhan su</th><th className="py-2 text-right">Created</th><th className="py-2 text-right">Complete</th><th className="py-2 text-right">Sale qty</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {reportData.ideaRows.map(row => <tr key={row.name}><td className="py-3 pr-3 font-semibold text-gray-900 dark:text-white">{row.name}</td><td className="py-3 text-right">{formatNumber(row.createdIdeas)}</td><td className="py-3 text-right">{formatNumber(row.completedIdeas)}</td><td className="py-3 text-right">{formatNumber(row.salesQty)}</td></tr>)}
            {reportData.ideaRows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-500">Chua co du lieu idea.</td></tr>}
          </tbody></table></div>
        </Section>

        <Section title="Designer submit" description="So file designer submit tu Fulfill va Idea board." icon={<FileImage className="h-4 w-4 text-indigo-600" />}>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500">Total</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(reportData.designerSummary.totalSubmitted)}</p></div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500">FF</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(reportData.designerSummary.fulfillSubmitted)}</p></div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500">Idea</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(reportData.designerSummary.ideaSubmitted)}</p></div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs uppercase text-gray-500 dark:text-gray-400"><tr className="border-b border-gray-200 dark:border-gray-700"><th className="py-2 text-left">Designer</th><th className="py-2 text-right">Total</th><th className="py-2 text-right">FF</th><th className="py-2 text-right">Idea</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {reportData.designerRows.map(row => <tr key={row.name}><td className="py-3 pr-3 font-semibold text-gray-900 dark:text-white">{row.name}</td><td className="py-3 text-right font-semibold">{formatNumber(row.totalSubmitted)}</td><td className="py-3 text-right">{formatNumber(row.fulfillSubmitted)}</td><td className="py-3 text-right">{formatNumber(row.ideaSubmitted)}</td></tr>)}
            {reportData.designerRows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-500">Chua co submit file.</td></tr>}
          </tbody></table></div>
        </Section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Section title="CS / Fulfillment" icon={<Truck className="h-4 w-4 text-emerald-600" />}>
          <div className="grid grid-cols-2 gap-3 mb-4"><div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500">Done tasks</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(reportData.totalOperationalFulfilled)}</p></div>{canViewCost && <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"><p className="text-xs text-gray-500 flex items-center gap-1"><DollarSign className="h-3 w-3" /> Tien fulfill</p><p className="text-xl font-bold text-gray-900 dark:text-white">{formatMoney(reportData.totalFulfillCost)}</p></div>}</div>
          <div className="space-y-2">{reportData.csRows.map(row => <div key={row.name} className="flex items-center justify-between text-sm"><span className="font-medium text-gray-700 dark:text-gray-300 truncate">{row.name}</span><span className="font-bold text-gray-900 dark:text-white">{formatNumber(row.fulfilled)}</span></div>)}{reportData.csRows.length === 0 && <p className="py-4 text-center text-sm text-gray-500">Chua co task done.</p>}</div>
        </Section>

        <Section title="Ben fulfill" icon={<CheckCircle2 className="h-4 w-4 text-blue-600" />}>
          <div className="h-56"><React.Suspense fallback={<ChartSkeleton />}><ReportSupplierPieChart data={supplierPieData} /></React.Suspense></div>
        </Section>

        <Section title="Rating theo shop" description="Range la diem review trong khoang report, Shop Avg la rating toan shop tu extension crawl." icon={<Star className="h-4 w-4 text-amber-600 fill-current" />}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3">
              <p className="text-xs text-gray-500">Avg all</p>
              <p className="text-xl font-bold">{renderRatingValue(reportData.avgRating || null)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3">
              <p className="text-xs text-gray-500 truncate">Highest Range</p>
              <p className="text-xl font-bold">
                {renderRatingValue(
                  reportData.highestRatingShop?.avg ?? null,
                  reportData.highestRatingShop ? getRatingDelta(reportData.highestRatingShop.avg, reportData.highestRatingShop.shopReviewAverage) : null
                )}
              </p>
              <p className="text-xs text-gray-500 truncate">{reportData.highestRatingShop?.shop || '-'}</p>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3">
              <p className="text-xs text-gray-500 truncate">Lowest Range</p>
              <p className="text-xl font-bold">
                {renderRatingValue(
                  reportData.lowestRatingShop?.avg ?? null,
                  reportData.lowestRatingShop ? getRatingDelta(reportData.lowestRatingShop.avg, reportData.lowestRatingShop.shopReviewAverage) : null
                )}
              </p>
              <p className="text-xs text-gray-500 truncate">{reportData.lowestRatingShop?.shop || '-'}</p>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3">
              <p className="text-xs text-gray-500 truncate">Highest Shop Avg</p>
              <p className="text-xl font-bold">{renderRatingValue(reportData.highestShopAverageShop?.shopReviewAverage ?? null)}</p>
              <p className="text-xs text-gray-500 truncate">{reportData.highestShopAverageShop?.shop || '-'}</p>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3">
              <p className="text-xs text-gray-500 truncate">Lowest Shop Avg</p>
              <p className="text-xl font-bold">{renderRatingValue(reportData.lowestShopAverageShop?.shopReviewAverage ?? null)}</p>
              <p className="text-xs text-gray-500 truncate">{reportData.lowestShopAverageShop?.shop || '-'}</p>
            </div>
          </div>
          <div className="space-y-3">
            {reportData.shopRatings.map(shop => (
              <div key={shop.shop} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{shop.shop}</span>
                <span className="flex items-center gap-3 flex-shrink-0 text-right">
                  <span>
                    <span className="block text-[10px] uppercase tracking-wide text-gray-400">Range</span>
                    <span className="font-bold">
                      {renderRatingValue(shop.count > 0 ? shop.avg : null, getRatingDelta(shop.count > 0 ? shop.avg : null, shop.shopReviewAverage))}
                    </span>
                    <span className="block text-xs text-gray-500">{formatNumber(shop.count)} reviews</span>
                  </span>
                  <span>
                    <span className="block text-[10px] uppercase tracking-wide text-gray-400">Shop Avg</span>
                    {shop.suspended ? (
                      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">Suspended</span>
                    ) : typeof shop.shopReviewAverage === 'number' ? (
                      <>
                        <span className="font-bold">{renderRatingValue(shop.shopReviewAverage)}</span>
                        <span className="block text-xs text-gray-500">({formatNumber(shop.shopReviewCount || 0)})</span>
                      </>
                    ) : (
                      <span className="font-semibold text-gray-400">-</span>
                    )}
                  </span>
                </span>
              </div>
            ))}
            {reportData.shopRatings.length === 0 && <p className="py-4 text-center text-sm text-gray-500">Chua co shop rating data.</p>}
          </div>
        </Section>
      </div>
    </div>
  );
};

export default ReportTab;
