import React, { Suspense, useState, useEffect } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUI } from '../../contexts/UIContext';
import SkeletonLoader from '../ui/SkeletonLoader';
import ErrorBoundary from '../ui/ErrorBoundary';
import ScrollToTop from './ScrollToTop';

import OverviewTab from '../tabs/OverviewTab';
const ProductsTab = React.lazy(() => import('../tabs/ProductsTab'));
const SupportTab = React.lazy(() => import('../tabs/SupportTab'));
const OrderListTab = React.lazy(() => import('../tabs/OrderListTab'));
const FulfillTab = React.lazy(() => import('../tabs/FulfillTab'));
const ReviewsTab = React.lazy(() => import('../tabs/ReviewsTab'));
const ReportTab = React.lazy(() => import('../tabs/ReportTab'));


interface MainContentProps {
    onViewOrderDetails: (recordId: string) => void;
    onResyncOrder: (recordId: string) => Promise<void>;
}

const MainContent: React.FC<MainContentProps> = ({ onViewOrderDetails, onResyncOrder }) => {
    const { isLoading, records, processedData, isProcessing, isFetchingNewRange } = useDashboard();
    const {
        activeTab,
        filterDateRange,
        dayFilter,
        sourceFilter,
        statusFilter,
        timeZone,
        handleViewDayDetails,
        handleShopDetails
    } = useUI();

    // Smart loading: Only show overlay if processing takes > 150ms (prevents micro-flashes)
    const [showOverlay, setShowOverlay] = useState(false);
    const hasData = processedData.orders.rows.length > 0 || processedData.overview.chartData.length > 0;

    useEffect(() => {
        // Show progress overlay only when processing EXISTING data (re-filtering)
        // If fetching new range, we show Skeleton instead
        if (isProcessing && hasData && !isFetchingNewRange) {
            const timer = setTimeout(() => setShowOverlay(true), 150);
            return () => clearTimeout(timer);
        } else {
            setShowOverlay(false);
        }
    }, [isProcessing, hasData, isFetchingNewRange]);

    // RENDER SKELETON LOGIC
    // Show skeleton if:
    // 1. Initial loading (isLoading)
    // 2. Fetching entirely new date range (isFetchingNewRange)
    // 3. Processing but we have no data to show (isProcessing && !hasData)
    const shouldShowSkeleton = isLoading || isFetchingNewRange || (isProcessing && !hasData);

    if (shouldShowSkeleton) {
        if (activeTab === 'Order List' || activeTab === 'Products') {
            return (
                <div className="p-2 md:p-6 animate-fade-in">
                    <SkeletonLoader variant="card" count={6} />
                </div>
            );
        }

        if (activeTab !== 'Overview') {
            // Default skeleton for other tabs except Overview (which renders its own skeleton/empty state now)
            return (
                <div className="p-4 animate-fade-in">
                    <SkeletonLoader variant="table-row" count={8} />
                </div>
            );
        }
    }
    // (Overview skeleton rendering logic moved/removed to allow immediate UI render)

    // Render content with optional processing overlay
    const renderContent = () => {
        const content = (() => {
            switch (activeTab) {
                case 'Overview':
                    const isSingleDay = filterDateRange.from === filterDateRange.to;
                    return (
                        <ErrorBoundary>
                            <OverviewTab
                                processedData={processedData}
                                isSingleDay={isSingleDay}
                                handleViewDayDetails={handleViewDayDetails}
                                handleShopDetails={handleShopDetails}
                            />
                        </ErrorBoundary>
                    );

                case 'Products':
                    return (
                        <Suspense fallback={<div className="p-2 md:p-6 animate-fade-in"><SkeletonLoader variant="card" count={6} /></div>}>
                            <ProductsTab processedData={processedData} />
                        </Suspense>
                    );

                case 'Order List':
                    return (
                        <Suspense fallback={<div className="p-2 md:p-6 animate-fade-in"><SkeletonLoader variant="card" count={6} /></div>}>
                            <OrderListTab
                                processedData={processedData}
                                dayFilter={dayFilter}
                                sourceFilter={sourceFilter}
                                statusFilter={statusFilter}
                                timeZone={timeZone}
                                handleViewOrderDetails={onViewOrderDetails}
                                handleResyncOrder={onResyncOrder}
                                allRecords={records}
                            />
                        </Suspense>
                    );

                case 'Support':
                    return (
                        <Suspense fallback={<div className="p-4 animate-fade-in"><SkeletonLoader variant="table-row" count={8} /></div>}>
                            <SupportTab processedData={processedData} />
                        </Suspense>
                    );

                case 'Fulfill':
                    return (
                        <Suspense fallback={<div className="p-4 animate-fade-in"><SkeletonLoader variant="table-row" count={8} /></div>}>
                            <FulfillTab processedData={processedData} />
                        </Suspense>
                    );

                case 'Reviews':
                    return (
                        <Suspense fallback={<div className="p-2 md:p-6 animate-fade-in"><SkeletonLoader variant="card" count={6} /></div>}>
                            <ReviewsTab />
                        </Suspense>
                    );

                case 'Report':
                    return (
                        <Suspense fallback={<div className="p-2 md:p-6 animate-fade-in"><SkeletonLoader variant="card" count={6} /></div>}>
                            <ReportTab />
                        </Suspense>
                    );

                default:
                    return <div className="p-8 text-center text-gray-500">Selected tab content not available.</div>;
            }
        })();

        return (
            <div key={activeTab} className="animate-fade-in-up flex-1 flex flex-col h-full min-h-0">
                {content}
            </div>
        );
    };

    return (
        <div className="relative flex flex-col h-full overflow-hidden">
            {/* Main content - always visible */}
            {renderContent()}

            {/* Skeleton overlay when processing with existing data */}
            {showOverlay && hasData && (
                <div className="absolute top-0 left-0 right-0 z-50">
                    <div className="h-1 w-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-progress-indeterminate shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                    </div>
                </div>
            )}

            {/* Scroll To Top Button */}
            <ScrollToTop />
        </div>
    );
};

export default MainContent;
