import React, { useState, useEffect, useMemo, useRef, createContext } from 'react';
import { Record, Account, ProcessedData, ManualCost, UserProfile, Category, ProductMapping } from '../types';
import {
  saveAccountsToFirebase,
  deleteRecordsForAccounts,
  getRecordsForDateRange
} from '../services/firebaseService';
import type { ExportProgress } from '../utils/excelExport';
import { setupGmailWatch } from '../services/emailService';
import { useNotification } from './NotificationContext';
import { User } from 'firebase/auth';
import { useDataSync } from '../hooks/useDataSync';
import { useRecordFiltering } from '../hooks/useRecordFiltering';
import { useAutoSync } from '../hooks/useAutoSync';
import { useExchangeRates } from '../hooks/useExchangeRates';


// Default Tab List
// const DEFAULT_TABS: Tab[] = ['Overview', 'Order List', 'Products', 'Case', 'Help', 'Fulfill']; // Unused

interface DashboardContextType {
  // Auth & Permissions
  user: User;
  teamId: string;
  role: 'owner' | 'user';
  permissions: { [key: string]: boolean };
  allowedAccounts?: string[]; // For shop-level access control
  filterDateRange: { from: string; to: string };
  timeZone: string;

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

  // Board Selection (Owner Only)
  boards: UserProfile[];
  selectedBoardId: string | null;
  setSelectedBoardId: React.Dispatch<React.SetStateAction<string | null>>;
  refreshBoards: () => Promise<void>;





  // Actions
  handleSaveAccounts: (updatedAccounts: Account[], explicitlyRemovedIds?: string[]) => Promise<void>;
  handleSyncClick: () => Promise<void>;
  handleResyncAccount: (account: Account, ruleNames?: string[]) => Promise<void>;
  handleQuickSync: (account: Account, ruleNames?: string[]) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleExport: () => void;
  handleExportWithOptions: (includeImages: boolean) => void;
  performGlobalSearch: (term: string) => Promise<void>;
  clearGlobalSearch: () => void;




  processedData: ProcessedData;
  exchangeRates: { [key: string]: number } | null;
  updateRate: (currency: string, rate: number) => void;
  resetRates: () => void;
  refreshRates: () => Promise<void>;
  nextUpdateTime: Date | null;

  // Category & Mapping
  categories: Category[];
  productMappings: ProductMapping[];
  refreshCategories: () => Promise<void>;
  refreshMappings: () => Promise<void>;
  updateMapping: (mapping: ProductMapping) => Promise<void>;
  createCategory: (category: { code: string, name: string }) => Promise<void>;
  bulkSaveCategories: (categories: { code: string, name: string, oldCode?: string }[]) => Promise<void>;
  bulkUpdateMappings: (mappings: ProductMapping[]) => Promise<void>;
  listingsMapping: { imageMap: { [key: string]: string }, nameMap: { [key: string]: string } } | null;
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
  globalUsdMode: boolean;
}

