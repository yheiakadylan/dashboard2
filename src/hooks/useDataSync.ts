import { useState, useEffect, useCallback, useRef } from 'react';
import { Record, Account, CostData, ManualCost, EtsyReview } from '../types';
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
    listenForAccounts,
    getRecordsForDateRange,
    getEtsyReviewsForDateRange,
    getAccountsFromFirebase,
    getManualCosts,
    getRefundRecordsForOrderIds,
    db
} from '../services/firebaseService';
import { splitDateRange } from '../utils/dateChunking';
import { collection, query, where, getDocs } from "firebase/firestore";
import { fetchCostsForRecords } from '../services/fulfillmentService';
import { User } from 'firebase/auth';


interface UseDataSyncProps {
    user: User | null;
    teamId: string;
    role: 'owner' | 'user';
    filterDateRange: { from: string; to: string };
    timeZone: string;
    addNotification: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const useDataSync = ({
    user,
    teamId,
    role,
    filterDateRange,
    timeZone,
    addNotification
}: UseDataSyncProps) => {
    // --- 1. State Declarations ---
    const [allAccounts, setAllAccounts] = useState<Account[]>(() => {
        // Initialize from cache if possible
        if (teamId) {
            try {
                const cached = localStorage.getItem(`vikcom_accounts_${teamId}`);
                if (cached) return JSON.parse(cached);
            } catch (e) {}
        }
        return [];
    });
    const [records, setRecords] = useState<Record[]>([]);
    const [previousPeriodRecords, setPreviousPeriodRecords] = useState<Record[] | null>(null);
    const [manualCosts, setManualCosts] = useState<ManualCost[]>([]);
    const [etsyReviews, setEtsyReviews] = useState<EtsyReview[]>([]);

    // Ref to track latest accounts for safety checks in async functions
    const allAccountsRef = useRef<Account[]>(allAccounts);

    useEffect(() => {
        allAccountsRef.current = allAccounts;
        // Update cache when accounts change
        if (teamId && allAccounts.length > 0) {
            try {
                localStorage.setItem(`vikcom_accounts_${teamId}`, JSON.stringify(allAccounts));
            } catch (e) {}
        }
    }, [allAccounts, teamId]);

    // Loading States
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSyncing, setIsSyncing] = useState<boolean>(false);
    const [isFetchingNewRange, setIsFetchingNewRange] = useState<boolean>(false);
    const [syncState, setSyncState] = useState<string | null>('Initializing...');
    const [syncProgress, setSyncProgress] = useState<{ current: number, total: number, message: string } | null>(null);
    const [accountSyncStatuses, setAccountSyncStatuses] = useState<{ [key: string]: string }>({});

    // Refs for Abort Control
    const initialLoadAbortControllerRef = useRef<AbortController | null>(null);
    const dateRangeFetchAbortControllerRef = useRef<AbortController | null>(null);
    const syncAbortControllerRef = useRef<AbortController | null>(null);
    const historicalSyncAbortControllerRef = useRef<AbortController | null>(null);

    // Refs for Request Tracking
    const fetchRequestIdRef = useRef<number>(0);
    const initialLoadCompleteRef = useRef<boolean>(false); // Track when initial load completes
    const dateRangeStringRef = useRef<string>(''); // Track date range changes

    // Refs for Debounced Realtime Sync
    const realtimeSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const realtimeListenerUnsubscribeRef = useRef<(() => void) | null>(null);
    const isRealtimeSyncEnabledRef = useRef<boolean>(false);
    // Ref to mark whether the accounts listener initial snapshot has been processed
    const accountsListenerInitializedRef = useRef<boolean>(false);

    // Queue for sync operations
    const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

    // --- Helper: Abort All Operations ---
    const abortAllOperations = useCallback(() => {
        // Abort all controllers
        initialLoadAbortControllerRef.current?.abort();
        dateRangeFetchAbortControllerRef.current?.abort();
        syncAbortControllerRef.current?.abort();
        historicalSyncAbortControllerRef.current?.abort();

        // Clear realtime sync timeout
        if (realtimeSyncTimeoutRef.current) {
            clearTimeout(realtimeSyncTimeoutRef.current);
            realtimeSyncTimeoutRef.current = null;
        }

        // Disable realtime sync
        isRealtimeSyncEnabledRef.current = false;

        // Unsubscribe from realtime listener
        if (realtimeListenerUnsubscribeRef.current) {
            realtimeListenerUnsubscribeRef.current();
            realtimeListenerUnsubscribeRef.current = null;
        }
    }, []);

