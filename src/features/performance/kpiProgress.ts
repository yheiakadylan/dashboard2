import {
  countBusinessDays,
  DEFAULT_PERFORMANCE_CALENDAR,
  getBusinessDayProgress,
  getRemainingBusinessMinutes,
  isBusinessDay,
  type PerformanceCalendarSettings,
} from './businessCalendar';
import type { KpiPaceStatus, KpiProgress, KpiTargetPeriod } from './types';

const DAY_MS = 86400000;
const roundOne = (value: number) => Math.round(value * 10) / 10;
const formatISO = (date: Date) => date.toISOString().slice(0, 10);
const parseISO = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);

const getTodayKey = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const addDays = (value: string, days: number) => {
  const date = parseISO(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatISO(date);
};

const differenceInDays = (from: string, to: string) => Math.max(0, Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / DAY_MS));

export const getKpiPeriodWindow = (period: KpiTargetPeriod, anchorValue: string) => {
  const anchor = parseISO(anchorValue);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  let from = new Date(anchor);
  let to = new Date(anchor);

  if (period === 'weekly') {
    const day = anchor.getUTCDay();
    from.setUTCDate(anchor.getUTCDate() - (day === 0 ? 6 : day - 1));
    to = new Date(from);
    to.setUTCDate(from.getUTCDate() + 6);
  } else if (period === 'monthly') {
    from = new Date(Date.UTC(year, month, 1));
    to = new Date(Date.UTC(year, month + 1, 0));
  } else if (period === 'quarterly') {
    const startMonth = Math.floor(month / 3) * 3;
    from = new Date(Date.UTC(year, startMonth, 1));
    to = new Date(Date.UTC(year, startMonth + 3, 0));
  }

  return { from: formatISO(from), to: formatISO(to) };
};

export const getEffectiveKpiPeriodWindow = (
  period: KpiTargetPeriod,
  anchorValue: string,
  effectiveFrom?: string,
  effectiveTo?: string,
) => {
  const window = getKpiPeriodWindow(period, anchorValue);
  return {
    from: effectiveFrom && effectiveFrom > window.from ? effectiveFrom : window.from,
    to: effectiveTo && effectiveTo < window.to ? effectiveTo : window.to,
  };
};

export const getNextKpiPeriodStart = (period: KpiTargetPeriod, anchorValue: string) => {
  const current = getKpiPeriodWindow(period, anchorValue);
  return addDays(current.to, 1);
};

const formatPeriodLabel = (period: KpiTargetPeriod, from: string, to: string) => {
  const start = parseISO(from);
  const end = parseISO(to);
  const short = (date: Date) => date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  if (period === 'daily') return `Ngày ${start.toLocaleDateString('vi-VN', { timeZone: 'UTC' })}`;
  if (period === 'weekly') return `Tuần ${short(start)}–${short(end)}`;
  if (period === 'monthly') return `Tháng ${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`;
  return `Quý ${Math.floor(start.getUTCMonth() / 3) + 1}/${start.getUTCFullYear()}`;
};

const getCountdownLabel = (
  period: KpiTargetPeriod,
  from: string,
  to: string,
  today: string,
  remainingWorkdays: number,
  calendar: PerformanceCalendarSettings,
) => {
  if (today < from) return `Bắt đầu sau ${differenceInDays(today, from)} ngày`;
  if (today > to) return 'Đã kết thúc';
  if (period === 'daily') {
    if (!isBusinessDay(today, calendar)) return 'Ngày nghỉ theo lịch làm việc';
    const remainingMinutes = getRemainingBusinessMinutes(new Date(), calendar);
    return `Còn ${Math.floor(remainingMinutes / 60)} giờ ${remainingMinutes % 60} phút làm việc`;
  }
  return `Còn ${roundOne(remainingWorkdays)} ngày làm việc · ${differenceInDays(today, to)} ngày lịch`;
};

const getPaceStatus = (completion: number, pace: number, elapsedRatio: number): KpiPaceStatus => {
  if (completion >= 100) return 'achieved';
  if (elapsedRatio <= 0) return 'not_started';
  if (pace >= 105) return 'ahead';
  if (pace >= 90) return 'on_track';
  return 'at_risk';
};

export const calculateKpiProgress = (
  period: KpiTargetPeriod,
  targetValue: number,
  actualValue: number,
  anchorValue: string,
  timeZone: string,
  effectiveFrom?: string,
  effectiveTo?: string,
  calendar: PerformanceCalendarSettings = DEFAULT_PERFORMANCE_CALENDAR,
): KpiProgress => {
  const window = getEffectiveKpiPeriodWindow(period, anchorValue, effectiveFrom, effectiveTo);
  const today = getTodayKey(calendar.timeZone || timeZone);
  const requestedAsOf = anchorValue.slice(0, 10) < today ? anchorValue.slice(0, 10) : today;
  const asOf = requestedAsOf < window.from ? window.from : requestedAsOf > window.to ? window.to : requestedAsOf;
  const totalWorkdays = countBusinessDays(window.from, window.to, calendar);

  let elapsedWorkdayUnits = 0;
  if (requestedAsOf >= window.from) {
    if (requestedAsOf > window.to) {
      elapsedWorkdayUnits = totalWorkdays;
    } else {
      const completedBeforeAsOf = countBusinessDays(window.from, addDays(asOf, -1), calendar);
      const currentDayProgress = requestedAsOf === today
        ? getBusinessDayProgress(new Date(), calendar)
        : isBusinessDay(asOf, calendar) ? 1 : 0;
      elapsedWorkdayUnits = Math.min(totalWorkdays, completedBeforeAsOf + currentDayProgress);
    }
  }

  const elapsedRatio = totalWorkdays > 0 ? Math.min(1, elapsedWorkdayUnits / totalWorkdays) : 0;
  const remainingWorkdays = Math.max(0, totalWorkdays - elapsedWorkdayUnits);
  const fullTarget = Math.max(0, targetValue);
  const actual = Math.max(0, actualValue);
  const expectedTarget = fullTarget * elapsedRatio;
  const completion = fullTarget > 0 ? actual / fullTarget * 100 : 0;
  const pace = expectedTarget > 0 ? actual / expectedTarget * 100 : 0;
  const remaining = Math.max(0, fullTarget - actual);
  const forecast = elapsedRatio > 0 ? actual / elapsedRatio : actual;

  return {
    period,
    periodLabel: formatPeriodLabel(period, window.from, window.to),
    periodFrom: window.from,
    periodTo: window.to,
    asOf,
    fullTarget: roundOne(fullTarget),
    expectedTarget: roundOne(expectedTarget),
    actual: roundOne(actual),
    completion: roundOne(completion),
    pace: roundOne(pace),
    remaining: roundOne(remaining),
    forecast: roundOne(forecast),
    requiredPerWorkday: roundOne(remaining / Math.max(1, remainingWorkdays)),
    elapsedWorkdays: roundOne(elapsedWorkdayUnits),
    totalWorkdays,
    remainingWorkdays: roundOne(remainingWorkdays),
    countdownLabel: requestedAsOf === today
      ? getCountdownLabel(period, window.from, window.to, today, remainingWorkdays, calendar)
      : requestedAsOf > window.to ? 'Đã kết thúc' : `Tính đến ${requestedAsOf}`,
    status: getPaceStatus(completion, pace, elapsedRatio),
  };
};
