import React, { Suspense, lazy } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { hasPermission } from '../../utils/permissionHelper';
import KpiCard from '../ui/KpiCard';
import { KpiValue } from '../../types';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../ui/DataTable';
import { useUI } from '../../contexts/UIContext';

import OverviewChart from '../charts/OverviewChart';
import SummaryChart from '../charts/SummaryChart';

interface OverviewTabProps {
    processedData: ProcessedData;
    isSingleDay: boolean;
    handleViewDayDetails: (date: string) => void;
    handleShopDetails: (accountId: string) => void;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ processedData, isSingleDay, handleViewDayDetails, handleShopDetails }) => {
    const { role, permissions, accounts } = useDashboard();
    const { globalUsdMode } = useUI();
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

    const { updateRate, refreshRates, resetRates, exchangeRates } = useDashboard();

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
                    <OverviewChart data={processedData.overview.chartData} exchangeRates={exchangeRates} />
                </ChartErrorBoundary>

                {/* Revenue Chart - Takes 1/2 width */}
                <ChartErrorBoundary>
                    <SummaryChart
                        data={processedData.summary.chartData}
                        hideTitle={true}
                        hideFunds={!can('viewKpiFunds')}
                        exchangeRates={exchangeRates}
                    />
                </ChartErrorBoundary>
            </div>

            {/* 3. Detailed Tables - Tabbed Interface */}
            {/* 3. Detailed Tables - Split View */}
            <div className={`grid grid-cols-1 ${isSingleDay ? '' : 'xl:grid-cols-2'} gap-6 items-start`}>
                {/* Left: Daily Breakdown (Card View) - Hide if single day */}
                {/* Left: Daily Breakdown (Card View) - Hide if single day */}
                {!isSingleDay && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Breakdown</h3>
                        </div>
                        <div className="">
                            <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                                {(() => {
                                    const rawHeaders = processedData.overview.table.headers;
                                    const rawRows = processedData.overview.table.rows;

                                    let headers = rawHeaders;
                                    let rows = rawRows;

                                    if (globalUsdMode && exchangeRates) {
                                        // 1. Identify indices for Revenue, Funds, Cost
                                        const revIndices: { idx: number, curr: string }[] = [];
                                        const fundsIndices: { idx: number, curr: string }[] = [];
                                        const costIndices: { idx: number, curr: string }[] = [];
                                        const otherIndices: number[] = [];

                                        rawHeaders.forEach((h, i) => {
                                            if (h.startsWith('Revenue (')) {
                                                revIndices.push({ idx: i, curr: h.match(/\(([^)]+)\)/)?.[1] || 'USD' });
                                            } else if (h.startsWith('Funds (')) {
                                                fundsIndices.push({ idx: i, curr: h.match(/\(([^)]+)\)/)?.[1] || 'USD' });
                                            } else if (h.startsWith('Cost (')) {
                                                costIndices.push({ idx: i, curr: h.match(/\(([^)]+)\)/)?.[1] || 'USD' });
                                            } else {
                                                otherIndices.push(i);
                                            }
                                        });

                                        // 2. Build New Headers
                                        const baseHeaders = otherIndices.map(i => rawHeaders[i]);
                                        // Insert USD columns before the last item ("Details")
                                        const finalHeaders = [...baseHeaders];
                                        const detailsIdx = finalHeaders.indexOf('Details');
                                        const insertAt = detailsIdx !== -1 ? detailsIdx : finalHeaders.length;

                                        const usdCols: string[] = [];
                                        if (revIndices.length > 0) usdCols.push('Revenue (USD)');
                                        if (fundsIndices.length > 0) usdCols.push('Funds (USD)');
                                        if (costIndices.length > 0) usdCols.push('Cost (USD)');

                                        finalHeaders.splice(insertAt, 0, ...usdCols);
                                        headers = finalHeaders;

                                        // 3. Transform Rows
                                        rows = rawRows.map(row => {
                                            const baseRow = otherIndices.map(i => row[i]);

                                            const calcUSD = (indices: { idx: number, curr: string }[]) => {
                                                return indices.reduce((sum, item) => {
                                                    const val = (row[item.idx] as number) || 0;
                                                    const rate = item.curr === 'USD' ? 1 : (exchangeRates[item.curr] || 0);
                                                    return sum + (val * rate);
                                                }, 0);
                                            };

                                            const transformedVals: number[] = [];
                                            if (revIndices.length > 0) transformedVals.push(calcUSD(revIndices));
                                            if (fundsIndices.length > 0) transformedVals.push(calcUSD(fundsIndices));
                                            if (costIndices.length > 0) transformedVals.push(calcUSD(costIndices));

                                            const finalRow = [...baseRow];
                                            finalRow.splice(insertAt, 0, ...transformedVals);
                                            return finalRow;
                                        });
                                    }

                                    return (
                                        <DataTable
                                            headers={headers}
                                            data={rows}
                                            onViewDayDetails={handleViewDayDetails}
                                            autoHeight={true}
                                            forceCardView={true}
                                        />
                                    );
                                })()}
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
                            {(() => {
                                let rows = processedData.summary.table.rows;
                                const headers = processedData.summary.table.headers;

                                if (globalUsdMode && exchangeRates) {
                                    const calcUsdVal = (amountMap?: { [c: string]: number }) => {
                                        if (!amountMap) return 0;
                                        return Object.entries(amountMap).reduce((sum, [curr, val]) => {
                                            const rate = curr === 'USD' ? 1 : (exchangeRates[curr] || 0);
                                            return sum + (val * rate);
                                        }, 0);
                                    };
                                    const formatUsd = (val: number) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)}`;

                                    rows = rows.map(row => {
                                        return row.map(cell => {
                                            if (cell && typeof cell === 'object' && 'type' in cell && cell.type === 'text_with_subtitle') {
                                                if (cell.mainAmountMap || cell.subtitleAmountMap) {
                                                    const mainUsd = calcUsdVal(cell.mainAmountMap);
                                                    const subUsd = calcUsdVal(cell.subtitleAmountMap);
                                                    return {
                                                        ...cell,
                                                        main: formatUsd(mainUsd),
                                                        subtitle: subUsd > 0 ? `↩ ${formatUsd(subUsd)}` : cell.subtitle,
                                                        value: mainUsd // For sorting if applied
                                                    };
                                                }
                                                return cell; // Fallback
                                            }

                                            if (cell && typeof cell === 'object' && 'type' in cell && cell.type === 'value_with_unit') {
                                                if (cell.amountMap) {
                                                    const usdVal = calcUsdVal(cell.amountMap);
                                                    return {
                                                        ...cell,
                                                        value: usdVal,
                                                        display: formatUsd(usdVal)
                                                    };
                                                }
                                                // Fallback to original value if no amount map
                                                return {
                                                    ...cell,
                                                    display: formatUsd(cell.value)
                                                };
                                            }
                                            return cell;
                                        });
                                    });
                                }

                                return (
                                    <DataTable
                                        headers={headers}
                                        data={rows}
                                        autoHeight={true}
                                        columnWidths={{ 'Revenue': 120, 'Orders': 80 }}
                                        onRowClick={(row) => {
                                            // Find the index of 'Shop' header
                                            const shopIndex = processedData.summary.table.headers.indexOf('Shop');
                                            if (shopIndex !== -1 && row && row[shopIndex]) {
                                                const shopName = String(row[shopIndex]);
                                                // Find corresponding accountId (email)
                                                const account = accounts.find(a => a.label === shopName || a.email === shopName);
                                                const accountId = account ? account.email : shopName;
                                                // Use the handleShopDetails function to switch tab and filter using the accountId
                                                handleShopDetails(accountId);
                                            }
                                        }}
                                    />
                                );
                            })()}
                        </Suspense>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverviewTab;
