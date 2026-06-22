import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/firebaseAdminHelper.js';
import { processTeamSync } from './_lib/syncService.js';



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

        // 🟢 MODE 1: WEBHOOK TRIGGER (Specific Team)
        // Check if teamId is provided (e.g. ?teamId=... or body { teamId: ... })
        const specificTeamId = (req.query.teamId as string) || (req.body?.teamId as string);

        if (specificTeamId) {
            console.log(`[Auto-Sync API] 🚀 Webhook triggered for team: ${specificTeamId}`);
            const result = await processTeamSync(specificTeamId);

            if (result.success) {
                return res.status(200).json({
                    success: true,
                    message: `Synced ${result.recordsSynced} records for team ${specificTeamId}`,
                    result
                });
            } else {
                return res.status(200).json({ // Return 200 even on logical failure to avoid retries if not needed, or 400/500? Let's stick to 200 with success:false for client handling
                    success: false,
                    message: result.error,
                    result
                });
            }
        }

        // 🟢 MODE 2: CRON JOB (All Teams)
        console.log('[Auto-Sync API] 🔄 Running cron job for ALL teams...');
        const results: any[] = [];
        let totalSynced = 0;

        // Step 1: Find all teams with auto-sync enabled
        // Optimization: In a real large-scale app, we might want to query for users with autoSyncToSheet=true
        // But here we iterate all users as per original logic (simplifies querying if settings are in a subcollection)
        const usersSnapshot = await db.collection('user').get();

        for (const userDoc of usersSnapshot.docs) {
            const teamId = userDoc.id;

            // We delegate the check for "enabled" and the actual sync to the service
            const result = await processTeamSync(teamId);

            // Filter out "skipped" results (errors usually mean skipped due to config)
            if (result.error !== 'Auto-sync disabled') {
                results.push(result);
                totalSynced += result.recordsSynced;
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

