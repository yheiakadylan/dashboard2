import { db } from './firebaseService';
import { collection, query, where, getDocs, writeBatch, doc, updateDoc } from 'firebase/firestore';
import { Listing } from '../types/listing';
import { Account } from '../types';

export interface ScrapedListing {
    listing_id: string;
    title: string;
    image: string;
    url: string;
    price?: string;
}

// Anti-bot configuration
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// Proxy configuration từ env hoặc hardcoded
const PROXY_CONFIG = {
    host: '94.103.56.26',
    port: '47921',
    username: 'Ae3ZIvlEmiwETwS',
    password: 'gcPGYU5SJztOhQj'
};

export const scrapeEtsyShop = async (shopUrl: string): Promise<ScrapedListing[]> => {
    const headers = {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Referer': 'https://www.etsy.com/',
        'Cache-Control': 'max-age=0'
    };

    const targetUrl = `${shopUrl}/items`;

    try {
        // CORS Proxy Options (in order of preference):
        // 1. ScraperAPI (paid, most reliable) - if env var is set
        // 2. Local Vercel serverless function (bypasses CORS + Cloudflare better)
        // 3. AllOrigins (free CORS proxy, but blocked by Cloudflare)

        let finalUrl: string;
        let fetchOptions: RequestInit = { credentials: 'omit' };

        if (import.meta.env.VITE_PROXY_API_URL) {
            // Option 1: ScraperAPI or custom proxy
            finalUrl = `${import.meta.env.VITE_PROXY_API_URL}?api_key=${import.meta.env.VITE_PROXY_API_KEY}&url=${encodeURIComponent(targetUrl)}`;
            fetchOptions.headers = headers;
        } else {
            // Option 2: Use Firebase Cloud Function
            // Get from env or use default region
            const functionUrl = import.meta.env.VITE_FIREBASE_FUNCTION_URL ||
                'https://proxyetsy-nj5q4gsfsq-uc.a.run.app';
            finalUrl = `${functionUrl}?url=${encodeURIComponent(targetUrl)}`;
            fetchOptions.headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            };
        }

        const response = await fetch(finalUrl, fetchOptions);

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Rate limited by Etsy. Please wait and try again.');
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        // Check for Captcha (relaxed - only throw if certain)
        const lowerHtml = html.toLowerCase();
        if (lowerHtml.includes('security challenge') ||
            lowerHtml.includes('are you a robot')) {
            throw new Error('Captcha detected. Please try again later or use a different proxy.');
        }

        // Parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const listings: ScrapedListing[] = [];

        // Try multiple selectors vì Etsy có thể đổi class names
        let listingElements = doc.querySelectorAll('[data-listing-id]');

        if (listingElements.length === 0) {
            // Fallback: tìm theo pattern khác
            listingElements = doc.querySelectorAll('.wt-grid__item-xs-6');
        }

        listingElements.forEach(el => {
            const listing_id = el.getAttribute('data-listing-id') ||
                el.querySelector('a')?.href.match(/\/listing\/(\d+)/)?.[1];

            const titleEl = el.querySelector('.v2-listing-card__title, .listing-title, h3');
            const title = titleEl?.textContent?.trim();

            const imgEl = el.querySelector('img');
            const image = imgEl?.src || imgEl?.getAttribute('data-src');

            const linkEl = el.querySelector('a');
            const url = linkEl?.href;

            if (listing_id && title && image && url) {
                listings.push({
                    listing_id,
                    title,
                    image: image.split('?')[0], // Remove query params
                    url: url.startsWith('http') ? url : `https://www.etsy.com${url}`
                });
            }
        });

        // Random delay sau mỗi request
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

        return listings;
    } catch (error) {
        console.error('Scrape error:', error);
        throw error;
    }
};

import { getDoc, setDoc } from 'firebase/firestore';

