import React, { useState, useEffect, useMemo, useRef, createContext } from 'react';
import { Record, Account, ProcessedData, ManualCost } from '../types';
import {
  saveAccountsToFirebase,
  deleteRecordsForAccounts,
  getRecordsForDateRange
} from '../services/firebaseService';
import { exportDashboardToExcel, ExportProgress } from '../utils/excelExport';
import { setupGmailWatch } from '../services/emailService';
import { useNotification } from './NotificationContext';
import { User } from 'firebase/auth';
import { useDataSync } from '../hooks/useDataSync';
import { useRecordFiltering } from '../hooks/useRecordFiltering';
import { useAutoSync } from '../hooks/useAutoSync';

// Default Tab List
// Default Tab List
// const DEFAULT_TABS: Tab[] = ['Overview', 'Order List', 'Products', 'Case', 'Help', 'Fulfill']; // Unused

interface DashboardContextType {
  // Auth & Permissions
  user: User;
  teamId: string;
  role: 'owner' | 'user';
  permissions: { [key: string]: boolean };
  allowedAccounts?: string[]; // For shop-level access control

  // Data State (from useDataSync)
  accounts: Account[]; // Filtered accounts for data display
  allAccounts: Account[]; // All accounts (for management purposes)
  managementAccounts: Account[]; // Accounts user can manage (for MailManager)
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  records: Record[];
  setRecords: React.Dispatch<React.SetStateAction<Record[]>>;
  manualCosts: ManualCost[];
  setManualCosts: React.Dispatch<React.SetStateAction<ManualCost[]>>;

  // Status
  isLoading: boolean;
  isSyncing: boolean;
  isFetchingNewRange: boolean;
  syncState: string | null;
  syncProgress: { current: number, total: number, message: string } | null;
  accountSyncStatuses: { [key: string]: string };
  isProcessing: boolean;
  isSavingAccounts: boolean;
  exportProgress: ExportProgress | null;
  isExporting: boolean;
  showExportOptions: boolean;
  setShowExportOptions: React.Dispatch<React.SetStateAction<boolean>>;




  // Actions
  handleSaveAccounts: (updatedAccounts: Account[], explicitlyRemovedIds?: string[]) => Promise<void>;
  handleSyncClick: () => Promise<void>;
  handleResyncAccount: (account: Account) => Promise<void>;
  handleQuickSync: (account: Account) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleExport: () => void;
  handleExportWithOptions: (includeImages: boolean) => void;
  performGlobalSearch: (term: string) => Promise<void>;




