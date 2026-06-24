import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDocs, limit, orderBy, query, where, writeBatch } from 'firebase/firestore';
import { discoverCurrentEtsyShop, fetchEtsyReviews, type EtsyReviewApiDeps } from './etsyReviewApi';
import { cleanEtsyReview } from './reviewCleaner';
import type { CleanedEtsyReview, EtsyReviewShopConfig, LatestSavedReviewMarker, ReviewSyncResult } from './types';

export const ETSY_REVIEW_ALARM = 'etsy_review_cron';

const DEFAULT_REVIEW_SYNC_HOURS = [8, 12];
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const REVIEW_SYNC_LOOKBACK_SECONDS = 24 * 60 * 60;

export interface EtsyReviewSyncDeps extends EtsyReviewApiDeps {
    db: Firestore;
    ensureAuth: () => Promise<boolean>;
    sleep: (ms: number) => Promise<unknown>;
}

const REVIEW_SYNC_STATUS_KEY = 'etsy_review_sync_status';

type ReviewSyncState = 'idle' | 'running' | 'success' | 'error';

interface EtsyReviewSyncStatus {
    state?: ReviewSyncState;
    currentAction?: string;
    lastStartedAt?: string;
    lastFinishedAt?: string;
    lastSuccessAt?: string;
    lastError?: string;
    lastFetched?: number;
    lastSaved?: number;
    nextRunAt?: string;
    updatedAt?: string;
}

