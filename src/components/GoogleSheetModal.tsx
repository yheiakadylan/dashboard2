import React, { useState, useEffect } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { getSettings, saveSettings } from '../services/firebaseService';
import { syncRecordsToGoogleSheet } from '../services/googleSheetService';
import { signInWithGoogle, getGoogleAccessToken } from '../services/authService';
import { Record, Account } from '../types';
import LoadingSpinner from './LoadingSpinner';
import { useNotification } from '../contexts/NotificationContext';
import { UserCircle } from 'lucide-react'; // Icon for user
import { useUI } from '../contexts/UIContext';

interface GoogleSheetModalProps {
    isOpen: boolean;
    onClose: () => void;
    records: Record[]; // Records to sync
}

const GoogleSheetModal: React.FC<GoogleSheetModalProps> = ({ isOpen, onClose, records }) => {
    const { teamId, allAccounts } = useDashboard(); // Destructure allAccounts
    const { timeZone } = useUI();
    const { addNotification } = useNotification();

    // State
    const [sheetId, setSheetId] = useState('');
    const [autoSync, setAutoSync] = useState(false);

    // Dedicated Sheet Account State (Persisted in Settings or Local? For now, we need to auth manually or save token)
    // To enable auto-sync later, we MUST save this account's refresh token to DB.
    // Let's store the connected sheet account in settings for simplicity for now.
    const [sheetAccount, setSheetAccount] = useState<Account | null>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [syncStatus, setSyncStatus] = useState<string | null>(null);
    const [authError, setAuthError] = useState(false);
    const [lastAutoSync, setLastAutoSync] = useState<number | null>(null);

    // Helper to format relative time
    const formatRelativeTime = (timestamp: number): string => {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        if (seconds > 10) return `${seconds} seconds ago`;
        return 'just now';
    };

    // Load settings on open
    useEffect(() => {
        if (isOpen && teamId) {
            setIsLoading(true);
            getSettings(teamId).then(settings => {
                if (settings.googleSheetId) setSheetId(settings.googleSheetId);
                if (settings.autoSyncToSheet) setAutoSync(settings.autoSyncToSheet);
                if (settings.sheetAccount) setSheetAccount(settings.sheetAccount);
            }).finally(() => setIsLoading(false));
            setAuthError(false);

            // Load last auto-sync time from localStorage
            const lastSyncStr = localStorage.getItem('lastAutoSyncTimestamp');
            if (lastSyncStr) {
                const lastSyncTime = parseInt(lastSyncStr, 10);
                if (!isNaN(lastSyncTime)) {
                    setLastAutoSync(lastSyncTime);
                }
            }
        }
    }, [isOpen, teamId]);

    // Real-time update for relative time display (refresh every minute)
    useEffect(() => {
        if (!lastAutoSync) return;

        const interval = setInterval(() => {
            // Force re-render to update relative time
            setLastAutoSync(prev => prev);
        }, 60000); // Update every minute

        return () => clearInterval(interval);
    }, [lastAutoSync]);

    const handleConnectSheetAccount = async () => {
        try {
            // Trigger specific Google Auth
            const account = await signInWithGoogle(); // This requests the scopes including sheets
            setSheetAccount(account);
            setAuthError(false);

            // Save immediately to settings so we don't lose it
            await saveSettings(teamId, { sheetAccount: account });
            addNotification(`Connected: ${account.email}`, "success");
        } catch (error: any) {
            console.error(error);
            addNotification("Failed to connect Google account.", "error");
        }
    };

    const handleSaveSettings = async () => {
        setIsSaving(true);
        try {
            // Check if we can get a token to verify the account is still valid?
            // Optional optimization.
            await saveSettings(teamId, {
                googleSheetId: sheetId,
                autoSyncToSheet: autoSync,
                sheetAccount // Persist the sheet account
            });
            addNotification("Settings saved.", "success");
        } catch (e: any) {
            addNotification("Failed to save settings.", "error");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSyncNow = async () => {
        if (!sheetId) {
            addNotification("Please enter a Google Sheet ID.", "error");
            return;
        }

        if (!sheetAccount) {
            addNotification("Please connect the Google Account that owns the sheet.", "error");
            setAuthError(true);
            return;
        }

        setSyncStatus("Đang đồng bộ...");
        setAuthError(false);

        try {
            await saveSettings(teamId, { googleSheetId: sheetId, sheetAccount });

            const result = await syncRecordsToGoogleSheet(sheetId, records, sheetAccount, allAccounts, timeZone);

            if (result.success) {
                addNotification(result.message, "success");
                setSyncStatus(null);
                onClose();
            } else {
                addNotification(`Sync failed: ${result.message}`, "error");
                setSyncStatus("Thất bại");
                // Check for auth errors
                if (result.message.includes('401') || result.message.includes('403') || result.message.includes('Permission')) {
                    setAuthError(true);
                }
            }
        } catch (e: any) {
            console.error(e);
            addNotification("Sync error occurred.", "error");
            setSyncStatus("Error");
            if (e.message?.includes('Permission') || e.message?.includes('403')) {
                setAuthError(true);
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Google Sheets Integration</h2>
                </div>

                <div className="p-6 space-y-4">
                    {isLoading ? (
                        <div className="flex justify-center p-4"><LoadingSpinner /></div>
                    ) : (
                        <>
                            {/* Account Connection Section */}
                            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                                <label className="block text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-300 mb-2">
                                    Sheet Owner Account
                                </label>

                                {sheetAccount ? (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-blue-900 dark:text-blue-100 font-medium">
                                            <UserCircle className="w-5 h-5" />
                                            <span className="truncate max-w-[200px]">{sheetAccount.email}</span>
                                        </div>
                                        <button
                                            onClick={handleConnectSheetAccount}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                            Change
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleConnectSheetAccount}
                                        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded-md text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-gray-700 transition"
                                    >
                                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                                            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                        </svg>
                                        Connect Google Account
                                    </button>
                                )}
                            </div>

                            {authError && (
                                <div className="text-xs text-red-600 p-2 bg-red-50 rounded">
                                    <p className="font-semibold">Sync Failed!</p>
                                    <ul className="list-disc list-inside mt-1">
                                        <li>Does the account <strong>{sheetAccount?.email}</strong> have <strong>Editor</strong> access to this specific Sheet?</li>
                                        <li>Try clicking "Change" above to re-grant permissions.</li>
                                    </ul>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Google Sheet ID
                                </label>
                                <input
                                    type="text"
                                    value={sheetId}
                                    onChange={(e) => setSheetId(e.target.value)}
                                    placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvEbrup"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    The ID is the long string in your Google Sheet URL.
                                </p>

                                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-md border border-blue-200 dark:border-blue-800">
                                    <p className="text-xs text-blue-800 dark:text-blue-300 font-semibold mb-2">📌 System Info:</p>
                                    <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                                        <li>• <strong>Timezone:</strong> UTC-7</li>
                                        <li>• <strong>Auto Sheet:</strong> Creates monthly sheets (Jan 2025, Feb 2025...)</li>
                                        <li>• <strong>Structure:</strong> Each day has its own header row, separated by blank lines</li>
                                        <li>• <strong>Borders:</strong> Auto-border around entire order</li>
                                        <li>• <strong>Multi-item:</strong> Each product in order gets its own row</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Auto Sync</span>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            Automatically sync new orders every 5 minutes in the background
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setAutoSync(!autoSync)}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoSync ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoSync ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                                {autoSync && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-md">
                                            <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                            <span className="font-medium">Auto-sync is enabled</span>
                                        </div>
                                        {lastAutoSync && (
                                            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 px-3 py-1.5">
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <span>Last auto-sync: <span className="font-medium">{formatRelativeTime(lastAutoSync)}</span></span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Sync Now - only show if records are provided */}
                            {records.length > 0 && (
                                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                                        Syncing <strong>{records.length}</strong> records currently displayed.
                                    </p>
                                    <button
                                        onClick={handleSyncNow}
                                        disabled={!!syncStatus || !sheetAccount}
                                        className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {syncStatus ? syncStatus : (
                                            <>
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                Sync Now
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button
                        onClick={handleSaveSettings}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                    >
                        Save Settings
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GoogleSheetModal;
