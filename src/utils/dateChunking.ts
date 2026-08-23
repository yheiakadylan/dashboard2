export interface DateChunk {
    start: Date;
    end: Date;
}

/**
 * Splits an inclusive/exclusive date range into balanced chunks.
 *
 * The chunks are intentionally not too small: when daily cache is dirty or
 * missing, fallback live fetches should not become one Firestore request per day.
 */
export const splitDateRange = (start: Date, end: Date): DateChunk[] => {
    const totalDurationMs = end.getTime() - start.getTime();
    if (totalDurationMs <= 0) return [];

    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * ONE_HOUR;
    const totalDays = totalDurationMs / ONE_DAY;

    let chunkSizeMs: number;

    if (totalDays <= 7) {
        chunkSizeMs = ONE_DAY;
    } else if (totalDays <= 30) {
        chunkSizeMs = 3 * ONE_DAY;
    } else if (totalDays <= 90) {
        chunkSizeMs = 7 * ONE_DAY;
    } else {
        chunkSizeMs = 15 * ONE_DAY;
    }

    const chunks: DateChunk[] = [];
    let currentStart = start.getTime();
    const endTime = end.getTime();

    while (currentStart < endTime) {
        const currentEnd = Math.min(currentStart + chunkSizeMs, endTime);
        chunks.push({
            start: new Date(currentStart),
            end: new Date(currentEnd),
        });
        currentStart = currentEnd;
    }

    return chunks;
};
