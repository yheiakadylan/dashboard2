import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "./firebaseService";
import { Template } from "../types";

const templatesCol = (teamId: string) =>
  collection(db, "user", teamId, "templates");

const validateUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return undefined;
    return url;
  } catch {
    return undefined;
  }
};

export const listenTemplates = (
  teamId: string,
  callback: (templates: Template[]) => void,
): (() => void) => {
  const q = query(templatesCol(teamId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const templates = snap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Template,
    );
    callback(templates);
  });
};

export const createTemplate = async (
  teamId: string,
  data: Omit<Template, "id" | "createdAt" | "updatedAt">,
): Promise<string> => {
  const now = Timestamp.now();
  const { url, ...rest } = data;
  const safeUrl = validateUrl(url);
  const docRef = await addDoc(templatesCol(teamId), {
    ...rest,
    // Firestore rejects undefined values
    ...(safeUrl ? { url: safeUrl } : {}),
    createdAt: now,
    updatedAt: now,
  });
  return docRef.id;
};

export const updateTemplate = async (
  teamId: string,
  templateId: string,
  data: Partial<Pick<Template, "title" | "providerName" | "url">>,
): Promise<void> => {
  const { url, ...rest } = data;
  const safeUrl = validateUrl(url);
  await updateDoc(doc(db, "user", teamId, "templates", templateId), {
    ...rest,
    ...(url !== undefined ? { url: safeUrl ?? "" } : {}),
    updatedAt: Timestamp.now(),
  });
};

export const deleteTemplate = async (
  teamId: string,
  templateId: string,
): Promise<void> => {
  await deleteDoc(doc(db, "user", teamId, "templates", templateId));
};
