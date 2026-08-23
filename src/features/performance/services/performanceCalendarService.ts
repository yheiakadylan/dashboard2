import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../services/firebaseService';
import {
  DEFAULT_PERFORMANCE_CALENDAR,
  normalizePerformanceCalendar,
  type PerformanceCalendarSettings,
} from '../businessCalendar';

const CACHE_MS = 60 * 1000;
const cache = new Map<string, { loadedAt: number; settings: PerformanceCalendarSettings }>();
const getCalendarRef = (teamId: string) => doc(db, 'user', teamId, 'settings', 'performance_calendar');

export const fetchPerformanceCalendar = async (teamId: string, forceRefresh = false) => {
  if (!teamId) return DEFAULT_PERFORMANCE_CALENDAR;
  const cached = cache.get(teamId);
  if (!forceRefresh && cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.settings;
  const snapshot = await getDoc(getCalendarRef(teamId));
  const settings = normalizePerformanceCalendar(snapshot.exists() ? snapshot.data() : null);
  cache.set(teamId, { loadedAt: Date.now(), settings });
  return settings;
};

export const savePerformanceCalendar = async (
  teamId: string,
  settings: PerformanceCalendarSettings,
  updatedBy: string,
) => {
  const payload = normalizePerformanceCalendar({
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
  await setDoc(getCalendarRef(teamId), payload, { merge: true });
  cache.set(teamId, { loadedAt: Date.now(), settings: payload });
  window.dispatchEvent(new Event('performance-calendar-change'));
  return payload;
};
