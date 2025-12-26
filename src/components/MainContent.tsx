import React, { Suspense, useState, useEffect } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import SkeletonLoader from './SkeletonLoader';
import ErrorBoundary from './ErrorBoundary';
import ScrollToTop from './ScrollToTop';

// Keep OverviewTab as direct import since it's the default tab
import OverviewTab from './tabs/OverviewTab';

import DataTable from './DataTable';

import ProductsTab from './tabs/ProductsTab';
import OrderListTab from './tabs/OrderListTab';
import FulfillTab from './tabs/FulfillTab';
import SupportTab from './tabs/SupportTab';

// Helper for lazy data tables
const LazyTable = ({ headers, data }: { headers: string[], data: any[] }) => (
    <Suspense fallback={
        <div className="p-4 h-full bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
            <SkeletonLoader variant="table-row" count={10} />
        </div>
    }>
        <DataTable headers={headers} data={data} />
    </Suspense>
);

interface MainContentProps {
    onViewOrderDetails: (recordId: string) => void;
    onResyncOrder: (recordId: string) => Promise<void>;
}

const MainContent: React.FC<MainContentProps> = ({ onViewOrderDetails, onResyncOrder }) => {
    const { isLoading, records, processedData, isProcessing } = useDashboard();
    const {
        activeTab,
        filterDateRange,
        dayFilter,
        sourceFilter,
        timeZone,
        handleViewDayDetails
    } = useUI();

    // Smart loading: Only show overlay if processing takes > 150ms (prevents micro-flashes)
    const [showOverlay, setShowOverlay] = useState(false);
    const hasData = processedData.orders.rows.length > 0 || processedData.overview.chartData.length > 0;

    useEffect(() => {
        if (isProcessing && hasData) {
            // Delay showing overlay to avoid flashes on fast networks
            const timer = setTimeout(() => setShowOverlay(true), 150);
            return () => clearTimeout(timer);
        } else {
            setShowOverlay(false);
        }
    }, [isProcessing, hasData]);

    // Show skeleton if we have no data at all (initial load)

    if ((isLoading || isProcessing) && !hasData) {
        return (
            <div className="p-4">
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
