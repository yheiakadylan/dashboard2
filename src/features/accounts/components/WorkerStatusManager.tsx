import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../../../contexts/DashboardContext";
import { useNotification } from "../../../contexts/NotificationContext";
import { Account } from "../../../types";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Activity,
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ShieldAlert,
  Trash2,
  Play,
  RefreshCw,
  Settings2,
  Save,
  Search,
  ListTree,
  X,
} from "lucide-react";
import {
  clearPendingSkuJobs,
  enqueueRemoteWorkerCommand,
  saveRemoteReviewCronHours,
  subscribeWorkerControlSettings,
} from "../../../services/firebaseService";

dayjs.extend(relativeTime);

const parseDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (value && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (value && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  return null;
};

const pickValidEtsyShopId = (account: any): string => {
  const ids = [account.etsy_shop_id, account.etsyShopId, account.shopId];
  for (const id of ids) {
    const text = String(id || "").trim();
    if (!/^\d+$/.test(text)) continue;

    const numericValue = Number(text);
    if (Number.isSafeInteger(numericValue) && numericValue > 0 && numericValue <= 2147483647) {
      return text;
    }
  }
  return "";
};

const hasWorkerError = (account: Account) => {
  const workerStatus = account.worker_status;
  const healthStatus = String(account.etsy_health_status || '').toLowerCase();
  return workerStatus?.status === 'error'
    || workerStatus?.review_status?.state === 'error'
    || Boolean(account.etsy_health_error)
    || Boolean(healthStatus && healthStatus !== 'ok');
};

const getWorkerSortPriority = (account: Account) => {
  if (account.etsy_suspended) return 5;
  if (hasWorkerError(account)) return 0;

  const workerStatus = account.worker_status;
  const isSilent = !workerStatus?.last_heartbeat
    || dayjs().diff(dayjs(workerStatus.last_heartbeat), 'minute') > 10;
  if (isSilent) return 1;
  if (
    workerStatus.status === 'processing'
    || workerStatus.review_status?.state === 'running'
  ) return 2;
  if ((workerStatus.pending_count || 0) > 0) return 3;
  return 4;
};

const WorkerStatusManager: React.FC = () => {
  const { accounts, teamId } = useDashboard();
  const { addNotification } = useNotification();
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    type: "clear" | "shop_clear" | null;
    shopEmail?: string;
    shopLabel?: string;
  }>({ show: false, type: null });

  // Extension control state
  const [isHealthRunning, setIsHealthRunning] = useState(false);
  const [isCrawlingReviews, setIsCrawlingReviews] = useState(false);
  const [cronHoursInput, setCronHoursInput] = useState('8, 12');
  const [isSavingCron, setIsSavingCron] = useState(false);
  const [showCronConfig, setShowCronConfig] = useState(false);
  const [shopSearchTerm, setShopSearchTerm] = useState('');

  useEffect(() => {
    return subscribeWorkerControlSettings(teamId, settings => {
      if (settings.reviewCronHours.length) setCronHoursInput(settings.reviewCronHours.join(', '));
    }, error => {
      console.warn('[Worker] Cannot load worker control settings:', error);
    });
  }, [teamId]);

  const healthCommandShops = useMemo(() => {
    return accounts
      .filter((acc) => acc.platforms && acc.platforms.includes("etsy"))
      .map((acc) => ({
        id: acc.id,
        label: acc.label || acc.email || acc.id,
        email: acc.email || null,
        platforms: acc.platforms || [],
        selected: true,
      }));
  }, [accounts]);

  const etsyCommandShops = useMemo(() => {
    return accounts
      .filter((acc) => acc.platforms?.includes("etsy") && !acc.etsy_suspended)
      .map((acc) => {
        const raw = acc as any;
        return {
          shopId: pickValidEtsyShopId(raw),
          shopName: acc.label || raw.shopName || acc.email || acc.id,
          label: acc.label || null,
          email: acc.email || null,
          name: raw.name || null,
          etsyShopName: raw.etsyShopName || raw.etsy_shop_name || null,
        };
      })
      .filter((shop) => shop.shopId && shop.shopName);
  }, [accounts]);

  const handleRunHealthCheck = useCallback(async () => {
    setIsHealthRunning(true);
    try {
      await enqueueRemoteWorkerCommand(teamId, 'health', 'run_health_check', {
        force: true,
        shops: healthCommandShops,
      });
      addNotification('Health check queued! Remote health extension will run it shortly.', 'success');
    } catch (err: any) {
      addNotification(err.message || 'Failed to queue health check.', 'error');
    } finally {
      setIsHealthRunning(false);
    }
  }, [addNotification, healthCommandShops, teamId]);

  const handleCrawlReviews = useCallback(async () => {
    setIsCrawlingReviews(true);
    try {
      await enqueueRemoteWorkerCommand(teamId, 'reviews', 'crawl_recent_reviews', {
        shops: etsyCommandShops,
      });
      addNotification('Review crawl queued! Remote SKU worker will run it shortly.', 'success');
    } catch (err: any) {
      addNotification(err.message || 'Failed to queue review crawl.', 'error');
    } finally {
      setIsCrawlingReviews(false);
    }
  }, [addNotification, etsyCommandShops, teamId]);

  const handleSaveCronHours = useCallback(async () => {
    const hours = cronHoursInput
      .split(/[,\s]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 0 && n <= 23);
    if (hours.length === 0) {
      addNotification('Invalid hours format. Enter hours 0–23, e.g. "8, 14, 20"', 'error');
      return;
    }
    setIsSavingCron(true);
    try {
      await saveRemoteReviewCronHours(teamId, hours);
      addNotification('Cron saved! Remote SKU workers will apply it shortly.', 'success');
      setShowCronConfig(false);
    } catch (err: any) {
      addNotification(err.message || 'Failed to save cron hours.', 'error');
    } finally {
      setIsSavingCron(false);
    }
  }, [cronHoursInput, addNotification, teamId]);

  // Filter out eBay accounts (only keep Etsy)
  const etsyAccounts = useMemo(() => {
    return accounts.filter((acc) => acc.platforms && acc.platforms.includes("etsy"));
  }, [accounts]);

  const eligibleEtsyAccounts = useMemo(() => {
    return etsyAccounts.filter(account => !account.etsy_suspended);
  }, [etsyAccounts]);

  const filteredEtsyAccounts = useMemo(() => {
    const keyword = shopSearchTerm.trim().toLowerCase();
    const matchedAccounts = keyword
      ? etsyAccounts.filter(account => [
        account.label,
        account.email,
        account.id,
        (account as any).name,
        (account as any).shopName,
        (account as any).etsyShopName,
        (account as any).etsy_shop_name,
      ].some(value => String(value || '').toLowerCase().includes(keyword)))
      : etsyAccounts;

    return matchedAccounts.slice().sort((left, right) => {
      const priorityDifference = getWorkerSortPriority(left) - getWorkerSortPriority(right);
      if (priorityDifference !== 0) return priorityDifference;
      const pendingDifference = (right.worker_status?.pending_count || 0) - (left.worker_status?.pending_count || 0);
      if (pendingDifference !== 0) return pendingDifference;
      return String(left.label || left.email).localeCompare(String(right.label || right.email));
    });
  }, [etsyAccounts, shopSearchTerm]);

  const stats = useMemo(() => {
    let active = 0;
    let error = 0;
    let offline = 0;
    const pending = eligibleEtsyAccounts.reduce((sum, a) => sum + (a.worker_status?.pending_count ?? 0), 0);

    eligibleEtsyAccounts.forEach((a) => {
      const ws = a.worker_status;
      if (!ws) {
        offline++;
        return;
      }
      const isSilent = dayjs().diff(dayjs(ws.last_heartbeat), "minute") > 10;
      if (isSilent) {
        offline++;
      } else if (ws.status === "error") {
        error++;
      } else {
        active++;
      }
    });

    return { active, error, offline, pending };
  }, [eligibleEtsyAccounts]);

  const getStatusStyles = (record: Account) => {
    const ws = record.worker_status;
    if (!ws)
      return {
        label: "OFFLINE",
        color:
          "text-slate-500 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
        icon: <Clock size={12} />,
      };

    const isSilent = dayjs().diff(dayjs(ws.last_heartbeat), "minute") > 10;
    if (isSilent)
      return {
        label: "LOST",
        color:
          "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20",
        icon: <ShieldAlert size={12} />,
      };

    if (ws.status === "error")
      return {
        label: "ERROR",
        color:
          "text-red-600 bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/20",
        icon: <AlertCircle size={12} />,
      };
    if (ws.status === "processing")
      return {
        label: "SYNCING",
        color:
          "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20",
        icon: <Loader2 size={12} className="animate-spin" />,
      };
    return {
      label: "ACTIVE",
      color:
        "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20",
      icon: <CheckCircle2 size={12} />,
    };
  };

  const handleAction = async () => {
    const { type, shopEmail, shopLabel } = confirmModal;
    setIsActionLoading(true);
    setConfirmModal({ show: false, type: null });
    try {
      if (type === "clear") {
        const count = await clearPendingSkuJobs(teamId);
        addNotification(
          `Cleared ${count} pending jobs for the entire team.`,
          "success",
        );
      } else if (type === "shop_clear" && shopEmail) {
        const count = await clearPendingSkuJobs(teamId, shopEmail);
        addNotification(
          `Cleared ${count} pending jobs for ${shopLabel}.`,
          "success",
        );
      }
    } catch (err) {
      addNotification("Action failed.", "error");
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1 font-sans tracking-tight">
      {/* Custom Modal */}
      {confirmModal.show && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-slate-700 dark:bg-slate-800">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-500 dark:bg-red-500/10">
              <AlertCircle size={24} />
            </div>
            <h4 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">
              Confirm Action
            </h4>
            <p className="mb-6 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {confirmModal.type === "clear" &&
                "Are you sure you want to delete ALL pending jobs across the entire team? This cannot be undone."}
              {confirmModal.type === "shop_clear" &&
                `Are you sure you want to delete pending jobs for ${confirmModal.shopLabel}?`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal({ show: false, type: null })}
                disabled={isActionLoading}
                className="flex-1 rounded-lg border border-slate-200 px-5 py-2.5 font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={isActionLoading}
                className="flex flex-1 items-center justify-center rounded-lg bg-red-600 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {isActionLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  "Confirm Delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid flex-shrink-0 grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-4">
          <div className="flex items-center gap-3 border-b border-r border-slate-200 px-4 py-3 dark:border-slate-800 sm:border-b-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <Activity size={15} />
            </div>
            <div>
              <span className="block text-lg font-bold leading-none text-slate-900 dark:text-white">{stats.active}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Active</span>
            </div>
          </div>

          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:border-b-0 sm:border-r">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <AlertCircle size={15} />
            </div>
            <div>
              <span className="block text-lg font-bold leading-none text-slate-900 dark:text-white">{stats.error}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Error</span>
            </div>
          </div>

          <div className="flex items-center gap-3 border-r border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
              <Clock size={15} />
            </div>
            <div>
              <span className="block text-lg font-bold leading-none text-slate-900 dark:text-white">{stats.offline}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Offline</span>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              <ListTree size={15} />
            </div>
            <div>
              <span className="block text-lg font-bold leading-none text-slate-900 dark:text-white">{stats.pending}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Queue</span>
            </div>
          </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/30">
          {/* Run Health Check */}
          <button
            onClick={handleRunHealthCheck}
            disabled={isHealthRunning}
            title="Trigger health check for all Etsy shops in the active Health Extension profile"
            className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-700 dark:hover:text-emerald-400"
          >
            {isHealthRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Health Check
          </button>

          {/* Crawl Reviews Now */}
          <button
            onClick={handleCrawlReviews}
            disabled={isCrawlingReviews}
            title="Crawl latest 25 reviews from all Etsy shops in the active SKU Worker profile"
            className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:text-blue-400"
          >
            {isCrawlingReviews ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Crawl Reviews
          </button>

          {/* Cron config popover */}
          <div className="relative">
            <button
              onClick={() => setShowCronConfig(value => !value)}
              title="Configure review crawl schedule"
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${showCronConfig ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-500/10 dark:text-blue-400' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}
            >
              <Settings2 size={14} />
              Review Cron
            </button>
            {showCronConfig && (
              <div className="fixed inset-x-3 top-1/2 z-[120] -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-72 sm:translate-y-0">
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Review Crawl Schedule</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">Hours 0–23 (Vietnam time), comma-separated.<br/>E.g. <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">8, 14, 20</code></p>
                <input
                  type="text"
                  value={cronHoursInput}
                  onChange={e => setCronHoursInput(e.target.value)}
                  placeholder="8, 12, 20"
                  className="mb-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-blue-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
                <button
                  onClick={handleSaveCronHours}
                  disabled={isSavingCron}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSavingCron ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save & Reschedule
                </button>
              </div>
            )}
          </div>

          <div className="hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

          {/* Clear All Jobs */}
          <button
            onClick={() => setConfirmModal({ show: true, type: "clear" })}
            className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Trash2 size={14} />
            Clear Queue
          </button>
        </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Shop workers</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Showing {filteredEtsyAccounts.length} of {etsyAccounts.length} Etsy shops
            </p>
          </div>
          <label className="relative block w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              value={shopSearchTerm}
              onChange={event => setShopSearchTerm(event.target.value)}
              placeholder="Search shop name or email..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm font-medium text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-blue-500/10"
            />
            {shopSearchTerm && <button type="button" onClick={() => setShopSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={14} /></button>}
          </label>
        </div>
        <div className="max-h-[430px] flex-1 overflow-auto custom-scrollbar">
          <table className="w-full min-w-[820px] text-left">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 text-[10px] font-bold uppercase tracking-wider text-slate-500 backdrop-blur-md dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Shop</th>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3">Health</th>
                <th className="px-4 py-3">Reviews</th>
                <th className="px-4 py-3 text-center">Queue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {filteredEtsyAccounts.map((acc) => {
                const st = getStatusStyles(acc);
                const hasPending = (acc.worker_status?.pending_count ?? 0) > 0;
                const reviewStatus = acc.worker_status?.review_status;
                const workerHasError = hasWorkerError(acc);

                return (
                  <tr
                    key={acc.id}
                    className={`group transition-all ${
                      acc.etsy_suspended
                        ? 'bg-slate-50/70 opacity-60 hover:opacity-100 dark:bg-slate-950/30'
                        : workerHasError
                          ? 'bg-red-50/40 hover:bg-red-50/70 dark:bg-red-950/10 dark:hover:bg-red-950/20'
                          : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30'
                    }`}
                  >
                    <td className="px-4 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 dark:text-white leading-tight mb-0.5 flex items-center gap-1.5">
                          {acc.label}
                          {acc.etsy_suspended && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                              SUSPENDED
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium tracking-tight">
                          {acc.email}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${st.color}`}
                      >
                        {st.icon}
                        {st.label}
                      </div>
                      <div className="mt-1.5 flex flex-col">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {acc.worker_status?.last_heartbeat
                            ? dayjs(acc.worker_status.last_heartbeat).fromNow()
                            : "--"}
                        </span>
                        <span className="mt-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                          {acc.worker_status?.version
                            ? `Build v${acc.worker_status.version}`
                            : "No build info"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {acc.etsy_health_status ? (
                        <div className="flex flex-col text-[11px] gap-0.5">
                          <div className="flex items-center gap-1">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                              acc.etsy_health_status === 'ok' ? 'bg-emerald-500' :
                              acc.etsy_health_status === 'suspended' ? 'bg-red-500' :
                              acc.etsy_health_status === 'captcha_required' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                            }`} />
                            <span className="font-bold text-slate-700 dark:text-slate-300 uppercase">
                              {acc.etsy_health_status}
                            </span>
                          </div>
                          {(() => {
                            const checkedDate = parseDateValue(acc.etsy_health_checked_at);
                            return checkedDate ? (
                              <span className="text-slate-500 dark:text-slate-400">
                                Checked {dayjs(checkedDate).fromNow()}
                              </span>
                            ) : null;
                          })()}
                          {acc.etsy_health_error && (
                            <span className="text-red-500 dark:text-red-400 font-medium truncate max-w-[200px]" title={acc.etsy_health_error}>
                              Error: {acc.etsy_health_error}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-300 dark:text-slate-600 font-medium">No check logs</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {reviewStatus ? (
                        <div className="flex flex-col text-[11px] gap-0.5">
                          <div className="flex items-center gap-1">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                              reviewStatus.state === 'running' ? 'bg-blue-500 animate-pulse' :
                              reviewStatus.state === 'error' ? 'bg-red-500' : 'bg-emerald-500'
                            }`} />
                            <span className="font-bold text-slate-700 dark:text-slate-300 uppercase">
                              {reviewStatus.state || 'IDLE'}
                            </span>
                          </div>
                          {reviewStatus.lastSuccessAt && (
                            <span className="text-slate-500 dark:text-slate-400">
                              Synced {dayjs(reviewStatus.lastSuccessAt).fromNow()} (+{reviewStatus.lastSaved || 0} reviews)
                            </span>
                          )}
                          {reviewStatus.lastError && (
                            <span className="text-red-500 dark:text-red-400 font-medium truncate max-w-[200px]" title={reviewStatus.lastError}>
                              Error: {reviewStatus.lastError}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-300 dark:text-slate-600 font-medium">No review sync logs</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="inline-flex items-center gap-2">
                        <span
                          className={`min-w-5 text-sm font-bold ${
                            hasPending
                              ? acc.worker_status!.pending_count > 15
                                ? "text-red-500 dark:text-red-400"
                                : "text-slate-900 dark:text-white"
                              : "text-slate-300 dark:text-slate-600"
                          }`}
                        >
                          {acc.worker_status?.pending_count ?? 0}
                        </span>
                        <button
                          disabled={!hasPending || isActionLoading}
                          onClick={() =>
                            setConfirmModal({
                              show: true,
                              type: "shop_clear",
                              shopEmail: acc.email,
                              shopLabel: acc.label,
                            })
                          }
                          className={`rounded-lg p-2 transition-colors ${
                            hasPending
                              ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                              : "cursor-not-allowed text-slate-200 dark:text-slate-700"
                          }`}
                          title="Clear this shop queue"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredEtsyAccounts.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-12 text-center text-slate-400 text-sm"
                  >
                    {shopSearchTerm ? 'No matching shops found.' : 'No Etsy shops found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default React.memo(WorkerStatusManager);
