import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { discoverCurrentEtsyShop, fetchEtsyReviews, isValidEtsyShopId, type EtsyReviewApiDeps } from './etsyReviewApi';
import { cleanEtsyReview } from './reviewCleaner';
import type { CleanedEtsyReview, EtsyReviewShopConfig, LatestSavedReviewMarker, ReviewSyncResult } from './types';

export const ETSY_REVIEW_ALARM = 'etsy_review_cron';

const DEFAULT_REVIEW_SYNC_HOURS = [8, 12];
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const REVIEW_SYNC_LOOKBACK_SECONDS = 24 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function splitWebhookUrls(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.flatMap(item => splitWebhookUrls(item));
    }
    if (typeof value !== 'string') return [];

    return value
        .split(/[\s,]+/)
        .map(url => url.trim())
        .filter(url => /^https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\//i.test(url));
}

function maskWebhookUrl(webhookUrl: string): string {
    return webhookUrl.replace(/\/hook\/[^/?#]+/i, '/hook/***');
}

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeKey(value: unknown): string {
    return cleanText(value).toLowerCase();
}

function isEmailLike(value: unknown): boolean {
    return EMAIL_PATTERN.test(cleanText(value));
}

function pickPreferredShopName(shop: Partial<EtsyReviewShopConfig> & Record<string, any>, fallback?: string): string {
    const preferred = [
        shop.label,
        shop.etsyShopName,
        shop.etsy_shop_name,
        shop.name,
        shop.shopLabel,
        shop.displayName,
        shop.shopName
    ].map(cleanText).filter(Boolean);

    const nonEmail = preferred.find(value => !isEmailLike(value));
    if (nonEmail) return nonEmail;

    const fallbackText = cleanText(fallback);
    if (fallbackText && !isEmailLike(fallbackText)) return fallbackText;

    return preferred[0]
        || fallbackText
        || cleanText(shop.email)
        || cleanText(shop.shopId);
}

export function createEtsyReviewSync(deps: EtsyReviewSyncDeps) {
    async function persistDiscoveredShopId(shop: EtsyReviewShopConfig): Promise<void> {
        if (!isValidEtsyShopId(shop.shopId)) return;

        const storage = (await chrome.storage.local.get(['teamId', 'account', 'accountLabel'])) as {
            teamId?: string;
            account?: string;
            accountLabel?: string;
        };
        if (!storage.teamId) return;

        const accountsRef = collection(deps.db, 'user', storage.teamId, 'accounts');
        const candidates = Array.from(new Set([
            cleanText(storage.account).toLowerCase(),
            cleanText(storage.account),
            cleanText(storage.accountLabel),
            cleanText(shop.shopName),
        ].filter(Boolean)));

        let accountDocId = '';
        for (const candidate of candidates) {
            const directDoc = await getDoc(doc(accountsRef, candidate));
            if (directDoc.exists()) {
                accountDocId = directDoc.id;
                break;
            }
        }

        for (const candidate of candidates) {
            if (accountDocId) break;
            for (const field of ['email', 'label', 'name', 'shopName']) {
                const snap = await getDocs(query(accountsRef, where(field, '==', candidate), limit(1)));
                if (!snap.empty) {
                    accountDocId = snap.docs[0].id;
                    break;
                }
            }
            if (accountDocId) break;
        }

        if (!accountDocId) {
            console.warn(`[Reviews] Discovered Etsy shop_id=${shop.shopId}, but could not match current account to persist it.`);
            return;
        }

        await updateDoc(doc(deps.db, 'user', storage.teamId, 'accounts', accountDocId), {
            etsy_shop_id: shop.shopId,
            etsyShopId: shop.shopId,
            etsyShopName: shop.shopName || null,
            updated_at: new Date().toISOString()
        });
    }

    async function resolveReviewShopDisplayName(review: CleanedEtsyReview): Promise<string> {
        const storage = (await chrome.storage.local.get(['account', 'accountLabel', 'etsy_review_shops'])) as {
            account?: string;
            accountLabel?: string;
            etsy_review_shops?: EtsyReviewShopConfig[];
        };

        const reviewShop = cleanText(review.shop_id);
        const reviewShopKey = normalizeKey(reviewShop);
        const configuredShops = Array.isArray(storage.etsy_review_shops) ? storage.etsy_review_shops : [];
        const matchedShop = configuredShops.find(shop => [
            shop.shopId,
            shop.shopName,
            shop.label,
            shop.email,
            shop.name,
            shop.etsyShopName
        ].some(value => normalizeKey(value) === reviewShopKey));

        const matchedName = matchedShop ? pickPreferredShopName(matchedShop) : '';
        const accountLabel = cleanText(storage.accountLabel);
        const account = cleanText(storage.account);

        if (matchedName && !isEmailLike(matchedName)) return matchedName;
        if (accountLabel && !isEmailLike(accountLabel)) return accountLabel;
        if (reviewShop && !isEmailLike(reviewShop)) return reviewShop;
        return matchedName || reviewShop || accountLabel || account || 'Unknown Shop';
    }

    async function triggerBadReviewWebhook(review: CleanedEtsyReview) {
        const storage = await chrome.storage.local.get(['review_webhook_urls', 'review_webhook_url', 'LARK_WEBHOOK_URL']);
        const webhookUrls = Array.from(new Set([
            ...splitWebhookUrls((import.meta.env as any).VITE_REVIEW_WEBHOOK_URLS),
            ...splitWebhookUrls((import.meta.env as any).VITE_REVIEW_WEBHOOK_URL),
            ...splitWebhookUrls((import.meta.env as any).VITE_REVIEW_WEBHOOK_URL_2),
            ...splitWebhookUrls(storage.review_webhook_urls),
            ...splitWebhookUrls(storage.review_webhook_url),
            ...splitWebhookUrls(storage.LARK_WEBHOOK_URL)
        ]));

        if (webhookUrls.length === 0) {
            console.warn(`[Reviews] Bad review alert skipped: webhook URL is not configured. review=${review.transaction_id || 'unknown'} shop=${review.shop_id}`);
            return;
        }

        console.log(`[Reviews] Sending bad review alert to ${webhookUrls.length} webhook(s). review=${review.transaction_id || 'unknown'} shop=${review.shop_id} rating=${review.rating}`);

        const ratingStars = '⭐'.repeat(review.rating || 0);
        const shopDisplayName = await resolveReviewShopDisplayName(review);
        let content = `**Shop**: **${shopDisplayName}**\n**Đánh giá**: ${review.rating} ${ratingStars}\n**Khách hàng**: ${review.buyer_name || 'N/A'} (${review.buyer_login_name || 'N/A'})\n**Sản phẩm**: [${review.listing_title}](https://www.etsy.com/listing/${review.listing_id})\n**Nội dung**: *"${review.review || 'Không có nội dung'}"*`;

        if (review.review_photo_detailed?.url_fullxfull) {
            content += `\n**Ảnh đính kèm**: [Xem ảnh khách chụp](${review.review_photo_detailed.url_fullxfull})`;
        }

        const card = {
            config: {
                wide_screen_mode: true,
                enable_forward: true
            },
            header: {
                title: { content: `🚨 Bad Review`, tag: 'plain_text' },
                template: 'red'
            },
            elements: [
                {
                    tag: 'div',
                    text: {
                        tag: 'lark_md',
                        content
                    }
                }
            ]
        };

        for (const webhookUrl of webhookUrls) {
            try {
                const resp = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ msg_type: 'interactive', card })
                });
                const responseText = await resp.text().catch(() => '');
                console.log(`[Reviews] Bad review webhook response: webhook=${maskWebhookUrl(webhookUrl)} status=${resp.status} ${responseText.slice(0, 300)}`);
                if (!resp.ok) {
                    console.error(`[Reviews] Bad review webhook failed. webhook=${maskWebhookUrl(webhookUrl)} status=${resp.status} body=${responseText.slice(0, 500)}`);
                }
            } catch (e) {
                console.error(`[Reviews] Error calling bad review webhook. webhook=${maskWebhookUrl(webhookUrl)}`, e);
            }
        }
    }

    async function saveEtsyReviewsToFirestore(reviews: CleanedEtsyReview[], sendAlerts = false): Promise<number> {
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
            const shouldSendBadAlert = sendAlerts
                && typeof review.rating === 'number'
                && review.rating >= 1
                && review.rating <= 3
                && !(await getDoc(reviewRef)).exists();
            batch.set(reviewRef, { ...review, updated_at: new Date().toISOString() }, { merge: true });
            batchCount++;
            savedCount++;

            if (shouldSendBadAlert) {
                triggerBadReviewWebhook(review).catch(err => {
                    console.error('[Reviews] Failed to send bad review alert:', err);
                });
            } else if (sendAlerts && typeof review.rating === 'number' && review.rating >= 1 && review.rating <= 3) {
                console.log(`[Reviews] Bad review alert skipped because review already exists. review=${docId} shop=${review.shop_id}`);
            }

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
        const { account, accountLabel, etsy_review_shops } = (await chrome.storage.local.get(['account', 'accountLabel', 'etsy_review_shops'])) as { account?: string; accountLabel?: string; etsy_review_shops?: EtsyReviewShopConfig[] };
        const configured = Array.isArray(etsy_review_shops) ? etsy_review_shops.find(shop => String(shop.shopId) === String(shopId)) : null;
        return configured ? pickPreferredShopName(configured, accountLabel || account || String(shopId)) : (accountLabel || account || String(shopId));
    }

    async function resolveReviewShopInput(shopId: string, shopName?: string): Promise<EtsyReviewShopConfig> {
        if (isValidEtsyShopId(shopId)) {
            return { shopId: String(shopId), shopName: shopName || await resolveShopName(shopId) };
        }

        const discoveredShop = await discoverCurrentEtsyShop(deps);
        if (!discoveredShop?.shopId) throw new Error('Missing shopId for review back-fill and cannot discover current Etsy shop.');

        const { account, accountLabel } = (await chrome.storage.local.get(['account', 'accountLabel'])) as { account?: string; accountLabel?: string };
        const resolvedShop = {
            shopId: String(discoveredShop.shopId),
            shopName: shopName || accountLabel || account || discoveredShop.shopName || String(discoveredShop.shopId)
        };
        await persistDiscoveredShopId(resolvedShop).catch(error => console.warn('[Reviews] Failed to persist discovered Etsy shop_id:', error));
        await chrome.storage.local.set({ etsy_review_shops: [resolvedShop] });
        return resolvedShop;
    }

    async function getConfiguredReviewShops(): Promise<EtsyReviewShopConfig[]> {
        const storage = (await chrome.storage.local.get(['etsy_review_shops'])) as { etsy_review_shops?: EtsyReviewShopConfig[] };
        let validConfiguredShops: EtsyReviewShopConfig[] = [];
        if (Array.isArray(storage.etsy_review_shops) && storage.etsy_review_shops.length > 0) {
            validConfiguredShops = storage.etsy_review_shops
                .filter(shop => isValidEtsyShopId(shop?.shopId))
                .map(shop => ({
                    ...shop,
                    shopId: String(shop.shopId),
                    shopName: pickPreferredShopName(shop, String(shop.shopId))
                }));

            const hasInvalidConfiguredShop = storage.etsy_review_shops.some(shop => !isValidEtsyShopId(shop?.shopId));
            if (!hasInvalidConfiguredShop && validConfiguredShops.length > 0) return validConfiguredShops;
            console.warn('[Reviews] Missing or invalid Etsy shop_id in stored review shop config. Discovering current Etsy shop instead.');
        }

        const currentShop = await discoverCurrentEtsyShop(deps);
        if (!currentShop) return validConfiguredShops;

        const { account, accountLabel } = (await chrome.storage.local.get(['account', 'accountLabel'])) as { account?: string; accountLabel?: string };
        const resolvedShop = { ...currentShop, shopName: accountLabel || account || currentShop.shopName };
        await persistDiscoveredShopId(resolvedShop).catch(error => console.warn('[Reviews] Failed to persist discovered Etsy shop_id:', error));
        const mergedShops = [
            ...validConfiguredShops.filter(shop => String(shop.shopId) !== String(resolvedShop.shopId)),
            resolvedShop
        ];
        await chrome.storage.local.set({ etsy_review_shops: mergedShops });
        return mergedShops;
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

                    const saved = await saveEtsyReviewsToFirestore(cleanedReviews, true);
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

        const saved = await saveEtsyReviewsToFirestore(cleanedReviews, true);
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
