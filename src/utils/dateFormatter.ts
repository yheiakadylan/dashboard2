/**
 * Efficient Date Formatter
 * Caches Intl.DateTimeFormat instances to avoid performance penalty of re-instantiation.
 */

const formatters: Map<string, Intl.DateTimeFormat> = new Map();

export const getCachedDateFormatter = (timeZone: string): Intl.DateTimeFormat => {
    if (!formatters.has(timeZone)) {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            formatters.set(timeZone, formatter);
        } catch (e) {
            // Fallback for invalid timezones
            console.warn(`Invalid timezone: ${timeZone}, falling back to UTC`);
            const fallbackFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'UTC',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            formatters.set(timeZone, fallbackFormatter); // Cache the fallback to avoid repeated errors
        }
    }
    return formatters.get(timeZone)!;
};

export const formatDateEfficiently = (dateStr: string, timeZone: string): string => {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';

        return getCachedDateFormatter(timeZone).format(date);
    } catch (e) {
        return 'Invalid Date';
    }
};
