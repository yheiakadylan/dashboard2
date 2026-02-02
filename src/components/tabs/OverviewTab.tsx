import React, { Suspense, lazy } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { hasPermission } from '../../utils/permissionHelper';
import KpiCard from '../KpiCard';
import { KpiValue } from '../../types';
import ChartErrorBoundary from '../ChartErrorBoundary';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../DataTable';

import OverviewChart from '../OverviewChart';
import SummaryChart from '../SummaryChart';

interface OverviewTabProps {
    processedData: ProcessedData;
    isSingleDay: boolean;
    handleViewDayDetails: (date: string) => void;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ processedData, isSingleDay, handleViewDayDetails }) => {
    const { role, permissions } = useDashboard();
    const hiddenValue: KpiValue = { value: '---', direction: 'neutral' };

    // Permission helper - checks new permissions with fallback to legacy
    const can = (permission: keyof typeof permissions) => hasPermission(role, permissions, permission);

    // Memoize KPI values with permission checks
    const kpiValues = React.useMemo(() => ({
        orders: can('viewKpiOrders')
            ? (processedData.summary.kpis['Total Orders'] || { value: '---' })
            : hiddenValue,
        shops: can('viewKpiShops')
            ? (processedData.summary.kpis['Shops'] || { value: '---' })
            : hiddenValue,
        revenue: can('viewKpiRevenue')
            ? (processedData.summary.kpis['Revenue'] || { value: '---' })
            : hiddenValue,
        funds: can('viewKpiFunds')
            ? (processedData.summary.kpis['Funds'] || { value: '---' })
            : hiddenValue,
        cost: can('viewKpiCost')
            ? (processedData.summary.kpis['Cost'] || { value: '---' })
            : hiddenValue,
        earn: can('viewKpiEarn')
            ? (processedData.summary.kpis['Earn'] || { value: '---' })
            : hiddenValue
    }), [processedData.summary.kpis, role, permissions]);

    // Extract refund info from KPIs
    const getRefundInfo = (kpi: any) => {
        if ('refundInfo' in kpi) return kpi.refundInfo;
        // For multi-currency KPIs
        if (typeof kpi === 'object' && !('value' in kpi)) {
            const refundMap: { [c: string]: string } = {};
            Object.entries(kpi).forEach(([currency, val]: [string, any]) => {
                if (val.refundInfo) refundMap[currency] = val.refundInfo;
            });
            return Object.keys(refundMap).length > 0 ? refundMap : undefined;
        }
        return undefined;
    };

    const { updateRate, refreshRates, resetRates } = useDashboard(); // Get exchange rate actions

    return (
        <div className="p-2 md:p-6">
            {/* 1. KPIs Section - Conditionally render based on permissions */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 md:gap-6 mb-6">
                {can('viewKpiOrders') && (
                    <KpiCard title="Total Orders" value={kpiValues.orders} refundInfo={getRefundInfo(kpiValues.orders)} />
                )}
                {can('viewKpiShops') && (
                    <KpiCard title="Shops" value={kpiValues.shops} />
                )}
                {can('viewKpiRevenue') && (
                    <KpiCard title="Revenue" value={kpiValues.revenue} onRateUpdate={updateRate} onRefresh={refreshRates} onReset={resetRates} />
                )}
                {can('viewKpiFunds') && (
                    <KpiCard title="Funds" value={kpiValues.funds} onRateUpdate={updateRate} onRefresh={refreshRates} onReset={resetRates} />
                )}
                {can('viewKpiCost') && (
                    <KpiCard title="Cost" value={kpiValues.cost} />
                )}
                {can('viewKpiEarn') && (
                    <KpiCard title="Earn" value={kpiValues.earn} onRateUpdate={updateRate} onRefresh={refreshRates} onReset={resetRates} />
                )}
            </div>

            {/* 2. Charts Section */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                {/* Main Overview Chart - Takes 1/2 width */}
                <ChartErrorBoundary>
                    <OverviewChart data={processedData.overview.chartData} />
                </ChartErrorBoundary>

                {/* Revenue Chart - Takes 1/2 width */}
                <ChartErrorBoundary>
                    <SummaryChart
                        data={processedData.summary.chartData}
                        hideTitle={true}
                        hideFunds={!can('viewKpiFunds')}
                    />
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
                                    mobileRowHeight={260} // Increased to show all rows including Cost without scroll
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
                                mobileRowHeight={200} // Explicitly set smaller height for mobile card view
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