export const crawlAccount = async (
    teamId: string,
    account: Account,
    onProgress?: (status: string) => void,
    preScrapedListings?: ScrapedListing[]
): Promise<{ added: number; updated: number; removed: number }> => {
    let scrapedListings: ScrapedListing[];

    if (preScrapedListings) {
        scrapedListings = preScrapedListings;
    } else {
        const shopUrl = `https://www.etsy.com/shop/${account.label}`;
        onProgress?.(`Fetching listings from ${account.label}...`);
        scrapedListings = await scrapeEtsyShop(shopUrl);
    }

    onProgress?.(`Comparing with database (Nested V2)...`);

    // Check if scrape returned any results
    if (scrapedListings.length === 0) {
        console.warn(`[Crawl] ⚠️ No listings found for ${account.label}. Shop might be empty or scrape failed.`);
    } else {
        console.log(`[Crawl] Found ${scrapedListings.length} listings for ${account.label}`);
    }

    // MANIFEST STRATEGY (Unified with Extension API)
    // Use existing 'manifests' collection with account.id as document ID
    const manifestRef = doc(db, 'user', teamId, 'manifests', account.id);
    const manifestSnap = await getDoc(manifestRef);
    let manifestData: Record<string, string> = {};
    const missingCreatedAt = new Set<string>();

    if (manifestSnap.exists()) {
        manifestData = manifestSnap.data().listings || {};
    } else {
        onProgress?.('Building initial manifest & checking data...');
        // Query NESTED path to build manifest and check for broken docs
        const listingsRef = collection(db, 'user', teamId, 'accounts', account.id, 'listings');
        // Only verify active listings
        const q = query(listingsRef, where('status', '==', 'active'));
        const snp = await getDocs(q);
        snp.forEach(d => {
            const data = d.data();
            manifestData[d.id] = [data.title, data.image || '', data.price || ''].join('|');
            // Flag docs missing createdAt for backfill
            if (!data.createdAt) {
                missingCreatedAt.add(d.id);
            }
        });
    }

    // Query for inactive listings to detect reactivation
    const inactiveQuery = query(
        collection(db, 'user', teamId, 'accounts', account.id, 'listings'),
        where('status', '==', 'inactive')
    );
    const inactiveSnap = await getDocs(inactiveQuery);
    const inactiveIds = new Set<string>(inactiveSnap.docs.map(d => d.id));

    let added = 0, updated = 0, removed = 0;
    let skippedCount = 0; // Track validation skips
    const scrapedIds = new Set<string>();
    const batch = writeBatch(db);
    let opCount = 0;
    const nowString = new Date().toISOString();
    const now = new Date();

    const checkCommit = async () => {
        if (opCount >= 450) {
            await batch.commit();
            opCount = 0;
        }
    };

    const newManifestData: Record<string, string> = { ...manifestData };

    // 2. Process Scraped Listings
    for (const listing of scrapedListings) {
        // Data validation
        if (!listing.listing_id || !listing.title) {
            console.warn('[Validation] Skipping invalid listing:', { listing_id: listing.listing_id, has_title: !!listing.title });
            skippedCount++; // Track validation skips
            continue;
        }

        scrapedIds.add(listing.listing_id);
        const currentHash = [listing.title, listing.image, listing.price || '', listing.url || ''].join('|');
        const knownHash = manifestData[listing.listing_id];
        const isReactivation = inactiveIds.has(listing.listing_id);

        // Write to NESTED path: user/{teamId}/accounts/{accountId}/listings/{listingId}
        const docRef = doc(db, 'user', teamId, 'accounts', account.id, 'listings', listing.listing_id);

        // Treat as new if not known OR if we detected it's broken (missing createdAt)
        const isNewOrBroken = !knownHash || missingCreatedAt.has(listing.listing_id);

        if (isNewOrBroken) {
            // NEW (or Repair or Reactivation)
            const payload: any = {
                ...listing,
                account_id: account.id, // Keep for redundancy
                updatedAt: nowString,
                status: 'active'
            };

            // Only set createdAt if it's TRULY new (not reactivation) OR if we know it's broken
            if (!isReactivation || missingCreatedAt.has(listing.listing_id)) {
                payload.createdAt = nowString;
            }

            batch.set(docRef, payload, { merge: true });

            newManifestData[listing.listing_id] = currentHash;
            added++;
            opCount++;
        } else if (knownHash !== currentHash) {
            // UPDATED
            batch.set(docRef, {
                title: listing.title,
                image: listing.image,
                url: listing.url,
                price: listing.price, // Update price
                updatedAt: nowString,
                status: 'active'
            }, { merge: true });

            newManifestData[listing.listing_id] = currentHash;
            updated++;
            opCount++;
        } else {
            // NO CHANGE - keep in manifest, but check reactivation
            if (isReactivation) {
                batch.set(docRef, {
                    ...listing,
                    account_id: account.id,
                    status: 'active',
                    updatedAt: nowString
                }, { merge: true });
                opCount++;
            }
            newManifestData[listing.listing_id] = currentHash;
        }

        await checkCommit();
    }

    // 3. Detect Removed
    for (const id in manifestData) {
        if (!scrapedIds.has(id)) {
            // Use setDoc with merge instead of updateDoc to handle missing docs
            const docRef = doc(db, 'user', teamId, 'accounts', account.id, 'listings', id);
            batch.set(docRef, {
                status: 'inactive',
                inactivatedAt: nowString,
                updatedAt: nowString
            }, { merge: true }); // ✅ Prevents "No document to update" error

            delete newManifestData[id];
            removed++;
            opCount++;
            await checkCommit();
        }
    }

    onProgress?.(`Saving ${added + updated + removed} changes...`);

    // 4. Save Manifest
    if (added > 0 || updated > 0 || removed > 0 || !manifestSnap.exists()) {
        batch.set(manifestRef, {
            listings: newManifestData,
            updatedAt: nowString // ISO string for consistency with Extension API
        });
        opCount++;
    }

    // Final Commit
    if (opCount > 0) {
        await batch.commit();
    }

    // Update account stats
    const accountRef = doc(db, 'user', teamId, 'accounts', account.id);
    await updateDoc(accountRef, {
        total_listings: scrapedIds.size, // Use scrapedIds.size to exclude skipped listings
        last_listing_crawl: now
    });

    // Final summary log
    console.log(`[Crawl] Summary for ${account.label}: Added: ${added}, Updated: ${updated}, Removed: ${removed}, Skipped: ${skippedCount}, Total: ${scrapedIds.size}`);

    if (skippedCount > 0) {
        console.warn(`[Crawl] ⚠️ ${skippedCount} listings were skipped due to validation errors for ${account.label}`);
    }

    return { added, updated, removed };
};

