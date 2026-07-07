import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUIFilters } from '../../contexts/UIContext';
import LoadingSpinner from '../ui/LoadingSpinner';
import ImagePreviewModal from '../modals/ImagePreviewModal';
import { buildAccountLabelMap, resolveAccountLabel } from '../../utils/accountLabels';
import KpiCard from '../ui/KpiCard';
import { getEtsyReviewsForDateRange } from '../../services/firebaseService';
import { EtsyReview } from '../../types';
import { buildNumericKpi, getPreviousDateRange, getPreviousPeriodLabel } from '../../utils/periodComparison';

const decodeHTML = (text: string | null | undefined) => {
    if (!text) return '';
    const textArea = document.createElement('textarea');
    textArea.innerHTML = text;
    return textArea.value;
};

const BAD_REVIEW_MAX_RATING = 3;
const isBadReview = (review: EtsyReview) => typeof review.rating === 'number' && review.rating <= BAD_REVIEW_MAX_RATING;
const getReviewKey = (review: EtsyReview) => String(
    review.id || review.transaction_id || review.order_id || `${review.shop_id}-${review.create_date}-${review.rating}`
);
const getProductKey = (review: EtsyReview) => {
    const listingId = String(review.listing_id || '').trim();
    if (listingId) return listingId;
    return decodeHTML(review.listing_title).trim().toLowerCase();
};
const normalizeShopKey = (value?: string | number | null) => String(value || '').trim().toLowerCase();

interface ProductReviewHighlight {
    productKey: string;
    listingId: string;
    title: string;
    shopLabel: string;
    total: number;
    goodReviews: number;
    badReviews: number;
    averageRating: number;
    imageUrl: string | null;
    sampleReview: EtsyReview;
}

type ShopBreakdownSortKey = 'shopName' | 'total' | 'averageRating' | 'shopReviewAverage' | 'fiveStars' | 'badReviews' | 'withImages';
type ShopBreakdownSort = { key: ShopBreakdownSortKey; direction: 'asc' | 'desc' };

