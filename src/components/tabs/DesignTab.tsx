import React, { useState, useEffect, useMemo } from "react";
import { useDashboard } from "../../contexts/DashboardContext";
import { DesignTask, DesignStatus } from "../../types";
import {
  listenDesignTasks,
  deleteDesignTask,
} from "../../services/designService";
import DesignTaskModal from "../DesignTaskModal";

const STATUSES: DesignStatus[] = [
  "new",
  "todo",
  "in_review",
  "need_fix",
  "done",
  "overdue",
];

const STATUS_LABELS: Record<DesignStatus, string> = {
  new: "New",
  todo: "Todo",
  in_review: "In Review",
  need_fix: "Need Fix",
  done: "Done",
  overdue: "Over Due Date",
};

const STATUS_COLORS: Record<DesignStatus, string> = {
  new: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600",
  todo: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  in_review:
    "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700",
  need_fix:
    "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-700",
  done: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-700",
  overdue:
    "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-700",
};

const STATUS_TAB_ACTIVE: Record<DesignStatus, string> = {
  new: "border-b-2 border-gray-600 text-gray-900 dark:text-white font-semibold",
  todo: "border-b-2 border-blue-600 text-blue-700 dark:text-blue-400 font-semibold",
  in_review:
    "border-b-2 border-yellow-500 text-yellow-700 dark:text-yellow-400 font-semibold",
  need_fix:
    "border-b-2 border-red-500 text-red-700 dark:text-red-400 font-semibold",
  done: "border-b-2 border-green-600 text-green-700 dark:text-green-400 font-semibold",
  overdue:
    "border-b-2 border-orange-500 text-orange-700 dark:text-orange-400 font-semibold",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  normal: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  high: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

const formatDate = (ts: any): string => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const TaskCard: React.FC<{
  task: DesignTask;
  isOwner: boolean;
  isSelected: boolean;
  onOpen: (t: DesignTask) => void;
  onDelete: (t: DesignTask) => void;
  onToggleSelect: (id: string) => void;
}> = ({ task, isOwner, isSelected, onOpen, onDelete, onToggleSelect }) => {
  const thumbnail = task.attachments?.[0] || task.imageUrls?.[0] || null;
  const priority = task.priority ?? "normal";

  return (
    <div
      onClick={() => onOpen(task)}
      className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden cursor-pointer hover:shadow-md transition-all group ${
        isSelected
          ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30"
          : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative h-36 bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <svg
            className="w-10 h-10 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        )}
        {/* Select checkbox — owner only */}
        {isOwner && (
          <div className="absolute top-2 left-2">
            <input
              type="checkbox"
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(task.id)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-3">
        <h3
          className="font-medium text-gray-900 dark:text-white text-sm truncate mb-0.5"
          title={task.title}
        >
          {task.title}
        </h3>
        {task.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-1">
            {task.description}
          </p>
        )}

        {/* Creator */}
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
          By: {task.createdByName}
        </p>

        {/* Status + Priority badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[task.status]}`}
          >
            {STATUS_LABELS[task.status]}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[priority]}`}
          >
            {PRIORITY_LABELS[priority]}
          </span>
        </div>

        {/* Designer */}
        {task.assignedToName && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            Designer: {task.assignedToName}
          </p>
        )}

        {/* Design Code */}
        {task.design_code && (
          <p className="text-xs font-mono text-indigo-600 dark:text-indigo-400 mb-1 truncate">
            {task.design_code}
          </p>
        )}

        {/* Dates */}
        <div className="text-xs text-gray-400 dark:text-gray-500 space-y-0.5">
          <p>Created: {formatDate(task.createdAt)}</p>
          <p>Updated: {formatDate(task.updatedAt)}</p>
        </div>

        {task.designUrls?.length > 0 && (
          <div className="mt-2 text-xs text-green-600 dark:text-green-400">
            {task.designUrls.length} design URL
            {task.designUrls.length > 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
};

const PAGE_SIZE = 20;

const DesignTab: React.FC = () => {
  const { teamId, role, user, viewable_design_teams } = useDashboard();
  const isOwner = role === "owner";

  const [tasks, setTasks] = useState<DesignTask[]>([]);
  const [activeStatus, setActiveStatus] = useState<DesignStatus>("new");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [modalTask, setModalTask] = useState<DesignTask | null | undefined>(
    undefined,
  ); // undefined=closed, null=create, task=edit

  useEffect(() => {
    const unsub = listenDesignTasks(teamId, setTasks);
    return unsub;
  }, [teamId]);

  const visibleTasks = useMemo(() => {
    if (isOwner) return tasks;
    const allowed = viewable_design_teams;
    if (!allowed || allowed.length === 0) return tasks;
    return tasks.filter((t) => {
      if (t.createdBy === user?.uid) return true;
      // New tasks: createdByTeams array (intersection with allowed)
      if (t.createdByTeams?.length)
        return t.createdByTeams.some((team) => allowed.includes(team));
      // Old tasks: single createdByTeam string (backward compat)
      if (t.createdByTeam) return allowed.includes(t.createdByTeam);
      return false;
    });
  }, [tasks, isOwner, viewable_design_teams, user?.uid]);

  const filteredTasks = visibleTasks.filter((t) => t.status === activeStatus);
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const pagedTasks = filteredTasks.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(pagedTasks.map((t) => t.id)) : new Set());
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      await Promise.all(
        [...selectedIds].map((id) => deleteDesignTask(teamId, id)),
      );
      setSelectedIds(new Set());
      setBulkDeleteConfirm(false);
    } finally {
      setBulkDeleting(false);
    }
  };

  const counts = STATUSES.reduce(
    (acc, s) => {
      acc[s] = visibleTasks.filter((t) => t.status === s).length;
      return acc;
    },
    {} as Record<DesignStatus, number>,
  );

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Design Tasks
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {visibleTasks.length} total task
            {visibleTasks.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setModalTask(null)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          New Task
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6 overflow-x-auto">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setActiveStatus(s);
              setCurrentPage(1);
              setSelectedIds(new Set());
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${
              activeStatus === s
                ? STATUS_TAB_ACTIVE[s]
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {STATUS_LABELS[s]}
            {counts[s] > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  s === "overdue"
                    ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                    : activeStatus === s
                      ? "bg-current/10"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                }`}
              >
                {counts[s]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk action toolbar — owner only, shown when tasks exist */}
      {isOwner && filteredTasks.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={
                pagedTasks.length > 0 &&
                pagedTasks.every((t) => selectedIds.has(t.id))
              }
              onChange={(e) => handleSelectAll(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Select all on page
          </label>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors"
            >
              Delete ({selectedIds.size})
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Task grid */}
      {filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-600">
          <svg
            className="w-12 h-12 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-sm">No tasks in {STATUS_LABELS[activeStatus]}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {pagedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isOwner={isOwner}
                isSelected={selectedIds.has(task.id)}
                onOpen={(t) => setModalTask(t)}
                onDelete={() => {}}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - currentPage) <= 1,
                )
                .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1)
                    acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === "..." ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-2 text-gray-400 dark:text-gray-500 text-sm"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setCurrentPage(item as number)}
                      className={`min-w-[2rem] px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        currentPage === item
                          ? "bg-blue-600 border-blue-600 text-white font-medium"
                          : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      {item}
                    </button>
                  ),
                )}

              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Task Modal */}
      {modalTask !== undefined && (
        <DesignTaskModal
          task={modalTask}
          onClose={() => setModalTask(undefined)}
        />
      )}

      {/* Bulk delete confirm */}
      {bulkDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setBulkDeleteConfirm(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              Delete {selectedIds.size} task{selectedIds.size > 1 ? "s" : ""}?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {bulkDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DesignTab;
