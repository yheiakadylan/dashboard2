import type { CleanedEtsyReview, EtsyReviewImage } from './types';

function pickImageUrls(image: any): EtsyReviewImage | null {
    if (!image || typeof image !== 'object') return null;

    const sources = Array.isArray(image.sources) ? image.sources : [];
    const source75 = sources.find((source: any) => Number(source?.width) === 75 || String(source?.url || '').includes('_75x75.'));
    const source300 = sources.find((source: any) => Number(source?.width) === 300 || String(source?.url || '').includes('_300x300.'));
    const largestSource = sources.reduce((best: any, source: any) => {
        const pixels = Number(source?.width || 0) * Number(source?.height || 0);
        const bestPixels = Number(best?.width || 0) * Number(best?.height || 0);
        return pixels > bestPixels ? source : best;
    }, null);

    const url75 = image.url_75x75 || source75?.url || null;
    const url300 = image.url_300x300 || source300?.url || null;
    const urlFull = image.url_fullxfull || image.url_fullxful || image.url || largestSource?.url || null;

    if (!url75 && !url300 && !urlFull) return null;
    return { url_75x75: url75, url_300x300: url300, url_fullxfull: urlFull };
}

function pickReviewPhotoUrls(image: any): EtsyReviewImage | null {
    if (!image || typeof image !== 'object') return null;

    const sources = Array.isArray(image.sources) ? image.sources : [];
    const source300 = sources.find((source: any) => Number(source?.width) === 300 || String(source?.url || '').includes('_300x300.'));
    const largestSource = sources.reduce((best: any, source: any) => {
        const pixels = Number(source?.width || 0) * Number(source?.height || 0);
        const bestPixels = Number(best?.width || 0) * Number(best?.height || 0);
        return pixels > bestPixels ? source : best;
    }, null);

    const url300 = image.url_300x300 || source300?.url || null;
    const urlFull = image.url_fullxfull || image.url_fullxful || image.url || largestSource?.url || null;

    if (!url300 && !urlFull) return null;
    return { url_300x300: url300, url_fullxfull: urlFull };
}

function toIsoUtc(value: any): string {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return new Date().toISOString();
    return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
}

export function cleanEtsyReview(raw: any, shopName: string): CleanedEtsyReview | null {
    if (!raw?.transaction_id) return null;

    const rawPhoto = raw.review_photo_detailed || raw.review_photo || (Array.isArray(raw.Images) ? raw.Images[0] : raw.Images) || null;
    const reviewPhoto = pickReviewPhotoUrls(rawPhoto);

    return {
        transaction_id: String(raw.transaction_id),
        order_id: raw.receipt_id ? String(raw.receipt_id) : '',
        shop_id: shopName || String(raw.shop_id || ''),
        rating: typeof raw.rating === 'number' ? raw.rating : Number(raw.rating || 0) || null,
        review: String(raw.review || ''),
        create_date: toIsoUtc(raw.create_date),
        buyer_name: raw.buyer_name || null,
        buyer_login_name: raw.buyer_login_name || null,
        listing_id: raw.listing_id ? String(raw.listing_id) : '',
        listing_title: String(raw.listing_title || ''),
        review_photo_detailed: reviewPhoto,
        listing_image: pickImageUrls(raw.listing_image)
    };
}

export function normalizeReviewPayload(payload: any): any[] {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.reviews)) return payload.reviews;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
}
