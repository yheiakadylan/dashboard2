import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUIFilters, useUILayout, useUIModals, useUISettings, useUITabs } from '../../contexts/UIContext';
import { LayoutDashboard, Users, ChevronDown, Check, LogOut, Settings } from 'lucide-react';

import { getImageFromDB } from '../../utils/indexedDB';

import { timezones } from '../../utils/timezones';
import ThemeToggle from '../ui/ThemeToggle';
import DateRangePicker from '../ui/DateRangePicker';
import TimezoneSelect from '../ui/TimezoneSelect';
import Spinner from '../ui/Spinner';
import ExportOptionsModal from '../modals/ExportOptionsModal';
import ExportProgressBar from '../ui/ExportProgressBar';
import NotificationCenter from '../../features/notifications/components/NotificationCenter';
import FilterPopover from '../ui/FilterPopover';
import ActiveFilterTags from '../ui/ActiveFilterTags';
import { useNotification } from '../../contexts/NotificationContext';
import CustomSelect from '../ui/CustomSelect';

const Header: React.FC = () => {
  const {
    handleLogout,
    handleSyncClick,
    isSyncing,
    accounts,
    role,
    permissions,
    syncState,
    handleExport,
    exportProgress,
    isExporting,
    showExportOptions,
    setShowExportOptions,
    handleExportWithOptions,
    teamId, // For NotificationCenter Firestore sync
    allowedAccounts, // For notification filtering by shop
    performGlobalSearch, // Global Search Function
    clearGlobalSearch, // Clear Global Search
    boards,
    selectedBoardId,
    setSelectedBoardId,
    user,
    processedData,
    records,
  } = useDashboard();

  const { activeTab } = useUITabs();
  const {
    selectedAccountId,
    setSelectedAccountId,
    timeZone,
    setTimeZone,
    searchTerm,
    setSearchTerm,
    sourceFilter,
    setSourceFilter,
    statusFilter,
    setStatusFilter,
    supportFilter,
    setSupportFilter,
    reviewRatingFilter,
    setReviewRatingFilter,
  } = useUIFilters();
  const {
    setIsAccountManagerOpen,
    setIsNotificationDetailOpen,
  } = useUIModals();
  const {
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    toggleMobileMenu,
  } = useUILayout();
  const { globalUsdMode, setGlobalUsdMode } = useUISettings();

  // Create userProfile for notification filtering
  const userProfile = teamId ? {
    teamId,
    role,
    permissions,
    allowedAccounts,
    email: user?.email // Include email for soft delete
  } : null;

  const { addNotification } = useNotification();
  const [isApiLoading, setIsApiLoading] = useState(false);
  const [showActionButtons, setShowActionButtons] = useState(false);

  const triggerBulkSyncSkuToTasks = async () => {
    if (isApiLoading) return;
    const currentOrders = processedData.orders.rows;
    if (currentOrders.length === 0) {
      addNotification('No orders to sync.', 'info');
      return;
    }
    
    setIsApiLoading(true);
    try {
      const { ORDER_LIST_INDICES } = await import('../../constants/dataIndices');
      const orderIds = new Set(currentOrders.map(r => r[ORDER_LIST_INDICES.RECORD_ID])); // RECORD_ID index
      const targetRecords = records.filter(r => r.id && orderIds.has(r.id) && r.status !== 'Refunded');
      
      if (targetRecords.length === 0) {
        addNotification('No valid orders to sync.', 'info');
        setIsApiLoading(false);
        return;
      }
      
      const payloadOrders = targetRecords.map(r => {
        const skuString = r.details?.items?.map(i => i.sku).filter(Boolean).join(', ') || '';
        const items = r.details?.items?.map(i => {
            const variations = [];
            if (i.variant) variations.push(i.variant);
            if (i.variant2) variations.push(i.variant2);
            return {
                title: i.name || '',
                sku: i.sku || '',
                listingId: i.listingId || '',
                transactionId: i.transactionId || '',
                customerFiles: Array.isArray(i.customerFiles) ? i.customerFiles : [],
                quantity: i.quantity || 1,
                variations
            };
        }) || [];
        
        return {
            orderId: r.order_id,
            skuString,
            items
        };
      });

      const res = await fetch('/api/lark-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk-sync-sku-to-tasks',
          secret: 'test1234',
          orders: payloadOrders
        })
      });
      
      const data = await res.json();
      if (res.ok) {
        addNotification(`Success: Synced ${data.updatedCount || payloadOrders.length} orders`, 'success');
      } else {
        addNotification(`Failed: ${data.message || 'Unknown error'}`, 'error');
      }
    } catch (e: any) {
      addNotification(`Error: ${e.message}`, 'error');
    } finally {
      setIsApiLoading(false);
    }
  };

  const triggerBulkFetchSku = async () => {
    if (isApiLoading) return;
    const currentOrders = processedData.orders.rows;
    if (currentOrders.length === 0) {
      addNotification('No orders to fetch.', 'info');
      return;
    }
    
    setIsApiLoading(true);
    try {
      const { ORDER_LIST_INDICES } = await import('../../constants/dataIndices');
      const orderIds = new Set(currentOrders.map(r => r[ORDER_LIST_INDICES.RECORD_ID]));
      const targetRecords = records.filter(r => {
        if (!r.id || !orderIds.has(r.id) || r.status === 'Refunded') return false;
        if (!r.details?.items || r.details.items.length === 0) return true;
        return r.details.items.some(item => !item.sku || item.sku.trim() === '');
      });
      
      if (targetRecords.length === 0) {
        addNotification('No valid orders to fetch (all have SKUs).', 'info');
        setIsApiLoading(false);
        return;
      }
      
      const payloadOrders = targetRecords.map(r => ({
          orderId: r.order_id,
          account: r.account
      }));

      const res = await fetch('/api/lark-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk-trigger-sku-fetch',
          secret: 'test1234',
          orders: payloadOrders
        })
      });
      
      const data = await res.json();
      if (res.ok) {
        addNotification(`Success: Triggered ${data.count || payloadOrders.length} orders`, 'success');
      } else {
        addNotification(`Failed: ${data.message || 'Unknown error'}`, 'error');
      }
    } catch (e: any) {
      addNotification(`Error: ${e.message}`, 'error');
    } finally {
      setIsApiLoading(false);
    }
  };

  const [isBoardDropdownOpen, setIsBoardDropdownOpen] = useState(false);
  const boardDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (boardDropdownRef.current && !boardDropdownRef.current.contains(event.target as Node)) {
        setIsBoardDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setIsProfileDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [localPhotoURL, setLocalPhotoURL] = useState(user?.photoURL || '');
  const activeObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (user) {
      if (user.photoURL && !localPhotoURL) {
        setLocalPhotoURL(user.photoURL);
      }
      getImageFromDB(user.uid).then((blob) => {
        if (cancelled || !blob) return;
        const objectUrl = URL.createObjectURL(blob);
        if (activeObjectUrlRef.current) {
          URL.revokeObjectURL(activeObjectUrlRef.current);
        }
        activeObjectUrlRef.current = objectUrl;
        setLocalPhotoURL(objectUrl);
      }).catch(e => console.error("Header avatar load failed", e));
    }

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    return () => {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
      }
    };
  }, []);

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFocusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusSearchInput = useCallback(() => {
    if (searchFocusTimeoutRef.current) {
      clearTimeout(searchFocusTimeoutRef.current);
    }
    searchFocusTimeoutRef.current = setTimeout(() => {
      searchInputRef.current?.focus();
      searchFocusTimeoutRef.current = null;
    }, 100);
  }, []);

  useEffect(() => {
    return () => {
      if (searchFocusTimeoutRef.current) {
        clearTimeout(searchFocusTimeoutRef.current);
      }
    };
  }, []);

  // Keyboard shortcuts - Combined to prevent duplicate event listeners (memory leak fix)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F: Toggle search
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setIsSearchExpanded(true);
        focusSearchInput();
        return;
      }

      // Ctrl+H: Toggle action buttons (Sync SKU, Fetch SKU)
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        setShowActionButtons(prev => !prev);
        return;
      }

      // Ctrl+S: Quick sync
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault(); // Prevent browser save dialog
        if (!isSyncing && handleSyncClick) {
          handleSyncClick();
        }
        return;
      }

      // Escape: Collapse search if expanded
      if (e.key === 'Escape' && isSearchExpanded) {
        setIsSearchExpanded(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSearchExpanded, isSyncing, handleSyncClick, setSearchTerm, focusSearchInput]);

  // --- HÀM LÀM SẠCH THÔNG BÁO ---
  const formatSyncState = (rawState: string) => {
    if (!rawState) return null;
    let text = rawState.replace(/\[.*?\]\s*/g, '');
    text = text.replace(/Applying rule:\s*/i, 'Applying ');
    text = text.replace(/Probing history/i, 'Checking history');
    text = text.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  // Memoized handlers
  const handleSearchExpand = useCallback(() => {
    setIsSearchExpanded(true);
    focusSearchInput();
  }, [focusSearchInput]);

  const handleSearchClear = useCallback(() => {
    setSearchTerm('');
    setIsSearchExpanded(false);
    // Clear global search results - restore to date range
    clearGlobalSearch();
  }, [setSearchTerm, clearGlobalSearch]);

  const handleMobileMenuToggle = useCallback(() => {
    toggleMobileMenu();
  }, [toggleMobileMenu]);

  const handleSettingsAndCloseMenu = useCallback(() => {
    setIsAccountManagerOpen(true);
    setIsMobileMenuOpen(false);
  }, [setIsAccountManagerOpen]);

  // Prepare Account Options for CustomSelect
  const accountOptions = useMemo(() => [
    { value: 'all', label: 'All Accounts' },
    ...accounts.map(acc => ({
      value: acc.email,
      label: acc.label || acc.email,
      status: acc.etsy_suspended === true ? 'suspended' as const : 'alive' as const
    }))
  ], [accounts]);

  return (
    <header className="glass-base border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30 transition-all duration-200">
      {/* Primary Header Bar */}
      <div className="px-4 h-16 flex items-center justify-between max-w-[1920px] mx-auto">

        {/* Left: Logo, Title, Sync Status */}
        <div className="flex items-center gap-3 min-w-0">
          {role === 'owner' && (
            <div className="relative mr-4" ref={boardDropdownRef}>
              <button
                onClick={() => setIsBoardDropdownOpen(!isBoardDropdownOpen)}
                className="flex items-center gap-2 px-3 h-9 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors text-gray-800 dark:text-white border border-transparent"
              >
                <div className="flex items-center gap-2">
                  {selectedBoardId ? (
                    boards.find(b => b.uid === selectedBoardId)?.photoURL ? (
                      <img src={boards.find(b => b.uid === selectedBoardId)?.photoURL} className="w-5 h-5 rounded-full object-cover" alt="" />
                    ) : (
                      <Users className="w-4 h-4 text-gray-500" />
                    )
                  ) : (
                    <LayoutDashboard className="w-4 h-4 text-gray-500" />
                  )}
                  <span className="truncate max-w-[150px]">
                    {selectedBoardId
                      ? (boards.find(b => b.uid === selectedBoardId)?.displayName || 'Team')
                      : 'All Teams'}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>

              {isBoardDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 p-1">
                  <button
                    onClick={() => { setSelectedBoardId(null); setIsBoardDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 rounded-lg transition-colors ${!selectedBoardId ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
                  >
                    <div className={`p-1.5 rounded-md flex-shrink-0 ${!selectedBoardId ? 'bg-blue-100 dark:bg-blue-800' : 'bg-gray-100 dark:bg-gray-700'}`}>
                      <LayoutDashboard className="h-4 w-4" />
                    </div>
                    <span className="font-medium">All Teams</span>
                    {!selectedBoardId && <Check className="ml-auto w-4 h-4 text-blue-600 dark:text-blue-400" />}
                  </button>

                  <div className="my-1 border-t border-gray-100 dark:border-gray-700/50" />

                  <div className="max-h-[300px] overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
                    {boards.map(board => (
                      <button
                        key={board.uid}
                        onClick={() => { setSelectedBoardId(board.uid || null); setIsBoardDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 rounded-lg transition-colors ${selectedBoardId === board.uid ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
                      >
                        {board.photoURL ? (
                          <img src={board.photoURL} alt="" className="w-7 h-7 rounded-full object-cover border border-gray-200 dark:border-gray-600 flex-shrink-0" />
                        ) : (
                          <div className={`p-1.5 rounded-md flex-shrink-0 ${selectedBoardId === board.uid ? 'bg-blue-100 dark:bg-blue-800' : 'bg-gray-100 dark:bg-gray-700'}`}>
                            <Users className="h-4 w-4" />
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium truncate">{board.displayName || 'Team'}</span>
                          <span className="text-xs text-gray-500 truncate">{board.email}</span>
                        </div>
                        {selectedBoardId === board.uid && <Check className="ml-auto w-4 h-4 text-blue-600 dark:text-blue-400" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Activity Indicator (Desktop/Tablet) */}
          {syncState && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium animate-pulse transition-all max-w-[200px] truncate">
              <Spinner size="xs" color="text-blue-700 dark:text-blue-300" />
              <span className="truncate">{formatSyncState(syncState)}</span>
            </div>
          )}

          {/* Export Progress Indicator (Desktop/Tablet) */}
          {isExporting && exportProgress && (
            <div className="hidden md:block mr-4 w-60">
              <ExportProgressBar progress={exportProgress} />
            </div>
          )}
        </div>

        {/* Right: Desktop Controls */}
        <div className="hidden md:flex items-center gap-3">
          {/* Collapsible Search */}
          <div className={`relative flex items-center transition-all duration-300 ${isSearchExpanded ? 'w-48 lg:w-64' : 'w-10'}`}>
            {!isSearchExpanded ? (
              // Search Icon Button
              <button
                onClick={handleSearchExpand}
                className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                title="Search (Ctrl+F)"
              >
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            ) : (
              // Expanded Search Input
              <>
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-10 pr-8 py-1.5 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                  onBlur={() => {
                    // Collapse if empty when blur
                    if (!searchTerm) {
                      setTimeout(() => setIsSearchExpanded(false), 150);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      performGlobalSearch(searchTerm);
                    }
                  }}
                />
                <button
                  onClick={handleSearchClear}
                  className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Combined Filter - Only for Order List */}
          {activeTab === 'Order List' && (
            <>
              {showActionButtons && (
                <>
                  <button 
                    onClick={triggerBulkSyncSkuToTasks} 
                    disabled={isApiLoading}
                    className="hidden lg:block px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md text-sm font-medium shadow-sm transition-colors whitespace-nowrap"
                  >
                    {isApiLoading ? 'Syncing...' : 'Sync SKU to Task'}
                  </button>
                  <button 
                    onClick={triggerBulkFetchSku} 
                    disabled={isApiLoading}
                    className="hidden lg:block px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-md text-sm font-medium shadow-sm transition-colors whitespace-nowrap"
                  >
                    {isApiLoading ? 'Fetching...' : 'Bulk Fetch SKU'}
                  </button>
                </>
              )}
              <FilterPopover
                sourceFilter={sourceFilter}
                statusFilter={statusFilter}
                onApply={(source, status) => {
                  setSourceFilter(source as any);
                  setStatusFilter(status as any);
                }}
              />
            </>
          )}

          {/* Support Filter - Only for Support Tab */}
          {activeTab === 'Support' && (
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
              {(['All', 'Case', 'Help'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setSupportFilter(filter)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all duration-200 ${supportFilter === filter
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'Reviews' && (
            <CustomSelect
              value={reviewRatingFilter}
              onChange={(value) => setReviewRatingFilter(value as any)}
              options={[
                { value: 'All', label: 'All Ratings' },
                { value: '5', label: '5 stars' },
                { value: '4', label: '4 stars' },
                { value: '3', label: '3 stars' },
                { value: '2', label: '2 stars' },
                { value: '1', label: '1 star' }
              ]}
              className="w-[140px]"
            />
          )}
          <DateRangePicker />

          <CustomSelect
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            options={accountOptions}
            disabled={accounts.length === 0}
            className="w-[170px]"
            showSearch={true}
            searchPlaceholder="Search..."
          />

          <TimezoneSelect value={timeZone} onChange={setTimeZone} options={timezones} />

          {/* Manual Sync Button */}
          <button
            onClick={handleSyncClick}
            disabled={isSyncing}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            title="Sync Now (Ctrl+S)"
          >
            <svg className={`w-5 h-5 ${isSyncing ? 'animate-spin text-blue-600' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Notification Center */}
          <NotificationCenter teamId={teamId} onDetailModalChange={setIsNotificationDetailOpen} userProfile={userProfile} accounts={accounts} />

          <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>

          {/* Profile Dropdown */}
          <div className="relative ml-2" ref={profileDropdownRef}>
            <button
              onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
              className="flex items-center gap-2 focus:outline-none"
            >
              <div className="relative flex-shrink-0">
                  {localPhotoURL ? (
                      <img
                          src={localPhotoURL}
                          alt="User"
                          className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-600 hover:ring-2 hover:ring-blue-500 transition-all"
                          onError={() => setLocalPhotoURL('')}
                      />
                  ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold hover:ring-2 hover:ring-blue-500 transition-all">
                          {user?.displayName ? user.displayName.charAt(0).toUpperCase() : (user?.email?.charAt(0).toUpperCase() || 'U')}
                      </div>
                  )}
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></span>
              </div>
            </button>

            {isProfileDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 py-1">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {user?.displayName || 'User'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {user?.email}
                  </p>
                </div>
                
                <div className="py-1">
                  <button
                    onClick={() => {
                        setIsProfileDropdownOpen(false);
                        setIsAccountManagerOpen(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center transition-colors"
                  >
                    <Settings className="w-4 h-4 mr-3 text-gray-500" />
                    Settings
                  </button>
                  <button
                    onClick={() => {
                        setIsProfileDropdownOpen(false);
                        handleLogout();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center transition-colors"
                  >
                    <LogOut className="w-4 h-4 mr-3 text-red-500" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right: Mobile Menu Toggle & Theme */}
        <div className="flex md:hidden items-center gap-1">
          {/* Mobile Order List Filter & Action Buttons */}
          {activeTab === 'Order List' && (
            <>
              {showActionButtons && (
                <>
                  <button 
                    onClick={triggerBulkSyncSkuToTasks} 
                    disabled={isApiLoading}
                    className="p-1.5 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors"
                    title="Sync SKU to Task"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                  <button 
                    onClick={triggerBulkFetchSku} 
                    disabled={isApiLoading}
                    className="p-1.5 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-800 disabled:opacity-50 rounded-md transition-colors mr-1"
                    title="Bulk Fetch SKU"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </button>
                </>
              )}
              <FilterPopover
                sourceFilter={sourceFilter}
                statusFilter={statusFilter}
                onApply={(source, status) => {
                  setSourceFilter(source as any);
                  setStatusFilter(status as any);
                }}
              />
            </>
          )}

          {activeTab === 'Support' && (
            <CustomSelect
              value={supportFilter}
              onChange={(val) => setSupportFilter(val as any)}
              options={[
                { value: 'All', label: 'All Support' },
                { value: 'Case', label: 'Case' },
                { value: 'Help', label: 'Help' }
              ]}
              className="w-32"
              triggerClassName="h-9 py-0"
            />
          )}

          {/* Manual Sync Button - Mobile */}
          <button
            onClick={handleSyncClick}
            disabled={isSyncing}
            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md focus:outline-none disabled:opacity-50"
            aria-label="Sync Now"
          >
            <svg className={`w-5 h-5 ${isSyncing ? 'animate-spin text-blue-600' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Notification Center - Mobile */}
          <NotificationCenter teamId={teamId} onDetailModalChange={setIsNotificationDetailOpen} userProfile={userProfile} accounts={accounts} />

          <button
            onClick={handleMobileMenuToggle}
            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md focus:outline-none"
            aria-label="Toggle Menu"
          >
            {isMobileMenuOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Active Filters Bar */}
      {activeTab === 'Order List' && (
        <ActiveFilterTags
          sourceFilter={sourceFilter}
          statusFilter={statusFilter}
          onRemoveSource={() => setSourceFilter('All')}
          onRemoveStatus={() => setStatusFilter('All')}
          onClearAll={() => {
            setSourceFilter('All');
            setStatusFilter('All');
          }}
        />
      )}

      {/* Mobile Menu Content (Collapsible) */}
      <div className={`md:hidden transition-all duration-300 ease-in-out ${isMobileMenuOpen ? 'max-h-screen opacity-100 border-t border-gray-200 dark:border-gray-700 shadow-xl overflow-visible' : 'max-h-0 opacity-0 overflow-hidden'}`}>
        <div className="p-4 bg-white dark:bg-gray-800 space-y-5">

          {/* Sync State Banner */}
          {syncState && (
            <div className="flex items-center gap-3 text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800/30">
              <Spinner size="sm" color="text-blue-600 dark:text-blue-400" />
              <span className="font-medium">{formatSyncState(syncState)}</span>
            </div>
          )}

          {/* Mobile Search */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search Orders, Customers..."
              className="w-full pl-10 pr-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-base focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  performGlobalSearch(searchTerm);
                  // Close mobile menu on search
                  setIsMobileMenuOpen(false);
                }
              }}
            />
          </div>

          {/* Mobile Filters */}
          <div className="space-y-4">
            {/* Tab Specific Filters (Mobile) - Order List */}
            {activeTab === 'Order List' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Source</label>
                  <CustomSelect
                    value={sourceFilter}
                    onChange={(val) => setSourceFilter(val as any)}
                    options={[
                      { value: 'All', label: 'All Sources' },
                      { value: 'Etsy_Sales', label: 'Etsy' },
                      { value: 'Ebay_Sales', label: 'eBay' }
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Status</label>
                  <CustomSelect
                    value={statusFilter}
                    onChange={(val) => setStatusFilter(val as any)}
                    options={[
                      { value: 'All', label: 'All Statuses' },
                      { value: 'New', label: 'New' },
                      { value: 'Refunded', label: 'Refunded' }
                    ]}
                  />
                </div>
              </div>
            )}

            {/* Tab Specific Filters (Mobile) - Only Support Tab */}
            {activeTab === 'Support' && (
              <div className="w-full">
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Filter</label>
                <CustomSelect
                  value={supportFilter}
                  onChange={(val) => setSupportFilter(val as any)}
                  options={[
                    { value: 'All', label: 'All Support' },
                    { value: 'Case', label: 'Case' },
                    { value: 'Help', label: 'Help' }
                  ]}
                />
              </div>
            )}

            {activeTab === 'Reviews' && (
              <div className="w-full">
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Rating</label>
                <CustomSelect
                  value={reviewRatingFilter}
                  onChange={(value) => setReviewRatingFilter(value as any)}
                  options={[
                    { value: 'All', label: 'All Ratings' },
                    { value: '5', label: '5 stars' },
                    { value: '4', label: '4 stars' },
                    { value: '3', label: '3 stars' },
                    { value: '2', label: '2 stars' },
                    { value: '1', label: '1 star' }
                  ]}
                />
              </div>
            )}
            <div className="w-full mb-3">
              <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Date Range</label>
              <DateRangePicker />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Account</label>
                <CustomSelect
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                  options={accountOptions}
                  className="w-full"
                  showSearch={true}
                  searchPlaceholder="Search accounts..."
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Timezone</label>
                <TimezoneSelect value={timeZone} onChange={setTimeZone} options={timezones} />
              </div>
            </div>
          </div>

          {/* Mobile Actions Footer */}
          <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">

            <div className="flex items-center gap-1">
              {(role === 'owner' || permissions.canManageSettings) && (
                <button
                  onClick={handleSettingsAndCloseMenu}
                  className="p-2 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                  title="Manage Accounts"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}

              <ThemeToggle className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md" />

              {/* USD Mode Toggle — wrapped in p-2 to match Settings/ThemeToggle height */}
              <div
                className="p-2 flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md cursor-pointer"
                onClick={() => setGlobalUsdMode(!globalUsdMode)}
                title={globalUsdMode ? 'USD Mode: On' : 'USD Mode: Off'}
              >
                <button
                  role="switch"
                  aria-checked={globalUsdMode}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-all duration-300 ease-in-out focus:outline-none ${globalUsdMode ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                >
                  <span className="sr-only">USD Mode</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-300 ease-in-out ${globalUsdMode ? 'translate-x-4' : 'translate-x-0'
                      }`}
                  />
                </button>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md font-medium text-sm transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Export Options Modal */}
      <ExportOptionsModal
        isOpen={showExportOptions}
        onClose={() => setShowExportOptions(false)}
        onExport={handleExportWithOptions}
      />
    </header >
  );
};

export default Header;
