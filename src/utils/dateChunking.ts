export interface DateChunk {
    start: Date;
    end: Date;
}

/**
 * Splits a date range into smaller chunks based on the total duration.
 * Strategy:
 * - Sub-daily (<= 24h): 6-hour chunks
 * - <= 7 days: 1-day chunks
 * - 8-20 days: 2-day chunks
 * - 21-60 days: 5-day chunks
 * - > 60 days: 15-day chunks
 * 
 * Constraint: Zero Overlap (Start inclusive, End exclusive).
 */
export const splitDateRange = (start: Date, end: Date): DateChunk[] => {
    const totalDurationMs = end.getTime() - start.getTime();
    if (totalDurationMs <= 0) return [];

    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * ONE_HOUR;

    const totalDays = totalDurationMs / ONE_DAY;

    let chunkSizeMs: number;

    if (totalDays <= 1) {
        chunkSizeMs = 6 * ONE_HOUR;
    } else if (totalDays <= 7) {
        chunkSizeMs = ONE_DAY;
    } else if (totalDays <= 20) {
        chunkSizeMs = 2 * ONE_DAY;
    } else if (totalDays <= 60) {
        chunkSizeMs = 5 * ONE_DAY;
    } else {
        chunkSizeMs = 15 * ONE_DAY;
    }

    const chunks: DateChunk[] = [];
    let currentStart = start.getTime();
    const endTime = end.getTime();

    while (currentStart < endTime) {
        let currentEnd = currentStart + chunkSizeMs;
        if (currentEnd > endTime) {
            currentEnd = endTime;
        }

        chunks.push({
            start: new Date(currentStart),
            end: new Date(currentEnd)
        });

        currentStart = currentEnd;
    }

    return chunks;
};
