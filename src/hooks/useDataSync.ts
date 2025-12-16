import { useState, useEffect, useCallback, useRef } from 'react';
import { Record, Account, CostData, ManualCost } from '../types';
import {
    fetchAllRecords,
    checkEmailsExistInRange,
    setupGmailWatch
} from '../services/emailService';
import {
    updateAccountsInFirebase,
    updateRecordsInFirebase,
    saveRecordsToFirebase,
    listenForNewRecords,
    getRecordsForDateRange,
    getAccountsFromFirebase,
    getManualCosts
} from '../services/firebaseService';
import { fetchCostsForRecords } from '../services/fulfillmentService';
import { User } from 'firebase/auth';

interface UseDataSyncProps {
    user: User | null;
    teamId: string;
    filterDateRange: { from: string; to: string };
    timeZone: string;
    addNotification: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const useDataSync = ({
    user,
    teamId,
    filterDateRange,
    timeZone,
    addNotification
}: UseDataSyncProps) => {
    const [allAccounts, setAllAccounts] = useState<Account[]>([]);
    const [records, setRecords] = useState<Record[]>([]);
    const [previousPeriodRecords, setPreviousPeriodRecords] = useState<Record[] | null>(null);
    const [manualCosts, setManualCosts] = useState<ManualCost[]>([]);

    // Loading States
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSyncing, setIsSyncing] = useState<boolean>(false);
    const [isFetchingNewRange, setIsFetchingNewRange] = useState<boolean>(false);
    const [syncState, setSyncState] = useState<string | null>('Initializing...');

    // Refs
    const isInitialMount = useRef(true);
    const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
    const abortControllerRef = useRef<AbortController | null>(null);

    // --- Helper: Enqueue Sync Task ---
    const enqueueSyncTask = useCallback((taskName: string, task: () => Promise<void>) => {
        syncQueueRef.current = syncQueueRef.current
            .then(async () => {
                console.log(`Starting queued task: ${taskName}`);
                await task();
            })
            .catch((err) => {
                console.error(`Error in queued task ${taskName}:`, err);
            });
    }, []);

    // --- Core Logic: Run Sync for specific accounts ---
    const runSync = useCallback(async (
        accountsForSync: Account[],
        existingRecords: Record[],
        overrideDateRange?: { from: string, to: string }
    ): Promise<Record[]> => {
        if (!accountsForSync.length) {
            addNotification("No accounts available to sync.", "info");
            return [];
        }
        setIsSyncing(true);
        setSyncState(`Syncing ${accountsForSync.length} account(s)...`);
        try {
            const syncStartTime = new Date().toISOString();
            const fetchedRecords = await fetchAllRecords(accountsForSync, setSyncState, overrideDateRange);
            setSyncState('Updating costs...');
            const isHistoricalSync = !!overrideDateRange;

            const recordsToScanForCost = isHistoricalSync
                ? fetchedRecords
                : [...existingRecords, ...fetchedRecords];

            const ordersNeedingCost = recordsToScanForCost.filter(r => r.kind === 'order' && !r.cost_total);
            let costMap: Map<string, CostData> = new Map();
            if (ordersNeedingCost.length > 0) {
                setSyncState(`Fetching costs for ${ordersNeedingCost.length} orders...`);
                costMap = await fetchCostsForRecords(ordersNeedingCost);
            }

            let updatedOldRecords: (Partial<Record> & { id: string; })[] = [];
            const newRecordsWithCost = fetchedRecords.map(record => {
                if (record.order_id && costMap.has(record.order_id)) {
                    const costInfo = costMap.get(record.order_id)!;
                    return { ...record, cost_total: costInfo.cost_total, ff_code: costInfo.ff_code, product_name: costInfo.product_name || null };
                }
                return record;
            });

            if (costMap.size > 0) {
                if (!isHistoricalSync) {
                    updatedOldRecords = existingRecords.filter(r => r.id && r.order_id && costMap.has(r.order_id)).map(record => {
                        const costInfo = costMap.get(record.order_id!)!;
                        return { id: record.id!, cost_total: costInfo.cost_total, ff_code: costInfo.ff_code, product_name: costInfo.product_name || null };
                    });

                    if (updatedOldRecords.length > 0) {
                        setSyncState(`Updating ${updatedOldRecords.length} records...`);
                        await updateRecordsInFirebase(teamId, updatedOldRecords);
                    }
                }
            }

            const addedRecords = await saveRecordsToFirebase(teamId, newRecordsWithCost);

            if (!overrideDateRange) {
                const updatedAccountsForFirebase = accountsForSync.map(acc => ({ ...acc, last_synced_at: syncStartTime }));
                await updateAccountsInFirebase(teamId, updatedAccountsForFirebase);
                setAllAccounts(prevAccounts => {
                    const updatedAccountsMap = new Map(updatedAccountsForFirebase.map(acc => [acc.id, acc]));
                    return prevAccounts.map(acc => updatedAccountsMap.get(acc.id) || acc);
                });
            }

            if (addedRecords.length > 0 || updatedOldRecords.length > 0) {
                addNotification(`Sync complete. +${addedRecords.length} new, ${updatedOldRecords.length} updated.`, "success");
            } else {
                addNotification(`Sync complete. No new records found.`, "success");
            }
            setSyncState(null);
            return addedRecords;
        } catch (error) {
            console.error('Sync error:', error);
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            addNotification(`Sync failed: ${errorMessage}`, "error");
            setSyncState(null);
            throw error;
        } finally {
            setIsSyncing(false);
        }
    }, [teamId, addNotification]);

