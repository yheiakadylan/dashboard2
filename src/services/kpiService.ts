import { collection, doc, getDocs, getDoc, setDoc, updateDoc, query, where, orderBy, deleteDoc, writeBatch, onSnapshot } from "firebase/firestore";
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
    where("date", "<=", endDate + "T23:59:59")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as KpiReport);
};

export const listenKpiReports = (teamId: string, startDate: string, endDate: string, callback: (reports: KpiReport[]) => void): () => void => {
  const reportsCol = collection(db, 'user', teamId, 'kpi_reports');
  const q = query(
    reportsCol, 
    where("date", ">=", startDate),
    where("date", "<=", endDate + "T23:59:59")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(doc => doc.data() as KpiReport));
  });
};

// Xóa KPI Report
export const deleteKpiReport = async (teamId: string, reportId: string): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'kpi_reports', reportId);
  await deleteDoc(docRef);
};

// Cập nhật một trường đơn lẻ trong KPI Report (dùng cho double-click inline edit)
// Dùng setDoc merge để TẠO mới nếu chưa tồn tại, hoặc UPDATE nếu đã có
export const updateKpiReportField = async (
  teamId: string,
  reportId: string,
  field: string,
  value: any,
  baseData?: Partial<KpiReport>  // data mặc định khi tạo mới
): Promise<void> => {
  const docRef = doc(db, 'user', teamId, 'kpi_reports', reportId);
  await setDoc(docRef, { id: reportId, ...baseData, [field]: value }, { merge: true });
};

// Lấy danh sách KPI Users (is_kpi = true) trong team – dùng cho Leaderboard
export interface KpiUserProfile {
  id: string;
  email: string;
  display_name?: string;
  manage_mail?: boolean;
  allowedAccounts?: string[];
  kpi_team?: string;
}

export const getKpiUserProfiles = async (teamId: string): Promise<KpiUserProfile[]> => {
  const q = query(
    collection(db, 'user_roles'),
    where('teamId', '==', teamId),
    where('is_kpi', '==', true)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    id: d.id,
    email: d.data().email || '',
    display_name: d.data().display_name || '',
    manage_mail: d.data().permissions?.canManageSettings ?? true,
    allowedAccounts: d.data().allowedAccounts || [],
    kpi_team: d.data().kpi_team,
  }));
};

// --- KPI Targets cho Leaderboard ---

export interface KpiTarget {
  sellerName: string;
  weekId: string; // VD: "2026-W23"
  targetRevenue: number;
  targetIdeas?: number;
  targetMockup?: number;
  targetListing?: number;
  targetFulfill?: number;
  note?: string;
}

export interface ExtendedKpiTarget {
  target: number;
  targetIdeas: number;
  targetMockup: number;
  targetListing: number;
  targetFulfill: number;
  note: string;
}

export const getKpiTargets = async (teamId: string, weekId: string): Promise<Record<string, ExtendedKpiTarget>> => {
  const targetsCol = collection(db, 'user', teamId, 'kpi_targets');
  const q = query(targetsCol, where("weekId", "==", weekId));
  const snap = await getDocs(q);
  
  const targets: Record<string, ExtendedKpiTarget> = {};
  snap.docs.forEach(doc => {
    const data = doc.data() as KpiTarget;
    // Map by lowercase normalized name
    const normalizedName = data.sellerName.trim().toLowerCase().replace(/\s+/g, '-');
    targets[normalizedName] = { 
        target: data.targetRevenue || 0, 
        targetIdeas: data.targetIdeas || 0,
        targetMockup: data.targetMockup || 0,
        targetListing: data.targetListing || 0,
        targetFulfill: data.targetFulfill || 0,
        note: data.note || '' 
    };
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
