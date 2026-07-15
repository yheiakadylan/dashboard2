import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDashboard } from "../contexts/DashboardContext";
import { DesignTask, DesignComment, DesignStatus } from "../types";
import {
  createDesignTask,
  updateDesignTask,
  claimDesignTask,
  listenDesignComments,
  addDesignComment,
  uploadDesignAttachment,
  uploadCommentAttachment,
  generateTaskId,
} from "../services/designService";
import Spinner from "./Spinner";

interface Props {
  task: DesignTask | null; // null = create mode
  onClose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  todo: "Todo",
  in_review: "In Review",
  need_fix: "Need Fix",
  done: "Done",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  todo: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  in_review:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  need_fix: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const DesignTaskModal: React.FC<Props> = ({ task, onClose }) => {
  const { teamId, role, permissions, user, display_name } = useDashboard();
  const isEdit = !!task;
  const isOwner = role === "owner";
  const canAddDesign = isOwner || !!permissions?.canAddDesign;
  const canProcess = isOwner || !!permissions?.canProcessDesign;
  const isAssignee = !!task && task.assignedTo === user?.uid;

  // Pre-generate ID for create mode so we can upload before saving
  const [pendingTaskId] = useState<string>(() =>
    !task ? generateTaskId(teamId) : "",
  );
  const activeTaskId = task?.id ?? pendingTaskId;

  // Status dropdown — statuses this user can select
  const allowedStatuses: DesignStatus[] = isOwner
    ? ["new", "todo", "in_review", "need_fix", "done"]
    : canProcess
      ? ["todo", "in_review"]
      : ["need_fix", "done"];
  const [statusDraft, setStatusDraft] = useState<DesignStatus>(
    task?.status ?? "new",
  );

  // Form state
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [attachments, setAttachments] = useState<string[]>(
    task?.attachments ?? [],
  );
  const [imageUrls, setImageUrls] = useState<string[]>(task?.imageUrls ?? []);
  const [designUrls, setDesignUrls] = useState<string[]>(
    task?.designUrls ?? [],
  );
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newDesignUrl, setNewDesignUrl] = useState("");

  // Comments
  const [comments, setComments] = useState<DesignComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [commentFilePreview, setCommentFilePreview] = useState<string | null>(
    null,
  );

  // Upload / saving state
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commentSending, setCommentSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentFileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const displayName = display_name || user?.email?.split("@")[0] || "Unknown";

  // Subscribe to comments in edit mode
  useEffect(() => {
    if (!isEdit || !task?.id) return;
    const unsub = listenDesignComments(teamId, task.id, setComments);
    return unsub;
  }, [isEdit, task?.id, teamId]);

