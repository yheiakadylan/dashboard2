import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Record } from '../../types';
import { syncRecordsToGoogleSheet, getNewAndExistingOrders } from '../../services/googleSheetService';
import { getGoogleAccessToken } from '../../features/auth/services/authService';
import { getSettings } from '../../services/firebaseService';
import { useDashboard } from '../../contexts/DashboardContext';

interface PreviewSyncModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedRecords: Record[];
    onSuccess?: () => void;
}

const PreviewSyncModal: React.FC<PreviewSyncModalProps> = ({
    isOpen,
    onClose,
    selectedRecords,
    onSuccess
}) => {
    const { teamId, allAccounts } = useDashboard();
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error' | 'loading'>('loading');
    const [syncMessage, setSyncMessage] = useState('');
    const [newOrders, setNewOrders] = useState<Record[]>([]);
    const [skippedOrders, setSkippedOrders] = useState<Record[]>([]);
    const [sheetId, setSheetId] = useState('');
    const [sheetAccount, setSheetAccount] = useState<any>(null);

    useEffect(() => {
        if (isOpen && teamId) {
            setSyncStatus('loading');

            getSettings(teamId).then(async settings => {
                setSheetId(settings.googleSheetId || '');
                setSheetAccount(settings.sheetAccount || null);

                // Check which orders are new
                if (settings.googleSheetId && settings.sheetAccount && selectedRecords.length > 0) {
                    try {
                        const accessToken = await getGoogleAccessToken(settings.sheetAccount);
                        const firstRecord = selectedRecords[0];
                        const recordsByMonth = new Map<string, Record[]>();

                        // Group records by month to check against correct sheets
                        selectedRecords.forEach(r => {
                            try {
                                const date = new Date(r.dt_local);
                                // Use Etc/GMT+7 to match googleSheetService logic
                                const formatter = new Intl.DateTimeFormat('en-US', {
                                    timeZone: 'Etc/GMT+7',
                                    month: 'numeric',
                                    year: 'numeric'
                                });
                                const parts = formatter.formatToParts(date);
                                const month = parts.find(p => p.type === 'month')?.value;
                                const year = parts.find(p => p.type === 'year')?.value;
                                const key = `Tháng ${month} - ${year}`;

                                if (!recordsByMonth.has(key)) recordsByMonth.set(key, []);
                                recordsByMonth.get(key)!.push(r);
                            } catch (e) {
                                console.warn('Error parsing date for record', r.id);
                            }
                        });

                        const allNewOrders: Record[] = [];
                        const allSkippedOrders: Record[] = [];

                        // Check each month group
                        for (const [monthKey, groupRecords] of recordsByMonth) {
                            try {
                                const { newOrders: newRecs, existingOrders: existingRecs } = await getNewAndExistingOrders(
                                    settings.googleSheetId,
                                    monthKey,
                                    groupRecords,
                                    accessToken
                                );
                                allNewOrders.push(...newRecs);
                                allSkippedOrders.push(...existingRecs);
                            } catch (error) {
                                console.error(`Error checking orders for ${monthKey}:`, error);
                                // If check fails, assume all new (safer) or all skipped? unique constraint usually assumes new.
                                allNewOrders.push(...groupRecords);
                            }
                        }

                        setNewOrders(allNewOrders);
                        setSkippedOrders(allSkippedOrders);
                        setSyncStatus('idle');
                    } catch (error) {
                        console.error('Error checking orders:', error);
                        setNewOrders(selectedRecords);
                        setSkippedOrders([]);
                        setSyncStatus('idle');
                    }
                } else {
                    setNewOrders(selectedRecords);
                    setSkippedOrders([]);
                    setSyncStatus('idle');
                }
            }).catch(error => {
                console.error('Failed to load settings:', error);
                setSyncStatus('error');
                setSyncMessage('Failed to load settings');
            });
        }
    }, [isOpen, selectedRecords, teamId]);

    const getAccountLabel = (email: string) => {
        const acc = allAccounts.find(a => a.email.toLowerCase() === email?.toLowerCase());
        return acc ? (acc.label || acc.email) : email;
    };

    const handleConfirmSync = async () => {
        if (!sheetId) {
            setSyncStatus('error');
            setSyncMessage('Please set Google Sheet ID in Settings');
            return;
        }

        if (!sheetAccount || !sheetAccount.email) {
            setSyncStatus('error');
            setSyncMessage('No Google account connected. Please connect in Settings.');
            return;
        }

        // Get access token
        console.log('[PreviewSync] SheetAccount before getToken:', sheetAccount);
        console.log('[PreviewSync] provider:', sheetAccount?.provider);
        console.log('[PreviewSync] token:', sheetAccount?.token ? 'EXISTS' : 'MISSING');
        console.log('[PreviewSync] email:', sheetAccount?.email);

        let accessToken: string;
        try {
            accessToken = await getGoogleAccessToken(sheetAccount);
        } catch (error: any) {
            console.error('[PreviewSync] Token error:', error);
            setSyncStatus('error');
            setSyncMessage('Failed to get access token. Please reconnect your Google account in Settings.');
            return;
        }

        setIsSyncing(true);
        setSyncStatus('syncing');
        setSyncMessage('Syncing to Google Sheets...');

        try {
            // Filter only 'order' kind records, exclude refunded
            const ordersOnly = selectedRecords.filter(r => r.kind === 'order' && r.status !== 'Refunded');

            if (ordersOnly.length === 0) {
                setSyncStatus('error');
                setSyncMessage('No orders to sync (refunds excluded)');
                return;
            }

            const result = await syncRecordsToGoogleSheet(
                sheetId,
                ordersOnly, // ← Only sync orders
                sheetAccount,
                allAccounts,
                'UTC'
            );

            setSyncStatus('success');
            setSyncMessage(`✅ Successfully synced ${result.count || selectedRecords.length} orders to Google Sheets!`);

            setTimeout(() => {
                onSuccess?.();
                onClose();
            }, 2000);
        } catch (error: any) {
            setSyncStatus('error');
            setSyncMessage(error.message || 'Failed to sync to Google Sheets');
        } finally {
            setIsSyncing(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                            Preview Sync
                        </h2>
                        <button
                            onClick={onClose}
                            disabled={isSyncing}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
                        >
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {syncStatus === 'idle' && (
                        <>
                            {/* Summary */}
                            {/* Summary */}
                            <div className="mb-8">
                                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 mb-3 uppercase tracking-wider">
                                    Summary
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    {/* Total Card */}
                                    <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-100 dark:border-gray-700 flex flex-col items-center justify-center">
                                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                                            Total Selected
                                        </span>
                                        <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                            {selectedRecords.length}
                                        </span>
                                    </div>

                                    {/* To Add Card */}
                                    <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-lg border border-green-100 dark:border-green-800/30 flex flex-col items-center justify-center">
                                        <span className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wide mb-1">
                                            To Add
                                        </span>
                                        <span className="text-2xl font-bold text-green-700 dark:text-green-400">
                                            {newOrders.length}
                                        </span>
                                    </div>

                                    {/* Skipped Card */}
                                    <div className={`p-4 rounded-lg border flex flex-col items-center justify-center ${skippedOrders.length > 0
                                        ? 'bg-orange-50 dark:bg-orange-900/10 border-orange-100 dark:border-orange-800/30'
                                        : 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700 opacity-60'
                                        }`}>
                                        <span className={`text-xs font-medium uppercase tracking-wide mb-1 ${skippedOrders.length > 0
                                            ? 'text-orange-600 dark:text-orange-400 font-bold'
                                            : 'text-gray-500 dark:text-gray-400'
                                            }`}>
                                            Skipped (Existing)
                                        </span>
                                        <span className={`text-2xl font-bold ${skippedOrders.length > 0
                                            ? 'text-orange-700 dark:text-orange-400'
                                            : 'text-gray-400 dark:text-gray-500'
                                            }`}>
                                            {skippedOrders.length}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* New Orders List */}
                            {newOrders.length > 0 && (
                                <div className="mb-6">
                                    <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4 uppercase tracking-wider">
                                        New Orders
                                    </h4>
                                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                                            {newOrders.map((record, index) => (
                                                <div
                                                    key={record.id}
                                                    className={`p-3 flex items-center justify-between group transition-colors ${index % 2 === 0
                                                        ? 'bg-white dark:bg-gray-900'
                                                        : 'bg-gray-50 dark:bg-gray-800/30'
                                                        }`}
                                                >
                                                    <div className="flex-1 min-w-0 pr-4">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-gray-900 dark:text-white text-sm">
                                                                #{record.order_id}
                                                            </span>
                                                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                                                • {getAccountLabel(record.account)}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                                                            {record.details?.items?.[0]?.name || 'Product'}
                                                            {record.details?.items && record.details.items.length > 1 && ` + ${record.details.items.length - 1}`}
                                                        </p>
                                                    </div>
                                                    <span className="text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                                        ${record.amount}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Skipped Orders */}
                            {skippedOrders.length > 0 && (
                                <div className="opacity-60">
                                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
                                        Already Synced
                                    </h4>
                                    <div className="space-y-1">
                                        {skippedOrders.map(record => (
                                            <div
                                                key={record.id}
                                                className="py-1 flex items-center gap-2 text-xs text-gray-400"
                                            >
                                                <span>#{record.order_id}</span>
                                                <span>•</span>
                                                <span>{getAccountLabel(record.account)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {syncStatus === 'loading' && (
                        <div className="text-center py-8">
                            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                            <p className="text-gray-600 dark:text-gray-400">Checking existing orders...</p>
                        </div>
                    )}

                    {syncStatus === 'syncing' && (
                        <div className="text-center py-8">
                            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                            <p className="text-gray-600 dark:text-gray-400">{syncMessage}</p>
                        </div>
                    )}

                    {syncStatus === 'success' && (
                        <div className="text-center py-8">
                            <div className="text-6xl mb-4">✅</div>
                            <p className="text-lg font-medium text-green-600 dark:text-green-400">{syncMessage}</p>
                        </div>
                    )}

                    {syncStatus === 'error' && (
                        <div className="text-center py-8">
                            <div className="text-6xl mb-4">❌</div>
                            <p className="text-lg font-medium text-red-600 dark:text-red-400">{syncMessage}</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        disabled={isSyncing}
                        className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md disabled:opacity-50"
                    >
                        {syncStatus === 'success' ? 'Close' : 'Cancel'}
                    </button>

                    {syncStatus === 'idle' && newOrders.length > 0 && (
                        <button
                            onClick={handleConfirmSync}
                            disabled={isSyncing}
                            className="px-6 py-2 bg-gray-900 hover:bg-black dark:bg-white dark:text-black dark:hover:bg-gray-200 disabled:bg-gray-400 text-white rounded-md font-medium transition-colors"
                        >
                            Confirm Sync
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default PreviewSyncModal;