    // --- Core Logic: Historical Sync ---
    const runHistoricalSync = useCallback(async (accountsToSync: Account[], initialRecords: Record[]) => {
        const accountsNeedingSync = accountsToSync.filter(a => !a.historical_sync_complete);
        if (accountsNeedingSync.length === 0) return;

        setSyncState(`Background Sync: ${accountsNeedingSync.length} account(s)`);

        for (let account of accountsToSync) {
            if (!account.scan_start_date) {
                setSyncState(`[${account.email}] Probing history...`);
                let foundStartDate: string | null = null;
                const tenYearsAgo = new Date(); tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
                for (let i = 0; i < 20; i++) {
                    const probeEndDate = new Date(); probeEndDate.setMonth(probeEndDate.getMonth() - (i * 6));
                    const probeStartDate = new Date(probeEndDate); probeStartDate.setMonth(probeStartDate.getMonth() - 6);
                    if (probeStartDate < tenYearsAgo) break;
                    const emailsExist = await checkEmailsExistInRange(account, { from: probeStartDate.toISOString(), to: probeEndDate.toISOString() });
                    if (emailsExist) { foundStartDate = probeStartDate.toISOString(); } else if (foundStartDate) { break; }
                }
                if (foundStartDate) {
                    const accountUpdate = { id: account.id, scan_start_date: foundStartDate };
                    await updateAccountsInFirebase(teamId, [accountUpdate]);
                    account = { ...account, scan_start_date: foundStartDate };
                    setAllAccounts(prev => prev.map(a => a.id === account.id ? { ...a, scan_start_date: foundStartDate } : a));
                } else {
                    const finalUpdate = { id: account.id, historical_sync_complete: true, scan_start_date: new Date().toISOString() };
                    await updateAccountsInFirebase(teamId, [finalUpdate]);
                    setAllAccounts(prev => prev.map(a => a.id === account.id ? { ...a, ...finalUpdate } : a));
                    continue;
                }
            }

            const finalSyncEnd = new Date(account.scan_start_date!);
            let currentSyncEnd: Date;
            if (account.history_synced_until) {
                currentSyncEnd = new Date(account.history_synced_until);
            } else {
                currentSyncEnd = new Date(); currentSyncEnd.setDate(currentSyncEnd.getDate() - 7);
            }

            let currentExistingRecords = [...initialRecords];
            let safetyCounter = 0;
            while (currentSyncEnd > finalSyncEnd) {
                safetyCounter++;
                if (safetyCounter > 1000) {
                    console.error(`[${account.email}] Historical sync loop exceeded 1000 iterations. Breaking to prevent infinite loop.`);
                    addNotification(`[${account.email}] Historical sync stopped (safety limit).`, "error");
                    break;
                }
                const currentSyncStart = new Date(currentSyncEnd);
                currentSyncStart.setDate(currentSyncStart.getDate() - 7);

                const effectiveSyncStart = currentSyncStart < finalSyncEnd ? finalSyncEnd : currentSyncStart;
                const dateRange = { from: effectiveSyncStart.toISOString(), to: currentSyncEnd.toISOString() };

                setSyncState(`[${account.email}] History: ${effectiveSyncStart.toLocaleDateString()} - ${currentSyncEnd.toLocaleDateString()}`);

                try {
                    const fetchedChunk = await runSync([account], currentExistingRecords, dateRange);
                    if (fetchedChunk.length > 0) currentExistingRecords.push(...fetchedChunk);

                    const newSyncedUntil = effectiveSyncStart.toISOString();
                    const accountUpdate = { id: account.id, history_synced_until: newSyncedUntil };
                    await updateAccountsInFirebase(teamId, [accountUpdate]);

                    setAllAccounts(prevAccounts => prevAccounts.map(acc => acc.id === account.id ? { ...acc, history_synced_until: newSyncedUntil } : acc));
                    currentSyncEnd = effectiveSyncStart;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (chunkError) {
                    console.error(`Error syncing history chunk for ${account.email}`, chunkError);
                    const errorMessage = chunkError instanceof Error ? chunkError.message : 'Unknown error';
                    addNotification(`[${account.email}] History sync paused: ${errorMessage}`, "error");
                    break;
                }
            }

            if (currentSyncEnd <= finalSyncEnd) {
                const finalAccountUpdate = { id: account.id, historical_sync_complete: true };
                await updateAccountsInFirebase(teamId, [finalAccountUpdate]);
                setAllAccounts(prevAccounts => prevAccounts.map(acc => acc.id === account.id ? { ...acc, historical_sync_complete: true } : acc));
                addNotification(`[${account.email}] Historical sync complete.`, "info");
            }
        }
        setSyncState(null);
    }, [runSync, teamId, addNotification]);

    // --- Effect: Load Initial Data ---
    useEffect(() => {
        if (!user) return;

        // Create AbortController for this effect
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        const loadInitialData = async () => {
            setIsLoading(true);
            setSyncState('Loading data...');
            try {
                const [fbAccounts, initialDisplayRecords, manualCostEntries] = await Promise.all([
                    getAccountsFromFirebase(teamId),
                    getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone),
                    getManualCosts(teamId)
                ]);

                // Check if component was unmounted
                if (signal.aborted) {
                    console.log('[useDataSync] Component unmounted, aborting initial data load');
                    return;
                }

                setAllAccounts(fbAccounts);
                setRecords(initialDisplayRecords);
                setManualCosts(manualCostEntries);
                setIsLoading(false);
                setSyncState(null);

                fbAccounts.forEach(acc => {
                    if (acc.provider === 'gmail') {
                        setupGmailWatch(teamId, acc).catch(err => console.error(`Failed to initialize webhook for ${acc.email}:`, err));
                    }
                });

                if (fbAccounts.length > 0 && !signal.aborted) {
                    setSyncState('Auto-syncing...');
                    runSync(fbAccounts, initialDisplayRecords).then(async (addedRecords) => {
                        // Check abort signal before continuing
                        if (signal.aborted) {
                            console.log('[useDataSync] Component unmounted, aborting sync continuation');
                            return;
                        }

                        const updatedDisplayRecords = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);

                        if (signal.aborted) return;
                        setRecords(updatedDisplayRecords);

                        const latestAccounts = await getAccountsFromFirebase(teamId);

                        if (signal.aborted) return;
                        setAllAccounts(latestAccounts);

                        const accountsForHistoricalSync = latestAccounts.filter(acc => !acc.historical_sync_complete);
                        if (accountsForHistoricalSync.length > 0 && !signal.aborted) {
                            runHistoricalSync(accountsForHistoricalSync, updatedDisplayRecords);
                        }
                    }).catch(error => {
                        if (signal.aborted) return; // Don't show error if aborted
                        console.error("Failed during initial sync:", error);
                        addNotification("Initial sync encountered an error.", "error");
                    });
                }
            } catch (error) {
                if (signal.aborted) return; // Don't show error if aborted
                console.error("Failed to load initial data:", error);
                addNotification("Could not load data from Firebase.", "error");
                setIsLoading(false);
                setSyncState(null);
            }
        };

        loadInitialData();

        // Cleanup: abort ongoing operations when component unmounts
        return () => {
            console.log('[useDataSync] Component unmounting, aborting all operations');
            abortControllerRef.current?.abort();
        };
    }, [user, teamId]); // Depend only on user/team, not ranges

    // --- Effect: Fetch Data on Range Change ---
    useEffect(() => {
        if (isInitialMount.current) { isInitialMount.current = false; return; }
        if (!user) return;

        // Create local abort controller for this range fetch
        const rangeAbortController = new AbortController();
        const signal = rangeAbortController.signal;

        const fetchDataForRange = async () => {
            setIsFetchingNewRange(true);
            setSyncState('Fetching...');
            // DON'T clear records - keep previous data visible (optimistic UI)

            const { from, to } = filterDateRange;

            const diffDays = Math.round(Math.abs(new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)) + 1;
            const shouldFetchPrevious = diffDays <= 7;
            let previousRange: { from: string; to: string } | null = null;
            if (shouldFetchPrevious) {
                const prevToDate = new Date(from); prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);
                const prevFromDate = new Date(prevToDate); prevFromDate.setUTCDate(prevFromDate.getUTCDate() - (diffDays - 1));
                previousRange = { from: prevFromDate.toISOString().split('T')[0], to: prevToDate.toISOString().split('T')[0] };
            }
            try {
                const currentRecordsPromise = getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
                const previousRecordsPromise = shouldFetchPrevious && previousRange ? getRecordsForDateRange(teamId, previousRange.from, previousRange.to, timeZone) : Promise.resolve(null);
                const [fbRecords, prevRecords] = await Promise.all([currentRecordsPromise, previousRecordsPromise]);

                // Check if this effect was cancelled before setting state
                if (signal.aborted) {
                    console.log('[useDataSync] Range fetch aborted (user changed range again)');
                    return;
                }

                setRecords(fbRecords);
                setPreviousPeriodRecords(prevRecords);
            } catch (error) {
                if (signal.aborted) return; // Don't show error if aborted
                console.error("Failed to fetch records for range:", error);
                addNotification('Error loading records for this range.', "error");
            } finally {
                if (!signal.aborted) {
                    setIsFetchingNewRange(false);
                    setSyncState(null);
                }
            }
        };

        fetchDataForRange();

        // Cleanup: abort if range changes before fetch completes
        return () => {
            rangeAbortController.abort();
        };
    }, [filterDateRange, user, timeZone, teamId, addNotification]);

    // --- Effect: Listen for New Records ---
    useEffect(() => {
        if (!user) return;
        const unsubscribe = listenForNewRecords(teamId, (newRecord) => {
            const { from, to } = filterDateRange;
            const recordDate = new Date(newRecord.dt_local);
            const fromDate = new Date(from);
            const toDate = new Date(to); toDate.setHours(23, 59, 59, 999);
            if (recordDate >= fromDate && recordDate <= toDate) {
                setRecords(prevRecords => [newRecord, ...prevRecords].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime()));
                addNotification(`New ${newRecord.kind} received.`, "info");
            }
        });
        return () => unsubscribe();
    }, [filterDateRange, user, teamId, addNotification]);

    return {
        allAccounts, setAllAccounts,
        records, setRecords,
        previousPeriodRecords, setPreviousPeriodRecords,
        manualCosts, setManualCosts,
        isLoading,
        isSyncing,
        isFetchingNewRange,
        syncState, setSyncState,
        runSync,
        runHistoricalSync,
        enqueueSyncTask
    };
};
