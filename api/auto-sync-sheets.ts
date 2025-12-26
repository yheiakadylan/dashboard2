// File: api/auto-sync-sheets.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/firebaseAdminHelper.js';
import { syncRecordsToGoogleSheet } from './_lib/googleSheetSyncHelper.js';

/**
 * Auto-Sync to Google Sheets - Server-Side Cron API
 * 
 * This endpoint syncs new records to Google Sheets for all teams
 * that have auto-sync enabled.
 * 
 * Security: Requires CRON_SECRET2 in Authorization header
 * Usage: Set up a cron job to call this endpoint every 5 minutes
 * 
 * Example:
 * curl -X POST https://your-domain.vercel.app/api/auto-sync-sheets \
 *   -H "Authorization: Bearer YOUR_CRON_SECRET2"
 */

interface TeamSettings {
    googleSheetId?: string;
    sheetAccount?: {
        id: string;
        email: string;
        token: string;
        provider: string;
    };
    autoSyncToSheet?: boolean;
    lastServerAutoSync?: number; // Timestamp of last server auto-sync
}

interface SyncResult {
    teamId: string;
    success: boolean;
    recordsSynced: number;
    error?: string;
}

/**
 * Get Google access token from refresh token
 */
async function getAccessToken(refreshToken: string): Promise<string> {
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to refresh token: ${error}`);
    }

    const data = await response.json();
    return data.access_token;
}

/**
 * Get records created/modified since last sync
 */
async function getNewRecordsSince(
    teamId: string,
    lastSyncTimestamp: number
): Promise<any[]> {
    const db = getDb();
    const recordsRef = db.collection('user').doc(teamId).collection('records');

    // Get records with dt_local > lastSyncTimestamp
    const lastSyncISO = new Date(lastSyncTimestamp).toISOString();
    const snapshot = await recordsRef
        .where('dt_local', '>', lastSyncISO)
        .orderBy('dt_local', 'asc')
        .get();

    const records: any[] = [];
    snapshot.forEach(doc => {
        records.push({ id: doc.id, ...doc.data() });
    });

    return records;
}


/**
 * Main handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Security: Check CRON_SECRET2
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.CRON_SECRET2}`;

    if (authHeader !== expectedAuth) {
        console.error('[Auto-Sync API] Unauthorized request');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[Auto-Sync API] Starting auto-sync process...');

    try {
        const db = getDb();
        const results: SyncResult[] = [];
        let totalSynced = 0;

        // Step 1: Find all teams with auto-sync enabled
        const usersSnapshot = await db.collection('user').get();

        for (const userDoc of usersSnapshot.docs) {
            const teamId = userDoc.id;

            // Get team settings
            const settingsDoc = await db
                .collection('user')
                .doc(teamId)
                .collection('settings')
                .doc('config')
                .get();

            if (!settingsDoc.exists) {
                continue;
            }

            const settings = settingsDoc.data() as TeamSettings;

            // Skip if auto-sync is not enabled
            if (!settings.autoSyncToSheet) {
                continue;
            }

            // Validate required settings
            if (!settings.googleSheetId || !settings.sheetAccount) {
                console.warn(`[Auto-Sync API] Team ${teamId} has auto-sync enabled but missing sheet config`);
                results.push({
                    teamId,
                    success: false,
                    recordsSynced: 0,
                    error: 'Missing sheet configuration'
                });
                continue;
            }

            try {
                console.log(`[Auto-Sync API] Processing team ${teamId}...`);

                // Get last sync timestamp (default to 5 minutes ago)
                const lastSyncTimestamp = settings.lastServerAutoSync || (Date.now() - 5 * 60 * 1000);

                // Get new records
                const newRecords = await getNewRecordsSince(teamId, lastSyncTimestamp);

                if (newRecords.length === 0) {
                    console.log(`[Auto-Sync API] Team ${teamId}: No new records`);
                    results.push({
                        teamId,
                        success: true,
                        recordsSynced: 0
                    });
                    continue;
                }

                console.log(`[Auto-Sync API] Team ${teamId}: Found ${newRecords.length} new records`);

                // Get access token
                const accessToken = await getAccessToken(settings.sheetAccount.token);

                // Get all accounts for label mapping
                const accountsSnapshot = await db
                    .collection('user')
                    .doc(teamId)
                    .collection('accounts')
                    .get();

                const accountLabelMap = new Map<string, string>();
                accountsSnapshot.forEach(doc => {
                    const acc = doc.data();
                    accountLabelMap.set(acc.email, acc.label || acc.email);
                });

                // Sync to sheet using imported helper
                const syncResult = await syncRecordsToGoogleSheet(
                    settings.googleSheetId,
                    newRecords,
                    accessToken,
                    accountLabelMap,
                    'America/Los_Angeles' // UTC-7
                );


                if (syncResult.success) {
                    // Update last sync timestamp
                    await settingsDoc.ref.update({
                        lastServerAutoSync: Date.now()
                    });

                    totalSynced += syncResult.count;
                    results.push({
                        teamId,
                        success: true,
                        recordsSynced: syncResult.count
                    });

                    console.log(`[Auto-Sync API] Team ${teamId}: ✅ Synced ${syncResult.count} records`);
                } else {
                    results.push({
                        teamId,
                        success: false,
                        recordsSynced: 0,
                        error: syncResult.message
                    });
                    console.error(`[Auto-Sync API] Team ${teamId}: ❌ ${syncResult.message}`);
                }

            } catch (error: any) {
                console.error(`[Auto-Sync API] Team ${teamId} error:`, error);
                results.push({
                    teamId,
                    success: false,
                    recordsSynced: 0,
                    error: error.message
                });
            }
        }

        // Return summary
        const summary = {
            timestamp: new Date().toISOString(),
            totalTeamsProcessed: results.length,
            totalRecordsSynced: totalSynced,
            results
        };

        console.log(`[Auto-Sync API] ✅ Complete - Synced ${totalSynced} records across ${results.length} teams`);

        return res.status(200).json(summary);

    } catch (error: any) {
        console.error('[Auto-Sync API] Fatal error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
