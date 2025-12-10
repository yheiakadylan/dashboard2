import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import { signOut, type User } from 'firebase/auth';
import { Record, Account, Tab, ProcessedData, CostData } from '../api/_lib/types';
import { processData } from '../utils/dataProcessing';
import {
  getAccountsFromFirebase,
  saveAccountsToFirebase,
  getRecordsForDateRange,
  saveRecordsToFirebase,
  updateAccountsInFirebase,
  deleteRecordsForAccounts,
  updateRecordsInFirebase,
  listenForNewRecords,
  auth,
  getManualCosts,
  addManualCost
} from '../services/firebaseService';
import { fetchAllRecords, checkEmailsExistInRange, setupGmailWatch } from '../services/emailService';
import { fetchCostsForRecords } from '../services/fulfillmentService';
import { useNotification } from './NotificationContext';
import { CacheService, getDashboardCacheKey, getAccountsCacheKey } from '../utils/cacheService';

interface DashboardContextType {
  accounts: Account[];
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  records: Record[];
  setRecords: React.Dispatch<React.SetStateAction<Record[]>>;
  activeTab: Tab;
  setActiveTab: React.Dispatch<React.SetStateAction<Tab>>;
  selectedAccountId: string;
  setSelectedAccountId: React.Dispatch<React.SetStateAction<string>>;
  filterDateRange: { from: string; to: string };
  setFilterDateRange: React.Dispatch<React.SetStateAction<{ from: string; to: string }>>;
  isLoading: boolean;
  isSyncing: boolean;
  isFetchingNewRange: boolean;
  isSavingAccounts: boolean;
  syncState: string | null;
  isAccountManagerOpen: boolean;
  setIsAccountManagerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dayFilter: string | null;
  setDayFilter: React.Dispatch<React.SetStateAction<string | null>>;
  processedData: ProcessedData;
  handleSaveAccounts: (updatedAccounts: Account[]) => Promise<void>;
  handleSyncClick: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleTabClick: (tab: Tab) => void;
  handleViewDayDetails: (date: string) => void;
  timeZone: string;
  setTimeZone: React.Dispatch<React.SetStateAction<string>>;
  user: User;
  teamId: string;
  role: 'owner' | 'user';
  permissions: { [key: string]: boolean };
  manualCosts: any[];
  setManualCosts: React.Dispatch<React.SetStateAction<any[]>>;
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  handleResyncAccount: (account: Account) => Promise<void>;
  handleQuickSync: (account: Account) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

interface DashboardProviderProps {
  children: ReactNode;
  user: User;
  teamId: string;
  role: 'owner' | 'user';
  permissions: { [key: string]: boolean };
  allowedAccounts?: string[];
}

export const DashboardProvider: React.FC<DashboardProviderProps> = ({ children, user, teamId, role, permissions, allowedAccounts }) => {
  const { addNotification } = useNotification(); // Use Notification Hook

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem('activeTab');
    const TABS: Tab[] = ['Overview', 'Order List', 'eBay', 'Etsy', 'Case', 'Help', 'Fulfill', 'Summary'];
    if (savedTab && TABS.includes(savedTab as Tab)) {
      return savedTab as Tab;
    }
    return 'Overview';
  });
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [records, setRecords] = useState<Record[]>([]);
  const [previousPeriodRecords, setPreviousPeriodRecords] = useState<Record[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isSavingAccounts, setIsSavingAccounts] = useState<boolean>(false);
  const [isFetchingNewRange, setIsFetchingNewRange] = useState<boolean>(false);

  // New State for Activity Indicator
  const [syncState, setSyncState] = useState<string | null>('Initializing...');

  const [isAccountManagerOpen, setIsAccountManagerOpen] = useState<boolean>(false);
  const isInitialMount = useRef(true);
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string>(() => {
    return localStorage.getItem('timeZone') || 'Asia/Ho_Chi_Minh';
  });
  const [manualCosts, setManualCosts] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [filterDateRange, setFilterDateRange] = useState(() => {
    // Try to restore from localStorage first
    const savedFilter = localStorage.getItem('filterDateRange');
    if (savedFilter) {
      try {
        const parsed = JSON.parse(savedFilter);
        // Validate that it has from and to properties
        if (parsed && parsed.from && parsed.to) {
          return parsed;
        }
      } catch (e) {
        // Ignore parsing errors and fall through to default
      }
    }

    // Default to today if no saved filter
    const getTodayInTimezone = (): Date => {
      const selectedTimeZone = localStorage.getItem('timeZone') || 'Asia/Ho_Chi_Minh';
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: selectedTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const [year, month, day] = formatter.format(new Date()).split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    };
    const todayInTimezone = getTodayInTimezone();
    const todayISO = todayInTimezone.toISOString().split('T')[0];
    return { from: todayISO, to: todayISO };
  });

  // 1. THÊM: Tạo ref để lưu hàng đợi promise
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  // 2. THÊM: Hàm helper để đẩy tác vụ vào hàng đợi
  const enqueueSyncTask = (taskName: string, task: () => Promise<void>) => {
    // Nối tiếp promise hiện tại với task mới
    syncQueueRef.current = syncQueueRef.current
      .then(async () => {
        console.log(`Starting queued task: ${taskName}`);
        await task();
      })
      .catch((err) => {
        console.error(`Error in queued task ${taskName}:`, err);
      });
  };

  useEffect(() => { localStorage.setItem('activeTab', activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem('timeZone', timeZone); }, [timeZone]);
  useEffect(() => { localStorage.setItem('filterDateRange', JSON.stringify(filterDateRange)); }, [filterDateRange]);

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
    setDayFilter(null);
  };

  const handleViewDayDetails = (date: string) => {
    setActiveTab('Order List');
    setDayFilter(date);
  };

  const visibleAccounts = useMemo(() => {
    if (role === 'owner') return allAccounts;
    if (!allowedAccounts || allowedAccounts.length === 0) return [];
    return allAccounts.filter(acc => allowedAccounts.includes(acc.email));
  }, [allAccounts, role, allowedAccounts]);

  useEffect(() => {
    if (!visibleAccounts.find(acc => acc.email === selectedAccountId) && selectedAccountId !== 'all') {
      setSelectedAccountId('all');
    }
  }, [visibleAccounts, selectedAccountId]);


  const runSync = useCallback(async (accountsForSync: Account[], existingRecords: Record[], overrideDateRange?: { from: string, to: string }): Promise<Record[]> => {
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
      let addedRecords: Record[] = [];
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
      addedRecords = await saveRecordsToFirebase(teamId, newRecordsWithCost);
      if (!overrideDateRange) {
        const updatedAccountsForFirebase = accountsForSync.map(acc => ({ ...acc, last_synced_at: syncStartTime }));
        await updateAccountsInFirebase(teamId, updatedAccountsForFirebase);
        setAllAccounts(prevAccounts => {
          const updatedAccountsMap = new Map(updatedAccountsForFirebase.map(acc => [acc.id, acc]));
          return prevAccounts.map(acc => updatedAccountsMap.get(acc.id) || acc);
        });
      }
      const totalRecordCount = existingRecords.length + addedRecords.length;
      if (addedRecords.length > 0 || updatedOldRecords.length > 0) {
        addNotification(`Sync complete. +${addedRecords.length} new, ${updatedOldRecords.length} updated.`, "success");
      } else {
        addNotification(`Sync complete. No new records found.`, "success");
      }
      setSyncState(null); // Clear header status
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

  const runHistoricalSync = useCallback(async (accountsToSync: Account[], initialRecords: Record[]) => {
    const accountsNeedingSync = accountsToSync.filter(a => !a.historical_sync_complete);
    if (accountsNeedingSync.length === 0) return;

    // Note: Historical sync updates syncState but keeps it quiet for Toast unless error/complete
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
          // setSyncState(`[${account.email}] Checking ${probeStartDate.toLocaleDateString()}...`);
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
      while (currentSyncEnd > finalSyncEnd) {
        const currentSyncStart = new Date(currentSyncEnd);
        currentSyncStart.setDate(currentSyncStart.getDate() - 7);

        const effectiveSyncStart = currentSyncStart < finalSyncEnd ? finalSyncEnd : currentSyncStart;
        const dateRange = { from: effectiveSyncStart.toISOString(), to: currentSyncEnd.toISOString() };

        setSyncState(`[${account.email}] History: ${effectiveSyncStart.toLocaleDateString()} - ${currentSyncEnd.toLocaleDateString()}`);

        try {
          // Hàm này sẽ gọi saveRecordsToFirebase ngay sau khi fetch xong 
          const fetchedChunk = await runSync([account], currentExistingRecords, dateRange);

          if (fetchedChunk.length > 0) currentExistingRecords.push(...fetchedChunk);

          const newSyncedUntil = effectiveSyncStart.toISOString();
          const accountUpdate = { id: account.id, history_synced_until: newSyncedUntil };
          await updateAccountsInFirebase(teamId, [accountUpdate]);

          setAllAccounts(prevAccounts => prevAccounts.map(acc => acc.id === account.id ? { ...acc, history_synced_until: newSyncedUntil } : acc));
          currentSyncEnd = effectiveSyncStart;
          // -Cho trình duyệt nghỉ 1 chút để không bị treo UI ---
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (chunkError: any) {
          console.error(`Error syncing history chunk for ${account.email}`, chunkError);
          addNotification(`[${account.email}] History sync paused: ${chunkError.message}`, "error");
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
    setSyncState(null); // Finished background sync
  }, [runSync, teamId, addNotification]);

  useEffect(() => {
    if (!user) return;
    const loadInitialData = async () => {
      setIsLoading(true);
      setSyncState('Loading data...');
      try {
        // Try to get cached data first (stale-while-revalidate pattern)
        const cacheKey = getDashboardCacheKey(teamId, filterDateRange.from, filterDateRange.to);
        const accountsCacheKey = getAccountsCacheKey(teamId);

        const cachedResult = await CacheService.getStale<{
          accounts: Account[];
          records: Record[];
          manualCosts: any[];
        }>(cacheKey);

        if (cachedResult) {
          // Show cached data immediately
          setAllAccounts(cachedResult.data.accounts);
          setRecords(cachedResult.data.records);
          setManualCosts(cachedResult.data.manualCosts);
          setIsLoading(false);
          setSyncState(cachedResult.isStale ? 'Refreshing data...' : null);

          // If cache is fresh, skip refetch
          if (!cachedResult.isStale) {
            // Still set up webhooks and auto-sync in background
            cachedResult.data.accounts.forEach(acc => {
              if (acc.provider === 'gmail') {
                setupGmailWatch(teamId, acc).catch(err => console.error(`Failed to initialize webhook for ${acc.email}:`, err));
              }
            });
            return;
          }
        }

        // Fetch fresh data from Firebase
        const [fbAccounts, initialDisplayRecords, manualCostEntries] = await Promise.all([
          getAccountsFromFirebase(teamId),
          getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone),
          getManualCosts(teamId)
        ]);

        // Update cache with fresh data
        await CacheService.set(cacheKey, {
          accounts: fbAccounts,
          records: initialDisplayRecords,
          manualCosts: manualCostEntries
        });

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
        if (fbAccounts.length > 0) {
          setSyncState('Auto-syncing...');
          runSync(fbAccounts, initialDisplayRecords).then(async (addedRecords) => {
            const updatedDisplayRecords = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
            setRecords(updatedDisplayRecords);

            // Update cache after sync
            await CacheService.set(cacheKey, {
              accounts: fbAccounts,
              records: updatedDisplayRecords,
              manualCosts: manualCostEntries
            });

            const latestAccounts = await getAccountsFromFirebase(teamId);
            setAllAccounts(latestAccounts);
            const accountsForHistoricalSync = latestAccounts.filter(acc => !acc.historical_sync_complete);
            if (accountsForHistoricalSync.length > 0) { runHistoricalSync(accountsForHistoricalSync, updatedDisplayRecords); }
          }).catch(error => {
            console.error("Failed during initial sync:", error);
            addNotification("Initial sync encountered an error.", "error");
          });
        }
      } catch (error) {
        console.error("Failed to load initial data:", error);
        addNotification("Could not load data from Firebase.", "error");
        setIsLoading(false);
        setSyncState(null);
      }
    };
    loadInitialData();
  }, [user, teamId]);

  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    if (!user) return;
    setDayFilter(null);
    const fetchDataForRange = async () => {
      setIsFetchingNewRange(true);
      setSyncState('Fetching...');
      const { from, to } = filterDateRange;

      // Try cache first with stale-while-revalidate
      const cacheKey = getDashboardCacheKey(teamId, from, to);
      const cachedResult = await CacheService.getStale<{
        currentRecords: Record[];
        previousRecords: Record[] | null;
      }>(cacheKey);

      if (cachedResult) {
        // Show cached data immediately
        setRecords(cachedResult.data.currentRecords);
        setPreviousPeriodRecords(cachedResult.data.previousRecords);
        setIsFetchingNewRange(false);
        setSyncState(cachedResult.isStale ? 'Refreshing...' : null);

        // If fresh, no need to refetch
        if (!cachedResult.isStale) {
          return;
        }
      }

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

        // Update cache with fresh data
        await CacheService.set(cacheKey, {
          currentRecords: fbRecords,
          previousRecords: prevRecords
        });

        setRecords(fbRecords);
        setPreviousPeriodRecords(prevRecords);
      } catch (error) {
        console.error("Failed to fetch records for range:", error);
        addNotification('Error loading records for this range.', "error");
      } finally {
        setIsFetchingNewRange(false);
        setSyncState(null);
      }
    };
    fetchDataForRange();
  }, [filterDateRange, user, timeZone, teamId, addNotification]);

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

  const handleSyncClick = async () => {
    if (isSyncing || !user) return;
    const accountsToSync = selectedAccountId === 'all' ? visibleAccounts : visibleAccounts.filter(acc => acc.email === selectedAccountId);
    if (accountsToSync.length === 0) { addNotification("No accounts selected for syncing.", "info"); return; }

    // Invalidate cache before sync
    const cacheKey = getDashboardCacheKey(teamId, filterDateRange.from, filterDateRange.to);
    await CacheService.invalidate(cacheKey);

    runSync(accountsToSync, records).then(async () => {
      setSyncState('Refreshing view...');
      const updatedDisplayRecords = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
      setRecords(updatedDisplayRecords);

      // Update cache with fresh synced data
      await CacheService.set(cacheKey, {
        currentRecords: updatedDisplayRecords,
        previousRecords: previousPeriodRecords
      });

      setSyncState(null);
    });
  };

  const handleResyncAccount = async (account: Account) => {
    if (!user) return;

    // Đẩy việc re-sync vào hàng đợi thay vì chạy ngay lập tức (await trực tiếp)
    enqueueSyncTask(`Resync ${account.email}`, async () => {
      const resetData = {
        id: account.id,
        historical_sync_complete: false,
        history_synced_until: null,
        last_synced_at: null,
        scan_start_date: null
      };

      try {
        setSyncState(`[Queue] Resetting ${account.email}...`);
        await updateAccountsInFirebase(teamId, [resetData]);
        const updatedAccount = { ...account, ...resetData } as Account;

        // Cập nhật state local ngay để UI hiển thị spinner
        setAllAccounts(prev => prev.map(a => a.id === account.id ? updatedAccount : a));

        setSyncState(`[Queue] Starting re-sync for ${account.email}...`);

        // Chạy sync (đã được bọc trong queue nên an toàn)
        const initialRecords = await runSync([updatedAccount], records);

        // Chạy historical sync (cũng nằm trong luồng tuần tự này)
        await runHistoricalSync([updatedAccount], [...records, ...initialRecords]);

        addNotification(`Re-sync finished for ${account.email}`, "success");
      } catch (error: any) {
        console.error("Resync error:", error);
        addNotification(`Failed to re-sync ${account.email}`, "error");
      } finally {
        setSyncState(null);
      }
    });

    // Thông báo cho user biết là đã tiếp nhận lệnh
    addNotification(`Queued re-sync for ${account.email}. It will start soon.`, "info");
  };

  const handleQuickSync = async (account: Account) => {
    if (!user) return;

    // Tính toán khoảng thời gian 7 ngày
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);

    const dateRange = {
      from: fromDate.toISOString(),
      to: toDate.toISOString()
    };

    // Đẩy vào hàng đợi để tránh treo máy nếu bấm nhiều lần
    enqueueSyncTask(`Quick Sync 7 Days - ${account.email}`, async () => {
      try {
        setSyncState(`[Queue] Syncing last 7 days for ${account.email}...`);

        // Gọi runSync với overrideDateRange
        await runSync([account], records, dateRange);

        addNotification(`Synced last 7 days for ${account.email} successfully.`, "success");
      } catch (error: any) {
        console.error("Quick sync error:", error);
        addNotification(`Failed to sync ${account.email}: ${error.message}`, "error");
      } finally {
        setSyncState(null);
      }
    });

    addNotification(`Queued 7-day sync for ${account.email}.`, "info");
  };

  const handleSaveAccounts = async (updatedAccounts: Account[]) => {
    if (!user) return;
    setIsSavingAccounts(true);
    setSyncState('Saving accounts...');
    try {
      const originalAccounts = [...allAccounts]; const originalRecords = [...records];
      const deletedAccounts = originalAccounts.filter(acc => !updatedAccounts.some(upd => upd.id === acc.id));
      const deletedAccountEmails = deletedAccounts.map(acc => acc.email);
      let nextRecords = originalRecords;
      if (deletedAccounts.length > 0) {
        setSyncState(`Deleting records for ${deletedAccounts.length} account(s)...`);
        await deleteRecordsForAccounts(teamId, deletedAccountEmails);
        nextRecords = originalRecords.filter(r => !deletedAccountEmails.includes(r.account));
        setRecords(nextRecords);
      }
      await saveAccountsToFirebase(teamId, updatedAccounts);
      setAllAccounts(updatedAccounts);
      setIsAccountManagerOpen(false);
      addNotification('Accounts saved successfully.', "success");

      const newAccounts = updatedAccounts.filter(acc => !originalAccounts.some(orig => orig.id === acc.id));
      if (newAccounts.length > 0) {
        setSyncState(`Syncing new account(s)...`);
        newAccounts.forEach(acc => {
          if (acc.provider === 'gmail') {
            setupGmailWatch(teamId, acc).catch(err => console.error(`Failed to set up webhook for new account ${acc.email}:`, err));
          }
        });

        runSync(newAccounts, nextRecords).then(async (initialSyncRecords) => {
          try {
            const updatedDisplayRecords = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
            setRecords(updatedDisplayRecords);
            runHistoricalSync(newAccounts, updatedDisplayRecords);
          } catch (fetchErr) {
            console.error("Failed to refresh records after new account sync:", fetchErr);
            runHistoricalSync(newAccounts, [...nextRecords, ...initialSyncRecords]);
          }
        }).catch(err => {
          console.error("Error during initial 7-day sync:", err);
          addNotification(`Error during initial sync: ${err.message}`, "error");
        });
      }
      setSyncState(null);
    } catch (error) {
      console.error("Failed to save accounts:", error);
      addNotification('Error saving accounts.', "error");
      setSyncState(null);
    } finally {
      setIsSavingAccounts(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAllAccounts([]); setRecords([]); setSelectedAccountId('all'); setActiveTab('Overview');
      setSyncState(null);
    } catch (error) {
      console.error("Logout failed:", error); addNotification("Failed to log out.", "error");
    }
  };

  const filteredRecords = useMemo(() => {
    // Safety check: return empty array if records not loaded yet
    if (!records || !Array.isArray(records)) {
      return [];
    }

    const allowedEmails = new Set(visibleAccounts.map(a => a.email));
    let baseFiltered = records.filter(record => allowedEmails.has(record.account));

    // 1. Account Filter
    if (selectedAccountId !== 'all') {
      baseFiltered = baseFiltered.filter(record => record.account === selectedAccountId);
    }

    // 2. Search Filter (Global)
    if (searchTerm.trim()) {
      const lowerTerm = searchTerm.toLowerCase();
      baseFiltered = baseFiltered.filter(r => {
        const oid = (r.order_id || '').toLowerCase();
        const custName = (r.details?.customerName || '').toLowerCase();
        const custEmail = (r.details?.customerEmail || '').toLowerCase();
        const prodName = (r.product_name || r.details?.items?.[0]?.name || '').toLowerCase();
        const ffCode = (r.ff_code || '').toLowerCase();

        return oid.includes(lowerTerm) ||
          custName.includes(lowerTerm) ||
          custEmail.includes(lowerTerm) ||
          prodName.includes(lowerTerm) ||
          ffCode.includes(lowerTerm);
      });
    }
    return baseFiltered;
  }, [records, visibleAccounts, selectedAccountId, searchTerm]);

  const processedData = useMemo(() => {
    return processData(
      filteredRecords,
      previousPeriodRecords,
      visibleAccounts,
      filterDateRange,
      timeZone,
      role,
      permissions,
      manualCosts
    );
  }, [filteredRecords, previousPeriodRecords, visibleAccounts, filterDateRange, timeZone, role, permissions, manualCosts]);

  const value = {
    accounts: visibleAccounts, // Use visibleAccounts instead of allAccounts for user role filtering
    setAccounts: setAllAccounts,
    records: filteredRecords,
    setRecords,
    activeTab,
    setActiveTab,
    selectedAccountId,
    setSelectedAccountId,
    filterDateRange,
    setFilterDateRange,
    isLoading,
    isSyncing,
    isFetchingNewRange,
    isSavingAccounts,
    syncState,
    isAccountManagerOpen,
    setIsAccountManagerOpen,
    dayFilter,
    setDayFilter,
    processedData,
    handleSaveAccounts,
    handleSyncClick,
    handleLogout,
    handleTabClick,
    handleViewDayDetails,
    timeZone,
    setTimeZone,
    user,
    teamId,
    role,
    permissions,
    manualCosts,
    setManualCosts,
    searchTerm,
    setSearchTerm,
    handleResyncAccount,
    handleQuickSync
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
};