import { getDb } from './firebaseAdminHelper.js';
import { syncRecordsToGoogleSheet } from './googleSheetSyncHelper.js';

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
export async function getAccessToken(refreshToken: string): Promise<string> {
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
    // Converting timestamp to ISO string for comparison
    const lastSyncISO = new Date(lastSyncTimestamp).toISOString();

    // Using dt_local string comparison (assuming dt_local is ISO string)
    // Note: This relies on dt_local being comparable as string, which ISO8601 is.
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
 * Process sync for a single team
 */
export async function processTeamSync(teamId: string, forceSync: boolean = false): Promise<SyncResult> {
    const db = getDb();

    // Get team settings
    const settingsDoc = await db
        .collection('user')
        .doc(teamId)
        .collection('settings')
        .doc('config')
        .get();

    if (!settingsDoc.exists) {
        return { teamId, success: false, recordsSynced: 0, error: 'Settings not found' };
    }

    const settings = settingsDoc.data() as TeamSettings;

    // Skip if auto-sync is not enabled, unless forced
    if (!settings.autoSyncToSheet && !forceSync) {
        return { teamId, success: true, recordsSynced: 0, error: 'Auto-sync disabled' };
    }

    // Validate required settings
    if (!settings.googleSheetId || !settings.sheetAccount) {
        console.warn(`[Sync Service] Team ${teamId} missing sheet config`);
        return {
            teamId,
            success: false,
            recordsSynced: 0,
            error: 'Missing sheet configuration'
        };
    }

    try {
        console.log(`[Sync Service] Processing team ${teamId}...`);

        // Get last sync timestamp (default to 5 minutes ago)
        // If forceSync is true, we might still want to respect the last sync time to avoid dupes, 
        // OR we might rely on the sheet sync helper's deduplication.
        // The sheet sync helper deduplicates by Order ID.
        // However, fetching "records since X" is an optimization.
        // Let's stick to "since last sync" logic to be efficient.
        const lastSyncTimestamp = settings.lastServerAutoSync || (Date.now() - 5 * 60 * 1000);

        // Get new records
        const newRecords = await getNewRecordsSince(teamId, lastSyncTimestamp);

        if (newRecords.length === 0) {
            console.log(`[Sync Service] Team ${teamId}: No new records`);
            return {
                teamId,
                success: true,
                recordsSynced: 0
            };
        }

        console.log(`[Sync Service] Team ${teamId}: Found ${newRecords.length} new records`);

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
            console.log(`[Sync Service] Team ${teamId}: ✅ Synced ${syncResult.count} records`);
            return {
                teamId,
                success: true,
                recordsSynced: syncResult.count
            };
        } else {
            console.error(`[Sync Service] Team ${teamId}: ❌ ${syncResult.message}`);
            return {
                teamId,
                success: false,
                recordsSynced: 0,
                error: syncResult.message
            };
        }

    } catch (error: any) {
        console.error(`[Sync Service] Team ${teamId} error:`, error);
        return {
            teamId,
            success: false,
            recordsSynced: 0,
            error: error.message
        };
    }
}
