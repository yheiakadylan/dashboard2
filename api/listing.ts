// File: api/listing.ts (Gateway for Extension)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/firebaseAdminHelper.js';
import fetch from 'node-fetch';

// Allow CORS
function allowCors(fn: Function) {
    return async (req: VercelRequest, res: VercelResponse) => {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
        res.setHeader(
            'Access-Control-Allow-Headers',
            'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
        );
        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }
        return await fn(req, res);
    };
}

/**
 * Unified API for Extension
 * Actions:
 * 1. login: Authenticate user & return teamId + shops
 * 2. get-shops: Fetch shops for a teamId
 * 3. save: Save crawled listings
 */
async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { action, email, password, teamId, shopId, userId, listings, token } = req.body;

    console.log(`[API Extension] Action: ${action || 'save (default)'}`);

    try {
        const db = getDb();

        // --- ACTION: LOGIN ---
        if (action === 'login') {
            if (!email || !password) {
                return res.status(400).json({ message: 'Email and password required' });
            }

            // Verify with Firebase Auth REST API using the client-side key
            // Note: In Vercel serverless, client env vars starting with VITE_ might not be exposed as process.env.VITE_... unless configured.
            // But we can try fallback or assume user set it.
            // Based on checking service/firebaseService.ts, it is VITE_FIREBASE_API_KEY
            const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
            if (!apiKey) {
                console.error('API Key Missing. Env vars:', Object.keys(process.env));
                return res.status(500).json({ message: 'Server misconfiguration: API Key missing' });
            }

            // Call Identity Toolkit
            const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
                method: 'POST',
                body: JSON.stringify({ email, password, returnSecureToken: true }),
                headers: { 'Content-Type': 'application/json' }
            });

            const authData: any = await authRes.json();

            if (!authRes.ok) {
                return res.status(401).json({ message: authData.error?.message || 'Login failed' });
            }

            const uid = authData.localId; // User ID
            const userEmail = authData.email;

            // Assume Owner Mode: TeamID = UID
            const targetTeamId = uid;

            // Fetch Shops immediately
            const accountsRef = db.collection('user').doc(targetTeamId).collection('accounts');
            const snapshot = await accountsRef.get();

            const shops = snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    if (data.platforms && data.platforms.includes('etsy')) {
                        return { id: doc.id, label: data.label };
                    }
                    return null;
                })
                .filter(Boolean);

            return res.status(200).json({
                success: true,
                token: authData.idToken,
                refreshToken: authData.refreshToken,
                teamId: targetTeamId,
                email: userEmail,
                shops
            });
        }

        // --- ACTION: GET SHOPS ---
        if (action === 'get-shops') {
            if (!teamId) return res.status(400).json({ message: 'Missing teamId' });

            const accountsRef = db.collection('user').doc(teamId).collection('accounts');
            const snapshot = await accountsRef.get();

            const shops = snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    if (data.platforms && data.platforms.includes('etsy')) {
                        return { id: doc.id, label: data.label };
                    }
                    return null;
                })
                .filter(Boolean);

            return res.status(200).json({ shops });
        }

        // --- ACTION: DAILY SNAPSHOT ---
        if (action === 'daily_snapshot') {
            const { date } = req.body;
            if (!teamId || !date) {
                return res.status(400).json({ error: 'Missing teamId or date' });
            }

            console.log(`[API] Creating daily snapshot for ${teamId} on ${date}...`);

            // 1. Get Accounts
            const accountsRef = db.collection('user').doc(teamId).collection('accounts');
            const accountsSnapshot = await accountsRef.get();

            const accounts: any[] = [];
            accountsSnapshot.forEach((doc) => {
                const data = doc.data();
                if (data.platforms?.includes('etsy')) {
                    accounts.push({ id: doc.id, ...data });
                }
            });

            if (accounts.length === 0) {
                return res.json({ success: false, message: 'No Etsy accounts found' });
            }

            // 2. Calculate Stats
            const dayStartISO = new Date(date + 'T00:00:00Z').toISOString();
            const dayEndISO = new Date(date + 'T23:59:59.999Z').toISOString();

            let totalNew = 0;
            let totalRemoved = 0;
            let totalListings = 0;
            const shopStats: Record<string, any> = {};

            // Query each account (Parallel)
            const accountPromises = accounts.map(async (account) => {
                const listingsRef = db.collection('user').doc(teamId).collection('accounts').doc(account.id).collection('listings');

                try {
                    // New listings
                    const newSnapshot = await listingsRef
                        .where('createdAt', '>=', dayStartISO)
                        .where('createdAt', '<=', dayEndISO)
                        .where('status', '==', 'active')
                        .get();

                    // Removed listings
                    const removedSnapshot = await listingsRef
                        .where('updatedAt', '>=', dayStartISO)
                        .where('updatedAt', '<=', dayEndISO)
                        .where('status', '==', 'inactive')
                        .get();

                    const newCount = newSnapshot.size;
                    const removedCount = removedSnapshot.size;

                    if (newCount > 0 || removedCount > 0) {
                        return {
                            id: account.id,
                            new: newCount,
                            removed: removedCount,
                            total: account.total_listings || 0
                        };
                    }
                } catch (error) {
                    console.error(`Error processing account ${account.id}:`, error);
                }
                return null;
            });

            const results = await Promise.all(accountPromises);

            results.forEach(res => {
                if (res) {
                    totalNew += res.new;
                    totalRemoved += res.removed;
                    shopStats[res.id] = {
                        new: res.new,
                        removed: res.removed,
                        total: res.total
                    };
                }
            });

            totalListings = accounts.reduce((sum, acc) => sum + (acc.total_listings || 0), 0);

            const stats = {
                date: date,
                new_listings: totalNew,
                removed_listings: totalRemoved,
                total_listings: totalListings,
                shops: shopStats,
                shops_crawled: Object.keys(shopStats).length,
                createdAt: new Date().toISOString(),
                source: 'api-snapshot'
            };

            // 3. Save Snapshot
            await db.collection('user').doc(teamId).collection('daily-stats').doc(date).set(stats);
            console.log(`✅ Snapshot saved: ${totalNew} new, ${totalRemoved} removed`);
            return res.json({ success: true, stats });
        }

        // --- ACTION: SAVE (Default) ---
        if (!action || action === 'save') {
            if (!teamId || !shopId || !Array.isArray(listings)) {
                return res.status(400).json({ message: 'Missing fields for save (teamId, shopId, listings)' });
            }

            const listingsRef = db.collection('user').doc(teamId).collection('accounts').doc(shopId).collection('listings');

            // ========== MANIFEST STRATEGY (Optimized) ==========
            // Read manifest to get existing listing hashes (1 read instead of 333!)
            const manifestRef = db.collection('user').doc(teamId).collection('manifests').doc(shopId);
            const manifestSnap = await manifestRef.get();

            let manifestData: Record<string, string> = {};
            if (manifestSnap.exists) {
                manifestData = manifestSnap.data()?.listings || {};
            }

            // Fetch inactive IDs to detect reactivation (preserve createdAt for reactivated listings)
            const inactiveQuery = await listingsRef.where('status', '==', 'inactive').get();
            const inactiveIds = new Set(inactiveQuery.docs.map(doc => doc.id));

            // Process scraped listings
            const scrapedIds = new Set<string>();
            const newManifestData: Record<string, string> = {};

            let added = 0, updated = 0, removed = 0, skipped = 0;
            const now = new Date().toISOString();

            // Batch processing
            const chunks = [];
            for (let i = 0; i < listings.length; i += 500) {
                chunks.push(listings.slice(i, i + 500));
            }

            for (const chunk of chunks) {
                const batch = db.batch();

                chunk.forEach((item: any) => {
                    const listingId = String(item.listing_id);

                    // Data validation
                    if (!item.listing_id || !item.title) {
                        console.warn('[Validation] Skipping invalid listing:', { listing_id: item.listing_id, has_title: !!item.title });
                        skipped++;
                        return;
                    }

                    scrapedIds.add(listingId);

                    // Create hash for change detection (title|image|price|url)
                    const currentHash = [item.title || '', item.image || '', item.price || '', item.url || ''].join('|');
                    const knownHash = manifestData[listingId];
                    const isReactivation = inactiveIds.has(listingId);

                    const docRef = listingsRef.doc(listingId);

                    if (!knownHash) {
                        // NEW listing (or first time seeing it)
                        const payload: any = {
                            ...item,
                            account_id: shopId,
                            status: 'active',
                            updatedAt: now,
                            crawled_by: userId || 'extension_v2'
                        };

                        // Set createdAt only if NOT reactivation
                        if (!isReactivation) {
                            payload.createdAt = now;
                        }

                        batch.set(docRef, payload, { merge: true });
                        newManifestData[listingId] = currentHash;
                        added++;

                    } else if (knownHash !== currentHash) {
                        // UPDATED listing (hash changed)
                        batch.set(docRef, {
                            ...item,
                            status: 'active',
                            updatedAt: now,
                            crawled_by: userId || 'extension_v2'
                        }, { merge: true });
                        newManifestData[listingId] = currentHash;
                        updated++;

                    } else {
                        // NO CHANGE in hash, but might need to reactivate
                        if (isReactivation) {
                            batch.set(docRef, {
                                ...item,
                                status: 'active',
                                updatedAt: now,
                                crawled_by: userId || 'extension_v2'
                            }, { merge: true });
                        }
                        newManifestData[listingId] = currentHash;
                    }
                });

                try {
                    await batch.commit();
                } catch (error) {
                    console.error('[Extension API] Failed to commit batch:', error);
                    throw new Error(`Batch commit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Detect removed listings (in manifest but not in crawl)
            let removedBatch = db.batch();
            let removedCount = 0;

            for (const id in manifestData) {
                if (!scrapedIds.has(id)) {
                    // Use .set() with merge instead of .update() to handle missing docs
                    // If doc doesn't exist, this will create it as inactive
                    // If doc exists, this will update it to inactive
                    removedBatch.set(listingsRef.doc(id), {
                        status: 'inactive',
                        inactivatedAt: now,
                        updatedAt: now
                    }, { merge: true }); // ✅ merge: true prevents "No document to update" error

                    removed++;
                    removedCount++;

                    // Commit in batches of 500
                    if (removedCount % 500 === 0) {
                        try {
                            await removedBatch.commit();
                            removedBatch = db.batch(); // Reset batch after commit
                        } catch (error) {
                            console.error('[Extension API] Failed to commit removed batch (intermediate):', error);
                            throw new Error(`Removed batch commit failed at ${removedCount}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                    }
                }
            }

            if (removedCount % 500 !== 0 && removedCount > 0) {
                try {
                    await removedBatch.commit();
                } catch (error) {
                    console.error('[Extension API] Failed to commit removed batch:', error);
                    throw new Error(`Removed batch commit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Update manifest
            const finalBatch = db.batch();

            finalBatch.set(manifestRef, {
                listings: newManifestData,
                updatedAt: now // ISO string for consistency
            });

            // Update account stats
            finalBatch.update(db.collection('user').doc(teamId).collection('accounts').doc(shopId), {
                last_listing_crawl: now,
                total_listings: scrapedIds.size,
                last_crawl_stats: {
                    added,
                    updated,
                    removed,
                    skipped,
                    timestamp: now
                }
            });

            try {
                await finalBatch.commit();
            } catch (error) {
                console.error('[Extension API] Failed to commit final batch:', error);
                throw new Error(`Final batch commit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            return res.status(200).json({
                success: true,
                count: listings.length,
                stats: {
                    added,
                    updated,
                    removed,
                    skipped,
                    total: scrapedIds.size
                }
            });
        }

        return res.status(400).json({ message: 'Unknown action' });

    } catch (error: any) {
        console.error('[API Extension Error]', error);
        return res.status(500).json({ message: error.message });
    }
}

export default allowCors(handler);
