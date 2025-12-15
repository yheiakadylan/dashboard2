import React, { Suspense, /* lazy */ } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import SkeletonLoader from './SkeletonLoader';
import Spinner from './Spinner';
import OverviewTab from './tabs/OverviewTab';
import ProductsTab from './tabs/ProductsTab';
import OrderListTab from './tabs/OrderListTab';
import FulfillTab from './tabs/FulfillTab';
import ErrorBoundary from './ErrorBoundary';
import { Record } from '../api/_lib/types';
import LoadingSpinner from './LoadingSpinner';

const DataTable = React.lazy(() => import('./DataTable'));

// Helper for lazy data tables
const LazyTable = ({ headers, data }: { headers: string[], data: any[] }) => (
    <Suspense fallback={<LoadingSpinner />}>
        <DataTable headers={headers} data={data} />
    </Suspense>
);

interface MainContentProps {
    onViewOrderDetails: (recordId: string) => void;
    onResyncOrder: (recordId: string) => Promise<void>;
}

const MainContent: React.FC<MainContentProps> = ({ onViewOrderDetails, onResyncOrder }) => {
    const { isLoading, records, processedData } = useDashboard();
    const {
        activeTab,
        filterDateRange,
        dayFilter,
        sourceFilter,
        timeZone,
        handleViewDayDetails
    } = useUI();

    if (isLoading && records.length === 0) {
        return (
            <div className="p-4">
                <SkeletonLoader variant="table-row" count={8} />
            </div>
        );
    }

    // Helper for lazy data tables
    const LazyTable = ({ headers, data }: { headers: string[], data: any[] }) => (
        <Suspense fallback={<LoadingSpinner />}>
            <DataTable headers={headers} data={data} />
        </Suspense>
    );

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
            return <ProductsTab processedData={processedData} />;

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

        case 'Case':
            return <LazyTable headers={processedData.cases.headers} data={processedData.cases.rows} />;

        case 'Help':
            return <LazyTable headers={processedData.help.headers} data={processedData.help.rows} />;

        case 'Fulfill':
            return <FulfillTab processedData={processedData} />;

        default:
            return <div className="p-8 text-center text-gray-500">Selected tab content not available.</div>;
    }
};

export default MainContent;
