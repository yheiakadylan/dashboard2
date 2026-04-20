import React, { useMemo, useState } from "react";
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
} from "lucide-react";
import { clearPendingSkuJobs } from "../../../services/firebaseService";

dayjs.extend(relativeTime);

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

  const stats = useMemo(() => {
    let active = 0;
    let error = 0;
    let offline = 0;
    const pending = accounts.reduce((sum, a) => sum + (a.worker_status?.pending_count ?? 0), 0);

    accounts.forEach((a) => {
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
  }, [accounts]);

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

      {/* Header Area with Status Cards */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2 px-1 mt-2">
        <div className="flex flex-col md:flex-row gap-3 flex-1 w-full">
          <div className="flex-1 px-4 py-3 rounded-[20px] border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 flex items-center gap-3 shadow-sm">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <Activity size={18} />
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-black text-emerald-700 dark:text-emerald-400 leading-none">
                {stats.active}
              </span>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-widest mt-1">
                Active
              </span>
            </div>
          </div>

          <div className="flex-1 px-4 py-3 rounded-[20px] border border-red-100 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5 flex items-center gap-3 shadow-sm">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400">
              <AlertCircle size={18} />
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-black text-red-700 dark:text-red-400 leading-none">
                {stats.error}
              </span>
              <span className="text-[10px] font-bold text-red-600 dark:text-red-500 uppercase tracking-widest mt-1">
                Error
              </span>
            </div>
          </div>

          <div className="flex-1 px-4 py-3 rounded-[20px] border border-blue-100 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 flex items-center gap-3 shadow-sm">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
              <Loader2 size={18} className="animate-spin" />
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-black text-blue-700 dark:text-blue-400 leading-none">
                {stats.pending}
              </span>
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-500 uppercase tracking-widest mt-1">
                Queue
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmModal({ show: true, type: "clear" })}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-all border border-red-200 dark:border-red-500/20"
          >
            <Trash2 size={16} />
            Clear All
          </button>
        </div>
      </div>

      {/* Main Information Grid/Table - Scrollable Container */}
      <div className="flex-1 border border-slate-200 dark:border-slate-800 rounded-[24px] overflow-hidden flex flex-col bg-white dark:bg-slate-900 shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-340px)] custom-scrollbar">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur-md z-10 border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              <tr>
                <th className="px-6 py-4 rounded-tl-[24px]">Shop Profile</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-center">Queue</th>
                <th className="px-6 py-4">Last Pulse</th>
                <th className="px-6 py-4 text-center rounded-tr-[24px]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {accounts.map((acc) => {
                const st = getStatusStyles(acc);
                const hasPending = (acc.worker_status?.pending_count ?? 0) > 0;
                return (
                  <tr
                    key={acc.id}
                    className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all"
                  >
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 dark:text-white leading-tight mb-0.5">
                          {acc.label}
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
              {accounts.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
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
