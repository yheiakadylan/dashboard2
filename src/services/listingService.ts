import { db } from './firebaseService';
import { collection, query, where, getDocs, orderBy, limit, getCountFromServer, startAfter, doc, getDoc } from 'firebase/firestore';
import { Listing } from '../types/listing';
import { updateRecordsInFirebase } from './firebaseService';
import { Record, DailyStats } from '../types';
import { decodeHTMLEntities } from '../utils/htmlDecode';

export const getListingsForAccount = async (
    teamId: string,
    accountId: string,
    limitCount: number = 50,
    lastDoc?: any,
    status?: string, // 'all' | 'active' | 'inactive' | 'new'
    timeFilter?: Date | null
): Promise<{ listings: Listing[], lastDoc: any }> => {

    // Base Collection Reference
    const collectionRef = collection(db, 'user', teamId, 'accounts', accountId, 'listings');
    let constraints: any[] = [];

    // apply status filter
    if (status && status !== 'all') {
        if (status === 'new') {
            constraints.push(where('status', '==', 'active'));
            if (timeFilter) {
                const dateStr = timeFilter instanceof Date ? timeFilter.toISOString() : timeFilter;
                constraints.push(where('createdAt', '>=', dateStr));
            }
        } else {
            constraints.push(where('status', '==', status));
        }
    }

    // Sort logic
    if (status === 'inactive') {
        constraints.push(orderBy('updatedAt', 'desc'));
    } else {
        constraints.push(orderBy('createdAt', 'desc'));
    }

    constraints.push(limit(limitCount));

    // Construct Query
    let q = query(collectionRef, ...constraints);

    if (lastDoc) {
        q = query(q, startAfter(lastDoc));
    }

    const snapshot = await getDocs(q);

    const listings = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            listing_id: doc.id,
            ...data,
            status: data.status || 'active',
            createdAt: data.createdAt?.toDate?.() || data.createdAt || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || data.updatedAt || new Date()
        } as Listing;
    });

    return {
        listings,
        lastDoc: snapshot.docs[snapshot.docs.length - 1]
    };
};

export const getListingCount = async (
    teamId: string,
    accountId: string,
    status?: string,
    timeFilter?: Date | null
): Promise<number> => {
    let constraints: any[] = [];

    if (status && status !== 'all') {
        if (status === 'new') {
            constraints.push(where('status', '==', 'active'));
            if (timeFilter) {
                const dateStr = timeFilter instanceof Date ? timeFilter.toISOString() : timeFilter;
                constraints.push(where('createdAt', '>=', dateStr));
            }
        } else {
            constraints.push(where('status', '==', status));
        }
    }

    const q = query(
        collection(db, 'user', teamId, 'accounts', accountId, 'listings'),
        ...constraints
    );
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
};