  processedData: ProcessedData;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

interface DashboardProviderProps {
  children: React.ReactNode;
  user: User;
  teamId: string;
  role: 'owner' | 'user';
  permissions: { [key: string]: boolean };
  allowedAccounts?: string[];
  // We pass auth logic from outside (App.tsx) or we could just use the hook here if we didn't need to conditionally render the provider.
  // Given App.tsx structure, we already have user/role there.
  onLogout: () => Promise<void>;
  // UI Injections for filtering/syncing
  timeZone: string;
  filterDateRange: { from: string; to: string };
  selectedAccountId: string;
  searchTerm: string;
}

export const DashboardProvider: React.FC<DashboardProviderProps> = ({
  children, user, teamId, role, permissions, allowedAccounts, onLogout,
  timeZone, filterDateRange, selectedAccountId, searchTerm
}) => {

  const { addNotification } = useNotification();



  // --- 3. Data Logic (via Hook) ---
  const {
    allAccounts, setAllAccounts,
    records, setRecords,
    previousPeriodRecords,
    manualCosts, setManualCosts,
    isLoading,
    isSyncing,
    isFetchingNewRange,
    syncState, setSyncState,
    syncProgress,
    accountSyncStatuses,
    runSync,
    runHistoricalSync,
    enqueueSyncTask
  } = useDataSync({
    user,
    teamId,
    role,
    filterDateRange,
    timeZone,
    addNotification
  });

  // --- Auto-Sync to Google Sheets ---
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  // Listen to auto-sync settings changes in real-time
  useEffect(() => {
    if (!teamId) return;

    import('../services/firebaseService').then(({ listenForSettings }) => {
      const unsubscribe = listenForSettings(teamId, (settings) => {
        if (settings.autoSyncToSheet !== undefined) {
          setAutoSyncEnabled(settings.autoSyncToSheet);
          console.log(`[Auto-Sync] Settings updated: ${settings.autoSyncToSheet ? 'ENABLED' : 'DISABLED'}`);
        }
      });

      return () => unsubscribe();
    });
  }, [teamId]);

  // Use auto-sync hook
  useAutoSync({
    enabled: autoSyncEnabled,
    teamId,
    records,
    allAccounts,
    timeZone,
    onSyncSuccess: (count) => {
      console.log(`[Auto-Sync] ✅ Synced ${count} records to Google Sheets`);
      // Silent notification - no need to disturb the user
      // addNotification(`Auto-synced ${count} orders to Google Sheets`, 'success');
    },
    onSyncError: (error) => {
      console.error('[Auto-Sync] ❌ Error:', error);
      // Only notify on errors that need attention
      if (error.includes('Permission') || error.includes('403')) {
        addNotification('Auto-sync failed: Please check Google Sheet permissions', 'error');
      }
    }
  });

  // --- Real-time Listener for New Records ---
  useEffect(() => {
    if (!teamId) return;

    console.log('[Real-time] Setting up listener for new records...');

    import('../services/firebaseService').then(({ listenForNewRecords }) => {
      const unsubscribe = listenForNewRecords(teamId, (newRecord) => {
        // Quietly add new record to state (React will re-render efficiently, no flash)
        setRecords(prev => {
          // Check if record already exists (avoid duplicates)
          const exists = prev.some(r => r.id === newRecord.id);
          if (exists) return prev;

          console.log(`[Real-time] ✨ New ${newRecord.kind} arrived: ${newRecord.order_id || newRecord.id}`);

          // Show toast notification only for orders
          if (newRecord.kind === 'order') {
            const productName = newRecord.details?.items?.[0]?.name || 'Unknown product';
            addNotification(
              `New order #${newRecord.order_id}: ${productName}`,
              'success'
            );
          }

          return [...prev, newRecord];
        });
      });

      return () => {
        console.log('[Real-time] Cleaning up listener...');
        unsubscribe();
      };
    });
  }, [teamId, addNotification]);

  // --- 4. Logic Functions ---




  // Computed Visible Accounts (for data display)
  const visibleAccounts = useMemo(() => {
    if (role === 'owner') return allAccounts;
    if (!allowedAccounts || allowedAccounts.length === 0) return [];
    return allAccounts.filter(acc => allowedAccounts.includes(acc.email));
  }, [allAccounts, role, allowedAccounts]);

  // Computed Management Accounts (for MailManager - users with canManageSettings see ALL)
  const managementAccounts = useMemo(() => {
    // Owner always sees all
    if (role === 'owner') return allAccounts;
    // Users with canManageSettings permission see ALL accounts (to prevent accidental deletion)
    if (permissions.canManageSettings) return allAccounts;
    // Regular users see only their allowed accounts
    if (!allowedAccounts || allowedAccounts.length === 0) return [];
    return allAccounts.filter(acc => allowedAccounts.includes(acc.email));
  }, [allAccounts, role, permissions.canManageSettings, allowedAccounts]);

  // We need these props from UIContext? No, DashboardContext should only care about data.
  // Actually, filtering logs often depends on UI state (filterDateRange).
  // So we should ACCEPT these as props or dependencies, or move filtering to UI layer?
  // Ideally: DashboardContext provides RAW data, specific views filter it.
  // BUT the worker needs filterDateRange to optimize

  // --- Worker / Data Processing ---
  const initialProcessedData: ProcessedData = {
    overview: { table: { headers: [], rows: [] }, chartData: [] },
    orders: { headers: [], rows: [] },
    ebay: { headers: [], rows: [] },
    etsy: { headers: [], rows: [] },
    cases: { headers: [], rows: [] },
    help: { headers: [], rows: [] },
    fulfill: { table: { headers: [], rows: [] }, merchizeChartData: [], printwayChartData: [] },
    summary: { kpis: {}, table: { headers: [], rows: [] }, chartData: [], topProductsByShop: {} },
    products: { headers: [], rows: [] }
  };

  const [processedData, setProcessedData] = useState<ProcessedData>(initialProcessedData);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSavingAccounts, setIsSavingAccounts] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [showExportOptions, setShowExportOptions] = useState<boolean>(false);

  // DON'T reset processedData - we'll show loading overlay instead (optimistic UI)

  const workerRef = useRef<Worker | null>(null);
  const workerRequestIdRef = useRef<number>(0);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/dataWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      const { success, data, error, requestId } = e.data;

      // Check if this response is from the latest request
      if (requestId !== workerRequestIdRef.current) {
        return;
      }

