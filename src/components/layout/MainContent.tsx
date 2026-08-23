import React, { useState, useEffect } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUITabs } from '../../contexts/UIContext';
import SkeletonLoader from '../ui/SkeletonLoader';
import ScrollToTop from './ScrollToTop';
import { markPerf } from '../../utils/perfMarks';
import DashboardRoutes from '../../routing/DashboardRoutes';


interface MainContentProps {
    onViewOrderDetails: (recordId: string) => void;
    onResyncOrder: (recordId: string) => Promise<void>;
}

const MainContent: React.FC<MainContentProps> = ({ onViewOrderDetails, onResyncOrder }) => {
    const { isLoading, processedData, isProcessing, isFetchingNewRange } = useDashboard();
    const { activeTab } = useUITabs();

    // Smart loading: Only show overlay if processing takes > 150ms (prevents micro-flashes)
    const [showOverlay, setShowOverlay] = useState(false);
    const hasData = processedData.orders.rows.length > 0 || processedData.overview.chartData.length > 0;

    useEffect(() => {
        markPerf('tab:switch', { activeTab });
    }, [activeTab]);

    useEffect(() => {
        // Show progress overlay only when processing EXISTING data (re-filtering)
        // If fetching new range, we show Skeleton instead
        if (activeTab !== 'Listing' && isProcessing && hasData && !isFetchingNewRange) {
            const timer = setTimeout(() => setShowOverlay(true), 150);
            return () => clearTimeout(timer);
        } else {
            setShowOverlay(false);
        }
    }, [activeTab, isProcessing, hasData, isFetchingNewRange]);

    // RENDER SKELETON LOGIC
    // Show skeleton if:
    // 1. Initial loading (isLoading)
    // 2. Fetching entirely new date range (isFetchingNewRange)
    // 3. Processing but we have no data to show (isProcessing && !hasData)
    const isStandaloneTab = activeTab === 'Listing';
    const shouldShowSkeleton = !isStandaloneTab && (isLoading || isFetchingNewRange || (isProcessing && !hasData));

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

    return (
        <div className="relative flex flex-col h-full overflow-hidden">
            {/* Main content - always visible */}
            <div key={activeTab} className="animate-fade-in-up flex-1 flex flex-col h-full min-h-0">
                <DashboardRoutes onViewOrderDetails={onViewOrderDetails} onResyncOrder={onResyncOrder} />
            </div>

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