export const getAllListingsPaginated = async (
    teamId: string,
    limitCount: number = 50,
    lastDoc?: any,
    status?: string,
    timeFilter?: Date | null,
    accessibleAccountIds?: string[]
): Promise<{ listings: Listing[], lastDoc: any }> => {
    try {
        // 1. Get Accounts
        const accountsRef = collection(db, 'user', teamId, 'accounts');
        const accountsSnap = await getDocs(accountsRef);
        let shops = accountsSnap.docs
            .filter(d => {
                const data = d.data();
                return data.platforms?.includes('etsy'); // Only Etsy shops
            })
            .map(d => ({ id: d.id, ...d.data() }));

        if (accessibleAccountIds && accessibleAccountIds.length > 0) {
            shops = shops.filter(shop => accessibleAccountIds.includes(shop.id));
        }

        if (shops.length === 0) return { listings: [], lastDoc: null };

        // 2. Query each account (Parallel)
        // If lastDoc exists, use its createdAt as the cursor (fetch items OLDER than cursor)
        const cursorDate = lastDoc ? (lastDoc.createdAt instanceof Date ? lastDoc.createdAt : new Date(lastDoc.createdAt)) : null;

        const promises = shops.map(async (shop) => {
            const listingsRef = collection(db, 'user', teamId, 'accounts', shop.id, 'listings');
            let constraints: any[] = [];

            if (status && status !== 'all') {
                if (status === 'new') {
                    constraints.push(where('status', '==', 'active'));
                    if (timeFilter) {
                        const dateStr = timeFilter instanceof Date ? timeFilter.toISOString() : timeFilter;
                        constraints.push(where('createdAt', '>=', dateStr));
                    }
                } else {
                    constraints.push(where('status', '==', status));
                }
            }

            // Pagination Cursor Logic (Time-based)
            if (cursorDate) {
                // Fetch items older than the last item on previous page
                constraints.push(where('createdAt', '<', cursorDate.toISOString()));
            }

            // Always sort by createdAt desc
            constraints.push(orderBy('createdAt', 'desc'));

            // Limit per shop (fetch enough to fill the page potentially)
            constraints.push(limit(limitCount));

            const q = query(listingsRef, ...constraints);
            const snapshot = await getDocs(q);

            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    listing_id: doc.id,
                    ...data,
                    account_id: shop.id,
                    createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt), // Ensure Date object
                    updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
                } as Listing;
            });
        });

        const results = await Promise.all(promises);
        const allListings = results.flat();

        // 3. Global Sort
        allListings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        // 4. Slice Page
        const pageListings = allListings.slice(0, limitCount);
        const newLastDoc = pageListings.length > 0 ? pageListings[pageListings.length - 1] : null;

        return {
            listings: pageListings,
            lastDoc: newLastDoc
        };

    } catch (e) {
        console.error('getAllListingsPaginated error:', e);
        return { listings: [], lastDoc: null };
    }
};

export const getAllListingsCount = async (
    teamId: string,
    status?: string,
    timeFilter?: Date | null,
    accessibleAccountIds?: string[]
): Promise<number> => {
    try {
        const accountsRef = collection(db, 'user', teamId, 'accounts');
        const accountsSnap = await getDocs(accountsRef);
        let shops = accountsSnap.docs.filter(d => d.data().platforms?.includes('etsy'));

        if (accessibleAccountIds && accessibleAccountIds.length > 0) {
            shops = shops.filter(shop => accessibleAccountIds.includes(shop.id));
        }

        const promises = shops.map(async (doc) => {
            const listingsRef = collection(db, 'user', teamId, 'accounts', doc.id, 'listings');
            const constraints: any[] = [];

            if (status && status !== 'all') {
                if (status === 'new') {
                    constraints.push(where('status', '==', 'active'));
                    if (timeFilter) {
                        const dateStr = timeFilter instanceof Date ? timeFilter.toISOString() : timeFilter;
                        constraints.push(where('createdAt', '>=', dateStr));
                    }
                } else {
                    constraints.push(where('status', '==', status));
                }
            }

            const q = query(listingsRef, ...constraints);
            const snapshot = await getCountFromServer(q);
            return snapshot.data().count;
        });

        const counts = await Promise.all(promises);
        return counts.reduce((sum, c) => sum + c, 0);
    } catch (e) {
        console.error('getAllListingsCount error:', e);
        return 0;
    }
};

export const getNewListingsCount = async (teamId: string, accountId: string, hours: number = 24): Promise<number> => {
    const timeThreshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(); // ISO string to match DB format

    try {
        const q = query(
            collection(db, 'user', teamId, 'accounts', accountId, 'listings'),
            where('status', '==', 'active'),
            where('createdAt', '>', timeThreshold) // Compare ISO strings
        );

        const snapshot = await getCountFromServer(q);
        const count = snapshot.data().count;
        return count;
    } catch (error: any) {
        console.error('[getNewListingsCount] Error:', error);
        return 0;
    }
};


const extractEtsyImageId = (url: string | undefined): string | null => {
    if (!url) return null;
    const match = url.match(/il_[^\.]+\.(\d+)[_\.]/);
    return match ? match[1] : null;
};

