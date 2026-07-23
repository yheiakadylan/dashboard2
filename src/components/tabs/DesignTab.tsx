import React, { useState, useEffect } from "react";
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
  onOpen: (t: DesignTask) => void;
  onDelete: (t: DesignTask) => void;
}> = ({ task, isOwner, onOpen, onDelete }) => {
  const thumbnail = task.attachments?.[0] || task.imageUrls?.[0] || null;
  const priority = task.priority ?? "normal";

  return (
    <div
      onClick={() => onOpen(task)}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden cursor-pointer hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all group"
    >
      {/* Thumbnail */}
      <div className="h-36 bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden">
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

      {/* Delete button — owner only */}
      {isOwner && (
        <div className="px-3 pb-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task);
            }}
            className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

const DesignTab: React.FC = () => {
  const { teamId, role } = useDashboard();
  const isOwner = role === "owner";

  const [tasks, setTasks] = useState<DesignTask[]>([]);
  const [activeStatus, setActiveStatus] = useState<DesignStatus>("new");
  const [modalTask, setModalTask] = useState<DesignTask | null | undefined>(
    undefined,
  ); // undefined=closed, null=create, task=edit
  const [deleteConfirm, setDeleteConfirm] = useState<DesignTask | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = listenDesignTasks(teamId, setTasks);
    return unsub;
  }, [teamId]);

  const filteredTasks = tasks.filter((t) => t.status === activeStatus);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await deleteDesignTask(teamId, deleteConfirm.id);
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  const counts = STATUSES.reduce(
    (acc, s) => {
      acc[s] = tasks.filter((t) => t.status === s).length;
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
            {tasks.length} total task{tasks.length !== 1 ? "s" : ""}
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
            onClick={() => setActiveStatus(s)}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isOwner={isOwner}
              onOpen={(t) => setModalTask(t)}
              onDelete={(t) => setDeleteConfirm(t)}
            />
          ))}
        </div>
      )}

      {/* Task Modal */}
      {modalTask !== undefined && (
        <DesignTaskModal
          task={modalTask}
          onClose={() => setModalTask(undefined)}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              Delete Task?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              "{deleteConfirm.title}" will be permanently deleted.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DesignTab;
