import { processData, type ProcessingScope } from '../utils/dataProcessing';
import { Record, Account, ManualCost } from '../types';

interface WorkerMessage {
    requestId: number;
    dataKey?: string;
    records: Record[];
    previousRecords: Record[] | null;
    accounts: Account[];
    filterDateRange: { from: string; to: string };
    timeZone: string;
    role: string;
    permissions: { [key: string]: boolean };
    manualCosts: ManualCost[];
    exchangeRates: { [currency: string]: number } | null;
    categories: any[];
    etsyReviews: any[];
    scope?: ProcessingScope;
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const {
        requestId,
        dataKey,
        records,
        previousRecords,
        accounts,
        filterDateRange,
        timeZone,
        role,
        permissions,
        manualCosts,
        exchangeRates,
        categories,
        etsyReviews,
        scope = 'all'
    } = e.data;

    try {
        const processed = processData(
            records,
            previousRecords,
            accounts,
            filterDateRange,
            timeZone,
            role,
            permissions,
            manualCosts,
            exchangeRates,
            categories,
            etsyReviews,
            scope
        );
        self.postMessage({ success: true, data: processed, requestId, scope, dataKey });
    } catch (error: any) {
        console.error(`[Worker] Error processing request #${requestId}:`, error);
        self.postMessage({ success: false, error: error.message, requestId, dataKey });
    }
};
