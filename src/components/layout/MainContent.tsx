import React, { Suspense, useState, useEffect } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUI } from '../../contexts/UIContext';
import SkeletonLoader from '../ui/SkeletonLoader';
import ErrorBoundary from '../ui/ErrorBoundary';
import ScrollToTop from './ScrollToTop';

import OverviewTab from '../tabs/OverviewTab';

import ProductsTab from '../tabs/ProductsTab';
import OrderListTab from '../tabs/OrderListTab';
import FulfillTab from '../tabs/FulfillTab';
import SupportTab from '../tabs/SupportTab';
import ListingTab from '../tabs/ListingTab';

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
        if (activeTab === 'Overview') {
            return (
                <div className="p-2 md:p-6 space-y-6 animate-fade-in">
                    {/* KPIs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6">
                        <SkeletonLoader variant="kpi-card" count={5} />
                    </div>
                    {/* Charts */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <SkeletonLoader variant="chart" count={1} className="h-80" />
                        <SkeletonLoader variant="chart" count={1} className="h-80" />
                    </div>
                    {/* Table */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                        <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4 animate-pulse" />
                        <SkeletonLoader variant="table-row" count={5} />
                    </div>
                </div>
            );
        }

        if (activeTab === 'Order List' || activeTab === 'Products') {
            return (
                <div className="p-2 md:p-6 animate-fade-in">
                    <SkeletonLoader variant="card" count={6} />
                </div>
            );
        }

        // Default skeleton for other tabs
        return (
            <div className="p-4 animate-fade-in">
                <SkeletonLoader variant="table-row" count={8} />
            </div>
        );
    }

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
                        <ProductsTab processedData={processedData} />
                    );

                case 'Order List':
                    return (
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
                    );

                case 'Support':
                    return <SupportTab processedData={processedData} />;

                case 'Fulfill':
                    return <FulfillTab processedData={processedData} />;

                case 'Listing':
                    return <ListingTab />;

                default:
                    return <div className="p-8 text-center text-gray-500">Selected tab content not available.</div>;
            }
        })();

        return (
            <div key={activeTab} className="animate-fade-in-up min-h-full">
                {content}
            </div>
        );
    };

    return (
        <div className="relative">
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
