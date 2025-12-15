import React, { Suspense, lazy } from 'react';
import KpiCard from '../KpiCard';
import ChartErrorBoundary from '../ChartErrorBoundary';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData } from '../../api/_lib/types';
import DataTable from '../DataTable';

const OverviewChart = lazy(() => import('../OverviewChart'));
const SummaryChart = lazy(() => import('../SummaryChart'));

interface OverviewTabProps {
    processedData: ProcessedData;
    isSingleDay: boolean;
    handleViewDayDetails: (date: string) => void;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ processedData, isSingleDay, handleViewDayDetails }) => {
    return (
        <div className="p-2 md:p-6 overflow-y-auto h-full">
            {/* 1. KPIs Section (Merged from Summary) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6 mb-6">
                <KpiCard title="Total Orders" value={processedData.summary.kpis['Total Orders'] || { value: '---' }} />
                <KpiCard title="Shops" value={processedData.summary.kpis['Shops'] || { value: '---' }} />
                <KpiCard title="Revenue" value={processedData.summary.kpis['Revenue'] || { value: '---' }} />
                <KpiCard title="Funds" value={processedData.summary.kpis['Funds'] || { value: '---' }} />
                <KpiCard title="Cost" value={processedData.summary.kpis['Cost'] || { value: '---' }} />
            </div>

            {/* 2. Charts Section */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                {/* Main Overview Chart - Takes 1/2 width */}
                <ChartErrorBoundary>
                    <Suspense fallback={<LoadingSpinner variant="chart" count={1} />}>
                        <OverviewChart data={processedData.overview.chartData} />
                    </Suspense>
                </ChartErrorBoundary>

                {/* Revenue Chart - Takes 1/2 width */}
                <ChartErrorBoundary>
                    <Suspense fallback={<LoadingSpinner variant="chart" />}>
                        <SummaryChart data={processedData.summary.chartData} hideTitle={true} />
                    </Suspense>
                </ChartErrorBoundary>
            </div>

            {/* 3. Detailed Tables - Tabbed Interface */}
            {/* 3. Detailed Tables - Split View */}
            <div className={`grid grid-cols-1 ${isSingleDay ? '' : 'xl:grid-cols-2'} gap-6 items-start`}>
                {/* Left: Daily Breakdown (Card View) - Hide if single day */}
                {!isSingleDay && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Breakdown</h3>
                        </div>
                        <div className="">
                            <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                                <DataTable
                                    headers={processedData.overview.table.headers}
                                    data={processedData.overview.table.rows}
                                    onViewDayDetails={handleViewDayDetails}
                                    autoHeight={true}
                                    mobileRowHeight={220} // Slightly more compact card for desktop split view
                                    forceCardView={true}
                                />
                            </Suspense>
                        </div>
                    </div>
                )}

                {/* Right: Shop Summary (Table View) */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Shop Summary</h3>
                    </div>
                    <div className="min-h-[400px]">
                        <Suspense fallback={<LoadingSpinner variant="table-row" count={5} />}>
                            <DataTable
                                headers={processedData.summary.table.headers}
                                data={processedData.summary.table.rows}
                                autoHeight={true}
                                mobileBreakpoint={0}
                                columnWidths={{ 'Revenue': 120, 'Orders': 80 }}
                            />
                        </Suspense>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverviewTab;
