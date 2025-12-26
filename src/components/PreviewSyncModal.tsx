import React, { useState, useEffect } from 'react';
import { Record } from '../types';
import { syncRecordsToGoogleSheet, getNewAndExistingOrders } from '../services/googleSheetService';
import { getGoogleAccessToken } from '../services/authService';
import { getSettings } from '../services/firebaseService';
import { useDashboard } from '../contexts/DashboardContext';

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
                        const date = new Date(firstRecord.dt_local);
                        const month = date.toLocaleString('vi-VN', { month: 'numeric', timeZone: 'America/Los_Angeles' });
                        const year = date.toLocaleString('vi-VN', { year: 'numeric', timeZone: 'America/Los_Angeles' });
                        const monthKey = `Tháng ${month} - ${year}`;

                        const { newOrders: newRecs, existingOrders: existingRecs } = await getNewAndExistingOrders(
                            settings.googleSheetId,
                            monthKey,
                            selectedRecords,
                            accessToken
                        );

                        setNewOrders(newRecs);
                        setSkippedOrders(existingRecs);
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
            const result = await syncRecordsToGoogleSheet(
                sheetId,
                selectedRecords,
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

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
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
                            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                                    Sync Summary
                                </h3>
                                <div className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
                                    <p>📊 Total selected: <strong>{selectedRecords.length}</strong> orders</p>
                                    <p>✅ Will be added: <strong>{newOrders.length}</strong> new orders</p>
                                    {skippedOrders.length > 0 && (
                                        <p>⏭️ Will be skipped: <strong>{skippedOrders.length}</strong> (already exist)</p>
                                    )}
                                </div>
                            </div>

                            {/* New Orders List */}
                            {newOrders.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="font-semibold text-gray-900 dark:text-white mb-3">
                                        Orders to be added:
                                    </h4>
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {newOrders.map(record => (
                                            <div
                                                key={record.id}
                                                className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <span className="font-medium text-gray-900 dark:text-white">
                                                            #{record.order_id}
                                                        </span>
                                                        <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                                                            {record.account}
                                                        </span>
                                                    </div>
                                                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                        ${record.amount}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-1">
                                                    {record.details?.items?.[0]?.name || 'No product'}
                                                    {record.details?.items && record.details.items.length > 1 && ` + ${record.details.items.length - 1} more`}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Skipped Orders */}
                            {skippedOrders.length > 0 && (
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white mb-3">
                                        Orders already in sheet (will skip):
                                    </h4>
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {skippedOrders.map(record => (
                                            <div
                                                key={record.id}
                                                className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm"
                                            >
                                                <span className="font-medium">#{record.order_id}</span>
                                                <span className="ml-2 text-gray-600 dark:text-gray-400">
                                                    {record.account}
                                                </span>
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
                            className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-md font-medium flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M19 19H5V5H19V19M12 13H7V11H12V13M17 9H7V7H17V9M17 17H7V15H17V17Z" />
                            </svg>
                            Confirm & Sync
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PreviewSyncModal;
