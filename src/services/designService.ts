import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  runTransaction,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "./firebaseService";
import { DesignTask, DesignComment } from "../types";

const tasksCol = (teamId: string) =>
  collection(db, "user", teamId, "design_tasks");

const commentsCol = (teamId: string, taskId: string) =>
  collection(db, "user", teamId, "design_tasks", taskId, "comments");

export const listenDesignTasks = (
  teamId: string,
  callback: (tasks: DesignTask[]) => void,
): (() => void) => {
  const q = query(tasksCol(teamId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const tasks = snap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as DesignTask,
    );
    callback(tasks);
  });
};

export const createDesignTask = async (
  teamId: string,
  data: Omit<DesignTask, "id" | "createdAt" | "updatedAt">,
  presetId?: string,
): Promise<string> => {
  const now = Timestamp.now();
  const payload = { ...data, createdAt: now, updatedAt: now };
  if (presetId) {
    const docRef = doc(tasksCol(teamId), presetId);
    await setDoc(docRef, payload);
    return presetId;
  }
  const docRef = await addDoc(tasksCol(teamId), payload);
  return docRef.id;
};

// Generate a new Firestore document ID without writing (for pre-upload in create mode)
export const generateTaskId = (teamId: string): string =>
  doc(tasksCol(teamId)).id;

export const updateDesignTask = async (
  teamId: string,
  taskId: string,
  data: Partial<Omit<DesignTask, "id" | "createdAt">>,
): Promise<void> => {
  await updateDoc(doc(db, "user", teamId, "design_tasks", taskId), {
    ...data,
    updatedAt: Timestamp.now(),
  });
};

export const deleteDesignTask = async (
  teamId: string,
  taskId: string,
): Promise<void> => {
  await deleteDoc(doc(db, "user", teamId, "design_tasks", taskId));
};

// Dùng transaction để tránh 2 user claim cùng lúc
export const claimDesignTask = async (
  teamId: string,
  taskId: string,
  uid: string,
  displayName: string,
): Promise<void> => {
  const taskRef = doc(db, "user", teamId, "design_tasks", taskId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists()) throw new Error("Task not found");
    const status = snap.data().status;
    if (status !== "new" && status !== "need_fix")
      throw new Error("Task is no longer available to claim");
    tx.update(taskRef, {
      status: "todo",
      assignedTo: uid,
      assignedToName: displayName,
      updatedAt: Timestamp.now(),
    });
  });
};

export const listenDesignComments = (
  teamId: string,
  taskId: string,
  callback: (comments: DesignComment[]) => void,
): (() => void) => {
  const q = query(commentsCol(teamId, taskId), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    const comments = snap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as DesignComment,
    );
    callback(comments);
  });
};

export const addDesignComment = async (
  teamId: string,
  taskId: string,
  data: Omit<DesignComment, "id" | "createdAt">,
): Promise<void> => {
  const { attachmentUrl, ...rest } = data;
  await addDoc(commentsCol(teamId, taskId), {
    ...rest,
    // Firestore rejects undefined values — only include attachmentUrl when defined
    ...(attachmentUrl !== undefined ? { attachmentUrl } : {}),
    createdAt: Timestamp.now(),
  });
};

export const uploadDesignAttachment = async (
  teamId: string,
  taskId: string,
  file: File,
): Promise<string> => {
  const path = `teams/${teamId}/design-attachments/${taskId}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
};

export const deleteDesignAttachment = async (url: string): Promise<void> => {
  try {
    const storageRef = ref(storage, url);
    await deleteObject(storageRef);
  } catch {
    // ignore if already deleted
  }
};

export const uploadCommentAttachment = async (
  teamId: string,
  taskId: string,
  file: File,
): Promise<string> => {
  const path = `teams/${teamId}/design-comments/${taskId}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
};

// Lấy tất cả comments 1 lần (dùng khi export)
export const getDesignComments = async (
  teamId: string,
  taskId: string,
): Promise<DesignComment[]> => {
  const q = query(commentsCol(teamId, taskId), orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DesignComment);
};