// Helper to build Image Map (Exported for use in sync)
export const getImageMapFromManifests = async (teamId: string): Promise<Map<string, string>> => {
    const imageMap = new Map<string, string>(); // ImageID -> ListingID
    try {
        const manifestsCol = collection(db, 'user', teamId, 'manifests');
        const manifestsSnap = await getDocs(manifestsCol);

        manifestsSnap.forEach(doc => {
            const data = doc.data();
            const listings = data.listings || {}; // ID -> Hash "title|image|price"

            Object.entries(listings).forEach(([listingId, hash]) => {
                if (typeof hash === 'string') {
                    const parts = hash.split('|');
                    const imgIndex = parts.findIndex(p => p.startsWith('http'));
                    const imageUrl = imgIndex > 0 ? parts[imgIndex] : parts[1];
                    const imgId = extractEtsyImageId(imageUrl);
                    if (imgId) {
                        imageMap.set(imgId, listingId);
                    }
                }
            });
        });
    } catch (e) {
        console.error('Error reading manifests:', e);
    }
    return imageMap;
}

export const applyListingIdsToRecord = (record: Record, imageMap: Map<string, string>): { hasChanges: boolean, record: Record } => {
    let hasChanges = false;
    let newItems = record.details?.items ? [...record.details.items] : undefined;

    if (newItems) {
        newItems = newItems.map(item => {
            if (item.listing_id) {
                return item;
            }

            const imgId = extractEtsyImageId(item.image);
            if (imgId && imageMap.has(imgId)) {
                hasChanges = true;
                const foundId = imageMap.get(imgId)!;
                return { ...item, listing_id: foundId };
            }
            return item;
        });
    }

    if (!hasChanges) return { hasChanges: false, record };

    return {
        hasChanges: true,
        record: {
            ...record,
            details: record.details ? {
                ...record.details,
                items: newItems || []
            } : record.details
        }
    };
};

const isDev = import.meta.env.DEV;

 //Builds mapping maps for efficient lookup in data processing worker \u2014 optimized for partial matching
