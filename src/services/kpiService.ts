import { collection, doc, getDocs, getDoc, setDoc, query, where, orderBy, deleteDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebaseService";
import { KpiReport } from "../types";

// Lấy danh sách Idea Tags
export const getIdeaTags = async (teamId: string): Promise<string[]> => {
  const docRef = doc(db, 'user', teamId, 'settings', 'kpi_tags');
  const snap = await getDoc(docRef);
  if (!snap.exists()) return [];
  const tagsMap = snap.data().tags || {};
  return Object.values(tagsMap) as string[];
};

// Lưu nhiều Idea Tag mới cùng lúc
export const addIdeaTags = async (teamId: string, tags: string[]): Promise<void> => {
  if (!tags.length) return;
  const docRef = doc(db, 'user', teamId, 'settings', 'kpi_tags');
  
  const tagsMap: Record<string, string> = {};
  tags.forEach(tag => {
    if (tag.trim()) {
      tagsMap[tag.trim().toLowerCase()] = tag.trim();
    }
  });

  await setDoc(docRef, { tags: tagsMap }, { merge: true });
};

// Lưu KPI Report
export const saveKpiReport = async (teamId: string, report: Omit<KpiReport, 'id'> & { id?: string }): Promise<void> => {
  const reportsCol = collection(db, 'user', teamId, 'kpi_reports');
  const docRef = report.id ? doc(reportsCol, report.id) : doc(reportsCol);
  
  const reportToSave = {
    ...report,
    id: docRef.id
  };
  
  await setDoc(docRef, reportToSave);
};

// Batch Save KPI Reports
export const saveKpiReportsBatch = async (teamId: string, reports: (Omit<KpiReport, 'id'> & { id: string })[]): Promise<void> => {
  const reportsCol = collection(db, 'user', teamId, 'kpi_reports');
  
  // Firestore batch limit is 500 operations
  const chunkSize = 400;
  for (let i = 0; i < reports.length; i += chunkSize) {
    const chunk = reports.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach(report => {
      const docRef = doc(reportsCol, report.id);
      batch.set(docRef, report, { merge: true }); // Use merge to overwrite existing safely
    });
    await batch.commit();
  }
};

// Lấy KPI Reports theo thời gian
export const getKpiReports = async (teamId: string, startDate: string, endDate: string): Promise<KpiReport[]> => {
  const reportsCol = collection(db, 'user', teamId, 'kpi_reports');
  const q = query(
    reportsCol, 
    where("date", ">=", startDate),
    where("date", "<=", endDate + "T23:59:59.999Z"),
    orderBy("date", "desc")
  );
  
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data() as KpiReport);
};

// Xóa KPI Report
export const deleteKpiReport = async (teamId: string, reportId: string): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'kpi_reports', reportId);
  await deleteDoc(docRef);
};

// --- KPI Targets cho Leaderboard ---

export interface KpiTarget {
  sellerName: string;
  weekId: string; // VD: "2026-W23"
  targetRevenue: number;
  note?: string;
}

export const getKpiTargets = async (teamId: string, weekId: string): Promise<Record<string, { target: number, note: string }>> => {
  const targetsCol = collection(db, 'user', teamId, 'kpi_targets');
  const q = query(targetsCol, where("weekId", "==", weekId));
  const snap = await getDocs(q);
  
  const targets: Record<string, { target: number, note: string }> = {};
  snap.docs.forEach(doc => {
    const data = doc.data() as KpiTarget;
    // Map by lowercase normalized name
    const normalizedName = data.sellerName.trim().toLowerCase().replace(/\s+/g, '-');
    targets[normalizedName] = { target: data.targetRevenue || 0, note: data.note || '' };
  });
  
  return targets;
};

export const saveKpiTarget = async (teamId: string, target: KpiTarget): Promise<void> => {
  const targetsCol = collection(db, 'user', teamId, 'kpi_targets');
  const normalizedName = target.sellerName.trim().toLowerCase().replace(/\s+/g, '-');
  const docId = `${target.weekId}_${normalizedName}`;
  const docRef = doc(targetsCol, docId);
  await setDoc(docRef, target, { merge: true });
};
