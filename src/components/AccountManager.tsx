// components/AccountManager.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Account } from '../types';
import { signInWithGoogle, signInWithMicrosoft } from '../services/authService';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import { useNotification } from '../contexts/NotificationContext';

import UserManager from './UserManager';
import ManualCostManager from './ManualCostManager';
import NotificationSettings from './NotificationSettings';
import Spinner from './Spinner';

// --- MAIL MANAGER COMPONENT ---
const MailManager: React.FC = () => {
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

  const { timeZone } = useUI();


  const { addNotification } = useNotification();

  const [localAccounts, setLocalAccounts] = useState<Account[]>([]);
  const [isAuthenticating, setIsAuthenticating] = useState<false | 'google' | 'microsoft'>(false);
  const [authError, setAuthError] = useState<string | null>(null);

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

  // Ref to hold latest state for the timeout callback
  const latestLocalAccountsRef = useRef(localAccounts);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    latestLocalAccountsRef.current = localAccounts;
  }, [localAccounts]);

  // Auto-save logic with starvation prevention
  useEffect(() => {
    // 1. Identify if meaningful changes exist (User Edits)
    // We only care if Label, Platforms, or Order differ.
    // System fields (last_synced_at, status) changes should NOT trigger save, 
    // but they should be included when we do save.

    // Quick length check first
    let hasChanges = localAccounts.length !== managementAccounts.length;

    if (!hasChanges) {
      // Deep check of editable fields
      for (let i = 0; i < localAccounts.length; i++) {
        const local = localAccounts[i];
        // Find corresponding account in management (order might differ, so search by ID)
        const remote = managementAccounts.find(a => a.id === local.id);

        if (!remote) { hasChanges = true; break; } // Should be caught by length, but safe check

        // Check Editable Fields
        if (local.label !== remote.label) { hasChanges = true; break; }
        if (local.order !== remote.order) { hasChanges = true; break; }

        // Check Platforms array
        const localPlatforms = local.platforms || [];
        const remotePlatforms = remote.platforms || [];
        if (localPlatforms.length !== remotePlatforms.length) { hasChanges = true; break; }
        // Simple array comparison (assuming order doesn't matter or is sorted, usually sufficient)
        const sortedLocalP = [...localPlatforms].sort();
        const sortedRemoteP = [...remotePlatforms].sort();
        if (JSON.stringify(sortedLocalP) !== JSON.stringify(sortedRemoteP)) { hasChanges = true; break; }
      }
    }

    if (!hasChanges) {
      // If no changes, do nothing. 
      // If a timer was running, we can let it die? 
      // No, if we reverted changes effectively, we might not need to save.
      // But typically we just let the logic below flow.
      return;
    }

    // 2. Schedule Save (Persistent Timer)
    // If a timer is already running, WE DO NOT RESET IT.
    // This allows the save to execute after 500ms even if updates keep coming.
    if (!saveTimeoutRef.current) {
      saveTimeoutRef.current = setTimeout(() => {
        // Execute Save using the LATEST state
        const accountsToSave = latestLocalAccountsRef.current.map((acc, index) => ({
          ...acc,
          order: index // Ensure order is explicit
        }));

        handleSaveAccounts(accountsToSave);
        saveTimeoutRef.current = null;
      }, 500); // 500ms delay
    }
  }, [localAccounts, managementAccounts, handleSaveAccounts]);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

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

  const handleReSync = async (account: Account) => {
    if (window.confirm(`Re-sync entire history for ${account.email}? This runs in background.`)) {
      // Gọi hàm xử lý trọn gói bên Context
      await handleResyncAccount(account);

      // Cập nhật lại UI local để hiện trạng thái 'History Sync...'
      setLocalAccounts(prev => prev.map(acc => acc.id === account.id ? {
        ...acc,
        historical_sync_complete: false,
        history_synced_until: null, //null
        last_synced_at: null
      } : acc));
    }
  };

  const handleQuickSyncClick = (account: Account) => {
    handleQuickSync(account);
  };

  const handlePlatformToggle = async (accountId: string, platform: string, isChecked: boolean) => {
    const updatedAccounts = localAccounts.map(acc => {
      if (acc.id !== accountId) return acc;

      // Current effective platforms (if undefined/empty -> all assumed)
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

    // Save immediately
    try {
      const ordered = updatedAccounts.map((acc, i) => ({ ...acc, order: i }));
      await handleSaveAccounts(ordered);
      const accEmail = updatedAccounts.find(a => a.id === accountId)?.email;
      addNotification(`Saved platform settings for ${accEmail}`, "success");
    } catch (error) {
      console.error("Failed to save platform settings:", error);
      addNotification("Failed to save settings.", "error");
    }
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
    <div className="flex flex-col h-full">
      <div className="flex-grow overflow-y-auto pr-2 scrollbar-hide">
        <h3 className="text-lg font-semibold mb-3">Manage Mail Accounts</h3>
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
                      <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/512px-Microsoft_logo.svg.png?20210729021049" alt="Microsoft" className="w-5 h-5 md:w-6 md:h-6" />
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
                    onClick={() => handleReSync(acc)}
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
            className="w-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold py-2 px-4 rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-wait">
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
            {isAuthenticating === 'google' ? 'Authenticating...' : 'Sign in with Google'}
          </button>
          <button
            onClick={() => handleAuth('microsoft')}
            disabled={!!isAuthenticating}
            className="w-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold py-2 px-4 rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-wait">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/512px-Microsoft_logo.svg.png?20210729021049" alt="Microsoft" className="w-5 h-5" />
            {isAuthenticating === 'microsoft' ? 'Authenticating...' : 'Sign in with Microsoft'}
          </button>
        </div>


        {authError && <p className="text-red-500 dark:text-red-400 text-sm mt-3 text-center">{authError}</p>}

        {/* Auto-save indicator */}
        {isSavingAccounts && (
          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-blue-600 dark:text-blue-400">
            <Spinner size="sm" color="text-blue-600 dark:text-blue-400" />
            <span>Auto-saving...</span>
          </div>
        )}


      </div>
    </div>
  );
};

// --- MAIN ACCOUNT MANAGER MODAL ---
const AccountManager: React.FC = () => {
  const { role, permissions } = useDashboard();
  const { setIsAccountManagerOpen } = useUI();

  // User thường (không có quyền mail) chỉ thấy notifications tab
  const canManageMail = role === 'owner' || permissions.canManageSettings;
  const defaultTab = canManageMail ? 'mail' : 'notifications';

  const [activeTab, setActiveTab] = useState<'mail' | 'users' | 'costs' | 'notifications'>(defaultTab);
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Chỉ đóng nếu click trực tiếp vào backdrop (không phải con của nó)
    if (e.target === e.currentTarget) {
      setIsAccountManagerOpen(false);
    }
  };

  return (
    <div onClick={handleBackdropClick}
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[100] p-2 md:p-4 animate-modal-backdrop" >
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl border border-gray-200 dark:border-gray-700 flex flex-col h-[90vh] md:h-[720px] md:max-h-[90vh] animate-slide-in-right" >
        {/* Header */}
        <div className="flex justify-between items-center p-3 md:p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
          <button onClick={() => setIsAccountManagerOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="20px" height="20px" viewBox="0 0 24 24" fill="none">
              <path fillRule="evenodd" clipRule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-x-auto scrollbar-hide">
          {/* Mail Accounts - Only for owner or users with canManageSettings */}
          {canManageMail && (
            <button
              onClick={() => setActiveTab('mail')}
              className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'mail' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              Mail Accounts
            </button>
          )}

          {/* Notifications - Available for ALL users */}
          <button
            onClick={() => setActiveTab('notifications')}
            className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'notifications' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            Notifications
          </button>
          {role === 'owner' && (
            <>
              <button
                onClick={() => setActiveTab('users')}
                className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'users' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                User Management
              </button>
              <button
                onClick={() => setActiveTab('costs')}
                className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'costs' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                Manual Costs
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="p-3 md:p-6 flex-grow flex flex-col overflow-hidden bg-white dark:bg-gray-800">
          {activeTab === 'mail' && <MailManager />}
          {activeTab === 'users' && <UserManager />}
          {activeTab === 'costs' && <ManualCostManager />}
          {activeTab === 'notifications' && <NotificationSettings />}
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(AccountManager);
