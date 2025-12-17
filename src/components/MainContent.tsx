import React, { Suspense } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import SkeletonLoader from './SkeletonLoader';
import ErrorBoundary from './ErrorBoundary';

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

    // Show skeleton if:
    // 1. We are fetching raw records (isLoading) AND have no records
    // 2. OR we are processing data (isProcessing) AND have no records (or effectively no processed data yet)
    //    Actually, simple check: if we are loading OR processing, and don't have a stable view, show skeleton.
    //    Ideally, if records > 0 but isProcessing, we currently show empty tabs because processedData is initial.
    //    So we should block until processing is done if processedData is empty.

    // Check if we have valid processed data for the current view
    const hasData = processedData.orders.rows.length > 0 || processedData.overview.chartData.length > 0;

    if ((isLoading || isProcessing) && !hasData) {
        return (
            <div className="p-4">
                <SkeletonLoader variant="table-row" count={8} />
            </div>
        );
    }



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
                />
            );

        case 'Support':
            return (
                <SupportTab processedData={processedData} />
            );

        case 'Fulfill':
            return (
                <FulfillTab processedData={processedData} />
            );

        default:
            return <div className="p-8 text-center text-gray-500">Selected tab content not available.</div>;
    }
};

export default MainContent;
