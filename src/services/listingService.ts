import { db } from './firebaseService';
import { collection, query, where, getDocs, orderBy, limit, getCountFromServer, startAfter } from 'firebase/firestore';
import { Listing } from '../types/listing';
import { updateRecordsInFirebase } from './firebaseService';
import { Record } from '../types';

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

// ... (keep previous functions but ensure no duplicates) ...
// Actually, I'm rewriting the file, so I need to include them.

export const getAllListingsPaginated = async (
    teamId: string,
    limitCount: number = 50,
    lastDoc?: any,
    status?: string,
    timeFilter?: Date | null
): Promise<{ listings: Listing[], lastDoc: any }> => {

    const collectionRef = collection(db, 'user', teamId, 'listings');
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

    if (status === 'inactive') {
        constraints.push(orderBy('updatedAt', 'desc'));
    } else {
        constraints.push(orderBy('createdAt', 'desc'));
    }

    constraints.push(limit(limitCount));

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
            createdAt: data.createdAt?.toDate?.() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
        } as Listing;
    });

    return {
        listings,
        lastDoc: snapshot.docs[snapshot.docs.length - 1]
    };
};

export const getAllListingsCount = async (teamId: string, status?: string, timeFilter?: Date | null): Promise<number> => {
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
    const q = query(
        collection(db, 'user', teamId, 'listings'),
        ...constraints
    );
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
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

// Helper to extract Etsy Image ID from URL
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
                    const imageUrl = parts[1]; // Index 1 is Image
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

export const findListingIdForRecord = (record: Record, imageMap: Map<string, string>): string | null => {
    if (record.listing_id) return record.listing_id;
    if (record.details?.items) {
        for (const item of record.details.items) {
            const imgId = extractEtsyImageId(item.image);
            if (imgId && imageMap.has(imgId)) {
                return imageMap.get(imgId)!;
            }
        }
    }
    return null;
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
        if (record.listing_id) return;

        let foundListingId: string | null = null;
        if (record.details?.items) {
            for (const item of record.details.items) {
                const imgId = extractEtsyImageId(item.image);
                if (imgId && imageMap.has(imgId)) {
                    foundListingId = imageMap.get(imgId)!;
                    break;
                }
            }
        }

        if (foundListingId) {
            updates.push({ id: doc.id, listing_id: foundListingId });
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
        if (record.listing_id) return;
        const listingId = findListingIdForRecord(record, imageMap);
        if (listingId && record.id) {
            updates.push({ id: record.id, listing_id: listingId });
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

/**
 * Get time series data for activity chart
 * Fetches and groups listings by time period
 */
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

/**
 * Generate period key based on view mode
 */
function getPeriodKey(date: Date, viewMode: ViewMode): string {
    if (viewMode === 'daily') {
        return date.toISOString().split('T')[0]; // "2026-02-09"
    } else if (viewMode === 'weekly') {
        const weekNum = getWeekNumber(date);
        return `Week ${weekNum} ${date.getFullYear()}`; // "Week 6 2026"
    } else {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getFullYear()}`; // "Feb 2026"
    }
}

/**
 * Get ISO week number
 */
function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Compare two period strings for sorting
 */
function comparePeriods(a: string, b: string, viewMode: ViewMode): number {
    if (viewMode === 'daily') {
        return a.localeCompare(b); // ISO date strings sort correctly
    } else if (viewMode === 'weekly') {
        const [, weekA, yearA] = a.match(/Week (\d+) (\d{4})/) || [];
        const [, weekB, yearB] = b.match(/Week (\d+) (\d{4})/) || [];
        if (yearA !== yearB) return parseInt(yearA) - parseInt(yearB);
        return parseInt(weekA) - parseInt(weekB);
    } else {
        const [monthA, yearA] = a.split(' ');
        const [monthB, yearB] = b.split(' ');
        if (yearA !== yearB) return parseInt(yearA) - parseInt(yearB);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months.indexOf(monthA) - months.indexOf(monthB);
    }
}