export const getListingMappingMaps = async (teamId: string, accountIds: string[]) => {
    if (isDev) console.log('[listingService] getListingMappingMaps called for team:', teamId, 'with', accountIds.length, 'accounts');
    const imageMap = new Map<string, string>(); // Full Image URL -> ListingID
    const nameMap = new Map<string, string>(); // Title -> ListingID

    const normalizeForMapping = (title: string | undefined) => {
        if (!title) return '';
        let t = decodeHTMLEntities(title).trim().toLowerCase();
        return t.split(/[\-\u2013\u2014\(\[,\/]/)[0].trim();
    };

    try {
        // Strict Fetch ONLY from Manifests (Global data)
        try {
            const dbPath = `user/${teamId}/manifests`;
            if (isDev) console.log(`[listingService] 🚀 EXACT DB FETCH PATH: ${dbPath}`);
            
            const manifestsCol = collection(db, 'user', teamId, 'manifests');
            const manifestsSnap = await getDocs(manifestsCol);
            
            if (isDev) console.log(`[listingService] 📬 Received ${manifestsSnap.size} manifest documents from ${dbPath}`);
            
            manifestsSnap.forEach(doc => {
                const data = doc.data();
                const listings = data.listings || {}; // ID -> Hash "title|image|price"
                Object.entries(listings).forEach(([listingId, hash]) => {
                    if (typeof hash === 'string') {
                        const parts = hash.split('|');
                        const imgIndex = parts.findIndex(p => p.startsWith('http'));
                        const title = imgIndex > 0 ? parts.slice(0, imgIndex).join('|') : parts[0];
                        const imageUrl = imgIndex > 0 ? parts[imgIndex] : parts[1];

                        if (imageUrl && imageUrl.trim()) {
                            imageMap.set(imageUrl.trim(), listingId);
                        }
                        
                        if (title) {
                            const fullTitle = decodeHTMLEntities(title).trim().toLowerCase();
                            const baseName = normalizeForMapping(title);
                            if (!nameMap.has(fullTitle)) nameMap.set(fullTitle, listingId);
                            if (baseName && !nameMap.has(baseName)) nameMap.set(baseName, listingId);
                        }
                    }
                });
            });
        } catch (manifestErr) {
            if (isDev) console.warn('[listingService] Manifest mapping failed:', manifestErr);
        }

    } catch (e) {
        console.error('[listingService] Critical error in getListingMappingMaps:', e);
    }

    if (isDev) console.log(`[listingService] Mapping built strictly from manifests: ${imageMap.size} images, ${nameMap.size} names`);

    return { 
        imageMap: Object.fromEntries(imageMap), 
        nameMap: Object.fromEntries(nameMap) 
    };
};

export const mapOrdersToListings = async (teamId: string, daysToScan: number = 60): Promise<{ processed: number, mapped: number }> => {
    console.log('Starting Map Orders to Listings...');

    const imageMap = await getImageMapFromManifests(teamId);
    if (imageMap.size === 0) return { processed: 0, mapped: 0 };

    const recordsCol = collection(db, 'user', teamId, 'records');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToScan);

    const q = query(recordsCol, where('dt_local', '>=', startDate.toISOString()));
    const recordsSnap = await getDocs(q);

    console.log(`Scanning ${recordsSnap.size} recent records...`);

    const updates: any[] = [];
    let mappedCount = 0;

    recordsSnap.forEach(doc => {
        const record = doc.data() as Record;
        // Optimization: if all its items have listing IDs, skip.
        const allItemsMapped = record.details?.items?.every(item => item.listing_id) ?? true;
        if (allItemsMapped) return;

        const result = applyListingIdsToRecord(record, imageMap);
        if (result.hasChanges) {
            updates.push({
                id: doc.id,
                details: result.record.details
            });
            mappedCount++;
        }
    });

    if (updates.length > 0) {
        console.log(`Updating ${updates.length} records...`);
        await updateRecordsInFirebase(teamId, updates);
    }

    return { processed: recordsSnap.size, mapped: mappedCount };
};

export const mapSpecificRecords = async (teamId: string, records: Record[]): Promise<{ processed: number, mapped: number }> => {
    console.log(`Mapping ${records.length} specific records...`);

    const imageMap = await getImageMapFromManifests(teamId);
    if (imageMap.size === 0) return { processed: 0, mapped: 0 };

    const updates: any[] = [];
    let mappedCount = 0;

    records.forEach(record => {
        const allItemsMapped = record.details?.items?.every(item => item.listing_id) ?? true;
        if (allItemsMapped) return;

        const result = applyListingIdsToRecord(record, imageMap);
        if (result.hasChanges && record.id) {
            updates.push({
                id: record.id,
                details: result.record.details
            });
            mappedCount++;
        }
    });

    if (updates.length > 0) {
        console.log(`Updating ${updates.length} records...`);
        await updateRecordsInFirebase(teamId, updates);
    }

    return { processed: records.length, mapped: mappedCount };
};

export const getRemovedListingsCount = async (teamId: string, accountId: string, hours: number = 24): Promise<number> => {
    const timeThreshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
        const q = query(
            collection(db, 'user', teamId, 'accounts', accountId, 'listings'),
            where('status', '==', 'inactive'),
            where('updatedAt', '>', timeThreshold)
        );
        const snapshot = await getCountFromServer(q);
        return snapshot.data().count;
    } catch (error) {
        console.warn('Failed to get removed listings count:', error);
        return 0; // Return 0 if index missing or error
    }
};

