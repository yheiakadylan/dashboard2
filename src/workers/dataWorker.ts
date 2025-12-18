import { processData } from '../utils/dataProcessing';
import { Record, Account, ManualCost } from '../types';

interface WorkerMessage {
    requestId: number;
    records: Record[];
    previousRecords: Record[] | null;
    accounts: Account[];
    filterDateRange: { from: string; to: string };
    timeZone: string;
    role: string;
    permissions: { [key: string]: boolean };
    manualCosts: ManualCost[];
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const {
        requestId,
        records,
        previousRecords,
        accounts,
        filterDateRange,
        timeZone,
        role,
        permissions,
        manualCosts
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
            manualCosts
        );
        self.postMessage({ success: true, data: processed, requestId });
    } catch (error: any) {
        console.error(`[Worker] Error processing request #${requestId}:`, error);
        self.postMessage({ success: false, error: error.message, requestId });
    }
};
