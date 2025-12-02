import React, { useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { timezones } from '../utils/timezones';
import ThemeToggle from './ThemeToggle';
import DateRangePicker from './DateRangePicker';
import TimezoneSelect from './TimezoneSelect';

const Header: React.FC = () => {
  const {
    handleLogout,
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    setIsAccountManagerOpen,
    timeZone,
    setTimeZone,
    role,
    permissions,
    syncState,
    searchTerm,
    setSearchTerm,
  } = useDashboard();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // --- HÀM LÀM SẠCH THÔNG BÁO ---
  const formatSyncState = (rawState: string) => {
    if (!rawState) return null;
    let text = rawState.replace(/\[.*?\]\s*/g, '');
    text = text.replace(/Applying rule:\s*/i, 'Applying ');
    text = text.replace(/Probing history/i, 'Checking history');
    text = text.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

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
                    <svg className="animate-spin h-3 w-3 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="truncate">{formatSyncState(syncState)}</span>
                </div>
            )}
        </div>

        {/* Right: Desktop Controls */}
        <div className="hidden md:flex items-center gap-3">
            {/* Search */}
            <div className="relative w-48 lg:w-64">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search..."
                    className="w-full pl-10 pr-8 py-1.5 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                />
                {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </button>
                )}
            </div>

            <DateRangePicker />
            
            <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm max-w-[150px] truncate"
                disabled={accounts.length === 0}
            >
                <option value="all">All Accounts</option>
                {accounts.map((acc) => (<option key={acc.id} value={acc.email}>{acc.label || acc.email}</option>))}
            </select>

            <TimezoneSelect value={timeZone} onChange={setTimeZone} options={timezones} />
            
            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>

            <ThemeToggle />
            
            {(role === 'owner' || permissions.canManageSettings) && (
                <button onClick={() => setIsAccountManagerOpen(true)} className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Settings">
                    <span className="text-lg leading-none">⚙️</span>
                </button>
            )}

            <button
                onClick={handleLogout}
                className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Logout"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
                </svg>
            </button>
        </div>

        {/* Right: Mobile Menu Toggle */}
        <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
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
      <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${isMobileMenuOpen ? 'max-h-screen opacity-100 border-t border-gray-200 dark:border-gray-700' : 'max-h-0 opacity-0'}`}>
        <div className="p-4 bg-gray-50 dark:bg-gray-800/95 space-y-4 shadow-inner">
            
            {/* Sync State in Mobile Menu (if present) */}
            {syncState && (
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 p-2 rounded-md">
                     <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>{formatSyncState(syncState)}</span>
                </div>
            )}

            {/* Mobile Search */}
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search Orders, Customers..."
                    className="w-full pl-10 pr-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
            </div>

            {/* Mobile Filters */}
            <div className="space-y-3">
                <div className="w-full">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Date Range</label>
                    <DateRangePicker />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Account</label>
                        <select
                            value={selectedAccountId}
                            onChange={(e) => setSelectedAccountId(e.target.value)}
                            className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="all">All Accounts</option>
                            {accounts.map((acc) => (<option key={acc.id} value={acc.email}>{acc.label || acc.email}</option>))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Timezone</label>
                        <TimezoneSelect value={timeZone} onChange={setTimeZone} options={timezones} />
                    </div>
                </div>
            </div>

            {/* Mobile Actions Footer */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                 {(role === 'owner' || permissions.canManageSettings) ? (
                    <button onClick={() => { setIsAccountManagerOpen(true); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium text-sm transition-colors">
                        <span>⚙️</span> Manage Accounts
                    </button>
                 ) : <div></div>}

                <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium text-sm px-3 py-1.5 bg-red-50 dark:bg-red-900/20 rounded-md transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
                    </svg>
                    Logout
                </button>
            </div>
        </div>
      </div>
    </header>
  );
};

export default Header;