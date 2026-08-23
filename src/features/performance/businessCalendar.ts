export const VIETNAM_BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

export interface BusinessTimeInterval {
  startMinutes: number;
  endMinutes: number;
}

export interface PerformanceCalendarSettings {
  timeZone: typeof VIETNAM_BUSINESS_TIME_ZONE;
  utcOffsetMinutes: number;
  workIntervals: BusinessTimeInterval[];
  workingSaturdayAnchor: string | null;
  holidays: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_PERFORMANCE_CALENDAR: PerformanceCalendarSettings = {
  timeZone: VIETNAM_BUSINESS_TIME_ZONE,
  utcOffsetMinutes: VIETNAM_UTC_OFFSET_MINUTES,
  workIntervals: [
    { startMinutes: 9 * 60, endMinutes: 12 * 60 },
    { startMinutes: 13 * 60 + 30, endMinutes: 18 * 60 },
  ],
  workingSaturdayAnchor: null,
  holidays: [],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDateKey = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);

export const isValidDateKey = (value: string) => {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  return formatDateKey(parseDateKey(value)) === value;
};

export const isSaturdayDateKey = (value: string) => isValidDateKey(value) && parseDateKey(value).getUTCDay() === 6;

export const normalizePerformanceCalendar = (value: unknown): PerformanceCalendarSettings => {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const anchor = typeof raw.workingSaturdayAnchor === 'string' && isSaturdayDateKey(raw.workingSaturdayAnchor)
    ? raw.workingSaturdayAnchor
    : null;
  const holidays = Array.isArray(raw.holidays)
    ? [...new Set(raw.holidays.filter((item): item is string => typeof item === 'string' && isValidDateKey(item)))].sort()
    : [];

  return {
    ...DEFAULT_PERFORMANCE_CALENDAR,
    workingSaturdayAnchor: anchor,
    holidays,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
};

const getLocalDateSerial = (timestamp: number, utcOffsetMinutes: number) => {
  const local = new Date(timestamp + utcOffsetMinutes * 60 * 1000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
};

export const getBusinessDateKey = (value: Date | number, settings = DEFAULT_PERFORMANCE_CALENDAR) => (
  formatDateKey(new Date(getLocalDateSerial(value instanceof Date ? value.getTime() : value, settings.utcOffsetMinutes)))
);

const normalizedWeekDifference = (dateValue: string, anchorValue: string) => (
  Math.round((parseDateKey(dateValue).getTime() - parseDateKey(anchorValue).getTime()) / (7 * DAY_MS))
);

export const isBusinessDay = (dateValue: string, settings = DEFAULT_PERFORMANCE_CALENDAR) => {
  if (!isValidDateKey(dateValue) || settings.holidays.includes(dateValue)) return false;
  const weekday = parseDateKey(dateValue).getUTCDay();
  if (weekday >= 1 && weekday <= 5) return true;
  if (weekday !== 6 || !settings.workingSaturdayAnchor) return false;
  const weekDifference = normalizedWeekDifference(dateValue, settings.workingSaturdayAnchor);
  return ((weekDifference % 2) + 2) % 2 === 0;
};

export const countBusinessDays = (from: string, to: string, settings = DEFAULT_PERFORMANCE_CALENDAR) => {
  if (!isValidDateKey(from) || !isValidDateKey(to) || to < from) return 0;
  let count = 0;
  for (let cursor = parseDateKey(from); cursor <= parseDateKey(to); cursor = new Date(cursor.getTime() + DAY_MS)) {
    if (isBusinessDay(formatDateKey(cursor), settings)) count += 1;
  }
  return count;
};

export const getBusinessMinutesPerDay = (settings = DEFAULT_PERFORMANCE_CALENDAR) => (
  settings.workIntervals.reduce((sum, interval) => sum + Math.max(0, interval.endMinutes - interval.startMinutes), 0)
);

const getLocalMinutes = (timestamp: number, utcOffsetMinutes: number) => {
  const local = new Date(timestamp + utcOffsetMinutes * 60 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
};

export const getBusinessDayProgress = (value: Date | number, settings = DEFAULT_PERFORMANCE_CALENDAR) => {
  const timestamp = value instanceof Date ? value.getTime() : value;
  const dateKey = getBusinessDateKey(timestamp, settings);
  if (!isBusinessDay(dateKey, settings)) return 0;
  const localMinutes = getLocalMinutes(timestamp, settings.utcOffsetMinutes);
  const elapsedMinutes = settings.workIntervals.reduce((sum, interval) => {
    if (localMinutes <= interval.startMinutes) return sum;
    return sum + Math.min(localMinutes, interval.endMinutes) - interval.startMinutes;
  }, 0);
  const totalMinutes = getBusinessMinutesPerDay(settings);
  return totalMinutes > 0 ? Math.min(1, Math.max(0, elapsedMinutes / totalMinutes)) : 0;
};

export const getRemainingBusinessMinutes = (value: Date | number, settings = DEFAULT_PERFORMANCE_CALENDAR) => {
  const timestamp = value instanceof Date ? value.getTime() : value;
  if (!isBusinessDay(getBusinessDateKey(timestamp, settings), settings)) return 0;
  return Math.max(0, Math.round(getBusinessMinutesPerDay(settings) * (1 - getBusinessDayProgress(timestamp, settings))));
};

export const calculateBusinessHours = (
  startValue: Date | number,
  endValue: Date | number,
  settings = DEFAULT_PERFORMANCE_CALENDAR,
) => {
  const start = startValue instanceof Date ? startValue.getTime() : startValue;
  const end = endValue instanceof Date ? endValue.getTime() : endValue;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const firstLocalDay = getLocalDateSerial(start, settings.utcOffsetMinutes);
  const lastLocalDay = getLocalDateSerial(end, settings.utcOffsetMinutes);
  let totalMilliseconds = 0;

  for (let localDay = firstLocalDay; localDay <= lastLocalDay; localDay += DAY_MS) {
    const dateKey = formatDateKey(new Date(localDay));
    if (!isBusinessDay(dateKey, settings)) continue;
    settings.workIntervals.forEach(interval => {
      const intervalStart = localDay - settings.utcOffsetMinutes * 60 * 1000 + interval.startMinutes * 60 * 1000;
      const intervalEnd = localDay - settings.utcOffsetMinutes * 60 * 1000 + interval.endMinutes * 60 * 1000;
      totalMilliseconds += Math.max(0, Math.min(end, intervalEnd) - Math.max(start, intervalStart));
    });
  }

  return totalMilliseconds / 3600000;
};

export const parseHolidayInput = (value: string) => (
  [...new Set(value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))].sort()
);