const ReviewsTab: React.FC = () => {
    const { etsyReviews, accounts, isLoading, teamId } = useDashboard();
    const { selectedAccountId, reviewRatingFilter, setReviewRatingFilter, filterDateRange, timeZone } = useUIFilters();

    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [previousReviews, setPreviousReviews] = useState<EtsyReview[] | null>(null);
    const [showBadReviewsOnly, setShowBadReviewsOnly] = useState(false);
    const [showImagesOnly, setShowImagesOnly] = useState(false);
    const [focusedReviewKey, setFocusedReviewKey] = useState<string | null>(null);
    const [selectedProductFilter, setSelectedProductFilter] = useState<{ productKey: string; title: string } | null>(null);
    const [shopBreakdownSort, setShopBreakdownSort] = useState<ShopBreakdownSort>({ key: 'total', direction: 'desc' });
    const reviewRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const reviewFeedRef = useRef<HTMLDivElement | null>(null);

    const accountLabelMap = useMemo(() => buildAccountLabelMap(accounts), [accounts]);
    const getShopLabel = (shopId?: string | number | null) => resolveAccountLabel(accountLabelMap, shopId);
    const previousRange = useMemo(() => getPreviousDateRange(filterDateRange), [filterDateRange]);
    const previousLabel = useMemo(() => getPreviousPeriodLabel(filterDateRange), [filterDateRange]);

    const selectedShopKeys = useMemo(() => {
        if (!selectedAccountId || selectedAccountId === 'all') return null;
        const selectedAccount = accounts.find(account => account.email === selectedAccountId);
        return new Set(
            [selectedAccountId, selectedAccount?.id, selectedAccount?.label]
                .filter((value): value is string => Boolean(value))
                .map(value => value.trim().toLowerCase())
        );
    }, [accounts, selectedAccountId]);

    const shopHealthByKey = useMemo(() => {
        const map = new Map<string, {
            reviewAverage: number | null;
            reviewCount: number | null;
            suspended: boolean;
        }>();

        accounts.forEach(account => {
            const health = {
                reviewAverage: typeof account.etsy_review_average === 'number' ? account.etsy_review_average : null,
                reviewCount: typeof account.etsy_review_count === 'number' ? account.etsy_review_count : null,
                suspended: account.etsy_suspended === true
            };

            [account.id, account.email, account.label]
                .map(normalizeShopKey)
                .filter(Boolean)
                .forEach(key => map.set(key, health));
        });

        return map;
    }, [accounts]);

    const shopAverageExtremes = useMemo(() => {
        const rows = accounts
            .filter(account => typeof account.etsy_review_average === 'number')
            .filter(account => {
                if (!selectedShopKeys) return true;
                return [account.id, account.email, account.label]
                    .map(normalizeShopKey)
                    .filter(Boolean)
                    .some(key => selectedShopKeys.has(key));
            })
            .map(account => ({
                shop: account.label || account.email || account.id,
                average: account.etsy_review_average as number,
                count: typeof account.etsy_review_count === 'number' ? account.etsy_review_count : 0,
                suspended: account.etsy_suspended === true
            }));

        const activeRows = rows.filter(row => !row.suspended);
        const comparableRows = activeRows.length > 0 ? activeRows : rows;
        const highest = comparableRows.reduce<typeof comparableRows[number] | null>(
            (best, row) => (!best || row.average > best.average || (row.average === best.average && row.count > best.count) ? row : best),
            null
        );
        const lowest = comparableRows.reduce<typeof comparableRows[number] | null>(
            (best, row) => (!best || row.average < best.average || (row.average === best.average && row.count > best.count) ? row : best),
            null
        );

        const toKpi = (row: typeof highest) => row
            ? {
                value: row.average.toFixed(2),
                previousLabel: row.shop,
                previousValue: `${row.count.toLocaleString()} reviews`
            }
            : { value: '-' };

        return {
            highest: toKpi(highest),
            lowest: toKpi(lowest)
        };
    }, [accounts, selectedShopKeys]);

    useEffect(() => {
        let cancelled = false;
        setPreviousReviews(null);

        getEtsyReviewsForDateRange(teamId, previousRange.from, previousRange.to, timeZone)
            .then(reviews => {
                if (!cancelled) setPreviousReviews(reviews);
            })
            .catch(error => {
                if (!cancelled) {
                     console.error('Failed to load previous reviews period:', error);
                     setPreviousReviews([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [teamId, previousRange.from, previousRange.to, timeZone]);

    useEffect(() => {
        if (reviewRatingFilter !== 'All') {
            setShowBadReviewsOnly(false);
            setShowImagesOnly(false);
        }
    }, [reviewRatingFilter]);

    // Apply filters
    const filteredReviews = useMemo(() => {
        return etsyReviews.filter(review => {
            const shopKey = String(review.shop_id || '').trim().toLowerCase();
            if (selectedShopKeys && !selectedShopKeys.has(shopKey)) {
                return false;
            }
            if (selectedProductFilter && getProductKey(review) !== selectedProductFilter.productKey) {
                return false;
            }
            if (showBadReviewsOnly && !isBadReview(review)) {
                return false;
            }
            if (showImagesOnly && !review.review_photo_detailed) {
                return false;
            }
            if (!showBadReviewsOnly && !showImagesOnly && reviewRatingFilter !== 'All' && review.rating !== Number(reviewRatingFilter)) {
                return false;
            }
            return true;
        }).sort((a, b) => new Date(b.create_date).getTime() - new Date(a.create_date).getTime());
    }, [etsyReviews, reviewRatingFilter, selectedProductFilter, selectedShopKeys, showBadReviewsOnly, showImagesOnly]);

    const reviewKpis = useMemo(() => {
        const filterByShop = (review: EtsyReview) => {
            const shopKey = String(review.shop_id || '').trim().toLowerCase();
            if (selectedShopKeys && !selectedShopKeys.has(shopKey)) return false;
            if (selectedProductFilter && getProductKey(review) !== selectedProductFilter.productKey) return false;
            return true;
        };

        const filterForActiveView = (review: EtsyReview) => {
            if (!filterByShop(review)) return false;
            if (showBadReviewsOnly && !isBadReview(review)) return false;
            if (showImagesOnly && !review.review_photo_detailed) return false;
            if (!showBadReviewsOnly && !showImagesOnly && reviewRatingFilter !== 'All' && review.rating !== Number(reviewRatingFilter)) return false;
            return true;
        };

        const currentBaseReviews = etsyReviews.filter(filterByShop);
        const previousBaseReviews = previousReviews ? previousReviews.filter(filterByShop) : null;
        const previousFilteredReviews = previousReviews ? previousReviews.filter(filterForActiveView) : null;
        const getAverageRating = (reviews: EtsyReview[]) => {
            const ratings = reviews
                .map(review => review.rating)
                .filter((rating): rating is number => typeof rating === 'number');
            if (ratings.length === 0) return 0;
            return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
        };

        const currentAverage = getAverageRating(filteredReviews);
        const previousAverage = previousFilteredReviews ? getAverageRating(previousFilteredReviews) : undefined;
        const currentFiveStars = filteredReviews.filter(review => review.rating === 5).length;
        const previousFiveStars = previousFilteredReviews?.filter(review => review.rating === 5).length;
        const currentBadReviews = currentBaseReviews.filter(isBadReview).length;
        const previousBadReviews = previousBaseReviews?.filter(isBadReview).length;
        const currentWithImages = currentBaseReviews.filter(review => !!review.review_photo_detailed).length;
        const previousWithImages = previousBaseReviews?.filter(review => !!review.review_photo_detailed).length;
        const currentReviewedShops = new Set(filteredReviews.map(review => String(review.shop_id || '').trim()).filter(Boolean)).size;
        const previousReviewedShops = previousFilteredReviews
            ? new Set(previousFilteredReviews.map(review => String(review.shop_id || '').trim()).filter(Boolean)).size
            : undefined;

        return {
            total: buildNumericKpi(filteredReviews.length, previousFilteredReviews?.length, String, previousLabel),
            reviewedShops: buildNumericKpi(currentReviewedShops, previousReviewedShops, String, previousLabel),
            averageRating: buildNumericKpi(
                currentAverage,
                previousAverage,
                value => value > 0 ? value.toFixed(2) : '0.00',
                previousLabel
            ),
            fiveStars: buildNumericKpi(currentFiveStars, previousFiveStars, String, previousLabel),
            badReviews: buildNumericKpi(currentBadReviews, previousBadReviews, String, previousLabel),
            withImages: buildNumericKpi(currentWithImages, previousWithImages, String, previousLabel)
        };
    }, [etsyReviews, filteredReviews, previousLabel, previousReviews, reviewRatingFilter, selectedProductFilter, selectedShopKeys, showBadReviewsOnly, showImagesOnly]);

    const reviewHighlights = useMemo(() => {
        let lowestReview: EtsyReview | null = null;
        let latestReview: EtsyReview | null = null;
        let bestReview: EtsyReview | null = null;
        let latestPhotoReview: EtsyReview | null = null;

        if (filteredReviews.length > 0) {
            const getRatingScore = (review: EtsyReview) => typeof review.rating === 'number' ? review.rating : 6;
            const usedKeys = new Set<string>();

            // 1. Find Lowest Review (absolute lowest rating)
            lowestReview = filteredReviews.reduce((best, review) => {
                const reviewScore = getRatingScore(review);
                const bestScore = getRatingScore(best);
                if (reviewScore < bestScore) return review;
                if (reviewScore === bestScore && new Date(review.create_date).getTime() > new Date(best.create_date).getTime()) {
                    return review;
                }
                return best;
            }, filteredReviews[0]);

            if (lowestReview) {
                usedKeys.add(getReviewKey(lowestReview));
            }

            // 2. Find Newest Review (excluding lowest review, if possible)
            latestReview = filteredReviews.find(r => !usedKeys.has(getReviewKey(r))) || null;
            if (!latestReview && filteredReviews.length > 0) {
                // Fallback to absolute latest if we only have 1 review
                latestReview = filteredReviews[0];
            }
            if (latestReview) {
                usedKeys.add(getReviewKey(latestReview));
            }

            // 3. Find Best Review (rating 5 or highest rating, excluding already used reviews, prefer with text)
            const remainingReviews = filteredReviews.filter(r => !usedKeys.has(getReviewKey(r)));
            if (remainingReviews.length > 0) {
                bestReview = remainingReviews.reduce((best, review) => {
                    const reviewScore = getRatingScore(review);
                    const bestScore = getRatingScore(best);
                    if (reviewScore > bestScore) return review;
                    if (reviewScore === bestScore) {
                        const reviewHasText = (review.review || '').trim().length > 0;
                        const bestHasText = (best.review || '').trim().length > 0;
                        if (reviewHasText && !bestHasText) return review;
                        if (!reviewHasText && bestHasText) return best;
                        if (new Date(review.create_date).getTime() > new Date(best.create_date).getTime()) {
                            return review;
                        }
                    }
                    return best;
                }, remainingReviews[0]);
            }
            if (bestReview) {
                usedKeys.add(getReviewKey(bestReview));
            }

            // 4. Find Latest Photo Review (excluding already used reviews)
            const remainingPhotoReviews = filteredReviews.filter(r => !usedKeys.has(getReviewKey(r)) && !!r.review_photo_detailed);
            latestPhotoReview = remainingPhotoReviews.length > 0 ? remainingPhotoReviews[0] : null;
        }

        const productReviewSource = etsyReviews.filter(review => {
            const shopKey = String(review.shop_id || '').trim().toLowerCase();
            if (selectedShopKeys && !selectedShopKeys.has(shopKey)) return false;
            return true;
        });

        const productMap = new Map<string, {
            productKey: string;
            listingId: string;
            title: string;
            shopLabel: string;
            total: number;
            goodReviews: number;
            badReviews: number;
            ratings: number[];
            imageUrl: string | null;
            latestReview: EtsyReview;
            goodSample: EtsyReview | null;
            badSample: EtsyReview | null;
        }>();

        productReviewSource.forEach(review => {
            const title = decodeHTML(review.listing_title).trim();
            const listingId = String(review.listing_id || '').trim();
            const productKey = getProductKey(review);
            if (!productKey) return;

            const current = productMap.get(productKey);
            const reviewTime = new Date(review.create_date).getTime();
            const isGood = typeof review.rating === 'number' && review.rating >= 4;
            const isBad = isBadReview(review);

            if (!current) {
                productMap.set(productKey, {
                    productKey,
                    listingId,
                    title: title || 'Unknown Product',
                    shopLabel: resolveAccountLabel(accountLabelMap, review.shop_id) || 'Unknown Shop',
                    total: 1,
                    goodReviews: isGood ? 1 : 0,
                    badReviews: isBad ? 1 : 0,
                    ratings: typeof review.rating === 'number' ? [review.rating] : [],
                    imageUrl: review.listing_image?.url_75x75 || review.listing_image?.url_300x300 || review.listing_image?.url_fullxfull || null,
                    latestReview: review,
                    goodSample: isGood ? review : null,
                    badSample: isBad ? review : null,
                });
                return;
            }

            current.total += 1;
            if (typeof review.rating === 'number') current.ratings.push(review.rating);
            if (isGood) {
                current.goodReviews += 1;
                if (!current.goodSample || reviewTime > new Date(current.goodSample.create_date).getTime()) {
                    current.goodSample = review;
                }
            }
            if (isBad) {
                current.badReviews += 1;
                if (
                    !current.badSample ||
                    (typeof review.rating === 'number' && typeof current.badSample.rating === 'number' && review.rating < current.badSample.rating) ||
                    reviewTime > new Date(current.badSample.create_date).getTime()
                ) {
                    current.badSample = review;
                }
            }
            if (!current.imageUrl) {
                current.imageUrl = review.listing_image?.url_75x75 || review.listing_image?.url_300x300 || review.listing_image?.url_fullxfull || null;
            }
            if (reviewTime > new Date(current.latestReview.create_date).getTime()) {
                current.latestReview = review;
            }
        });

        const productRows: ProductReviewHighlight[] = Array.from(productMap.values()).map(product => {
            const averageRating = product.ratings.length > 0
                ? product.ratings.reduce((sum, rating) => sum + rating, 0) / product.ratings.length
                : 0;
            return {
                productKey: product.productKey,
                listingId: product.listingId,
                title: product.title,
                shopLabel: product.shopLabel,
                total: product.total,
                goodReviews: product.goodReviews,
                badReviews: product.badReviews,
                averageRating,
                imageUrl: product.imageUrl,
                sampleReview: product.goodSample || product.badSample || product.latestReview,
            };
        });

        const goodProduct = productRows
            .filter(product => product.goodReviews > 0)
            .sort((a, b) =>
                b.goodReviews - a.goodReviews ||
                b.averageRating - a.averageRating ||
                b.total - a.total ||
                new Date(b.sampleReview.create_date).getTime() - new Date(a.sampleReview.create_date).getTime()
            )[0] || null;

        const badProduct = productRows
            .filter(product => product.badReviews > 0)
            .sort((a, b) =>
                b.badReviews - a.badReviews ||
                a.averageRating - b.averageRating ||
                b.total - a.total ||
                new Date(b.sampleReview.create_date).getTime() - new Date(a.sampleReview.create_date).getTime()
            )[0] || null;

        return {
            lowestReview,
            latestReview,
            bestReview,
            latestPhotoReview,
            goodProduct,
            badProduct
        };
    }, [accountLabelMap, etsyReviews, filteredReviews, selectedShopKeys]);

    const shopBreakdownRows = useMemo(() => {
        const shopsDataMap = new Map<string, {
            shopName: string;
            total: number;
            previousTotal: number;
            delta: number;
            ratings: number[];
            fiveStars: number;
            badReviews: number;
            withImages: number;
        }>();

        const ensureRow = (shopName: string) => {
            if (!shopsDataMap.has(shopName)) {
                shopsDataMap.set(shopName, {
                    shopName,
                    total: 0,
                    previousTotal: 0,
                    delta: 0,
                    ratings: [],
                    fiveStars: 0,
                    badReviews: 0,
                    withImages: 0
                });
            }
            return shopsDataMap.get(shopName)!;
        };

        accounts.forEach(account => {
            if (typeof account.etsy_review_average !== 'number') return;
            const accountKeys = [account.id, account.email, account.label]
                .map(normalizeShopKey)
                .filter(Boolean);
            if (selectedShopKeys && !accountKeys.some(key => selectedShopKeys.has(key))) return;

            ensureRow(account.label || account.email || account.id);
        });

        filteredReviews.forEach(review => {
            const shopName = getShopLabel(review.shop_id) || 'Unknown Shop';
            const data = ensureRow(shopName);
            data.total += 1;
            if (typeof review.rating === 'number') {
                data.ratings.push(review.rating);
                if (review.rating === 5) data.fiveStars += 1;
                if (review.rating <= BAD_REVIEW_MAX_RATING) data.badReviews += 1;
            }
            if (review.review_photo_detailed) {
                data.withImages += 1;
            }
        });

        const previousFilter = (review: EtsyReview) => {
            const shopKey = String(review.shop_id || '').trim().toLowerCase();
            if (selectedShopKeys && !selectedShopKeys.has(shopKey)) return false;
            if (showBadReviewsOnly && !isBadReview(review)) return false;
            if (showImagesOnly && !review.review_photo_detailed) return false;
            if (!showBadReviewsOnly && !showImagesOnly && reviewRatingFilter !== 'All' && review.rating !== Number(reviewRatingFilter)) return false;
            return true;
        };

        (previousReviews || []).filter(previousFilter).forEach(review => {
            const shopName = getShopLabel(review.shop_id) || 'Unknown Shop';
            const data = ensureRow(shopName);
            data.previousTotal += 1;
        });

        return Array.from(shopsDataMap.values())
            .map(data => {
                const avg = data.ratings.length > 0
                    ? data.ratings.reduce((sum, r) => sum + r, 0) / data.ratings.length
                    : 0;
                const shopHealth = shopHealthByKey.get(normalizeShopKey(data.shopName));
                return {
                    ...data,
                    delta: data.total - data.previousTotal,
                    averageRating: avg,
                    shopReviewAverage: shopHealth?.reviewAverage ?? null,
                    shopReviewCount: shopHealth?.reviewCount ?? null,
                    shopSuspended: shopHealth?.suspended === true
                };
            })
            .sort((a, b) => {
                const direction = shopBreakdownSort.direction === 'asc' ? 1 : -1;
                const getValue = (row: typeof a) => {
                    if (shopBreakdownSort.key === 'shopReviewAverage') return row.shopReviewAverage ?? -1;
                    return row[shopBreakdownSort.key];
                };
                const valueA = getValue(a);
                const valueB = getValue(b);

                if (typeof valueA === 'string' || typeof valueB === 'string') {
                    const compared = String(valueA).localeCompare(String(valueB));
                    if (compared !== 0) return compared * direction;
                } else if (valueA !== valueB) {
                    return (Number(valueA) - Number(valueB)) * direction;
                }

                return b.total - a.total || b.delta - a.delta || a.shopName.localeCompare(b.shopName);
            });
    }, [accounts, filteredReviews, getShopLabel, previousReviews, reviewRatingFilter, selectedShopKeys, shopBreakdownSort, shopHealthByKey, showBadReviewsOnly, showImagesOnly]);

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

    const handleHighlightClick = (review: EtsyReview) => {
        const key = getReviewKey(review);
        setFocusedReviewKey(key);
        window.setTimeout(() => {
            reviewRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
    };

    const handleToggleBadReviews = () => {
        setReviewRatingFilter('All');
        setShowImagesOnly(false);
        setShowBadReviewsOnly(current => !current);
    };

    const handleToggleImagesOnly = () => {
        setReviewRatingFilter('All');
        setShowBadReviewsOnly(false);
        setShowImagesOnly(current => !current);
    };

    const handleProductHighlightClick = (product: ProductReviewHighlight) => {
        setSelectedProductFilter({ productKey: product.productKey, title: product.title });
        setReviewRatingFilter('All');
        setShowBadReviewsOnly(false);
        setShowImagesOnly(false);
        setFocusedReviewKey(null);
        window.setTimeout(() => {
            reviewFeedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
    };

    const handleShopBreakdownSort = (key: ShopBreakdownSortKey) => {
        setShopBreakdownSort(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const renderShopSortHeader = (label: string, key: ShopBreakdownSortKey, align: 'left' | 'center' = 'center') => {
        const active = shopBreakdownSort.key === key;
        const arrow = active ? (shopBreakdownSort.direction === 'desc' ? '↓' : '↑') : '↕';
        return (
            <button
                type="button"
                onClick={() => handleShopBreakdownSort(key)}
                className={`inline-flex w-full items-center gap-1 font-bold uppercase tracking-wide transition-colors hover:text-blue-600 dark:hover:text-blue-400 ${align === 'center' ? 'justify-center' : 'justify-start'} ${active ? 'text-blue-600 dark:text-blue-400' : ''}`}
                title={`Sort by ${label}`}
            >
                <span>{label}</span>
                <span className="text-[10px]">{arrow}</span>
            </button>
        );
    };

    const renderHighlightCard = (label: string, review: EtsyReview | null) => {
        if (!review) return null;
        const dateDisplay = new Intl.DateTimeFormat('en-US', {
            timeZone, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
        }).format(new Date(review.create_date));
        const reviewText = decodeHTML(review.review).trim();

        const isLowest = label.toLowerCase().includes('lowest');
        const isBest = label.toLowerCase().includes('best');
        const isPhoto = label.toLowerCase().includes('photo');

        const cardStyleClasses = isLowest
            ? "border-l-4 border-l-red-500 bg-gradient-to-br from-red-50/40 via-white to-white dark:from-red-950/10 dark:via-gray-800/90 dark:to-gray-800/80 hover:border-red-400 dark:hover:border-red-500"
            : isBest
            ? "border-l-4 border-l-green-500 bg-gradient-to-br from-green-50/40 via-white to-white dark:from-green-950/10 dark:via-gray-800/90 dark:to-gray-800/80 hover:border-green-400 dark:hover:border-green-500"
            : isPhoto
            ? "border-l-4 border-l-cyan-500 bg-gradient-to-br from-cyan-50/40 via-white to-white dark:from-cyan-950/10 dark:via-gray-800/90 dark:to-gray-800/80 hover:border-cyan-400 dark:hover:border-cyan-500"
            : "border-l-4 border-l-blue-500 bg-gradient-to-br from-blue-50/40 via-white to-white dark:from-blue-950/10 dark:via-gray-800/90 dark:to-gray-800/80 hover:border-blue-400 dark:hover:border-blue-500";

        const labelStyleClasses = isLowest
            ? "text-red-600 dark:text-red-400"
            : isBest
            ? "text-green-600 dark:text-green-400"
            : isPhoto
            ? "text-cyan-600 dark:text-cyan-400"
            : "text-blue-600 dark:text-blue-400";

        const accentText = isLowest
            ? "text-red-600 dark:text-red-400"
            : isBest
            ? "text-green-600 dark:text-green-400"
            : isPhoto
            ? "text-cyan-600 dark:text-cyan-400"
            : "text-blue-600 dark:text-blue-400";

        return (
            <button
                type="button"
                onClick={() => handleHighlightClick(review)}
                className={`text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-all ${cardStyleClasses}`}
            >
                <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                        <div className={`text-xs font-bold uppercase tracking-widest ${labelStyleClasses}`}>{label}</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{decodeHTML(review.buyer_name || review.buyer_login_name || 'Anonymous User')}</div>
                    </div>
                    <div className="shrink-0">{renderStars(review.rating)}</div>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    {dateDisplay} · {getShopLabel(review.shop_id)}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
                    {reviewText || <span className="italic text-gray-400">No text provided</span>}
                </p>
                <div className={`mt-2 text-xs font-semibold ${accentText}`}>Click to inspect</div>
            </button>
        );
    };

    const renderProductHighlightCard = (
        label: string,
        product: ProductReviewHighlight | null,
        tone: 'good' | 'bad'
    ) => {
        if (!product) return null;

        const isGood = tone === 'good';
        const cardStyleClasses = isGood
            ? "border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50/50 via-white to-white dark:from-emerald-950/10 dark:via-gray-800/90 dark:to-gray-800/80 hover:border-emerald-400 dark:hover:border-emerald-500"
            : "border-l-4 border-l-orange-500 bg-gradient-to-br from-orange-50/50 via-white to-white dark:from-orange-950/10 dark:via-gray-800/90 dark:to-gray-800/80 hover:border-orange-400 dark:hover:border-orange-500";
        const labelStyleClasses = isGood
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-orange-600 dark:text-orange-400";
        const accentText = isGood
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-orange-600 dark:text-orange-400";
        const primaryCount = isGood ? product.goodReviews : product.badReviews;
        const primaryLabel = isGood ? 'good reviews' : 'bad reviews';

        return (
            <button
                type="button"
                onClick={() => handleProductHighlightClick(product)}
                className={`text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-all ${cardStyleClasses}`}
            >
                <div className="flex items-start gap-3">
                    {product.imageUrl ? (
                        <img
                            src={product.imageUrl}
                            alt={product.title}
                            className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-gray-700 shrink-0"
                        />
                    ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 shrink-0 flex items-center justify-center text-[10px] font-semibold text-gray-400">
                            No Img
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className={`text-xs font-bold uppercase tracking-widest ${labelStyleClasses}`}>{label}</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white line-clamp-2">
                            {product.title}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {product.shopLabel}{product.listingId ? ` · ID ${product.listingId}` : ''}
                        </div>
                    </div>
                    <div className="shrink-0 hidden sm:block">{renderStars(product.averageRating)}</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-white/70 dark:bg-gray-900/30 px-2 py-2">
                        <div className={`text-sm font-black ${accentText}`}>{primaryCount}</div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{primaryLabel}</div>
                    </div>
                    <div className="rounded-lg bg-white/70 dark:bg-gray-900/30 px-2 py-2">
                        <div className="text-sm font-black text-gray-900 dark:text-white">{product.averageRating.toFixed(2)}</div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">avg rating</div>
                    </div>
                    <div className="rounded-lg bg-white/70 dark:bg-gray-900/30 px-2 py-2">
                        <div className="text-sm font-black text-gray-900 dark:text-white">{product.total}</div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">reviews</div>
                    </div>
                </div>
                <div className={`mt-2 text-xs font-semibold ${accentText}`}>Click to filter this product</div>
            </button>
        );
    };

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] relative">
            <div className="p-2 md:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 mb-6 w-full">
                    <KpiCard title="Total Reviews" value={reviewKpis.total} />
                    <KpiCard title="Reviewed Shops" value={reviewKpis.reviewedShops} />
                    <KpiCard title="Average Rating" value={reviewKpis.averageRating} />
                    <KpiCard title="Highest Shop Avg" value={shopAverageExtremes.highest} />
                    <KpiCard title="Lowest Shop Avg" value={shopAverageExtremes.lowest} />
                    <KpiCard title="5 Star Reviews" value={reviewKpis.fiveStars} />
                    <KpiCard
                        title="Bad Reviews"
                        value={reviewKpis.badReviews}
                        onClick={handleToggleBadReviews}
                        isActive={showBadReviewsOnly}
                        trendPolarity="lower-is-better"
                    />
                    <KpiCard
                        title="With Images"
                        value={reviewKpis.withImages}
                        onClick={handleToggleImagesOnly}
                        isActive={showImagesOnly}
                    />
                </div>

                {/* 2-Column Layout for Shop Breakdown & Review Highlights */}
                {(shopBreakdownRows.length > 0 || reviewHighlights.lowestReview || reviewHighlights.latestReview || reviewHighlights.goodProduct || reviewHighlights.badProduct) && (
                    <div className="w-full mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                        {/* Shop Breakdown Table */}
                        {shopBreakdownRows.length > 0 ? (
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col h-[350px] lg:h-0 lg:min-h-full">
                                <div className="flex flex-col h-full">
                                    <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                                        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-700 dark:text-gray-300">Shop Breakdown</h3>
                                    </div>
                                    <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0 relative [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-gray-750 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                                        <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400 relative border-collapse">
                                            <thead className="text-xs uppercase text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 bg-gray-50 dark:bg-gray-800">
                                                <tr>
                                                    <th className="px-4 py-3 font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">{renderShopSortHeader('Shop Name', 'shopName', 'left')}</th>
                                                    <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">{renderShopSortHeader('Reviews', 'total')}</th>
                                                    <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">{renderShopSortHeader('Rating', 'averageRating')}</th>
                                                    <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">{renderShopSortHeader('Review Avg', 'shopReviewAverage')}</th>
                                                    <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">{renderShopSortHeader('5 star', 'fiveStars')}</th>
                                                    <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">{renderShopSortHeader('Bad', 'badReviews')}</th>
                                                    <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">{renderShopSortHeader('Images', 'withImages')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                {shopBreakdownRows.map(row => (
                                                    <tr key={row.shopName} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                        <td className="px-4 py-3 font-bold text-gray-900 dark:text-white truncate max-w-[150px]" title={row.shopName}>{row.shopName}</td>
                                                        <td className="px-3 py-3 text-center">
                                                            <div className="flex items-baseline justify-center gap-2">
                                                                <span className="font-bold text-gray-900 dark:text-white">{row.total}</span>
                                                                <span className={`text-[11px] font-bold ${row.delta > 0 ? 'text-green-600 dark:text-green-400' : row.delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                                                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                                                                prev {row.previousTotal}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3 text-center font-semibold text-yellow-600 dark:text-yellow-400">★{row.averageRating.toFixed(2)}</td>
                                                        <td className="px-3 py-3 text-center">
                                                            {row.shopSuspended ? (
                                                                <span className="inline-flex rounded-full bg-red-100 px-2 py-1 text-[10px] font-black uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">Suspended</span>
                                                            ) : typeof row.shopReviewAverage === 'number' ? (
                                                                <div>
                                                                    <div className="font-semibold text-amber-600 dark:text-amber-400">★{row.shopReviewAverage.toFixed(2)}</div>
                                                                    <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                                                                        ({(row.shopReviewCount ?? 0).toLocaleString()})
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-300 dark:text-gray-600">--</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-3 text-center font-semibold text-green-600 dark:text-green-400">{row.fiveStars}</td>
                                                        <td className="px-3 py-3 text-center font-semibold text-red-600 dark:text-red-400">{row.badReviews}</td>
                                                        <td className="px-3 py-3 text-center font-semibold text-blue-600 dark:text-blue-400">{row.withImages}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        ) : <div />}

                        {/* Review Highlights */}
                        {(reviewHighlights.lowestReview || reviewHighlights.latestReview || reviewHighlights.bestReview || reviewHighlights.latestPhotoReview || reviewHighlights.goodProduct || reviewHighlights.badProduct) ? (
                            <div className="bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/60 dark:from-gray-800 dark:via-gray-800/95 dark:to-blue-950/20 border-2 border-blue-100 dark:border-blue-900/40 p-5 rounded-2xl shadow-md ring-1 ring-blue-50 dark:ring-blue-950/30 flex flex-col">
                                <div className="flex flex-col h-full w-full">
                                    <div className="mb-4 flex-shrink-0">
                                        <div className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                                            Review Highlights
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Timeline events plus product-level winners and products collecting bad reviews in this range.</p>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        {(() => {
                                            const renderedKeys = new Set<string>();
                                            const cards: React.ReactNode[] = [];

                                            const addCard = (label: string, review: EtsyReview | null) => {
                                                if (!review) return;
                                                const key = getReviewKey(review);
                                                if (renderedKeys.has(key)) return;
                                                renderedKeys.add(key);
                                                cards.push(renderHighlightCard(label, review));
                                            };

                                            addCard('Lowest Review', reviewHighlights.lowestReview);
                                            addCard('Newest Review', reviewHighlights.latestReview);
                                            addCard('Best Review', reviewHighlights.bestReview);
                                            addCard('Latest Photo Review', reviewHighlights.latestPhotoReview);

                                            return [
                                                renderProductHighlightCard('Best Reviewed Product', reviewHighlights.goodProduct, 'good'),
                                                renderProductHighlightCard('Most Bad Reviews Product', reviewHighlights.badProduct, 'bad'),
                                                ...cards
                                            ].filter(Boolean);
                                        })()}
                                    </div>
                                </div>
                            </div>
                        ) : <div />}
                    </div>
                )}

                {showBadReviewsOnly && (
                    <div className="max-w-6xl mx-auto mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-2 text-sm text-red-700 dark:text-red-300">
                        <span>Showing bad reviews ({BAD_REVIEW_MAX_RATING} stars or below).</span>
                        <button
                            type="button"
                            onClick={() => setShowBadReviewsOnly(false)}
                            className="font-semibold hover:underline"
                        >
                            Clear
                        </button>
                    </div>
                )}
                {showImagesOnly && (
                    <div className="max-w-6xl mx-auto mb-4 flex items-center justify-between gap-3 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 text-sm text-blue-700 dark:text-blue-300">
                        <span>Showing reviews with images only.</span>
                        <button
                            type="button"
                            onClick={() => setShowImagesOnly(false)}
                            className="font-semibold hover:underline"
                        >
                            Clear
                        </button>
                    </div>
                )}
                {selectedProductFilter && (
                    <div className="max-w-6xl mx-auto mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                        <span className="min-w-0 truncate">
                            Showing product: <strong>{selectedProductFilter.title}</strong>
                        </span>
                        <button
                            type="button"
                            onClick={() => setSelectedProductFilter(null)}
                            className="font-semibold hover:underline shrink-0"
                        >
                            Clear
                        </button>
                    </div>
                )}

                {/* List */}
                <div ref={reviewFeedRef} className="max-w-6xl mx-auto mb-4 pt-2 border-t border-gray-200 dark:border-gray-700 scroll-mt-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        Review Feed ({filteredReviews.length})
                    </h3>
                </div>
                <div className="flex flex-col gap-4 pb-20 max-w-7xl mx-auto">
                    {filteredReviews.length > 0 ? (
                        filteredReviews.map((review) => {
                            const reviewKey = getReviewKey(review);
                            const dateDisplay = new Intl.DateTimeFormat('en-US', {
                                timeZone, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
                            }).format(new Date(review.create_date));

                            const reviewPhoto = review.review_photo_detailed;
                            const isLowestHighlight = reviewHighlights.lowestReview && getReviewKey(reviewHighlights.lowestReview) === reviewKey;
                            const focusBorderClass = isLowestHighlight
                                ? 'border-red-500 dark:border-red-400 ring-2 ring-red-100 dark:ring-red-900/40'
                                : 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-100 dark:ring-blue-900/40';

                            return (
                                <div
                                    key={reviewKey}
                                    ref={(node) => {
                                        if (node) reviewRefs.current.set(reviewKey, node);
                                        else reviewRefs.current.delete(reviewKey);
                                    }}
                                    className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border p-5 hover:shadow-md transition-all ${focusedReviewKey === reviewKey ? focusBorderClass : 'border-gray-200 dark:border-gray-700'}`}
                                >
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
