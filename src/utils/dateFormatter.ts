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

/**
 * Formats a date as relative time (e.g. "5 mins ago", "2 hours ago")
 * Falls back to standard date format if > 2 days
 */
export function formatTimeAgo(dateInput: any): string {
    if (!dateInput) return '';

    // Handle Firestore Timestamp or standard Date/String
    const date = dateInput.seconds
        ? new Date(dateInput.seconds * 1000)
        : new Date(dateInput);

    if (isNaN(date.getTime())) return 'Invalid Date';

    const now = new Date();
    const diffInSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

    // Logic: mins ago, hours ago, then date
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} mins ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 172800) return 'Yesterday'; // < 2 days

    return date.toLocaleDateString();
}