export const crawlAllAccounts = async (
    teamId: string,
    accounts: Account[],
    onProgress?: (accountIndex: number, total: number, status: string) => void
): Promise<void> => {
    const etsyAccounts = accounts.filter(
        acc => acc.listing_tracking_enabled && acc.platforms?.includes('etsy')
    );

    for (let i = 0; i < etsyAccounts.length; i++) {
        const account = etsyAccounts[i];
        console.log(`[Crawl ${i + 1}/${etsyAccounts.length}] Starting: ${account.label} (${account.id})`);
        onProgress?.(i + 1, etsyAccounts.length, `Processing ${account.label}...`);

        try {
            const result = await crawlAccount(teamId, account, (status) => {
                onProgress?.(i + 1, etsyAccounts.length, status);
            });

            console.log(`[Crawl ${i + 1}/${etsyAccounts.length}] ✅ Success: ${account.label} - Added: ${result.added}, Updated: ${result.updated}, Removed: ${result.removed}`);

            // Delay 3-8s giữa các accounts
            if (i < etsyAccounts.length - 1) {
                const delay = 3000 + Math.random() * 5000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (error: any) {
            console.error(`[Crawl ${i + 1}/${etsyAccounts.length}] ❌ Error: ${account.label}:`, error.message);
            onProgress?.(i + 1, etsyAccounts.length, `Error: ${error.message}`);

            // ✅ IMPORTANT: Update account timestamp even on error so UI shows status
            try {
                const accountRef = doc(db, 'user', teamId, 'accounts', account.id);
                await updateDoc(accountRef, {
                    last_listing_crawl: new Date(),
                    last_crawl_error: error.message || 'Unknown error',
                    last_crawl_error_at: new Date()
                });
                console.log(`[Crawl ${i + 1}/${etsyAccounts.length}] 📝 Updated error status for: ${account.label}`);
            } catch (updateError) {
                console.error(`[Crawl ${i + 1}/${etsyAccounts.length}] ⚠️ Failed to update error status for ${account.label}:`, updateError);
            }

            // Nếu bị rate limit, đợi lâu hơn
            if (error.message.includes('Rate limited') || error.message.includes('429')) {
                console.log(`[Crawl ${i + 1}/${etsyAccounts.length}] ⏳ Rate limited, waiting 30s...`);
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }
    }
};
