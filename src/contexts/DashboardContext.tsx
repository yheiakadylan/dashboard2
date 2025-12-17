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

// Default Tab List
// Default Tab List
// const DEFAULT_TABS: Tab[] = ['Overview', 'Order List', 'Products', 'Case', 'Help', 'Fulfill']; // Unused

interface DashboardContextType {
  // Auth & Permissions
  user: User;
  teamId: string;
  role: 'owner' | 'user';
  permissions: { [key: string]: boolean };

  // Data State (from useDataSync)
  accounts: Account[];
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
  isProcessing: boolean;
  isSavingAccounts: boolean;
  exportProgress: ExportProgress | null;
  isExporting: boolean;
  showExportOptions: boolean;
  setShowExportOptions: React.Dispatch<React.SetStateAction<boolean>>;




  // Actions
  handleSaveAccounts: (updatedAccounts: Account[]) => Promise<void>;
  handleSyncClick: () => Promise<void>;
  handleResyncAccount: (account: Account) => Promise<void>;
  handleQuickSync: (account: Account) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleExport: () => void;
  handleExportWithOptions: (includeImages: boolean) => void;




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
    runSync,
    runHistoricalSync,
    enqueueSyncTask
  } = useDataSync({
    user,
    teamId,
    filterDateRange,
    timeZone,
    addNotification
  });

  // --- 4. Logic Functions ---




  // Computed Visible Accounts
  const visibleAccounts = useMemo(() => {
    if (role === 'owner') return allAccounts;
    if (!allowedAccounts || allowedAccounts.length === 0) return [];
    return allAccounts.filter(acc => allowedAccounts.includes(acc.email));
  }, [allAccounts, role, allowedAccounts]);

  // We need these props from UIContext? No, DashboardContext should only care about data.
  // Actually, filtering logs often depends on UI state (filterDateRange).
  // So we should ACCEPT these as props or dependencies, or move filtering to UI layer?
  // Ideally: DashboardContext provides RAW data, specific views filter it.
  // BUT the worker needs filterDateRange to optimize.
  // TEMPORARY FIX: We will accept these as arguments in hooks or context?
  // Problem: useDataSync needs filterDateRange.
  // SOLUTION: We will inject the filter params into DashboardContext from App (via UIContext) OR
  // we let DashboardContext consume UIContext?
  // Circular dependency risk: DashboardContext -> UIContext -> (maybe) DashboardContext.
  // Better: App passes these values down to DashboardProvider?
  // Let's modify DashboardProviderProps.

  // NOTE: For this step I am deleting the state definitions but I need to get them from somewhere
  // to pass to useDataSync.
  // I will update DashboardProvider to accept `filterDateRange`, `timeZone` etc as props from App wrapper.



  // Filter Records for Display/Processing
  const filteredRecords = useRecordFiltering({
    records,
    accounts: visibleAccounts,
    selectedAccountId,
    searchTerm
  });




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

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/dataWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      const { success, data, error } = e.data;
      if (success) setProcessedData(data);
      else console.error("Worker Error:", error);
      setIsProcessing(false);
    };
    return () => workerRef.current?.terminate();
  }, []);


  useEffect(() => {
    if (!workerRef.current) return;

    workerRef.current.postMessage({
      records: filteredRecords,
      previousRecords: previousPeriodRecords,
      accounts: visibleAccounts,
      filterDateRange,
      timeZone,
      role,
      permissions,
      manualCosts
    });
  }, [filteredRecords, previousPeriodRecords, visibleAccounts, filterDateRange, timeZone, role, permissions, manualCosts]);


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

  const handleSaveAccounts = async (updatedAccounts: Account[]) => {
    if (!user) return;
    setIsSavingAccounts(true);
    setSyncState('Saving accounts...');
    try {

      const originalAccounts = [...allAccounts];
      const originalRecords = [...records];

      // Detect deletions
      const deletedAccounts = originalAccounts.filter(acc => !updatedAccounts.some(u => u.id === acc.id));
      const deletedEmails = deletedAccounts.map(a => a.email);

      let nextRecords = originalRecords;
      if (deletedAccounts.length > 0) {
        setSyncState(`Cleaning up ${deletedAccounts.length} accounts...`);
        await deleteRecordsForAccounts(teamId, deletedEmails);
        nextRecords = originalRecords.filter(r => !deletedEmails.includes(r.account));
        setRecords(nextRecords);
      }

      await saveAccountsToFirebase(teamId, updatedAccounts);
      setAllAccounts(updatedAccounts);
      // setIsAccountManagerOpen(false); // REMOVED: UI Action should be handled by caller
      addNotification('Accounts saved.', "success");


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


  return (
    <DashboardContext.Provider value={{
      user, teamId, role, permissions,
      accounts: visibleAccounts, setAccounts: setAllAccounts,
      records, setRecords,
      manualCosts, setManualCosts,
      isLoading, isSyncing, isFetchingNewRange, syncState, isProcessing, isSavingAccounts,
      exportProgress, isExporting,
      showExportOptions, setShowExportOptions,
      handleSaveAccounts,
      handleSyncClick,
      handleResyncAccount,
      handleQuickSync,
      handleLogout: onLogout,
      handleExport,
      handleExportWithOptions,
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
