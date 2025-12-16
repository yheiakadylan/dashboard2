
/**
 * Calculates the UTC offset and a formatted string for a given timezone.
 * @param timeZone IANA timezone name (e.g., "America/New_York")
 * @returns An object with the numeric offset and the formatted string (e.g., "UTC-04:00")
 */
export function getOffsetInfo(timeZone: string): { offset: number; offsetStr: string } {
    try {
        const date = new Date();
        // Get the current time in UTC
        const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
        // Get the current time in the target timezone
        const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
        // Calculate the difference in hours
        const offset = (tzDate.getTime() - utcDate.getTime()) / (60 * 60 * 1000);

        const hours = Math.floor(Math.abs(offset));
        const minutes = Math.floor((Math.abs(offset) * 60) % 60);
        const sign = offset >= 0 ? '+' : '-';

        const offsetStr = `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        return { offset, offsetStr };
    } catch (e) {
        return { offset: 0, offsetStr: 'UTC+00:00' };
    }
}

// Map of Offset String -> Representative IANA ID
// This ensures we have a valid IANA ID for Intl API while displaying clean labels.
const representativeZones: { [key: string]: string } = {
    "UTC-12:00": "Etc/GMT+12",
    "UTC-11:00": "Pacific/Pago_Pago",
    "UTC-10:00": "Pacific/Honolulu",
    "UTC-09:00": "America/Anchorage",
    "UTC-08:00": "America/Los_Angeles", // PST
    "UTC-07:00": "America/Phoenix",      // MST (No DST preferred for stability, or Denver)
    "UTC-06:00": "America/Chicago",      // CST
    "UTC-05:00": "America/New_York",     // EST
    "UTC-04:00": "America/Halifax",
    "UTC-03:30": "America/St_Johns",
    "UTC-03:00": "America/Sao_Paulo",
    "UTC-02:00": "Atlantic/South_Georgia",
    "UTC-01:00": "Atlantic/Azores",
    "UTC+00:00": "Etc/UTC",
    "UTC+01:00": "Europe/Paris",
    "UTC+02:00": "Europe/Athens", // or Africa/Cairo
    "UTC+03:00": "Europe/Moscow",
    "UTC+03:30": "Asia/Tehran",
    "UTC+04:00": "Asia/Dubai",
    "UTC+04:30": "Asia/Kabul",
    "UTC+05:00": "Asia/Karachi",
    "UTC+05:30": "Asia/Kolkata",
    "UTC+05:45": "Asia/Kathmandu",
    "UTC+06:00": "Asia/Dhaka",
    "UTC+06:30": "Asia/Yangon",
    "UTC+07:00": "Asia/Ho_Chi_Minh", // Prioritize Vietnam
    "UTC+08:00": "Asia/Singapore",
    "UTC+08:45": "Australia/Eucla",
    "UTC+09:00": "Asia/Tokyo",
    "UTC+09:30": "Australia/Darwin",
    "UTC+10:00": "Australia/Sydney",
    "UTC+10:30": "Australia/Lord_Howe",
    "UTC+11:00": "Pacific/Noumea",
    "UTC+12:00": "Pacific/Auckland",
    "UTC+12:45": "Pacific/Chatham",
    "UTC+13:00": "Pacific/Tongatapu",
    "UTC+14:00": "Pacific/Kiritimati",
};

const uniqueOffsets = new Map<string, { value: string, label: string, offset: number }>();

// 1. Load from the curated representative list
Object.entries(representativeZones).forEach(([label, ianaId]) => {
    try {
        const { offset } = getOffsetInfo(ianaId);
        // We prioritize the label from our map keys to keep it consistent (e.g. UTC-07:00)
        // regardless of whether DST makes specific zones shift.
        uniqueOffsets.set(label, {
            value: ianaId,
            label: label, // Force the clean label
            offset: offset
        });
    } catch (e) {
        // Skip invalid zones
    }
});

// 2. Fill in generic gaps (integer offsets) if missing
for (let i = -12; i <= 14; i++) {
    const sign = i >= 0 ? '+' : '-';
    const offsetStr = `UTC${sign}${String(Math.abs(i)).padStart(2, '0')}:00`;

    if (!uniqueOffsets.has(offsetStr)) {
        const gmtSign = i > 0 ? '-' : '+'; // Etc/GMT signs are inverted
        const gmtVal = `Etc/GMT${gmtSign}${Math.abs(i)}`;
        uniqueOffsets.set(offsetStr, {
            value: gmtVal,
            label: offsetStr,
            offset: i
        });
    }
}

export const timezones = Array.from(uniqueOffsets.values()).sort((a, b) => a.offset - b.offset);