    // --- Helper: Enable Realtime Sync (Debounced) ---
    const scheduleRealtimeSync = useCallback(() => {
        // Clear any existing timeout
        if (realtimeSyncTimeoutRef.current) {
            clearTimeout(realtimeSyncTimeoutRef.current);
        }

        // Disable current realtime sync
        isRealtimeSyncEnabledRef.current = false;

        // Schedule enablement after 10 seconds
        realtimeSyncTimeoutRef.current = setTimeout(() => {
            isRealtimeSyncEnabledRef.current = true;
        }, 10000); // 10 second delay
    }, []);

    // --- Helper: Enqueue Sync Task ---
    const enqueueSyncTask = useCallback((taskName: string, task: () => Promise<void>) => {
        syncQueueRef.current = syncQueueRef.current
            .then(async () => {
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
        overrideDateRange?: { from: string, to: string },
        signal?: AbortSignal,
        onProgress?: (progress: { current: number, total: number, message: string }) => void,
        isSilent: boolean = false,
        ruleNames?: string[]
    ): Promise<Record[]> => {
        if (!accountsForSync.length) {
            addNotification("No accounts available to sync.", "info");
            return [];
        }

        // Check if aborted before starting
        if (signal?.aborted) {
            return [];
        }

        setIsSyncing(true);
        setIsSyncing(true);
        if (!isSilent) setSyncState(`Syncing ${accountsForSync.length} account(s)...`);
        try {
            const syncStartTime = new Date().toISOString();
            const existingEmailIds = new Set(existingRecords.filter(r => r.email_id).map(r => r.email_id!));

            if (signal?.aborted) return [];

            const fetchedRecords = await fetchAllRecords(accountsForSync, setSyncState, overrideDateRange, existingEmailIds, onProgress, ruleNames);

            if (signal?.aborted) return [];

            const isHistoricalSync = !!overrideDateRange;

            // SAFETY CHECK: validRecords only
            // If an account was deleted during fetch, we must NOT save its records or update its status.
            const currentAccountEmails = new Set(allAccountsRef.current.map(a => a.email));
            let validRecords = fetchedRecords.filter(r => currentAccountEmails.has(r.account));

            if (validRecords.length < fetchedRecords.length) {
                console.warn("Sync: Detected removed accounts. Dropping orphaned records.");
            }

            if (validRecords.length === 0 && fetchedRecords.length > 0) {
                // All accounts in this batch were removed
                setSyncState(null);
                return [];
            }

            // Use validRecords for the rest of the function
            // Use validRecords for the rest of the function

            // OPTIMIZATION: Only fetch costs if syncing Sales rules or Full Sync ("Sale" keyword check)
            // This prevents calling MZ/PW APIs when just updating Refunded status
            const isSaleRuleSync = !ruleNames || ruleNames.some(name => name.includes('Sales'));

            let costMap: Map<string, CostData> = new Map();

            if (isSaleRuleSync) {
                const recordsToScanForCost = isHistoricalSync
                    ? validRecords
                    : [...existingRecords, ...validRecords];

                setSyncState('Updating costs...');

                const ordersNeedingCost = recordsToScanForCost.filter(r => r.kind === 'order' && !r.cost_total);

                if (ordersNeedingCost.length > 0) {
                    if (signal?.aborted) return [];
                    setSyncState(`Fetching costs for ${ordersNeedingCost.length} orders...`);
                    costMap = await fetchCostsForRecords(ordersNeedingCost);
                }
            } else {
                // If not syncing sales, we skip cost fetching. 
                // Any new records (e.g. Refunded emails) will be saved without cost data, which is fine as they are statuses.
            }

            if (signal?.aborted) return [];

            let updatedOldRecords: (Partial<Record> & { id: string; })[] = [];
            const newRecordsWithCost = validRecords.map(record => {
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
                        if (signal?.aborted) return [];
                        setSyncState(`Updating ${updatedOldRecords.length} records...`);
                        await updateRecordsInFirebase(teamId, updatedOldRecords);
                    }
                }
            }

            if (signal?.aborted) return [];

            let finalNewRecords = newRecordsWithCost;
            let addedRecords: Record[] = [];
            if (finalNewRecords.length > 0) {
                addedRecords = await saveRecordsToFirebase(teamId, finalNewRecords);
            }

            if (signal?.aborted) return [];

            if (!overrideDateRange) {
                // SAFETY CHECK: Only update accounts that are still in the system
                const currentAccountIds = new Set(allAccountsRef.current.map(a => a.id));
                const accountsToUpdate = accountsForSync.filter(acc => currentAccountIds.has(acc.id));

                if (accountsToUpdate.length > 0) {
                    const updatedAccountsForFirebase = accountsToUpdate.map(acc => ({ ...acc, last_synced_at: syncStartTime }));
                    await updateAccountsInFirebase(teamId, updatedAccountsForFirebase);
                    setAllAccounts(prevAccounts => {
                        const updatedAccountsMap = new Map(updatedAccountsForFirebase.map(acc => [acc.id, acc]));
                        return prevAccounts.map(acc => updatedAccountsMap.get(acc.id) || acc);
                    });
                }
            }

            if (addedRecords.length > 0 || updatedOldRecords.length > 0) {
                addNotification(`Sync complete. +${addedRecords.length} new, ${updatedOldRecords.length} updated.`, "success");
            } else {
                addNotification(`Sync complete. No new records found.`, "success");
            }
            setSyncState(null);
            return addedRecords;
        } catch (error) {
            if (signal?.aborted) return [];
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
    const runHistoricalSync = useCallback(async (
        accountsToSync: Account[],
        initialRecords: Record[],
        signal?: AbortSignal,
        ruleNames?: string[]
    ) => {
        const accountsNeedingSync = accountsToSync.filter(a => !a.historical_sync_complete);
        if (accountsNeedingSync.length === 0) return;

        if (signal?.aborted) return;

        setSyncState(`Background Sync: ${accountsNeedingSync.length} account(s)`);

        for (let account of accountsToSync) {
            if (signal?.aborted) return;

            // SAFETY CHECK: Abort if account no longer exists
            if (!allAccountsRef.current.some(a => a.id === account.id)) {
                console.log(`Historical Sync: Account ${account.email} was removed. Skipping.`);
                continue;
            }

            if (!account.scan_start_date) {
                setSyncState(`[${account.email}] Probing history...`);
                let foundStartDate: string | null = null;
                const tenYearsAgo = new Date(); tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
                for (let i = 0; i < 20; i++) {
                    if (signal?.aborted) return;
                    const probeEndDate = new Date(); probeEndDate.setMonth(probeEndDate.getMonth() - (i * 6));
                    const probeStartDate = new Date(probeEndDate); probeStartDate.setMonth(probeStartDate.getMonth() - 6);
                    if (probeStartDate < tenYearsAgo) break;
                    const emailsExist = await checkEmailsExistInRange(account, { from: probeStartDate.toISOString(), to: probeEndDate.toISOString() });
                    if (emailsExist) { foundStartDate = probeStartDate.toISOString(); } else if (foundStartDate) { break; }
                }
                if (foundStartDate) {
                    if (signal?.aborted) return;
                    const accountUpdate = { id: account.id, scan_start_date: foundStartDate };
                    await updateAccountsInFirebase(teamId, [accountUpdate]);
                    account = { ...account, scan_start_date: foundStartDate };
                    setAllAccounts(prev => prev.map(a => a.id === account.id ? { ...a, scan_start_date: foundStartDate } : a));
                } else {
                    if (signal?.aborted) return;
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
                if (signal?.aborted) return;

                // SAFETY CHECK: Abort loop if account deleted
                if (!allAccountsRef.current.some(a => a.id === account.id)) {
                    console.log(`Historical Sync: Account ${account.email} removed during loop. Aborting.`);
                    break;
                }

                safetyCounter++;
                if (safetyCounter > 1000) {
                    console.error(`[${account.email}] Historical sync loop exceeded 1000 iterations. Breaking to prevent infinite loop.`);
                    addNotification(`[${account.email}] Historical sync stopped (safety limit).`, "error");
                    break;
                }
                const currentSyncStart = new Date(currentSyncEnd);
                currentSyncStart.setDate(currentSyncStart.getDate() - 7);

                const effectiveSyncStart = currentSyncStart < finalSyncEnd ? finalSyncEnd : currentSyncStart;

                const historyMsg = `${effectiveSyncStart.toLocaleDateString()} - ${currentSyncEnd.toLocaleDateString()}`;
                setSyncState(null); // Clear global state to avoid flickering
                setAccountSyncStatuses(prev => ({ ...prev, [account.id]: historyMsg }));

                const dateRange = { from: effectiveSyncStart.toISOString(), to: currentSyncEnd.toISOString() };

                try {
                    const fetchedChunk = await runSync([account], currentExistingRecords, dateRange, signal, undefined, false, ruleNames);
                    if (signal?.aborted) return;
                    if (fetchedChunk.length > 0) currentExistingRecords.push(...fetchedChunk);

                    const newSyncedUntil = effectiveSyncStart.toISOString();
                    const accountUpdate = { id: account.id, history_synced_until: newSyncedUntil };
                    await updateAccountsInFirebase(teamId, [accountUpdate]);

                    setAllAccounts(prevAccounts => prevAccounts.map(acc => acc.id === account.id ? { ...acc, history_synced_until: newSyncedUntil } : acc));
                    currentSyncEnd = effectiveSyncStart;
                } catch (chunkError) {
                    if (signal?.aborted) return;
                    console.error(`Error syncing history chunk for ${account.email}`, chunkError);
                    const errorMessage = chunkError instanceof Error ? chunkError.message : 'Unknown error';
                    addNotification(`[${account.email}] History sync paused: ${errorMessage}`, "error");
                    break;
                }
            }

            if (currentSyncEnd <= finalSyncEnd) {
                if (signal?.aborted) return;
                const finalAccountUpdate = { id: account.id, historical_sync_complete: true };
                await updateAccountsInFirebase(teamId, [finalAccountUpdate]);
                setAllAccounts(prevAccounts => prevAccounts.map(acc => acc.id === account.id ? { ...acc, historical_sync_complete: true } : acc));
                addNotification(`[${account.email}] Historical sync complete.`, "info");

                // Clear status
                setAccountSyncStatuses(prev => {
                    const next = { ...prev };
                    delete next[account.id];
                    return next;
                });
            }
        }
        setSyncState(null);
    }, [runSync, teamId, addNotification]);

    // --- Effect: Load Initial Data (Only on mount) ---
    useEffect(() => {
        if (!user) return;

        // Abort any previous initial load
        initialLoadAbortControllerRef.current?.abort();
        abortAllOperations();

        // Create new AbortController for this initial load
        const controller = new AbortController();
        initialLoadAbortControllerRef.current = controller;
        const signal = controller.signal;

        const loadInitialData = async () => {
            // Initialize date range tracking FIRST to prevent race condition with date range effect
            dateRangeStringRef.current = `${filterDateRange.from}|${filterDateRange.to}|${timeZone}`;

            setIsLoading(true);
            setSyncState('Loading data...');
            try {
                const [fbAccounts, initialDisplayRecords, manualCostEntries, initialReviews] = await Promise.all([
                    getAccountsFromFirebase(teamId),
                    getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone),
                    getManualCosts(teamId),
                    getEtsyReviewsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone)
                ]);

                // Check if aborted
                if (signal.aborted) {
                    return;
                }

                // If cache had the same accounts, we don't need to overwrite state unnecessarily
                // But we still update to ensure we have the absolute latest from server
                setAllAccounts(fbAccounts);
                setRecords(initialDisplayRecords);
                setManualCosts(manualCostEntries);
                setEtsyReviews(initialReviews);

                // IMPORTANT: Set loading to false immediately so UI displays data
                setIsLoading(false);
                setSyncState(null);

                // Mark initial load as complete
                initialLoadCompleteRef.current = true;

                // Setup Gmail watch for owner
                if (role === 'owner') {
                    fbAccounts.forEach(acc => {
                        if (acc.provider === 'gmail') {
                            setupGmailWatch(teamId, acc).catch(err => console.error(`Failed to initialize webhook for ${acc.email}:`, err));
                        }
                    });
                }

                // Delay background tasks by 5 seconds to let UI render with existing data first
                if (fbAccounts.length > 0 && !signal.aborted) {
                    setTimeout(async () => {
                        if (signal.aborted) {
                            return;
                        }

                        // Schedule realtime sync after data stabilizes
                        scheduleRealtimeSync();

                        // Run historical sync in background
                        const accountsForHistoricalSync = fbAccounts.filter(acc => !acc.historical_sync_complete);
                        if (accountsForHistoricalSync.length > 0 && !signal.aborted) {
                            historicalSyncAbortControllerRef.current = new AbortController();
                            runHistoricalSync(accountsForHistoricalSync, initialDisplayRecords, historicalSyncAbortControllerRef.current.signal);
                        }
                    }, 5000); // 5 second delay
                }
            } catch (error) {
                if (signal.aborted) return;
                console.error("Failed to load initial data:", error);
                addNotification("Could not load data from Firebase.", "error");
                setIsLoading(false);
                setSyncState(null);
            }
        };

        loadInitialData();

        // Cleanup: abort when component unmounts or user changes
        return () => {
            controller.abort();
        };
    }, [user, teamId]); // Only depend on user/team, not date ranges

    // --- Effect: Fetch Data on Range Change ---
    useEffect(() => {
        // Build current date range string (include timezone to force refetch on TZ change)
        const currentDateRangeString = `${filterDateRange.from}|${filterDateRange.to}|${timeZone}`;

        // Skip if:
        // 1. Initial load hasn't completed yet
        // 2. Date range (or timezone) hasn't actually changed
        if (!initialLoadCompleteRef.current) {
            return;
        }

        if (dateRangeStringRef.current === currentDateRangeString) {
            return;
        }

        // Update tracked date range
        dateRangeStringRef.current = currentDateRangeString;

        if (!user) return;

        // STEP 1: Abort all ongoing operations immediately
        abortAllOperations();

        // STEP 2: Reset previous period immediately (not visible in main UI)
        // NOTE: We intentionally do NOT reset `records` here.
        // Keeping stale records visible during fetch is better UX than flashing empty/null.
        // The worker's `isFetchingNewRange` guard prevents it from processing while fetching.
        setPreviousPeriodRecords(null);

        // STEP 3: Abort previous date range fetch controller
        dateRangeFetchAbortControllerRef.current?.abort();

        // STEP 4: Create new controller for this specific range fetch
        const controller = new AbortController();
        dateRangeFetchAbortControllerRef.current = controller;
        const signal = controller.signal;

        // STEP 5: Increment Request ID to track this specific request
        const requestId = fetchRequestIdRef.current + 1;
        fetchRequestIdRef.current = requestId;

        const fetchDataForRange = async () => {
            setIsFetchingNewRange(true);
            setSyncState('Fetching...');

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
                // Helper: Get timezone offset string
                const getTimezoneOffsetString = (tz: string, dateStr: string): string => {
                    try {
                        const d = new Date(dateStr + "T12:00:00Z");
                        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
                        const parts = formatter.formatToParts(d);
                        const gmtPart = parts.find(p => p.type === 'timeZoneName');
                        return gmtPart ? gmtPart.value.replace('GMT', '') : '+00:00';
                    } catch { return '+00:00'; }
                };

                // Helper: Fetch records in parallel chunks
                const fetchParallel = async (startStr: string, endStr: string, tz: string): Promise<Record[]> => {
                    if (signal.aborted) return [];

                    const sOffset = getTimezoneOffsetString(tz, startStr);
                    const eOffset = getTimezoneOffsetString(tz, endStr);

                    const startDate = new Date(`${startStr}T00:00:00.000${sOffset}`);
                    const endDate = new Date(`${endStr}T23:59:59.999${eOffset}`);

                    const chunks = splitDateRange(startDate, endDate);

                    // Parallel Requests
                    const chunkPromises = chunks.map(async (chunk) => {
                        if (signal.aborted) return [];

                        const q = query(
                            collection(db, 'user', teamId, 'records'),
                            where('dt_local', '>=', chunk.start.toISOString()),
                            where('dt_local', '<', chunk.end.toISOString())
                        );
                        const snapshot = await getDocs(q);
                        return snapshot.docs.map(doc => ({ ...(doc.data() as object), id: doc.id } as Record));
                    });

                    const results = await Promise.all(chunkPromises);

                    if (signal.aborted) return [];

                    // Merge and sort
                    const merged = results.flat();
                    return merged.sort((a, b) => {
                        if (b.dt_local < a.dt_local) return -1;
                        if (b.dt_local > a.dt_local) return 1;
                        return 0;
                    });
                };

                const currentRecordsPromise = fetchParallel(filterDateRange.from, filterDateRange.to, timeZone);
                const previousRecordsPromise = shouldFetchPrevious && previousRange
                    ? fetchParallel(previousRange.from, previousRange.to, timeZone)
                    : Promise.resolve(null);
                const reviewsPromise = getEtsyReviewsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);

                const [fbRecords, prevRecords, fetchedReviews] = await Promise.all([currentRecordsPromise, previousRecordsPromise, reviewsPromise]);

                // RACE CONDITION CHECK: Verify this is still the latest request
                if (signal.aborted || requestId !== fetchRequestIdRef.current) {
                    console.log(`[fetchDataForRange] Ignoring stale request #${requestId} (current: #${fetchRequestIdRef.current})`);
                    return;
                }

                // Cross-check refunds (Level 1: check orders for refunds outside range)
                const finalRecords = [...fbRecords];
                const orderIdsToCrossCheck = fbRecords
                    .filter(r => r.kind === 'order' && r.order_id && r.source !== 'Etsy_Refunded')
                    .map(r => r.order_id!);

                if (orderIdsToCrossCheck.length > 0) {
                    setSyncState('Cross-checking refunds...');
                    try {
                        const crossCheckRefunds = await getRefundRecordsForOrderIds(teamId, orderIdsToCrossCheck, filterDateRange.from, filterDateRange.to);
                        if (crossCheckRefunds.length > 0 && !signal.aborted) {
                            const existingIds = new Set(fbRecords.map(r => r.id));
                            let added = false;
                            crossCheckRefunds.forEach(refRecord => {
                                if (!existingIds.has(refRecord.id)) {
                                    finalRecords.push(refRecord);
                                    added = true;
                                }
                            });
                            if (added) {
                                finalRecords.sort((a, b) => (b.dt_local || '').localeCompare(a.dt_local || ''));
                            }
                        }
                    } catch (ccError) {
                        console.error("Refund cross-check failed:", ccError);
                    }
                }

                // Update state with new data
                setRecords(finalRecords);
                setPreviousPeriodRecords(prevRecords);
                setEtsyReviews(fetchedReviews);

                // Schedule realtime sync after data stabilizes (10 second delay)
                scheduleRealtimeSync();
            } catch (error) {
                if (signal.aborted || requestId !== fetchRequestIdRef.current) return;
                console.error("Failed to fetch records for range:", error);
                addNotification('Error loading records for this range.', "error");
            } finally {
                if (requestId === fetchRequestIdRef.current) {
                    setIsFetchingNewRange(false);
                    setSyncState(null);
                }
            }
        };

        fetchDataForRange();

        // Cleanup: abort if range changes before fetch completes
        return () => {
            controller.abort();
        };
    }, [filterDateRange, user, timeZone, teamId]); // Only depend on actual data values, not functions

    // --- Effect: Listen for New Records (Realtime) ---
    useEffect(() => {
        if (!user) return;

        // Setup listener
        const unsubscribe = listenForNewRecords(teamId, (newRecord) => {
            // Only process if realtime sync is enabled
            if (!isRealtimeSyncEnabledRef.current) {
                return;
            }

            const { from, to } = filterDateRange;
            const recordDate = new Date(newRecord.dt_local);
            const fromDate = new Date(from);
            const toDate = new Date(to); toDate.setHours(23, 59, 59, 999);

            if (recordDate >= fromDate && recordDate <= toDate) {
                setRecords(prevRecords => {
                    const exists = prevRecords.some(r => r.id === newRecord.id);
                    if (exists) return prevRecords;

                    if (newRecord.kind === 'order') {
                        const isRefund = newRecord.source === 'Etsy_Refunded';
                        if (isRefund) {
                            addNotification(`Refund processed #${newRecord.order_id}`, 'info');
                        } else {
                            const productName = newRecord.details?.items?.[0]?.name || 'Unknown product';
                            addNotification(`New order #${newRecord.order_id}: ${productName}`, 'success');
                        }
                    } else if (newRecord.kind === 'Funds') {
                        addNotification(`Funds Received: $${newRecord.amount}`, 'success');
                    } else {
                        addNotification(`New ${newRecord.kind} received.`, "info");
                    }

                    return [newRecord, ...prevRecords].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());
                });
            }
        });

        // Store unsubscribe function
        realtimeListenerUnsubscribeRef.current = unsubscribe;

        return () => {
            unsubscribe();
        };
    }, [filterDateRange, user, teamId, addNotification]);