export const DashboardProvider: React.FC<DashboardProviderProps> = ({
  children, user, teamId, role, permissions, allowedAccounts, onLogout,
  timeZone, filterDateRange, selectedAccountId, searchTerm, globalUsdMode
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

  const { rates: exchangeRates, updateRate, resetRates, refreshRates, nextUpdateTime } = useExchangeRates();

  // --- Auto-Sync to Google Sheets ---
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  // Listen to auto-sync settings changes in real-time
  useEffect(() => {
    if (!teamId) return;

    let unsubscribe: (() => void) | undefined;
    let isMounted = true;

    import('../services/firebaseService').then(({ listenForSettings }) => {
      if (!isMounted) return;
      unsubscribe = listenForSettings(teamId, (settings) => {
        if (settings.autoSyncToSheet !== undefined) {
          setAutoSyncEnabled(settings.autoSyncToSheet);
          console.log(`[Auto-Sync] Settings updated: ${settings.autoSyncToSheet ? 'ENABLED' : 'DISABLED'}`);
        }
      });
    });

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
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



  // --- 4. Logic Functions ---

  // Board Logic
  const [boards, setBoards] = useState<UserProfile[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  const refreshBoards = React.useCallback(async () => {
    if (role === 'owner' && teamId) {
      const { getTeamMembers } = await import('../services/firebaseService');
      const fetchedBoards = await getTeamMembers(teamId);
      setBoards(fetchedBoards);
    }
  }, [role, teamId]);

  useEffect(() => {
    refreshBoards();
  }, [refreshBoards]);

  // --- Category & Mapping Logic ---
  const [categories, setCategories] = useState<Category[]>([]);
  const [productMappings, setProductMappings] = useState<ProductMapping[]>([]);

  const refreshCategories = React.useCallback(async () => {
    if (teamId) {
      const { getCategories } = await import('../services/firebaseService');
      const fetched = await getCategories(teamId);
      setCategories(fetched);
    }
  }, [teamId]);

  const refreshMappings = React.useCallback(async () => {
    if (teamId) {
      const { getProductMappings } = await import('../services/firebaseService');
      const fetched = await getProductMappings(teamId);
      setProductMappings(fetched);
    }
  }, [teamId]);

  // --- Listing Mapping Logic ---
  const [listingsMapping, setListingsMapping] = useState<{ imageMap: { [key: string]: string }, nameMap: { [key: string]: string } } | null>(null);

  const refreshListingsMapping = React.useCallback(async () => {
    if (teamId && allAccounts.length > 0) {
      const { getListingMappingMaps } = await import('../services/listingService');
      const etsyAccountIds = allAccounts.filter(a => a.platforms?.includes('etsy')).map(a => a.id);
      if (etsyAccountIds.length > 0) {
        const mapping = await getListingMappingMaps(teamId, etsyAccountIds);
        if (import.meta.env.DEV) {
          console.log('[DashboardContext] Listing Mapping fetched:', 
            Object.keys(mapping.imageMap).length, 'images,', 
            Object.keys(mapping.nameMap).length, 'names');
        }
        setListingsMapping(mapping);
      }
    }
  }, [teamId, allAccounts.length]); // Re-fetch only if account count changes or team changes

  useEffect(() => {
    refreshListingsMapping();
  }, [refreshListingsMapping]);

  useEffect(() => {
    refreshCategories();
    refreshMappings();
  }, [refreshCategories, refreshMappings]);

  const updateMapping = async (mapping: ProductMapping) => {
    if (!teamId) return;
    const { saveProductMapping } = await import('../services/firebaseService');
    await saveProductMapping(teamId, mapping);
    await refreshMappings();
  };

  const createCategory = async (category: { code: string, name: string }) => {
    if (!teamId) return;
    const { saveCategory } = await import('../services/firebaseService');
    await saveCategory(teamId, category);
    await refreshCategories();
  };

  const bulkSaveCategories = async (categoriesToSave: { code: string, name: string, oldCode?: string }[]) => {
    if (!teamId) return;
    const { saveCategoriesBulk, saveProductMappingsBulk } = await import('../services/firebaseService');
    
    // Detect renames (where code changed)
    const renames = categoriesToSave.filter(c => c.oldCode && c.oldCode !== c.code);
    
    if (renames.length > 0) {
      setSyncState('Updating product mappings...');
      const mappingsToUpdate: ProductMapping[] = [];
      
      renames.forEach(rename => {
        // Find all mappings that used the old code
        productMappings.forEach(mapping => {
          if (mapping.category_code === rename.oldCode) {
            mappingsToUpdate.push({
              ...mapping,
              category_code: rename.code
            });
          }
        });
      });
      
      if (mappingsToUpdate.length > 0) {
        await saveProductMappingsBulk(teamId, mappingsToUpdate);
        await refreshMappings();
      }
    }

    setSyncState('Saving categories...');
    await saveCategoriesBulk(teamId, categoriesToSave);
    await refreshCategories();
    setSyncState(null);
  };

  const bulkUpdateMappings = async (mappings: ProductMapping[]) => {
    if (!teamId) return;
    const { saveProductMappingsBulk } = await import('../services/firebaseService');
    await saveProductMappingsBulk(teamId, mappings);
    await refreshMappings();
  };

  // Computed Visible Accounts (for data display)
  const visibleAccounts = useMemo(() => {
    // Owner Logic
    if (role === 'owner') {
      // If a board is selected, filter by that board's allowedAccounts
      if (selectedBoardId) {
        const selectedBoard = boards.find(b => b.uid === selectedBoardId);
        if (selectedBoard && selectedBoard.allowedAccounts && selectedBoard.allowedAccounts.length > 0) {
          return allAccounts.filter(acc => selectedBoard.allowedAccounts!.includes(acc.email));
        }
        return [];
      }
      return allAccounts;
    }

    // Regular User Logic
    if (!allowedAccounts || allowedAccounts.length === 0) return [];
    return allAccounts.filter(acc => allowedAccounts.includes(acc.email));
  }, [allAccounts, role, allowedAccounts, selectedBoardId, boards]);

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
    fulfill: { table: { headers: [], rows: [] }, merchizeChartData: [], printwayChartData: [], allProductChartData: [], refundedChartData: [], totalCost: 0, refundRate: 0 },
    summary: {
      kpis: {},
      table: { headers: [], rows: [] },
      chartData: [],
      topProductsByShop: {},
      topProductsByCategory: {},
      topProductsBySize: {},
      categoryComparison: [],
      unmappedKeywords: []
    },
    products: { headers: [], rows: [] }
  };

  const [processedData, setProcessedData] = useState<ProcessedData>(initialProcessedData);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSavingAccounts, setIsSavingAccounts] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [showExportOptions, setShowExportOptions] = useState<boolean>(false);

  // Clear processed data when fetching a new range to prevent flashing old data
  // while the worker is busy processing the new data.
  useEffect(() => {
    if (isFetchingNewRange) {
      setProcessedData(initialProcessedData);
    }
  }, [isFetchingNewRange]);


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

  // Use a ref to hold the absolute stable version of accounts (by content)
  // This prevents filteredRecords from changing reference if the content is same
  const stableAccountsRef = useRef(processingAccounts);
  const stableProcessingAccounts = useMemo(() => {
    const isDifferent = JSON.stringify(processingAccounts) !== JSON.stringify(stableAccountsRef.current);
    if (isDifferent) {
      stableAccountsRef.current = processingAccounts;
    }
    return stableAccountsRef.current;
  }, [processingAccounts]);

  const processingAccountsHash = useMemo(() => JSON.stringify(stableProcessingAccounts), [stableProcessingAccounts]);

  // --- STABILIZE OTHER DEPENDENCIES ---
  const stableManualCostsRef = useRef(manualCosts);
  const stableManualCosts = useMemo(() => {
    const isDifferent = JSON.stringify(manualCosts) !== JSON.stringify(stableManualCostsRef.current);
    if (isDifferent) {
      stableManualCostsRef.current = manualCosts;
    }
    return stableManualCostsRef.current;
  }, [manualCosts]);

  const stableMappingsRef = useRef(productMappings);
  const stableMappings = useMemo(() => {
    const isDifferent = JSON.stringify(productMappings) !== JSON.stringify(stableMappingsRef.current);
    if (isDifferent) {
      stableMappingsRef.current = productMappings;
    }
    return stableMappingsRef.current;
  }, [productMappings]);

  const stableRatesRef = useRef(exchangeRates);
  const stableRates = useMemo(() => {
    const isDifferent = JSON.stringify(exchangeRates) !== JSON.stringify(stableRatesRef.current);
    if (isDifferent) {
      stableRatesRef.current = exchangeRates;
    }
    return stableRatesRef.current;
  }, [exchangeRates]);


  // Filter Records for Display/Processing
  // Use stableProcessingAccounts to prevent re-filtering (and re-processing) when only timestamps change
  const filteredRecords = useRecordFiltering({
    records,
    accounts: stableProcessingAccounts as Account[], // Use memoized stable version
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
    rates: any;
    mappings: any;
    categories: any;
  }>({
    records: null,
    prevRecords: null,
    accountsHash: '',
    filter: null,
    tz: '',
    manual: null,
    rates: null, // This will store the stableRates reference
    mappings: null,
    categories: null
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
      manual: manualCosts,
      rates: exchangeRates,
      mappings: productMappings,
      categories: categories
    };

    // Optimized comparison to avoid redundant worker runs
    const prevTrigger = lastTriggeredRef.current;

    // Deep compare rates as they are rarely changed but new objects
    const ratesChanged = JSON.stringify(exchangeRates) !== JSON.stringify(prevTrigger.rates);

    if (
      filteredRecords === prevTrigger.records &&
      previousPeriodRecords === prevTrigger.prevRecords &&
      processingAccountsHash === prevTrigger.accountsHash &&
      filterDateRange === prevTrigger.filter &&
      timeZone === prevTrigger.tz &&
      stableManualCosts === prevTrigger.manual &&
      stableRates === prevTrigger.rates &&
      stableMappings === prevTrigger.mappings &&
      categories === prevTrigger.categories
    ) {
      return;
    }

    lastTriggeredRef.current = {
      records: filteredRecords,
      prevRecords: previousPeriodRecords,
      accountsHash: processingAccountsHash,
      filter: filterDateRange,
      tz: timeZone,
      manual: stableManualCosts,
      rates: stableRates,
      mappings: stableMappings,
      categories: categories
    };

    // Set processing state
    setIsProcessing(true);

    // Safety timeout: If worker doesn't respond in 15s, force unlock UI
    const safetyTimeout = setTimeout(() => {
      if (isProcessingRef.current) {
        console.warn("Worker timed out, forcing UI unlock.");
        setIsProcessing(false);
      }
    }, 15000);

    // Increment request ID
    workerRequestIdRef.current += 1;
    const currentRequestId = workerRequestIdRef.current;

    // Use stable accounts for worker
    workerRef.current.postMessage({
      requestId: currentRequestId,
      records: filteredRecords,
      previousRecords: previousPeriodRecords,
      accounts: stableProcessingAccounts,
      filterDateRange,
      timeZone,
      role,
      permissions,
      manualCosts: stableManualCosts,
      exchangeRates: stableRates,
      productMappings: stableMappings,
      categories: categories,
      listingsMapping: listingsMapping // PASS LISTING MAPPING TO WORKER
    });

    return () => clearTimeout(safetyTimeout);
  }, [filteredRecords, previousPeriodRecords, processingAccountsHash, filterDateRange, timeZone, role, permissions, manualCosts, exchangeRates, productMappings, categories, listingsMapping]);



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

  const handleResyncAccount = async (account: Account, ruleNames?: string[]) => {
    if (!user) return;
    const taskTitle = ruleNames ? `Resync ${account.email} (${ruleNames.length} rules)` : `Resync ${account.email}`;
    enqueueSyncTask(taskTitle, async () => {
      try {
        setSyncState(`[Queue] Resetting ${account.email}...`);

        // If full re-sync (no rule names), reset history flags. 
        // If custom sync (specific rules), we might NOT want to reset history flags fully? 
        // User asked: "re-sync này gồm sync last 7d và history sync luôn".
        // If we don't reset flags, runHistoricalSync might skip if it thinks it's complete.
        // But runHistoricalSync logic checks `historical_sync_complete`.
        // If we want to force re-run history for specific rules, we might need to trick it or just run it regardless of flag?
        // Actually, runHistoricalSync has a check: `if (accountsNeedingSync.length === 0) return;`
        // We should probably reset the flag so it runs.

        const resetData = { id: account.id, historical_sync_complete: false, history_synced_until: undefined, last_synced_at: undefined, scan_start_date: undefined };
        await saveAccountsToFirebase(teamId, [{ ...account, ...resetData }]);

        const updatedAccount = { ...account, ...resetData };
        setAllAccounts(prev => prev.map(a => a.id === account.id ? updatedAccount : a));

        setSyncState(`[Queue] Syncing ${account.email}...`);

        // 1. Run "Last 7 Days" / Recent Sync
        const initialRecords = await runSync([updatedAccount], records, undefined, undefined, undefined, false, ruleNames);

        // 2. Run Historical Sync
        await runHistoricalSync([updatedAccount], [...records, ...initialRecords], undefined, ruleNames);

        addNotification(`Re-sync finished for ${account.email}`, "success");
      } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        addNotification(`Failed to re-sync ${account.email}: ${errorMessage}`, "error");
      } finally { setSyncState(null); }
    });
    addNotification(`Queued re-sync for ${account.email}`, "info");
  };

  const handleQuickSync = async (account: Account, ruleNames?: string[]) => {
    if (!user) return;
    const toDate = new Date();
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - 7);
    const range = { from: fromDate.toISOString(), to: toDate.toISOString() };

    const taskTitle = ruleNames ? `Quick Sync ${account.email} (${ruleNames.length} rules)` : `Quick Sync ${account.email}`;
    enqueueSyncTask(taskTitle, async () => {
      try {
        setSyncState(`[Queue] Quick sync ${account.email}...`);
        await runSync([account], records, range, undefined, undefined, false, ruleNames);
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

    // Dynamic import to reduce initial bundle size
    import('../utils/excelExport').then(({ exportDashboardToExcel }) => {
      exportDashboardToExcel(processedData, filename, includeImages, globalUsdMode, exchangeRates, (progress) => {
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

  const clearGlobalSearch = () => {
    // Reload records for current date range
    const fetchData = async () => {
      setIsProcessing(true);
      try {
        const { getRecordsForDateRange } = await import('../services/firebaseService');
        const data = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
        setRecords(data);
      } catch (error) {
        console.error('Error reloading records:', error);
      } finally {
        setIsProcessing(false);
      }
    };
    fetchData();
  };


  return (
    <DashboardContext.Provider value={{
      user, teamId, role, permissions, allowedAccounts, filterDateRange, timeZone,
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
      clearGlobalSearch,
      processedData,
      exchangeRates,
      updateRate,
      resetRates,
      refreshRates,
      nextUpdateTime,

      boards,
      selectedBoardId,
      setSelectedBoardId,
      refreshBoards,

      categories,
      productMappings,
      refreshCategories,
      refreshMappings,
      updateMapping,
      createCategory,
      bulkSaveCategories,
      bulkUpdateMappings,
      listingsMapping
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
