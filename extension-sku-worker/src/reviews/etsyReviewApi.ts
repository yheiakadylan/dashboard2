import type { EtsyReviewShopConfig, FetchEtsyReviewsOptions } from './types';
import { normalizeReviewPayload } from './reviewCleaner';

const MAX_ETSY_SHOP_ID = 2147483647;

export interface EtsyReviewApiDeps {
    markEtsyLoggedOut: () => void;
    markEtsyLoggedIn?: () => void;
    setRateLimitUntil: (timestamp: number) => void;
    getRateLimitUntil?: () => number;
}

export function isValidEtsyShopId(value: unknown): boolean {
    const text = String(value || '').trim();
    if (!/^\d+$/.test(text)) return false;

    const numericValue = Number(text);
    return Number.isSafeInteger(numericValue) && numericValue > 0 && numericValue <= MAX_ETSY_SHOP_ID;
}

export async function fetchEtsyReviews(deps: EtsyReviewApiDeps, shopId: string, options: FetchEtsyReviewsOptions = {}): Promise<any[]> {
    if (!isValidEtsyShopId(shopId)) {
        throw new Error(`Invalid Etsy shop id for reviews API: ${shopId}`);
    }

    const rateLimitUntil = deps.getRateLimitUntil?.() || 0;
    if (Date.now() < rateLimitUntil) {
        throw new Error(`Etsy reviews API rate limited until ${new Date(rateLimitUntil).toISOString()}.`);
    }

    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.minCreated) params.set('min_created', String(options.minCreated));

    const queryString = params.toString();
    const url = `https://www.etsy.com/api/v3/ajax/shop/${encodeURIComponent(shopId)}/reviews${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json', 'x-requested-with': 'XMLHttpRequest' } });

    if (response.status === 401 || response.status === 403) {
        deps.markEtsyLoggedOut();
        throw new Error('Etsy session expired while fetching reviews.');
    }

    if (response.status === 429) {
        deps.setRateLimitUntil(Date.now() + 15 * 60 * 1000);
        throw new Error('Etsy reviews API rate limited.');
    }

    if (!response.ok) throw new Error(`Etsy reviews API returned ${response.status}`);
    deps.markEtsyLoggedIn?.();
    return normalizeReviewPayload(await response.json());
}

export async function discoverCurrentEtsyShop(deps: EtsyReviewApiDeps): Promise<EtsyReviewShopConfig | null> {
    try {
        const response = await fetch('https://www.etsy.com/your/shops/me/dashboard', {
            headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
        });
        if (!response.ok) return null;

        const html = await response.text();
        if (html.includes('class="sign-in-button-wrapper"') || html.includes('id="sign-in"')) {
            deps.markEtsyLoggedOut();
            return null;
        }

        const shopId = html.match(/"shop_id"\s*:\s*"?(\d+)"?/)?.[1];
        const shopName = html.match(/"shop_name"\s*:\s*"([^"]+)"/)?.[1]
            || html.match(/https:\/\/([a-zA-Z0-9-]+)\.etsy\.com/)?.[1]
            || html.match(/"shop_url"\s*:\s*"https:\/\/([^."]+)\.etsy\.com/)?.[1];

        if (!shopId) return null;
        deps.markEtsyLoggedIn?.();
        return { shopId, shopName: shopName || shopId };
    } catch (error) {
        console.error('[Reviews] Failed to discover current Etsy shop:', error);
        return null;
    }
}