    // --- Effect: Listen for Account Changes (Realtime) ---
    useEffect(() => {
        if (!user) return;
        const unsubscribe = listenForAccounts(teamId, (updatedAccounts) => {
            // If this is the listener's first snapshot, treat as baseline: store and don't notify.
            if (!accountsListenerInitializedRef.current) {
                accountsListenerInitializedRef.current = true;
                setAllAccounts(updatedAccounts);
                return;
            }

            // Prevent notifying if the accounts are exactly what we already have in cache/state
            const prevAccounts = allAccountsRef.current;
            // Removed early return here so worker_status updates can flow through to the UI
            // The notification logic below already safely checks for label/id changes.

            // Only send notifications after the initial app load completed
            if (initialLoadCompleteRef.current) {
                const prevAccounts = allAccountsRef.current;
                const prevMap = new Map(prevAccounts.map(a => [a.id, a]));
                const currentMap = new Map(updatedAccounts.map(a => [a.id, a]));

                // Collect additions to avoid spamming many individual notifications
                const addedEmails: string[] = [];
                updatedAccounts.forEach(newAcc => {
                    const oldAcc = prevMap.get(newAcc.id);
                    if (!oldAcc) {
                        addedEmails.push(newAcc.email);
                    } else {
                        if (oldAcc.label !== newAcc.label) {
                            addNotification(`Account ${newAcc.email} renamed to "${newAcc.label}"`, 'info');
                        }
                    }
                });

                if (addedEmails.length === 1) {
                    addNotification(`New account added: ${addedEmails[0]}`, 'info');
                } else if (addedEmails.length > 1) {
                    addNotification(`+${addedEmails.length} new accounts added`, 'info');
                }

                // Detect Deletions
                prevAccounts.forEach(oldAcc => {
                    if (!currentMap.has(oldAcc.id)) {
                        addNotification(`Account removed: ${oldAcc.email}`, 'info');
                    }
                });
            }

            setAllAccounts(updatedAccounts);
        });

        return () => {
            unsubscribe();
        };
    }, [user, teamId, addNotification]);

    // --- Cleanup on Unmount ---
    useEffect(() => {
        return () => {
            abortAllOperations();
        };
    }, [abortAllOperations]);

    return {
        allAccounts, setAllAccounts,
        records, setRecords,
        previousPeriodRecords, setPreviousPeriodRecords,
        manualCosts, setManualCosts,
        etsyReviews, setEtsyReviews,
        isLoading,
        isSyncing,
        isFetchingNewRange,
        syncState, setSyncState,
        syncProgress,
        accountSyncStatuses,
        runSync,
        runHistoricalSync,
        enqueueSyncTask
    };
};
