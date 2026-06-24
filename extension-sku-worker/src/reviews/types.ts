export interface EtsyReviewImage {
    url_75x75?: string | null;
    url_300x300?: string | null;
    url_fullxfull?: string | null;
}

export interface CleanedEtsyReview {
    transaction_id: string;
    order_id: string;
    shop_id: string;
    rating: number | null;
    review: string;
    create_date: string;
    buyer_name: string | null;
    buyer_login_name: string | null;
    listing_id: string;
    listing_title: string;
    review_photo_detailed: EtsyReviewImage | null;
    listing_image: EtsyReviewImage | null;
}

export interface EtsyReviewShopConfig {
    shopId: string;
    shopName: string;
}

export interface FetchEtsyReviewsOptions {
    limit?: number;
    offset?: number;
    minCreated?: number;
}

export interface ReviewSyncResult {
    fetched: number;
    saved: number;
}

export interface LatestSavedReviewMarker {
    transactionId?: string;
    createDate?: string;
    createMs?: number;
}
