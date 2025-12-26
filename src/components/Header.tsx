import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';

import { timezones } from '../utils/timezones';
import ThemeToggle from './ThemeToggle';
import DateRangePicker from './DateRangePicker';
import TimezoneSelect from './TimezoneSelect';
import Spinner from './Spinner';
import ExportOptionsModal from './ExportOptionsModal';
import ExportProgressBar from './ExportProgressBar';
import NotificationCenter from './NotificationCenter';

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
  } = useDashboard();

  const {
    selectedAccountId,
    setSelectedAccountId,
    setIsAccountManagerOpen,
    timeZone,
    setTimeZone,
    searchTerm,
    setSearchTerm,
    activeTab,
    sourceFilter,
    setSourceFilter,
    supportFilter,
    setSupportFilter,
    isSidebarCollapsed,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    toggleMobileMenu,
    setIsNotificationDetailOpen,
  } = useUI();

  // Create userProfile for notification filtering
  const userProfile = teamId ? {
    teamId,
    role,
    permissions,
    allowedAccounts,
    email: useDashboard().user?.email // Include email for soft delete
  } : null;

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts - Combined to prevent duplicate event listeners (memory leak fix)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F: Toggle search
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setIsSearchExpanded(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
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
  }, [isSearchExpanded, isSyncing, handleSyncClick, setSearchTerm]);

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
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchTerm('');
    setIsSearchExpanded(false);
  }, [setSearchTerm]);

  const handleMobileMenuToggle = useCallback(() => {
    toggleMobileMenu();
  }, [toggleMobileMenu]);

  const handleSettingsAndCloseMenu = useCallback(() => {
    setIsAccountManagerOpen(true);
    setIsMobileMenuOpen(false);
  }, [setIsAccountManagerOpen]);

  const cycleSourceFilter = useCallback(() => {
    const options = ['All', 'Ebay_Sales', 'Etsy_Sales'] as const;
    const currentIndex = options.indexOf(sourceFilter as any);
    const nextIndex = (currentIndex + 1) % options.length;
    setSourceFilter(options[nextIndex]);
  }, [sourceFilter, setSourceFilter]);

  const cycleSupportFilter = useCallback(() => {
    const options = ['All', 'Case', 'Help'] as const;
    const currentIndex = options.indexOf(supportFilter as any);
    const nextIndex = (currentIndex + 1) % options.length;
    setSupportFilter(options[nextIndex]);
  }, [supportFilter, setSupportFilter]);

  return (
    <header className="bg-white dark:bg-gray-800 shadow-md border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30 transition-all duration-200">
      {/* Primary Header Bar */}
      <div className="px-4 h-16 flex items-center justify-between max-w-[1920px] mx-auto">

        {/* Left: Logo, Title, Sync Status */}
        <div className="flex items-center gap-3 min-w-0">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600 dark:text-blue-500 flex-shrink-0" aria-hidden="true">
            <path d="M4 4V20H8V4H4ZM10 10V20H14V10H10ZM16 16V20H20V16H16Z" fill="currentColor" />
            <path d="M4 15L9 9L14 13L20 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-gray-900" />
          </svg>
          <h1 className="text-xl font-bold text-gray-800 dark:text-white truncate">
            <span className="hidden sm:inline">Sales Dashboard</span>
            <span className="sm:hidden">Dashboard</span>
          </h1>

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

          {/* Source Filter - Only for Order List */}
          {activeTab === 'Order List' && (
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
              {(['All', 'Ebay_Sales', 'Etsy_Sales'] as const).map(src => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all duration-200 ${sourceFilter === src
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                >
                  {src === 'All' ? 'All' : src === 'Ebay_Sales' ? 'eBay' : 'Etsy'}
                </button>
              ))}
            </div>
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

          <DateRangePicker />

          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm max-w-[150px] truncate"
            disabled={accounts.length === 0}
            aria-label="Select Account"
          >
            <option value="all">All Accounts</option>
            {accounts.map((acc) => (<option key={acc.id} value={acc.email}>{acc.label || acc.email}</option>))}
          </select>

          <TimezoneSelect value={timeZone} onChange={setTimeZone} options={timezones} />

          {/* Notification Center */}
          <NotificationCenter teamId={teamId} onDetailModalChange={setIsNotificationDetailOpen} userProfile={userProfile} accounts={accounts} />

          <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>

          {/* Export Button */}
          <div className="relative">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={`text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors flex items-center justify-center ${isSidebarCollapsed ? 'px-3 py-1.5' : 'p-2'
                } ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={isExporting ? 'Exporting...' : 'Export Excel'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span className={`${isSidebarCollapsed ? 'block' : 'hidden'} ml-2 text-sm font-medium`}>Export</span>
            </button>
          </div>

        </div>

        {/* Right: Mobile Menu Toggle & Theme */}
        <div className="flex md:hidden items-center gap-1">
          {/* Mobile Filter Toggles */}
          {activeTab === 'Order List' && (
            <div className="flex mr-1 bg-gray-100 dark:bg-gray-700 rounded-md p-0.5 border border-gray-200 dark:border-gray-600">
              {(['All', 'Ebay_Sales', 'Etsy_Sales'] as const).map(src => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={`px-1.5 py-1 text-[10px] font-bold rounded-sm transition-all ${sourceFilter === src
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                    }`}
                >
                  {src === 'All' ? 'All' : src === 'Ebay_Sales' ? 'eBay' : 'Etsy'}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'Support' && (
            <div className="flex mr-1 bg-gray-100 dark:bg-gray-700 rounded-md p-0.5 border border-gray-200 dark:border-gray-600">
              {(['All', 'Case', 'Help'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setSupportFilter(filter)}
                  className={`px-1.5 py-1 text-[10px] font-bold rounded-sm transition-all ${supportFilter === filter
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                    }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          )}

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

      {/* Mobile Menu Content (Collapsible) */}
      <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${isMobileMenuOpen ? 'max-h-screen opacity-100 border-t border-gray-200 dark:border-gray-700 shadow-xl' : 'max-h-0 opacity-0'}`}>
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
            {/* Tab Specific Filters (Mobile) - Only Support Tab */}
            {activeTab === 'Support' && (
              <div className="w-full">
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Filter</label>
                <div className="flex bg-gray-50 dark:bg-gray-700/50 rounded-lg p-1 border border-gray-200 dark:border-gray-600">
                  {(['All', 'Case', 'Help'] as const).map(filter => (
                    <button
                      key={filter}
                      onClick={() => setSupportFilter(filter)}
                      className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all duration-200 ${supportFilter === filter
                        ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200 dark:border-gray-500'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="w-full">
              <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Date Range</label>
              <DateRangePicker />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Account</label>
                <div className="relative">
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                  >
                    <option value="all">All Accounts</option>
                    {accounts.map((acc) => (<option key={acc.id} value={acc.email}>{acc.label || acc.email}</option>))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                </div>
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
