import { useEffect, useRef } from 'react';
import { Record, Account } from '../types';
import { syncRecordsToGoogleSheet } from '../services/googleSheetService';
import { getSettings } from '../services/firebaseService';

interface AutoSyncOptions {
    enabled: boolean;
    teamId: string;
    records: Record[];
    allAccounts: Account[];
    timeZone: string;
    onSyncSuccess?: (count: number) => void;
    onSyncError?: (error: string) => void;
}

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const LAST_SYNC_KEY = 'lastAutoSyncTimestamp';

/**
 * Hook to automatically sync records to Google Sheets
 * Runs every 5 minutes when enabled
 * Only syncs new orders since last sync
 */
export const useAutoSync = ({
    enabled,
    teamId,
    records,
    allAccounts,
    timeZone,
    onSyncSuccess,
    onSyncError
}: AutoSyncOptions) => {
    const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const isSyncingRef = useRef(false);

    const performAutoSync = async () => {
        // Prevent concurrent syncs
        if (isSyncingRef.current) {
            console.log('[Auto-Sync] Already syncing, skipping...');
            return;
        }

        // Check if online
        if (!navigator.onLine) {
            console.log('[Auto-Sync] Offline, skipping sync...');
            return;
        }

        try {
            isSyncingRef.current = true;

            // Get settings to check if auto-sync is still enabled and get sheet config
            const settings = await getSettings(teamId);

            if (!settings.autoSyncToSheet) {
                console.log('[Auto-Sync] Auto-sync disabled in settings, stopping...');
                return;
            }

            if (!settings.googleSheetId || !settings.sheetAccount) {
                console.log('[Auto-Sync] Missing sheet configuration, skipping...');
                return;
            }

            // Get last sync timestamp
            const lastSyncTime = localStorage.getItem(LAST_SYNC_KEY);
            const lastSyncTimestamp = lastSyncTime ? parseInt(lastSyncTime, 10) : 0;

            console.log(`[Auto-Sync] Last sync: ${lastSyncTimestamp ? new Date(lastSyncTimestamp).toLocaleString() : 'Never'}`);
            console.log(`[Auto-Sync] Total records: ${records.length}`);

            // Filter: Only ORDERS (not refunds), created/modified since last sync
            const newRecords = records.filter(record => {
                // CRITICAL: Only sync orders, not refunds or other types
                if (record.kind !== 'order') return false;

                const recordTimestamp = new Date(record.dt_local).getTime();
                return recordTimestamp > lastSyncTimestamp;
            });

            console.log(`[Auto-Sync] New ORDERS since last sync: ${newRecords.length}`);

            if (newRecords.length === 0) {
                console.log('[Auto-Sync] ℹ️ No new orders to sync');
                return;
            }

            console.log(`[Auto-Sync] Starting sync of ${newRecords.length} new records...`);

            // Perform sync
            const result = await syncRecordsToGoogleSheet(
                settings.googleSheetId,
                newRecords,
                settings.sheetAccount,
                allAccounts,
                timeZone
            );

            if (result.success) {
                // Update last sync timestamp
                localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());

                console.log(`[Auto-Sync] ✅ Successfully synced ${newRecords.length} records`);

                if (onSyncSuccess) {
                    onSyncSuccess(newRecords.length);
                }
            } else {
                console.error('[Auto-Sync] ❌ Sync failed:', result.message);

                if (onSyncError) {
                    onSyncError(result.message);
                }
            }
        } catch (error: any) {
            console.error('[Auto-Sync] ❌ Error during auto-sync:', error);

            if (onSyncError) {
                onSyncError(error.message || 'Unknown error');
            }
        } finally {
            isSyncingRef.current = false;
        }
    };

    useEffect(() => {
        // Clear any existing interval
        if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
        }

        if (!enabled || !teamId || records.length === 0) {
            return;
        }

        console.log('[Auto-Sync] Enabled - will sync every 5 minutes');

        // Perform initial sync after 30 seconds (to avoid immediate sync on load)
        const initialSyncTimeout = setTimeout(() => {
            performAutoSync();
        }, 30000); // 30 seconds delay

        // Set up interval for periodic syncs
        syncIntervalRef.current = setInterval(() => {
            performAutoSync();
        }, AUTO_SYNC_INTERVAL);

        // Cleanup
        return () => {
            clearTimeout(initialSyncTimeout);
            if (syncIntervalRef.current) {
                clearInterval(syncIntervalRef.current);
                syncIntervalRef.current = null;
            }
        };
    }, [enabled, teamId, records.length, allAccounts.length, timeZone]);

    // Listen to online/offline events
    useEffect(() => {
        const handleOnline = () => {
            console.log('[Auto-Sync] Back online - will sync on next interval');
            // Optionally trigger immediate sync when coming back online
            if (enabled && !isSyncingRef.current) {
                setTimeout(performAutoSync, 5000); // Sync 5 seconds after coming online
            }
        };

        const handleOffline = () => {
            console.log('[Auto-Sync] Went offline - syncs paused');
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [enabled]);

    return {
        performManualSync: performAutoSync,
        isSyncing: isSyncingRef.current
    };
};