      if (success) setProcessedData(data);
      else console.error("[Worker] Error:", error);
      setIsProcessing(false);
    };

    // Safety error handler
    workerRef.current.onerror = (err) => {
      console.error("Worker Silent Error:", err);
      setIsProcessing(false);
    };

    return () => workerRef.current?.terminate();
  }, []);

  // Computed Processing Accounts (Stable reference for Worker)
  // Strips out timestamps to prevent re-processing when only sync status changes
  const processingAccounts = useMemo(() => {
    return visibleAccounts.map(acc => ({
      id: acc.id,
      email: acc.email,
      label: acc.label,
      platforms: acc.platforms,
      provider: acc.provider
    }));
  }, [visibleAccounts]);

  // Ref to hold stable processing accounts
  const stableProcessingAccountsRef = useRef(processingAccounts);
  // Manual check
  const isProcessingAccountsDifferent = JSON.stringify(processingAccounts) !== JSON.stringify(stableProcessingAccountsRef.current);
  if (isProcessingAccountsDifferent) {
    stableProcessingAccountsRef.current = processingAccounts;
  }

  // Let's explicitly memoize the JSON string and use that as dependency?
  const processingAccountsHash = useMemo(() => JSON.stringify(processingAccounts), [processingAccounts]);


  // Filter Records for Display/Processing
  // Use stableProcessingAccountsRef to prevent re-filtering (and re-processing) when only timestamps change
  const filteredRecords = useRecordFiltering({
    records,
    accounts: stableProcessingAccountsRef.current as Account[], // Cast as full Account[] assuming filtering uses only stable IDs
    selectedAccountId,
    searchTerm
  });

  // Track the last trigger state for worker to prevent redundant runs
  const lastTriggeredRef = useRef<{
    records: any;
    prevRecords: any;
    accountsHash: string;
    filter: any;
    tz: string;
    manual: any;
  }>({
    records: null,
    prevRecords: null,
    accountsHash: '',
    filter: null,
    tz: '',
    manual: null
  });

  // Sync ref for safety timeout check
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;

  // Trigger Worker
  useEffect(() => {
    if (!workerRef.current) return;

    const triggerKey = {
      records: filteredRecords,
      prevRecords: previousPeriodRecords,
      accountsHash: processingAccountsHash,
      filter: filterDateRange,
      tz: timeZone,
      manual: manualCosts
    };

    if (
      filteredRecords === lastTriggeredRef.current.records &&
      previousPeriodRecords === lastTriggeredRef.current.prevRecords &&
      processingAccountsHash === lastTriggeredRef.current.accountsHash &&
      filterDateRange === lastTriggeredRef.current.filter &&
      timeZone === lastTriggeredRef.current.tz &&
      manualCosts === lastTriggeredRef.current.manual
    ) {
      return;
    }

    lastTriggeredRef.current = {
      records: filteredRecords,
      prevRecords: previousPeriodRecords,
      accountsHash: processingAccountsHash,
      filter: filterDateRange,
      tz: timeZone,
      manual: manualCosts
    };

    // Set processing state
    setIsProcessing(true);
    // DON'T reset processedData - keep old data visible for optimistic UI

    // Safety timeout: If worker doesn't respond in 10s, force unlock UI
    const safetyTimeout = setTimeout(() => {
      if (isProcessingRef.current) {
        console.warn("Worker timed out, forcing UI unlock.");
        setIsProcessing(false);
      }
    }, 10000);

    // Increment request ID
    workerRequestIdRef.current += 1;
    const currentRequestId = workerRequestIdRef.current;

    // Use stable accounts for worker
    workerRef.current.postMessage({
      requestId: currentRequestId,
      records: filteredRecords,
      previousRecords: previousPeriodRecords,
      accounts: stableProcessingAccountsRef.current, // Use stable structure
      filterDateRange,
      timeZone,
      role,
      permissions,
      manualCosts
    });

    return () => clearTimeout(safetyTimeout);
  }, [filteredRecords, previousPeriodRecords, processingAccountsHash, filterDateRange, timeZone, role, permissions, manualCosts]);


  // --- Action Handlers ---

  const handleSyncClick = async () => {
    if (isSyncing || !user) return;
    const accountsToSync = selectedAccountId === 'all' ? visibleAccounts : visibleAccounts.filter(acc => acc.email === selectedAccountId);
    if (accountsToSync.length === 0) { addNotification("No accounts selected.", "info"); return; }

    runSync(accountsToSync, records).then(async () => {
      setSyncState('Refreshing view...');
      try {
        const updatedDisplayRecords = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
        setRecords(updatedDisplayRecords);
      } catch (e) { console.error(e); }
      setSyncState(null);
    });
  };

  const handleResyncAccount = async (account: Account) => {
    if (!user) return;
    enqueueSyncTask(`Resync ${account.email}`, async () => {
      try {
        setSyncState(`[Queue] Resetting ${account.email}...`);
        const resetData = { id: account.id, historical_sync_complete: false, history_synced_until: null, last_synced_at: null, scan_start_date: null };
        await saveAccountsToFirebase(teamId, [{ ...account, ...resetData }]); // Helper reuse? Or updateAccounts
        // Logic simplifed: Just update state & run sync
        const updatedAccount = { ...account, ...resetData };
        setAllAccounts(prev => prev.map(a => a.id === account.id ? updatedAccount : a));

        setSyncState(`[Queue] Syncing ${account.email}...`);
        const initialRecords = await runSync([updatedAccount], records);
        await runHistoricalSync([updatedAccount], [...records, ...initialRecords]);
        addNotification(`Re-sync finished for ${account.email}`, "success");
      } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        addNotification(`Failed to re-sync ${account.email}: ${errorMessage}`, "error");
      } finally { setSyncState(null); }
    });
    addNotification(`Queued re-sync for ${account.email}`, "info");
  };

  const handleQuickSync = async (account: Account) => {
    if (!user) return;
    const toDate = new Date();
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - 7);
    const range = { from: fromDate.toISOString(), to: toDate.toISOString() };

    enqueueSyncTask(`Quick Sync ${account.email}`, async () => {
      try {
        setSyncState(`[Queue] Quick sync ${account.email}...`);
        await runSync([account], records, range);
        addNotification(`Quick sync complete for ${account.email}`, "success");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        addNotification(`Quick sync failed: ${errorMessage}`, "error");
      } finally { setSyncState(null); }
    });
    addNotification(`Queued quick sync for ${account.email}`, "info");
  };

  const handleSaveAccounts = async (updatedAccounts: Account[], explicitlyRemovedIds: string[] = []) => {
    if (!user) return;
    setIsSavingAccounts(true);
    setSyncState('Saving accounts...');
    try {

      const originalAccounts = [...allAccounts];
      const originalRecords = [...records];

      // Detect deletions (Derived + Explicit)
      const derivedDeletedAccounts = originalAccounts.filter(acc => !updatedAccounts.some(u => u.id === acc.id));

      // Combine derived and explicit IDs
      const derivedDeletedIds = derivedDeletedAccounts.map(a => a.id);
      const deletedAccountIds = Array.from(new Set([...derivedDeletedIds, ...explicitlyRemovedIds]));

      // Resolve emails for cleanup (only for known accounts)
      const deletedEmails: string[] = [];
      deletedAccountIds.forEach(id => {
        const acc = originalAccounts.find(a => a.id === id);
        if (acc) deletedEmails.push(acc.email);
      });

      // Keep 'deletedAccounts' variable for safety check (only includes known accounts)
      const deletedAccounts = derivedDeletedAccounts;

      // CRITICAL SAFETY CHECK: Prevent users from deleting accounts they can't see
      if (role !== 'owner' && deletedAccounts.length > 0) {
        // Check if user is trying to delete accounts outside their permission scope
        const unauthorizedDeletions = deletedAccounts.filter(acc => {
          // If user has allowedAccounts restriction, they can only delete accounts in that list
          if (allowedAccounts && allowedAccounts.length > 0) {
            return !allowedAccounts.includes(acc.email);
          }
          return false;
        });

        if (unauthorizedDeletions.length > 0) {
          console.error('[Security] User attempted to delete unauthorized accounts:', unauthorizedDeletions.map(a => a.email));
          addNotification('⚠️ Security Error: You cannot delete accounts outside your permission scope.', 'error');
          setSyncState(null);
          setIsSavingAccounts(false);
          return;
        }
      }



      let nextRecords = originalRecords;
      if (deletedAccounts.length > 0) {
        setSyncState(`Cleaning up ${deletedAccounts.length} accounts...`);
        await deleteRecordsForAccounts(teamId, deletedEmails);
        nextRecords = originalRecords.filter(r => !deletedEmails.includes(r.account));
        setRecords(nextRecords);
      }

      // Safe update: Only upsert updatedAccounts and delete explicitly deleted IDs
      await saveAccountsToFirebase(teamId, updatedAccounts, deletedAccountIds);

      // REMOVED: setAllAccounts(updatedAccounts) 
      // REMOVED: addNotification('Accounts saved.', "success");
      // We rely on the real-time listener in useDataSync to update the state and notify the user.
      // This ensures 1) we are sure the server has the data, and 2) the "Account Renamed" notification triggers correctly because the local state is still "stale" when the listener fires.


      // Detect additions
      const newAccounts = updatedAccounts.filter(acc => !originalAccounts.some(o => o.id === acc.id));
      if (newAccounts.length > 0) {
        setSyncState('Initializing new accounts...');
        newAccounts.forEach(acc => {
          if (acc.provider === 'gmail') setupGmailWatch(teamId, acc).catch(console.error);
        });

        runSync(newAccounts, nextRecords).then(async () => {
          try {
            const updated = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
            setRecords(updated);
            runHistoricalSync(newAccounts, updated);
          } catch (e) {
            console.error('Error refreshing view after adding new accounts:', e);
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            addNotification(`Failed to refresh view: ${errorMessage}`, "error");
          }
        });
      }
      setSyncState(null);
    } catch (e) {
      console.error(e);
      addNotification('Error saving accounts.', "error");
      setSyncState(null);
    } finally {
      setIsSavingAccounts(false);
    }
  };




  // Export to Excel - Show options modal
  const handleExport = () => {
    if (!processedData) {
      addNotification('No data to export', 'info');
      return;
    }
    setShowExportOptions(true);
  };

  // Export to Excel with options
  const handleExportWithOptions = (includeImages: boolean) => {
    if (!processedData) {
      addNotification('No data to export', 'info');
      return;
    }

    setIsExporting(true);
    setExportProgress({ stage: 'collecting', stageLabel: 'Preparing export...', current: 0, total: 100, percentage: 0 });

    // Get timezone offset for filename
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);

    // Get timezone offset
    let timezoneOffset = 'UTC';
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset'
      });
      const parts = formatter.formatToParts(date);
      const offsetPart = parts.find(p => p.type === 'timeZoneName');
      if (offsetPart && offsetPart.value) {
        // Format like UTC+07 or UTC-05
        timezoneOffset = offsetPart.value.replace('GMT', 'UTC').replace(':', '');
      }
    } catch (e) {
      console.error('Error getting timezone offset:', e);
    }

    const filename = `Dashboard_Export_${dateStr}_${timezoneOffset}.xlsx`;

    addNotification(`Generating Excel file${includeImages ? ' with images' : ''}...`, 'info');

    exportDashboardToExcel(processedData, filename, includeImages, (progress) => {
      setExportProgress(progress);
    })
      .then(() => {
        addNotification('Export completed', 'success');
      })
      .catch((err) => {
        console.error(err);
        addNotification('Export failed', 'error');
      })
      .finally(() => {
        setIsExporting(false);
        setExportProgress(null);
      });
  };

  const performGlobalSearch = async (term: string) => {
    if (!term || !term.trim()) return;
    setIsProcessing(true);
    setSyncState('Searching globally...');
    try {
      const { searchGlobalRecords } = await import('../services/firebaseService');
      const results = await searchGlobalRecords(teamId, term);

      if (results.length > 0) {
        setRecords(results);
        addNotification(`Global Search: Found ${results.length} record(s) matching "${term}"`, 'success');
      } else {
        addNotification(`Global Search: No records found for "${term}"`, 'info');
      }
    } catch (e) {
      console.error(e);
      addNotification('Global Search failed', 'error');
    } finally {
      setIsProcessing(false);
      setSyncState(null);
    }
  };


  return (
    <DashboardContext.Provider value={{
      user, teamId, role, permissions, allowedAccounts,
      accounts: visibleAccounts, // Filtered for data display
      allAccounts, // All accounts (unfiltered)
      managementAccounts, // For MailManager - respects canManageSettings
      setAccounts: setAllAccounts,
      records, setRecords,
      manualCosts, setManualCosts,
      isLoading, isSyncing, isFetchingNewRange, syncState, syncProgress, accountSyncStatuses, isProcessing, isSavingAccounts,
      exportProgress, isExporting,
      showExportOptions, setShowExportOptions,
      handleSaveAccounts,
      handleSyncClick,
      handleResyncAccount,
      handleQuickSync,
      handleLogout: onLogout,
      handleExport,
      handleExportWithOptions,
      performGlobalSearch,
      processedData


    }}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const context = React.useContext(DashboardContext);
  if (context === undefined) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
};
