import React, { useMemo, useState, useCallback } from "react";
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
} from "lucide-react";
import {
  clearPendingSkuJobs,
  enqueueRemoteWorkerCommand,
  saveRemoteReviewCronHours,
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

  const reviewCommandShops = useMemo(() => {
    return accounts
      .filter((acc) => acc.platforms && acc.platforms.includes("etsy"))
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
      .filter((shop) => shop.shopName);
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
        shops: reviewCommandShops,
      });
      addNotification('Review crawl queued! Remote SKU worker will run it shortly.', 'success');
    } catch (err: any) {
      addNotification(err.message || 'Failed to queue review crawl.', 'error');
    } finally {
      setIsCrawlingReviews(false);
    }
  }, [addNotification, reviewCommandShops, teamId]);

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
  }, [cronHoursInput, addNotification]);

  // Filter out eBay accounts (only keep Etsy)
  const etsyAccounts = useMemo(() => {
    return accounts.filter((acc) => acc.platforms && acc.platforms.includes("etsy"));
  }, [accounts]);

  const stats = useMemo(() => {
    let active = 0;
    let error = 0;
    let offline = 0;
    const pending = etsyAccounts.reduce((sum, a) => sum + (a.worker_status?.pending_count ?? 0), 0);

    etsyAccounts.forEach((a) => {
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
  }, [etsyAccounts]);

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
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 font-sans tracking-tight">
      {/* Custom Modal */}
      {confirmModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-[32px] border border-slate-200 dark:border-slate-700 shadow-2xl p-8 max-w-sm w-full text-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
              <AlertCircle size={24} />
            </div>
            <h4 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Confirm Action
            </h4>
            <p className="text-slate-500 text-sm mb-8 leading-relaxed">
              {confirmModal.type === "clear" &&
                "Are you sure you want to delete ALL pending jobs across the entire team? This cannot be undone."}
              {confirmModal.type === "shop_clear" &&
                `Are you sure you want to delete pending jobs for ${confirmModal.shopLabel}?`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal({ show: false, type: null })}
                disabled={isActionLoading}
                className="flex-1 py-3 px-6 rounded-full border border-slate-200 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all font-sans"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={isActionLoading}
                className="flex-1 py-3 px-6 rounded-full font-bold text-white bg-red-500 hover:bg-red-600 transition-all shadow-lg shadow-red-500/30 flex items-center justify-center font-sans"
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

      {/* Header Area — Stats + Actions */}
      <div className="flex items-center justify-between gap-4 mb-2 px-1 mt-2">
        {/* Stat Cards */}
        <div className="flex gap-2 flex-shrink-0">
          <div className="px-4 py-2.5 rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 flex items-center gap-2.5 shadow-sm">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <Activity size={15} />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black text-emerald-700 dark:text-emerald-400 leading-none">{stats.active}</span>
              <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-widest mt-0.5">Active</span>
            </div>
          </div>

          <div className="px-4 py-2.5 rounded-2xl border border-red-100 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5 flex items-center gap-2.5 shadow-sm">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400">
              <AlertCircle size={15} />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black text-red-700 dark:text-red-400 leading-none">{stats.error}</span>
              <span className="text-[9px] font-bold text-red-600 dark:text-red-500 uppercase tracking-widest mt-0.5">Error</span>
            </div>
          </div>

          <div className="px-4 py-2.5 rounded-2xl border border-blue-100 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 flex items-center gap-2.5 shadow-sm">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
              <Loader2 size={15} className="animate-spin" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black text-blue-700 dark:text-blue-400 leading-none">{stats.pending}</span>
              <span className="text-[9px] font-bold text-blue-600 dark:text-blue-500 uppercase tracking-widest mt-0.5">Queue</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Run Health Check */}
          <button
            onClick={handleRunHealthCheck}
            disabled={isHealthRunning}
            title="Trigger health check for all Etsy shops in the active Health Extension profile"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-all border border-emerald-200 dark:border-emerald-500/20 disabled:opacity-50 whitespace-nowrap"
          >
            {isHealthRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Health Check
          </button>

          {/* Crawl Reviews Now */}
          <button
            onClick={handleCrawlReviews}
            disabled={isCrawlingReviews}
            title="Crawl latest 25 reviews from all Etsy shops in the active SKU Worker profile"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 text-sm font-bold hover:bg-sky-100 dark:hover:bg-sky-500/20 transition-all border border-sky-200 dark:border-sky-500/20 disabled:opacity-50 whitespace-nowrap"
          >
            {isCrawlingReviews ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Crawl Reviews
          </button>

          {/* Cron config popover */}
          <div className="relative">
            <button
              onClick={() => setShowCronConfig(v => !v)}
              title="Configure review crawl schedule"
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 text-sm font-bold hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-all border border-violet-200 dark:border-violet-500/20 whitespace-nowrap"
            >
              <Settings2 size={14} />
              Cron
            </button>
            {showCronConfig && (
              <div className="absolute right-0 top-full mt-2 z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4 w-72">
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Review Crawl Schedule</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">Hours 0–23 (Vietnam time), comma-separated.<br/>E.g. <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">8, 14, 20</code></p>
                <input
                  type="text"
                  value={cronHoursInput}
                  onChange={e => setCronHoursInput(e.target.value)}
                  placeholder="8, 12, 20"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-400 mb-3"
                />
                <button
                  onClick={handleSaveCronHours}
                  disabled={isSavingCron}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-bold transition-all disabled:opacity-50"
                >
                  {isSavingCron ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save & Reschedule
                </button>
              </div>
            )}
          </div>

          {/* Separator */}
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />

          {/* Clear All Jobs */}
          <button
            onClick={() => setConfirmModal({ show: true, type: "clear" })}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-all border border-red-200 dark:border-red-500/20 whitespace-nowrap"
          >
            <Trash2 size={14} />
            Clear All
          </button>
        </div>
      </div>


      {/* Main Information Grid/Table - Scrollable Container */}
      <div className="flex-1 border border-slate-200 dark:border-slate-800 rounded-[24px] overflow-hidden flex flex-col bg-white dark:bg-slate-900 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-280px)] custom-scrollbar">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur-md z-10 border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              <tr>
                <th className="px-6 py-4 rounded-tl-[24px]">Shop Profile</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-center">Queue</th>
                <th className="px-6 py-4">Last Pulse</th>
                <th className="px-6 py-4">Health Check</th>
                <th className="px-6 py-4">Review Sync</th>
                <th className="px-6 py-4 text-center rounded-tr-[24px]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {etsyAccounts.map((acc) => {
                const st = getStatusStyles(acc);
                const hasPending = (acc.worker_status?.pending_count ?? 0) > 0;
                const reviewStatus = acc.worker_status?.review_status;

                return (
                  <tr
                    key={acc.id}
                    className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all"
                  >
                    <td className="px-6 py-5">
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
                    <td className="px-6 py-5">
                      <div
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black border ${st.color}`}
                      >
                        {st.icon}
                        {st.label}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <span
                        className={`text-sm font-black ${
                          hasPending
                            ? acc.worker_status!.pending_count > 15
                              ? "text-red-500 dark:text-red-400"
                              : "text-slate-900 dark:text-white"
                            : "text-slate-300 dark:text-slate-600"
                        }`}
                      >
                        {acc.worker_status?.pending_count ?? 0}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-nowrap">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300">
                          {acc.worker_status?.last_heartbeat
                            ? dayjs(acc.worker_status.last_heartbeat).fromNow()
                            : "--"}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium tracking-tight mt-0.5">
                          {acc.worker_status?.version
                            ? `Build v${acc.worker_status.version}`
                            : "No build info"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
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
                    <td className="px-6 py-5">
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
                    <td className="px-6 py-5 text-center">
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
                        className={`p-2.5 rounded-full transition-all ${
                          hasPending
                            ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 active:scale-95 cursor-pointer"
                            : "text-slate-200 dark:text-slate-700 cursor-not-allowed"
                        }`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {etsyAccounts.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-slate-400 text-sm"
                  >
                    No accounts found.
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