async function updateReviewSyncStatus(update: Partial<EtsyReviewSyncStatus>): Promise<void> {
    const current = (await chrome.storage.local.get([REVIEW_SYNC_STATUS_KEY])) as { [REVIEW_SYNC_STATUS_KEY]?: EtsyReviewSyncStatus };
    await chrome.storage.local.set({
        [REVIEW_SYNC_STATUS_KEY]: {
            ...(current[REVIEW_SYNC_STATUS_KEY] || {}),
            ...update,
            updatedAt: new Date().toISOString()
        }
    });
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export function createEtsyReviewSync(deps: EtsyReviewSyncDeps) {
    async function saveEtsyReviewsToFirestore(reviews: CleanedEtsyReview[]): Promise<number> {
        if (reviews.length === 0) return 0;

        const { teamId } = (await chrome.storage.local.get(['teamId'])) as { teamId?: string };
        if (!teamId) throw new Error('Missing teamId in chrome.storage.local.');

        const isAuthenticated = await deps.ensureAuth();
        if (!isAuthenticated) throw new Error('Cannot authenticate Firebase for review sync.');

        const reviewsRef = collection(deps.db, 'user', teamId, 'reviews');
        let savedCount = 0;
        let batch = writeBatch(deps.db);
        let batchCount = 0;

        for (const review of reviews) {
            const docId = review.transaction_id;
            if (!docId) continue;
            const reviewRef = doc(reviewsRef, docId);
            batch.set(reviewRef, { ...review, updated_at: new Date().toISOString() }, { merge: true });
            batchCount++;
            savedCount++;

            if (batchCount >= 450) {
                await batch.commit();
                batch = writeBatch(deps.db);
                batchCount = 0;
            }
        }

        if (batchCount > 0) await batch.commit();
        console.log(`[Reviews] Saved ${savedCount} review(s) to Firestore.`);
        return savedCount;
    }

    async function resolveShopName(shopId: string): Promise<string> {
        const { account, etsy_review_shops } = (await chrome.storage.local.get(['account', 'etsy_review_shops'])) as { account?: string; etsy_review_shops?: EtsyReviewShopConfig[] };
        const configured = Array.isArray(etsy_review_shops) ? etsy_review_shops.find(shop => String(shop.shopId) === String(shopId)) : null;
        return configured?.shopName || account || String(shopId);
    }

    async function resolveReviewShopInput(shopId: string, shopName?: string): Promise<EtsyReviewShopConfig> {
        if (shopId) {
            return { shopId: String(shopId), shopName: shopName || await resolveShopName(shopId) };
        }

        const discoveredShop = await discoverCurrentEtsyShop(deps);
        if (!discoveredShop?.shopId) throw new Error('Missing shopId for review back-fill and cannot discover current Etsy shop.');

        const { account } = (await chrome.storage.local.get(['account'])) as { account?: string };
        return {
            shopId: String(discoveredShop.shopId),
            shopName: shopName || account || discoveredShop.shopName || String(discoveredShop.shopId)
        };
    }

    async function getConfiguredReviewShops(): Promise<EtsyReviewShopConfig[]> {
        const storage = (await chrome.storage.local.get(['etsy_review_shops'])) as { etsy_review_shops?: EtsyReviewShopConfig[] };
        if (Array.isArray(storage.etsy_review_shops) && storage.etsy_review_shops.length > 0) {
            return storage.etsy_review_shops
                .filter(shop => shop?.shopId)
                .map(shop => ({ shopId: String(shop.shopId), shopName: String(shop.shopName || shop.shopId) }));
        }

        const currentShop = await discoverCurrentEtsyShop(deps);
        if (!currentShop) return [];

        const { account } = (await chrome.storage.local.get(['account'])) as { account?: string };
        return [{ ...currentShop, shopName: account || currentShop.shopName }];
    }

    async function backFillEtsyReviews(shopId: string, shopName?: string, minDateStr?: string): Promise<ReviewSyncResult> {
        await updateReviewSyncStatus({
            state: 'running',
            currentAction: 'backfill',
            lastStartedAt: new Date().toISOString(),
            lastError: ''
        });

        try {
            const resolvedShop = await resolveReviewShopInput(shopId, shopName);

            const limitPerPage = 100;
            let offset = 0;
            let fetched = 0;
            const cleanedReviews: CleanedEtsyReview[] = [];

            let minCreated: number | undefined = undefined;
            if (minDateStr) {
                minCreated = Math.floor(new Date(minDateStr).getTime() / 1000);
            }

            console.log(`[Reviews] Back-fill started for shop ${resolvedShop.shopName} (${resolvedShop.shopId}). minDate=${minDateStr || 'none'}`);

            while (true) {
                const page = await fetchEtsyReviews(deps, resolvedShop.shopId, { limit: limitPerPage, offset, minCreated });
                if (page.length === 0) break;

                let shouldStop = false;
                fetched += page.length;
                page.forEach(raw => {
                    const createTime = Number(raw.create_date || 0);
                    if (minCreated && createTime < minCreated) {
                        shouldStop = true;
                    } else {
                        const cleaned = cleanEtsyReview(raw, resolvedShop.shopName);
                        if (cleaned) cleanedReviews.push(cleaned);
                    }
                });

                console.log(`[Reviews] Back-fill page offset=${offset}, fetched=${page.length}.`);
                if (page.length < limitPerPage || shouldStop) break;
                offset += limitPerPage;
                await deps.sleep(600);
            }

            const saved = await saveEtsyReviewsToFirestore(cleanedReviews);
            console.log(`[Reviews] Back-fill finished. fetched=${fetched}, saved=${saved}.`);
            await updateReviewSyncStatus({
                state: 'success',
                currentAction: 'backfill',
                lastFinishedAt: new Date().toISOString(),
                lastSuccessAt: new Date().toISOString(),
                lastFetched: fetched,
                lastSaved: saved,
                lastError: ''
            });
            return { fetched, saved };
        } catch (error) {
            await updateReviewSyncStatus({
                state: 'error',
                currentAction: 'backfill',
                lastFinishedAt: new Date().toISOString(),
                lastError: getErrorMessage(error)
            });
            throw error;
        }
    }

    async function crawlRecent25Reviews(): Promise<ReviewSyncResult> {
        await updateReviewSyncStatus({
            state: 'running',
            currentAction: 'recent_25',
            lastStartedAt: new Date().toISOString(),
            lastError: ''
        });

        try {
            const shops = await getConfiguredReviewShops();
            let totalFetched = 0;
            let totalSaved = 0;

            for (const shop of shops) {
                if (!shop.shopId) continue;
                console.log(`[Reviews] Crawling 25 recent reviews for shop ${shop.shopName || shop.shopId}`);
                try {
                    const page = await fetchEtsyReviews(deps, shop.shopId, { limit: 25, offset: 0 });
                    const cleanedReviews: CleanedEtsyReview[] = [];

                    totalFetched += page.length;
                    page.forEach(raw => {
                        const cleaned = cleanEtsyReview(raw, shop.shopName);
                        if (cleaned) cleanedReviews.push(cleaned);
                    });

                    const saved = await saveEtsyReviewsToFirestore(cleanedReviews);
                    totalSaved += saved;
                } catch (err: any) {
                    console.error(`[Reviews] Error crawling 25 reviews for shop ${shop.shopId}:`, err);
                    throw err;
                }
            }

            await updateReviewSyncStatus({
                state: 'success',
                currentAction: 'recent_25',
                lastFinishedAt: new Date().toISOString(),
                lastSuccessAt: new Date().toISOString(),
                lastFetched: totalFetched,
                lastSaved: totalSaved,
                lastError: ''
            });
            return { fetched: totalFetched, saved: totalSaved };
        } catch (error) {
            await updateReviewSyncStatus({
                state: 'error',
                currentAction: 'recent_25',
                lastFinishedAt: new Date().toISOString(),
                lastError: getErrorMessage(error)
            });
            throw error;
        }
    }

    async function getConfiguredReviewSyncHours(): Promise<number[]> {
        const storage = (await chrome.storage.local.get(['etsy_review_sync_hours', 'review_sync_hours', 'etsyReviewCronHours'])) as any;
        const rawHours = storage.etsy_review_sync_hours || storage.review_sync_hours || storage.etsyReviewCronHours;
        const hours = Array.isArray(rawHours) ? rawHours : [];
        const normalized = hours
            .map(hour => Number(hour))
            .filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23);
        return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a - b) : DEFAULT_REVIEW_SYNC_HOURS;
    }

    function getNextVietnamRunTimestamp(nowMs: number, hours: number[]): number {
        const vietnamNow = new Date(nowMs + VIETNAM_UTC_OFFSET_MS);
        const year = vietnamNow.getUTCFullYear();
        const month = vietnamNow.getUTCMonth();
        const day = vietnamNow.getUTCDate();

        const candidates = hours.map(hour => {
            const vietnamTargetMs = Date.UTC(year, month, day, hour, 0, 0, 0);
            let actualTargetMs = vietnamTargetMs - VIETNAM_UTC_OFFSET_MS;
            if (actualTargetMs <= nowMs) actualTargetMs += 24 * 60 * 60 * 1000;
            return actualTargetMs;
        });

        return Math.min(...candidates);
    }

    async function scheduleNextEtsyReviewCron(): Promise<string> {
        const syncHours = await getConfiguredReviewSyncHours();
        const nextRunTimestamp = getNextVietnamRunTimestamp(Date.now(), syncHours);
        await chrome.alarms.create(ETSY_REVIEW_ALARM, { when: nextRunTimestamp });

        const nextRunAt = new Date(nextRunTimestamp).toISOString();
        await updateReviewSyncStatus({ nextRunAt });
        console.log(`[Reviews] Scheduled next cron at ${nextRunAt}. Vietnam hours=${syncHours.join(',')}`);
        return nextRunAt;
    }

    async function getLatestSavedReviewMarker(shopName: string): Promise<LatestSavedReviewMarker> {
        const { teamId } = (await chrome.storage.local.get(['teamId'])) as { teamId?: string };
        if (!teamId) return {};

        const isAuthenticated = await deps.ensureAuth();
        if (!isAuthenticated) return {};

        const reviewsRef = collection(deps.db, 'user', teamId, 'reviews');
        const latestQuery = query(reviewsRef, where('shop_id', '==', shopName), orderBy('create_date', 'desc'), limit(1));
        const snap = await getDocs(latestQuery);
        if (snap.empty) return {};

        const latest = snap.docs[0].data() as any;
        const createMs = latest.create_date ? Date.parse(String(latest.create_date)) : undefined;
        return {
            transactionId: latest.transaction_id ? String(latest.transaction_id) : snap.docs[0].id,
            createDate: latest.create_date ? String(latest.create_date) : undefined,
            createMs: Number.isFinite(createMs) ? createMs : undefined
        };
    }

    async function syncReviewsUntilLatestSaved(shop: EtsyReviewShopConfig): Promise<ReviewSyncResult> {
        const marker = await getLatestSavedReviewMarker(shop.shopName);
        const hasSavedMarker = Boolean(marker.transactionId || marker.createMs);
        const markerSeconds = marker.createMs ? Math.max(0, Math.floor(marker.createMs / 1000) - REVIEW_SYNC_LOOKBACK_SECONDS) : undefined;
        const limitPerPage = 25;
        let offset = 0;
        let fetched = 0;
        const cleanedReviews: CleanedEtsyReview[] = [];

        console.log(`[Reviews] Syncing ${shop.shopName}. latestSaved=${marker.createDate || 'none'}`);

        while (true) {
            const page = await fetchEtsyReviews(deps, shop.shopId, { limit: limitPerPage, offset, minCreated: markerSeconds });
            if (page.length === 0) break;

            fetched += page.length;
            let reachedKnownReview = false;

            for (const raw of page) {
                const cleaned = cleanEtsyReview(raw, shop.shopName);
                if (!cleaned) continue;

                const createMs = Date.parse(cleaned.create_date);
                const isKnownTransaction = marker.transactionId && cleaned.transaction_id === marker.transactionId;
                const isOlderThanMarker = marker.createMs && Number.isFinite(createMs) && createMs < marker.createMs;

                if (isKnownTransaction || isOlderThanMarker) {
                    reachedKnownReview = true;
                    break;
                }

                cleanedReviews.push(cleaned);
            }

            console.log(`[Reviews] Cron page shop=${shop.shopName}, offset=${offset}, fetched=${page.length}, reachedKnown=${reachedKnownReview}`);
            if (!hasSavedMarker || reachedKnownReview || page.length < limitPerPage) break;

            offset += limitPerPage;
            await deps.sleep(600);
        }

        const saved = await saveEtsyReviewsToFirestore(cleanedReviews);
        return { fetched, saved };
    }

    async function runEtsyReviewCronJob(): Promise<ReviewSyncResult> {
        console.log('[Reviews] Running cron job...');
        await updateReviewSyncStatus({
            state: 'running',
            currentAction: 'cron',
            lastStartedAt: new Date().toISOString(),
            lastError: ''
        });

        const shops = await getConfiguredReviewShops();
        let totalFetched = 0;
        let totalSaved = 0;
        const errors: string[] = [];

        for (const shop of shops) {
            if (!shop.shopId) continue;
            try {
                const result = await syncReviewsUntilLatestSaved(shop);
                totalFetched += result.fetched;
                totalSaved += result.saved;
            } catch (err: any) {
                console.error(`[Reviews] Error syncing shop ${shop.shopId}:`, err);
                errors.push(`${shop.shopName || shop.shopId}: ${getErrorMessage(err)}`);
            }
        }

        await chrome.storage.local.set({ last_review_sync_timestamp: Math.floor(Date.now() / 1000) });
        await scheduleNextEtsyReviewCron();
        const finishedAt = new Date().toISOString();
        await updateReviewSyncStatus({
            state: errors.length > 0 ? 'error' : 'success',
            currentAction: 'cron',
            lastFinishedAt: finishedAt,
            ...(errors.length > 0 ? {} : { lastSuccessAt: finishedAt }),
            lastFetched: totalFetched,
            lastSaved: totalSaved,
            lastError: errors.join(' | ')
        });
        return { fetched: totalFetched, saved: totalSaved };
    }

    return {
        backFillEtsyReviews,
        crawlRecent25Reviews,
        runEtsyReviewCronJob,
        scheduleNextEtsyReviewCron
    };
}