export const getDailyStats = async (
    teamId: string,
    days: number = 7,
    accessibleAccountIds?: string[]
): Promise<DailyStats[]> => {
    const stats: DailyStats[] = [];
    const today = new Date();

    // Generate array of dates for the last N days
    const dates: string[] = [];
    const todayLocalStr = today.toLocaleDateString('en-CA');
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];

        // Skip fetching snapshot for today to force realtime calculation
        if (dateKey !== todayLocalStr) {
            dates.push(dateKey);
        }
    }

    // Fetch in parallel
    const promises = dates.map(async (dateKey) => {
        try {
            // 1. Try to get snapshot
            const docRef = doc(db, 'user', teamId, 'daily-stats', dateKey);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                return { date: dateKey, ...docSnap.data() } as DailyStats;
            }
            return null;
        } catch (error) {
            console.error(`Error fetching stats for ${dateKey}:`, error);
            return null;
        }
    });

    const results = await Promise.all(promises);
    const validStats = results.filter(Boolean) as DailyStats[];

    // Filter snapshots based on accessible accounts
    const filteredStats = validStats.map(stat => {
        if (!accessibleAccountIds || accessibleAccountIds.length === 0) return stat;

        let filteredNew = 0;
        let filteredRemoved = 0;
        let filteredTotal = 0;
        let filteredShops: any = {};

        if (stat.shops) {
            Object.entries(stat.shops).forEach(([shopId, shopStat]: [string, any]) => {
                if (accessibleAccountIds.includes(shopId)) {
                    filteredNew += shopStat.new || 0;
                    filteredRemoved += shopStat.removed || 0;
                    filteredTotal += shopStat.total || 0;
                    filteredShops[shopId] = shopStat;
                }
            });
        }

        return {
            ...stat,
            new_listings: filteredNew,
            removed_listings: filteredRemoved,
            total_listings: filteredTotal,
            shops: filteredShops,
            shops_crawled: Object.keys(filteredShops).length
        };
    });

    stats.push(...filteredStats);

    // 3. Calculate "Today's" Stats (Realtime)
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const dayStartISO = startOfDay.toISOString();
        const dateStr = startOfDay.toLocaleDateString('en-CA'); // YYYY-MM-DD

        // If today's snapshot doesn't exist yet (it shouldn't until tomorrow)
        if (!stats.find(s => s.date === dateStr)) {
            // Fetch accounts to iterate
            const accountsRef = collection(db, 'user', teamId, 'accounts');
            const accountsSnap = await getDocs(accountsRef);

            let todayNew = 0;
            let todayRemoved = 0;
            let todayTotal = 0;
            const todayShopStats: { [key: string]: any } = {};

            // Parallel
            await Promise.all(accountsSnap.docs.map(async (doc) => {
                const shopId = doc.id;
                if (accessibleAccountIds && accessibleAccountIds.length > 0 && !accessibleAccountIds.includes(shopId)) return;

                const data = doc.data();
                if (!data.platforms?.includes('etsy')) return;

                const listingsRef = collection(db, 'user', teamId, 'accounts', shopId, 'listings');

                try {
                    // Count New
                    const qNew = query(
                        listingsRef,
                        where('createdAt', '>=', dayStartISO),
                        where('status', '==', 'active')
                    );
                    const snapNew = await getCountFromServer(qNew);
                    const newCount = snapNew.data().count;

                    // Count Removed
                    const qRem = query(
                        listingsRef,
                        where('updatedAt', '>=', dayStartISO),
                        where('status', '==', 'inactive')
                    );
                    const snapRem = await getCountFromServer(qRem);
                    const remCount = snapRem.data().count;

                    // Count Total Active
                    const qTotal = query(
                        listingsRef,
                        where('status', '==', 'active')
                    );
                    const snapTotal = await getCountFromServer(qTotal);
                    const totalCount = snapTotal.data().count;
                    if (typeof totalCount === 'number') {
                        todayTotal += totalCount;
                    }

                    if (newCount > 0 || remCount > 0) {
                        todayNew += newCount;
                        todayRemoved += remCount;
                        todayShopStats[shopId] = {
                            new: newCount,
                            removed: remCount,
                            total: totalCount
                        };
                    }
                } catch (e) { }
            }));

            // Append "Today" to stats
            // Always push today to show on chart even if 0
            stats.push({
                date: dateStr,
                new_listings: todayNew,
                removed_listings: todayRemoved,
                total_listings: todayTotal,
                shops: todayShopStats,
                shops_crawled: Object.keys(todayShopStats).length,
                createdAt: new Date().toISOString(),
                source: 'realtime'
            } as DailyStats);
        }
    } catch (e) {
        console.warn('Failed to calculate Today stats:', e);
    }

    return stats;
};

// ========== TIME SERIES DATA FUNCTIONS ==========

export interface TimeSeriesDataPoint {
    period: string; // "2026-02-09", "Week 6 2026", "Feb 2026"
    newCount: number;
    removedCount: number;
    breakdown: {
        accountId: string;
        label: string;
        newCount: number;
        removedCount: number;
    }[];
}

export type ViewMode = 'daily' | 'weekly' | 'monthly';