  // Attachment upload — works in both create and edit mode using activeTaskId
  const handleFiles = useCallback(
    async (files: FileList) => {
      setUploading(true);
      setError(null);
      try {
        const urls: string[] = [];
        for (const file of Array.from(files)) {
          const url = await uploadDesignAttachment(teamId, activeTaskId, file);
          urls.push(url);
        }
        const updated = [...attachments, ...urls];
        setAttachments(updated);
        // In edit mode, persist immediately; in create mode, attachments are saved on submit
        if (isEdit && task?.id) {
          await updateDesignTask(teamId, task.id, { attachments: updated });
        }
      } catch {
        setError("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [activeTaskId, teamId, attachments, isEdit, task?.id],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleAddImageUrl = () => {
    const url = newImageUrl.trim();
    if (!url) return;
    setImageUrls((prev) => [...prev, url]);
    setNewImageUrl("");
  };

  const handleAddDesignUrl = () => {
    const url = newDesignUrl.trim();
    if (!url) return;
    setDesignUrls((prev) => [...prev, url]);
    setNewDesignUrl("");
  };

  const handleRemoveItem = (
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    idx: number,
  ) => {
    setter(list.filter((_, i) => i !== idx));
  };

  // Save (create or update)
  const handleSave = async () => {
    const canEditContent = canAddDesign || isOwner;
    if (canEditContent) {
      if (!title.trim()) {
        setError("Title is required.");
        return;
      }
      if (!description.trim()) {
        setError("Description is required.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit && task) {
        const update: Partial<Omit<DesignTask, "id" | "createdAt">> = {
          status: statusDraft,
        };
        if (canEditContent) {
          update.title = title.trim();
          update.description = description.trim();
          update.imageUrls = imageUrls;
          update.designUrls = designUrls;
        }
        // When claiming (new/need_fix → todo), record assignee
        if (
          statusDraft === "todo" &&
          task.status !== "todo" &&
          !task.assignedTo
        ) {
          update.assignedTo = user!.uid;
          update.assignedToName = displayName;
        }
        await updateDesignTask(teamId, task.id, update);
      } else {
        await createDesignTask(
          teamId,
          {
            title: title.trim(),
            description: description.trim(),
            status: "new",
            attachments,
            imageUrls,
            designUrls,
            createdBy: user!.uid,
            createdByName: displayName,
          },
          pendingTaskId,
        );
      }
      onClose();
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Status actions
  const handleClaim = async () => {
    if (!task) return;
    setActionLoading(true);
    setError(null);
    try {
      await claimDesignTask(teamId, task.id, user!.uid, displayName);
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to claim task.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStatusChange = async (
    newStatus: "in_review" | "done" | "need_fix",
  ) => {
    if (!task) return;
    setActionLoading(true);
    setError(null);
    try {
      const update: any = { status: newStatus };
      if (newStatus === "in_review") {
        update.designUrls = designUrls;
      }
      await updateDesignTask(teamId, task.id, update);
      onClose();
    } catch {
      setError("Failed to update status.");
    } finally {
      setActionLoading(false);
    }
  };

  // Comment
  const handleCommentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCommentFile(file);
    setCommentFilePreview(URL.createObjectURL(file));
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() && !commentFile) return;
    if (!task) return;
    setCommentSending(true);
    setError(null);
    try {
      let attachmentUrl: string | undefined;
      if (commentFile) {
        attachmentUrl = await uploadCommentAttachment(
          teamId,
          task.id,
          commentFile,
        );
      }
      await addDesignComment(teamId, task.id, {
        content: commentText.trim(),
        attachmentUrl,
        createdBy: user!.uid,
        createdByName: displayName,
      });
      setCommentText("");
      setCommentFile(null);
      setCommentFilePreview(null);
    } catch {
      setError("Failed to add comment.");
    } finally {
      setCommentSending(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
  };

  const formatTime = (ts: any) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isEdit ? "Edit Task" : "New Design Task"}
            </h2>
            {task && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status]}`}
              >
                {STATUS_LABELS[task.status]}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title..."
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe the design requirements..."
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          {/* Attachments — available in both create and edit mode */}
          {
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Attachments
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-300 dark:border-gray-600 hover:border-blue-400"
                }`}
              >
                {uploading ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <Spinner size="sm" />
                    Uploading...
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Drag & drop files here, or click to select
                  </p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              {attachments.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {attachments.map((url, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={url}
                        alt=""
                        className="w-full h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-600"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24'%3E%3Cpath fill='%23ccc' d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3C/svg%3E";
                        }}
                      />
                      <button
                        onClick={() =>
                          handleRemoveItem(attachments, setAttachments, i)
                        }
                        className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          }

          {/* Image URLs (Loại 2 or Owner, in edit mode) */}
          {(isOwner || (canProcess && isEdit)) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Reference Image URLs
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddImageUrl()}
                  placeholder="https://..."
                  className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  onClick={handleAddImageUrl}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  Add URL
                </button>
              </div>
              {imageUrls.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {imageUrls.map((url, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400"
                    >
                      <span className="flex-1 truncate">{url}</span>
                      <button
                        onClick={() =>
                          handleRemoveItem(imageUrls, setImageUrls, i)
                        }
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Design URLs — visible to all in edit mode */}
          {isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Design Output URLs
              </label>
              {/* Only assignee or owner can add */}
              {(isOwner || (canProcess && isAssignee)) && (
                <div className="flex gap-2 mb-2">
                  <input
                    type="url"
                    value={newDesignUrl}
                    onChange={(e) => setNewDesignUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddDesignUrl()}
                    placeholder="https://..."
                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    onClick={handleAddDesignUrl}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                  >
                    Add URL
                  </button>
                </div>
              )}
              {designUrls.length > 0 ? (
                <ul className="space-y-1">
                  {designUrls.map((url, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-blue-600 dark:text-blue-400">
                        {url}
                      </span>
                      <button
                        onClick={() => handleCopyUrl(url)}
                        title="Copy URL"
                        className="text-gray-400 hover:text-blue-500 text-xs px-1"
                      >
                        Copy
                      </button>
                      {(isOwner || (canProcess && isAssignee)) && (
                        <button
                          onClick={() =>
                            handleRemoveItem(designUrls, setDesignUrls, i)
                          }
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-400 italic">
                  No design URLs yet.
                </p>
              )}
            </div>
          )}

          {/* Status dropdown — edit mode only */}
          {isEdit && task && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Status
              </label>
              <select
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value as DesignStatus)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {/* Always show current status even if not in allowed list */}
                {!allowedStatuses.includes(task.status) && (
                  <option value={task.status} disabled>
                    {STATUS_LABELS[task.status]} (current)
                  </option>
                )}
                {allowedStatuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Task meta */}
          {isEdit && task && (
            <div className="text-xs text-gray-400 dark:text-gray-500 space-y-0.5">
              <p>
                Created by: {task.createdByName} — {formatTime(task.createdAt)}
              </p>
              {task.assignedTo && <p>Assigned to: {task.assignedToName}</p>}
            </div>
          )}

          {/* Comments — edit mode only */}
          {isEdit && task && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Comments ({comments.length})
              </h3>

              {/* Comment list */}
              <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
                {comments.length === 0 && (
                  <p className="text-xs text-gray-400 italic">
                    No comments yet.
                  </p>
                )}
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {c.createdByName}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatTime(c.createdAt)}
                      </span>
                    </div>
                    {c.content && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {c.content}
                      </p>
                    )}
                    {c.attachmentUrl && (
                      <img
                        src={c.attachmentUrl}
                        alt=""
                        className="mt-2 max-h-40 rounded-lg border border-gray-200 dark:border-gray-600"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Add comment */}
              <div className="space-y-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={2}
                  placeholder="Add a comment..."
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
                {commentFilePreview && (
                  <div className="relative inline-block">
                    <img
                      src={commentFilePreview}
                      alt=""
                      className="h-20 rounded-lg border border-gray-200 dark:border-gray-600"
                    />
                    <button
                      onClick={() => {
                        setCommentFile(null);
                        setCommentFilePreview(null);
                      }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => commentFileRef.current?.click()}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    📎 Image
                  </button>
                  <input
                    ref={commentFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCommentFileChange}
                  />
                  <button
                    onClick={handleSubmitComment}
                    disabled={
                      commentSending || (!commentText.trim() && !commentFile)
                    }
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {commentSending && <Spinner size="sm" />}
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          {/* Show Save in edit mode for all users (status change); Create only for canAddDesign/owner */}
          {(isEdit || canAddDesign || isOwner) && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Spinner size="sm" />}
              {isEdit ? "Save Changes" : "Create Task"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DesignTaskModal;
