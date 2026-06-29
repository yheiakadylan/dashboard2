import React, { useState, useMemo } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUI } from '../../contexts/UIContext';
import LoadingSpinner from '../ui/LoadingSpinner';
import ImagePreviewModal from '../modals/ImagePreviewModal';
import { buildAccountLabelMap, resolveAccountLabel } from '../../utils/accountLabels';

const decodeHTML = (text: string | null | undefined) => {
    if (!text) return '';
    const textArea = document.createElement('textarea');
    textArea.innerHTML = text;
    return textArea.value;
};

const ReviewsTab: React.FC = () => {
    const { etsyReviews, accounts, isLoading } = useDashboard();
    const { selectedAccountId, reviewRatingFilter, timeZone } = useUI();

    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const accountLabelMap = useMemo(() => buildAccountLabelMap(accounts), [accounts]);
    const getShopLabel = (shopId?: string | number | null) => resolveAccountLabel(accountLabelMap, shopId);

    const selectedShopKeys = useMemo(() => {
        if (!selectedAccountId || selectedAccountId === 'all') return null;
        const selectedAccount = accounts.find(account => account.email === selectedAccountId);
        return new Set(
            [selectedAccountId, selectedAccount?.id, selectedAccount?.label]
                .filter((value): value is string => Boolean(value))
                .map(value => value.trim().toLowerCase())
        );
    }, [accounts, selectedAccountId]);

    // Apply filters
    const filteredReviews = useMemo(() => {
        return etsyReviews.filter(review => {
            if (reviewRatingFilter !== 'All' && review.rating !== Number(reviewRatingFilter)) {
                return false;
            }
            if (selectedShopKeys && !selectedShopKeys.has(String(review.shop_id || '').trim().toLowerCase())) {
                return false;
            }
            return true;
        }).sort((a, b) => new Date(b.create_date).getTime() - new Date(a.create_date).getTime());
    }, [etsyReviews, reviewRatingFilter, selectedShopKeys]);

    if (isLoading) {
        return <LoadingSpinner variant="card" count={5} />;
    }

    const renderStars = (rating: number | null) => {
        if (!rating) return <span className="text-gray-400 text-sm">No rating</span>;
        const stars = [];
        for (let i = 1; i <= 5; i++) {
            stars.push(
                <svg key={i} className={`w-4 h-4 ${i <= rating ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
            );
        }
        return <div className="flex items-center space-x-1">{stars}</div>;
    };

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] relative">
            <div className="p-2 md:p-6">
                {/* List */}
                <div className="flex flex-col gap-4 pb-20 max-w-5xl mx-auto">
                    {filteredReviews.length > 0 ? (
                        filteredReviews.map((review) => {
                            const dateDisplay = new Intl.DateTimeFormat('en-US', {
                                timeZone, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
                            }).format(new Date(review.create_date));

                            const reviewPhoto = review.review_photo_detailed;

                            return (
                                <div key={review.id || review.transaction_id || review.order_id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow">
                                    <div className="flex flex-col md:flex-row gap-6">
                                        {/* Left Side: Review */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <div className="font-semibold text-gray-900 dark:text-white text-lg">
                                                        {decodeHTML(review.buyer_name || review.buyer_login_name || 'Anonymous User')}
                                                    </div>
                                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                                        {dateDisplay}
                                                    </div>
                                                </div>
                                                <div className="md:hidden">
                                                    {renderStars(review.rating)}
                                                </div>
                                            </div>
                                            
                                            <div className="hidden md:block mb-3">
                                                {renderStars(review.rating)}
                                            </div>
                                            
                                            <p className="text-gray-700 dark:text-gray-300 text-base whitespace-pre-wrap leading-relaxed">
                                                {decodeHTML(review.review) || <span className="italic text-gray-400">No text provided</span>}
                                            </p>
                                            
                                            {reviewPhoto && (
                                                <div className="mt-4 flex flex-wrap gap-3">
                                                    <img
                                                        src={reviewPhoto.url_300x300 || reviewPhoto.url_fullxfull || ''}
                                                        alt="Customer upload"
                                                        className="w-[300px] h-[300px] object-cover rounded-md border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
                                                        onClick={() => setPreviewImage(reviewPhoto.url_fullxfull || reviewPhoto.url_300x300 || null)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Right Side: Product & Order Info */}
                                        <div className="w-full md:w-[320px] shrink-0 flex flex-col gap-4 border-t md:border-t-0 md:border-l border-gray-100 dark:border-gray-700 pt-4 md:pt-0 md:pl-6">
                                            <div>
                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                    Order ID: <span className="font-medium text-gray-900 dark:text-gray-200">{review.order_id || 'N/A'}</span>
                                                </div>
                                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                    Shop: <span className="font-medium text-gray-900 dark:text-gray-200">{getShopLabel(review.shop_id)}</span>
                                                </div>
                                            </div>
                                            
                                            <div>
                                                <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Product</div>
                                                <div className="flex items-start gap-3">
                                                    {review.listing_image?.url_75x75 ? (
                                                        <img src={review.listing_image.url_75x75} alt={review.listing_title} className="w-[75px] h-[75px] shrink-0 object-cover rounded cursor-pointer hover:opacity-80" onClick={() => setPreviewImage(review.listing_image?.url_fullxfull || review.listing_image?.url_75x75 || null)} />
                                                    ) : (
                                                        <div className="w-[75px] h-[75px] shrink-0 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center text-xs text-gray-400 border border-gray-200 dark:border-gray-700">No Img</div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <a 
                                                            href={`https://etsy.com/listing/${review.listing_id}`} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline line-clamp-2" 
                                                            title={decodeHTML(review.listing_title)}
                                                        >
                                                            {decodeHTML(review.listing_title) || 'Unknown Product'}
                                                        </a>
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            ID: {review.listing_id || 'N/A'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="w-full flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
                            No reviews found matching the selected filters.
                        </div>
                    )}
                </div>
            </div>
            
            <ImagePreviewModal
                imageUrl={previewImage}
                onClose={() => setPreviewImage(null)}
            />
        </div>
    );
};

export default ReviewsTab;