export const getListingsTimeSeries = async (
    teamId: string,
    accounts: { id: string; label: string }[],
    viewMode: ViewMode,
    days: number = 7
): Promise<TimeSeriesDataPoint[]> => {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Fetch all listings from all accounts in parallel
    const allListingsPromises = accounts.map(async (account) => {
        const listingsRef = collection(db, 'user', teamId, 'accounts', account.id, 'listings');

        // Fetch new listings (created in range)
        const newQuery = query(
            listingsRef,
            where('createdAt', '>=', startDate.toISOString()),
            where('status', '==', 'active')
        );

        // Fetch removed listings (became inactive in range)
        const removedQuery = query(
            listingsRef,
            where('status', '==', 'inactive'),
            where('updatedAt', '>=', startDate.toISOString())
        );

        const [newSnapshot, removedSnapshot] = await Promise.all([
            getDocs(newQuery),
            getDocs(removedQuery)
        ]);

        return {
            accountId: account.id,
            label: account.label,
            newListings: newSnapshot.docs.map(doc => ({
                id: doc.id,
                createdAt: doc.data().createdAt,
                ...doc.data()
            })),
            removedListings: removedSnapshot.docs.map(doc => ({
                id: doc.id,
                updatedAt: doc.data().updatedAt,
                inactivatedAt: doc.data().inactivatedAt,
                ...doc.data()
            }))
        };
    });

    const accountsData = await Promise.all(allListingsPromises);

    // Group by time period
    const periodMap = new Map<string, TimeSeriesDataPoint>();

    accountsData.forEach(accountData => {
        // Process new listings
        accountData.newListings.forEach((listing: any) => {
            const date = new Date(listing.createdAt);
            const periodKey = getPeriodKey(date, viewMode);

            if (!periodMap.has(periodKey)) {
                periodMap.set(periodKey, {
                    period: periodKey,
                    newCount: 0,
                    removedCount: 0,
                    breakdown: []
                });
            }

            const point = periodMap.get(periodKey)!;
            point.newCount++;

            // Update breakdown
            let shopBreakdown = point.breakdown.find(b => b.accountId === accountData.accountId);
            if (!shopBreakdown) {
                shopBreakdown = {
                    accountId: accountData.accountId,
                    label: accountData.label,
                    newCount: 0,
                    removedCount: 0
                };
                point.breakdown.push(shopBreakdown);
            }
            shopBreakdown.newCount++;
        });

        // Process removed listings
        accountData.removedListings.forEach((listing: any) => {
            const date = new Date(listing.updatedAt || listing.inactivatedAt);
            const periodKey = getPeriodKey(date, viewMode);

            if (!periodMap.has(periodKey)) {
                periodMap.set(periodKey, {
                    period: periodKey,
                    newCount: 0,
                    removedCount: 0,
                    breakdown: []
                });
            }

            const point = periodMap.get(periodKey)!;
            point.removedCount++;

            // Update breakdown
            let shopBreakdown = point.breakdown.find(b => b.accountId === accountData.accountId);
            if (!shopBreakdown) {
                shopBreakdown = {
                    accountId: accountData.accountId,
                    label: accountData.label,
                    newCount: 0,
                    removedCount: 0
                };
                point.breakdown.push(shopBreakdown);
            }
            shopBreakdown.removedCount++;
        });
    });

    // Convert to array and sort
    const result = Array.from(periodMap.values()).sort((a, b) => {
        return comparePeriods(a.period, b.period, viewMode);
    });

    return result;
};

function getPeriodKey(date: Date, viewMode: ViewMode): string {
    if (viewMode === 'daily') {
        return date.toISOString().split('T')[0];
    } else if (viewMode === 'weekly') {
        const weekNum = getWeekNumber(date);
        return `Week ${weekNum} ${date.getFullYear()}`;
    } else {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getFullYear()}`;
    }
}

function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function comparePeriods(a: string, b: string, viewMode: ViewMode): number {
    if (viewMode === 'daily') return a.localeCompare(b);
    if (viewMode === 'monthly') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const [ma, ya] = a.split(' ');
        const [mb, yb] = b.split(' ');
        if (ya !== yb) return parseInt(ya) - parseInt(yb);
        return months.indexOf(ma) - months.indexOf(mb);
    }
    // Weekly: "Week 6 2026"
    const [wa, numa, ya] = a.split(' ');
    const [wb, numb, yb] = b.split(' ');
    if (ya !== yb) return parseInt(ya) - parseInt(yb);
    return parseInt(numa) - parseInt(numb);
}
