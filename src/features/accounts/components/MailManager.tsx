// components/AccountManager.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Account } from '../../../types';
import { signInWithGoogle, signInWithMicrosoft } from '../../auth/services/authService';
import { useDashboard } from '../../../contexts/DashboardContext';
import { useUIFilters } from '../../../contexts/UIContext';
import { useNotification } from '../../../contexts/NotificationContext';
import Spinner from '../../../components/ui/Spinner';

import { ReSyncModal } from './ReSyncModal';
import { BulkQuickSyncModal } from './BulkQuickSyncModal';

// --- MAIL MANAGER COMPONENT ---
export const MailManager: React.FC = () => {
  const {
    managementAccounts, // Use managementAccounts instead of accounts
    handleSaveAccounts,
    isSavingAccounts,
    syncState,
    syncProgress,
    accountSyncStatuses,
    handleResyncAccount,
    handleQuickSync // Add new handler
  } = useDashboard();

  const { timeZone } = useUIFilters();


  const { addNotification } = useNotification();

  const [localAccounts, setLocalAccounts] = useState<Account[]>([]);
  const [isAuthenticating, setIsAuthenticating] = useState<false | 'google' | 'microsoft'>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Re-Sync Modal State
  const [reSyncModal, setReSyncModal] = useState<{ isOpen: boolean; account: Account | null }>({ isOpen: false, account: null });

  // Bulk Quick Sync Modal State
  const [bulkSyncModal, setBulkSyncModal] = useState(false);

  useEffect(() => {
    setLocalAccounts(prevLocal => {
      // Create a map of the latest server state
      const serverMap = new Map(managementAccounts.map(a => [a.id, a]));
      const localIds = new Set(prevLocal.map(a => a.id));

      // 1. Update existing local accounts with server data, but PRESERVE user edits (label, platforms)
      //    and preserve the current local array order.
      const mergedLocal = prevLocal
        .filter(localAcc => serverMap.has(localAcc.id)) // Remove accounts deleted on server
        .map(localAcc => {
          const serverAcc = serverMap.get(localAcc.id)!;
          return {
            ...serverAcc,       // Take latest system fields (sync status, last_synced_at, etc.)
            label: localAcc.label,         // Preserve local user edit
            platforms: localAcc.platforms, // Preserve local user edit
            order: localAcc.order          // Preserve local order
          };
        });

      // 2. Identify new accounts from server that aren't in local state yet
      const newAccounts = managementAccounts.filter(a => !localIds.has(a.id));

      // 3. Combine: Existing/Merged + New
      return [...mergedLocal, ...newAccounts];
    });
  }, [managementAccounts]);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (localAccounts.length !== managementAccounts.length) return true;
    for (let i = 0; i < localAccounts.length; i++) {
      const local = localAccounts[i];
      const remote = managementAccounts.find(a => a.id === local.id);
      if (!remote) return true;
      if (local.label !== remote.label) return true;
      if (local.order !== remote.order) return true;
      const lp = local.platforms || [];
      const rp = remote.platforms || [];
      if (lp.length !== rp.length || JSON.stringify([...lp].sort()) !== JSON.stringify([...rp].sort())) return true;
    }
    return false;
  }, [localAccounts, managementAccounts]);

  const onManualSave = async () => {
    const accountsToSave = localAccounts.map((acc, index) => ({
      ...acc,
      order: index
    }));
    await handleSaveAccounts(accountsToSave);
  };

  const getAccountSyncStatus = (account: Account): { text: string; color: string; icon: React.ReactNode; title: string } => {
    if (syncState && syncState.includes(account.email)) {
      return {
        text: 'Syncing...',
        color: 'text-blue-500 dark:text-blue-400',
        icon: <Spinner size="sm" color="text-blue-500 dark:text-blue-400" />,
        title: `System is actively processing ${account.email}. Status: ${syncState}`
      };
    }

    if (account.historical_sync_complete === false) {
      const progressDate = account.history_synced_until ? new Date(account.history_synced_until).toLocaleDateString() : 'start';
      return {
        text: 'History Sync...',
        color: 'text-purple-500 dark:text-purple-400',
        icon: <Spinner size="sm" color="text-purple-500 dark:text-purple-400" />,
        title: `Background historical sync in progress. Reached: ${progressDate}`
      };
    }

    if (account.last_synced_at) {
      const lastSyncDate = new Date(account.last_synced_at);
      const formattedTime = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      }).format(lastSyncDate);

      return {
        text: 'Synced',
        color: 'text-green-600 dark:text-green-500',
        icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414L11 9.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>,
        title: `Last synced: ${formattedTime}`
      };
    }

    return {
      text: 'Pending',
      color: 'text-gray-500 dark:text-gray-400',
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.415L11 9.586V6z" clipRule="evenodd" /></svg>,
      title: 'Waiting for initial sync.'
    };
  };

  const handleAuth = async (provider: 'google' | 'microsoft') => {
    setIsAuthenticating(provider);
    setAuthError(null);
    try {
      const newAccount = provider === 'google'
        ? await signInWithGoogle()
        : await signInWithMicrosoft();

      const newAccountWithFlag: Account = {
        ...newAccount,
        historical_sync_complete: false,
        platforms: ['etsy', 'ebay'], // Default to both
      };

      if (!localAccounts.find(acc => acc.id === newAccountWithFlag.id)) {
        const updatedAccounts = [...localAccounts, newAccountWithFlag];
        setLocalAccounts(updatedAccounts);

        // Save immediately
        const orderedAccounts = updatedAccounts.map((acc, index) => ({
          ...acc,
          order: index
        }));
        await handleSaveAccounts(orderedAccounts);

        addNotification("Account added and saved successfully.", "success");
      } else {
        addNotification("This account is already in the list.", "info");
      }
    } catch (error) {
      console.error(`Authentication error for ${provider}:`, error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      setAuthError(msg);
      addNotification(`Authentication failed: ${msg}`, "error");
    } finally {
      setIsAuthenticating(false);
    }
  }

  const handleLabelChange = (id: string, newLabel: string) => {
    setLocalAccounts(prev => prev.map(acc => acc.id === id ? { ...acc, label: newLabel } : acc));
  };

  const handleDelete = (id: string) => {
    if (window.confirm("Are you sure you want to remove this account? This action is immediate.")) {
      const updatedAccounts = localAccounts.filter(acc => acc.id !== id);
      setLocalAccounts(updatedAccounts);

      const orderedAccounts = updatedAccounts.map((acc, index) => ({
        ...acc,
        order: index
      }));
      handleSaveAccounts(orderedAccounts, [id]);
    }
  };

  const handleReSyncClick = (account: Account) => {
    setReSyncModal({ isOpen: true, account });
  };

  const handleConfirmReSync = async (account: Account, ruleNames?: string[]) => {
    // Gọi hàm xử lý trọn gói bên Context
    await handleResyncAccount(account, ruleNames);

    // Cập nhật lại UI local để hiện trạng thái 'History Sync...' 
    // (Only relevant if we want immediate feedback before context updates)
    setLocalAccounts(prev => prev.map(acc => acc.id === account.id ? {
      ...acc,
      historical_sync_complete: false,
      history_synced_until: undefined, //null
      last_synced_at: undefined
    } : acc));
  };

  const handleQuickSyncClick = (account: Account) => {
    handleQuickSync(account);
  };

  const handleBulkSyncConfirm = async (selectedAccounts: Account[], syncType: 'quick' | 'history', ruleNames?: string[]) => {
    if (syncType === 'history') {
      // Full re-sync (history)
      for (const account of selectedAccounts) {
        await handleResyncAccount(account, ruleNames);
      }
      const msg = ruleNames
        ? `Queued ${selectedAccounts.length} account(s) for full re-sync with ${ruleNames.length} rule(s)`
        : `Queued ${selectedAccounts.length} account(s) for full re-sync`;
      addNotification(msg, "success");
    } else {
      // Quick sync (last 7 days)
      for (const account of selectedAccounts) {
        await handleQuickSync(account, ruleNames);
      }
      const msg = ruleNames
        ? `Queued ${selectedAccounts.length} account(s) for quick sync with ${ruleNames.length} rule(s)`
        : `Queued ${selectedAccounts.length} account(s) for quick sync`;
      addNotification(msg, "success");
    }
  };

  const handlePlatformToggle = (accountId: string, platform: string, isChecked: boolean) => {
    const updatedAccounts = localAccounts.map(acc => {
      if (acc.id !== accountId) return acc;

      const currentApiPlatforms = acc.platforms && acc.platforms.length > 0 ? acc.platforms : ['etsy', 'ebay'];

      let newPlatforms: string[];
      if (isChecked) {
        if (!currentApiPlatforms.includes(platform)) newPlatforms = [...currentApiPlatforms, platform];
        else newPlatforms = [...currentApiPlatforms];
      } else {
        newPlatforms = currentApiPlatforms.filter(p => p !== platform);
      }

      return { ...acc, platforms: newPlatforms };
    });

    setLocalAccounts(updatedAccounts);
    // REMOVED: handleSaveAccounts(ordered); - User must click Save button
  };

  const handleDrop = () => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }
    const accountsCopy = [...localAccounts];
    const draggedItemContent = accountsCopy.splice(dragItem.current, 1)[0];
    accountsCopy.splice(dragOverItem.current, 0, draggedItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setLocalAccounts(accountsCopy);
  };



  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-grow overflow-y-auto pr-2 scrollbar-hide">
        <div className="flex items-center justify-between mb-3 sticky top-0 bg-white dark:bg-gray-900 z-20 py-1">
          <div className="flex items-center gap-3">
             <h3 className="text-lg font-semibold">Manage Mail Accounts</h3>
             {hasUnsavedChanges && (
                <button
                  onClick={onManualSave}
                  disabled={isSavingAccounts}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-full shadow-lg shadow-blue-500/20 transition-all animate-pulse-subtle flex items-center gap-1.5"
                >
                  {isSavingAccounts ? <Spinner size="xs" color="text-white" /> : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  Save Changes
                </button>
             )}
          </div>
          <button
            onClick={() => setBulkSyncModal(true)}
            disabled={localAccounts.length === 0}
            className="px-3 py-1.5 text-xs font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/40 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title="Sync multiple accounts at once"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Bulk Quick Sync
          </button>
        </div>
        <div className="space-y-2">
          {localAccounts.map((acc, index) => {
            const syncStatus = getAccountSyncStatus(acc);

            return (
              <div
                key={acc.id}
                draggable
                onDragStart={() => dragItem.current = index}
                onDragEnter={() => dragOverItem.current = index}
                onDragEnd={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="flex flex-col md:flex-row md:items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 gap-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all duration-200 group relative overflow-hidden"
              >
                {/* Numbering Badge */}
                <div className="absolute top-0 left-0 bg-gray-50 dark:bg-gray-700/50 px-1.5 py-0.5 rounded-br-lg border-b border-r border-gray-100 dark:border-gray-600/50 z-10">
                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 font-mono">{index + 1}</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3 flex-grow min-w-0">


                  <div className="flex-shrink-0">
                    {acc.provider === 'gmail' ? (
                      <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5 md:w-6 md:h-6" />
                    ) : (
                      <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/960px-Microsoft_logo.svg.png" alt="Microsoft" className="w-5 h-5 md:w-6 md:h-6" />
                    )}
                  </div>
                  <div className="flex-grow space-y-1 min-w-0">
                    <input
                      type="text"
                      value={acc.label}
                      onChange={(e) => handleLabelChange(acc.id, e.target.value)}
                      className="font-semibold bg-transparent text-gray-900 dark:text-white p-1 text-sm md:text-base rounded w-full focus:bg-gray-50 dark:focus:bg-gray-700/50 focus:ring-2 focus:ring-blue-500/20 focus:outline-none truncate transition-colors border-b border-transparent focus:border-blue-500"
                      placeholder="Enter Shop Name"
                    />
                    <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 px-1 truncate">{acc.email}</p>

                    {/* Platform Toggles */}
                    <div className="flex items-center gap-3 px-1 mt-1">
                      <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="w-3 h-3 text-blue-600 rounded focus:ring-blue-500 border-gray-300 dark:border-gray-500"
                          checked={!acc.platforms || acc.platforms.length === 0 || acc.platforms.includes('etsy')}
                          onChange={(e) => handlePlatformToggle(acc.id, 'etsy', e.target.checked)}
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-300">Etsy</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="w-3 h-3 text-blue-600 rounded focus:ring-blue-500 border-gray-300 dark:border-gray-500"
                          checked={!acc.platforms || acc.platforms.length === 0 || acc.platforms.includes('ebay')}
                          onChange={(e) => handlePlatformToggle(acc.id, 'ebay', e.target.checked)}
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-300">eBay</span>
                      </label>
                    </div>

                    {/* Sync Status / Progress */}
                    {accountSyncStatuses && accountSyncStatuses[acc.id] ? (
                      <div className="mt-1.5 w-full pr-2 animate-fadeIn bg-purple-50 dark:bg-purple-900/30 p-1.5 rounded-md border border-purple-100 dark:border-purple-800/50">
                        <div className="flex items-center gap-2 text-[11px] font-bold text-purple-600 dark:text-purple-400">
                          <Spinner size="xs" color="text-purple-600 dark:text-purple-400" />
                          <span className="uppercase tracking-wide">Syncing History:</span>
                          <span className="font-mono">{accountSyncStatuses[acc.id]}</span>
                        </div>
                      </div>
                    ) : (syncProgress && syncProgress.message.includes(`[${acc.email}]`)) ? (
                      <div className="mt-1.5 w-full pr-2 animate-fadeIn bg-white/50 dark:bg-black/20 p-1.5 rounded-md">
                        <div className="flex justify-between items-center text-[10px] font-bold text-blue-600 dark:text-blue-400 mb-1">
                          <span className="truncate mr-1 uppercase">{syncProgress.message.replace(`[${acc.email}]`, '').trim()}</span>
                          <span>{Math.round((syncProgress.current / syncProgress.total) * 100)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, (syncProgress.current / syncProgress.total) * 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    ) : (
                      <div className={`flex items-center gap-1.5 px-1 text-xs font-medium ${syncStatus.color}`} title={syncStatus.title}>
                        {syncStatus.icon}
                        <span>{syncStatus.text}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center flex-shrink-0 gap-1.5 md:gap-2 justify-end md:justify-start">
                  <button
                    onClick={() => handleQuickSyncClick(acc)}
                    className="text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300 font-semibold px-2 md:px-3 py-1 rounded-md transition-colors text-xs md:text-sm whitespace-nowrap"
                    title="Sync data for the last 7 days"
                  >
                    Sync 7D
                  </button>
                  <button
                    onClick={() => handleReSyncClick(acc)}
                    className="hidden md:inline-block text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-semibold px-3 py-1 rounded-md transition-colors text-sm disabled:opacity-50"
                    title="Re-sync History"
                  >
                    Re-sync
                  </button>
                  <button
                    onClick={() => handleDelete(acc.id)}
                    className="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 font-semibold px-2 md:px-3 py-1 rounded-md transition-colors text-xs md:text-sm"
                  >
                    Del
                  </button>
                </div>
              </div>
            );
          })}
          {localAccounts.length === 0 && <p className="text-gray-400 dark:text-gray-500 text-center py-4">No accounts yet.</p>}
        </div>
      </div>

      <div className="flex-shrink-0 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-3">Add New Account</h3>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleAuth('google')}
            disabled={!!isAuthenticating}
            className="w-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600 font-bold py-2.5 px-4 rounded-lg transition-all shadow-sm hover:shadow flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-wait">
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
            {isAuthenticating === 'google' ? 'Authenticating...' : 'Sign in with Google'}
          </button>
          <button
            onClick={() => handleAuth('microsoft')}
            disabled={!!isAuthenticating}
            className="w-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600 font-bold py-2.5 px-4 rounded-lg transition-all shadow-sm hover:shadow flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-wait">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/960px-Microsoft_logo.svg.png" alt="Microsoft" className="w-5 h-5" />
            {isAuthenticating === 'microsoft' ? 'Authenticating...' : 'Sign in with Microsoft'}
          </button>
        </div>


        {authError && <p className="text-red-500 dark:text-red-400 text-sm mt-3 text-center">{authError}</p>}
      </div>

      {/* Floating Auto-save indicator */}
      <div className={`absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-full shadow-lg border border-blue-100 dark:border-blue-900 transition-all duration-300 pointer-events-none z-10 ${isSavingAccounts ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <Spinner size="xs" color="text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Saving changes...</span>
      </div>

      <ReSyncModal
        isOpen={reSyncModal.isOpen}
        account={reSyncModal.account}
        onClose={() => setReSyncModal({ isOpen: false, account: null })}
        onConfirm={handleConfirmReSync}
      />

      <BulkQuickSyncModal
        isOpen={bulkSyncModal}
        accounts={localAccounts}
        onClose={() => setBulkSyncModal(false)}
        onConfirm={handleBulkSyncConfirm}
      />
    </div>
  );
};

