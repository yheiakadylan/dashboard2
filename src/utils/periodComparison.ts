import { KpiValue } from '../types';

export interface DateRange {
    from: string;
    to: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseDateKey = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`);

const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);

export const isThisWeekRange = (range: DateRange): boolean => {
    const fromDate = parseDateKey(range.from);
    const toDate = parseDateKey(range.to);

    // fromDate must be a Monday (getUTCDay() === 1)
    if (fromDate.getUTCDay() !== 1) return false;

    const diffTime = toDate.getTime() - fromDate.getTime();
    const diffDays = Math.round(diffTime / MS_PER_DAY);

    // Must be in the same week (from Monday to Sunday inclusive) and span more than 1 day
    return diffDays > 0 && diffDays <= 6;
};

export const getDateRangeLengthDays = (range: DateRange) => {
    const from = parseDateKey(range.from).getTime();
    const to = parseDateKey(range.to).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 1;
    return Math.max(1, Math.round((to - from) / MS_PER_DAY) + 1);
};

export const getPreviousDateRange = (range: DateRange): DateRange => {
    if (isThisWeekRange(range)) {
        const fromDate = parseDateKey(range.from);
        const prevFrom = new Date(fromDate);
        prevFrom.setUTCDate(prevFrom.getUTCDate() - 7);
        const prevTo = new Date(fromDate);
        prevTo.setUTCDate(prevTo.getUTCDate() - 1);
        return {
            from: formatDateKey(prevFrom),
            to: formatDateKey(prevTo)
        };
    }

    const lengthDays = getDateRangeLengthDays(range);
    const prevTo = parseDateKey(range.from);
    prevTo.setUTCDate(prevTo.getUTCDate() - 1);

    const prevFrom = new Date(prevTo);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - (lengthDays - 1));

    return {
        from: formatDateKey(prevFrom),
        to: formatDateKey(prevTo)
    };
};

export const getPreviousPeriodLabel = (range: DateRange) => {
    if (isThisWeekRange(range)) return 'Previous week';
    const lengthDays = getDateRangeLengthDays(range);
    if (lengthDays === 1) return 'Yesterday';
    if (lengthDays === 7) return 'Previous week';
    return `Previous ${lengthDays} days`;
};

export const calculateKpiComparison = (current: number, previous: number): Pick<KpiValue, 'change' | 'direction'> => {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
        return { direction: 'neutral' };
    }

    if (previous === 0) {
        return {
            change: current > 0 ? Infinity : 0,
            direction: current > 0 ? 'up' : 'neutral'
        };
    }

    const change = ((current - previous) / previous) * 100;
    return {
        change: Math.abs(change),
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
    };
};

export const buildNumericKpi = (
    value: number,
    previousValue?: number,
    formatter: (value: number) => string = String,
    previousLabel = 'Previous period'
): KpiValue => ({
    value: formatter(value),
    ...(typeof previousValue === 'number'
        ? {
            previousValue: formatter(previousValue),
            previousLabel,
            ...calculateKpiComparison(value, previousValue)
        }
        : { direction: 'neutral' })
});
