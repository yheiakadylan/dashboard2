import React, { Suspense } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { hasPermission } from '../../utils/permissionHelper';
import KpiCard from '../ui/KpiCard';
import { KpiValue } from '../../types';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import SkeletonLoader from '../ui/SkeletonLoader';
import { ProcessedData } from '../../types';
import DataTable from '../ui/DataTable';
import { useUISettings } from '../../contexts/UIContext';

import { useNotification } from '../../contexts/NotificationContext';

const OverviewChart = React.lazy(() => import('../charts/OverviewChart'));
const SummaryChart = React.lazy(() => import('../charts/SummaryChart'));
const DATE_COLUMN = 'Date';
const SUMMARY_COLUMN_WIDTHS = { 'Revenue': 120, 'Orders': 80 };

interface OverviewTabProps {
    processedData: ProcessedData;
    isSingleDay: boolean;
    handleViewDayDetails: (date: string) => void;
    handleShopDetails: (accountId: string) => void;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ processedData, isSingleDay, handleViewDayDetails, handleShopDetails }) => {
    const { role, permissions, accounts, filterDateRange, isLoading, isFetchingNewRange, isProcessing, processedDataKeys, currentDataKey } = useDashboard();
    const { globalUsdMode } = useUISettings();
    const { addNotification } = useNotification();
    const hiddenValue: KpiValue = { value: '---', direction: 'neutral' };
    const isOverviewDataStale = processedDataKeys.overview !== currentDataKey;
    const showLoadingState = isLoading || isFetchingNewRange || isProcessing || isOverviewDataStale;

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

    const handleCopyFunds = React.useCallback(() => {
        try {
            const rawHeaders = processedData.overview.table.headers;
            const rawRows = [...processedData.overview.table.rows];
            
            // Sort from oldest to newest (by Date string at index 0)
            rawRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
            
            let fundsText = '';
            
            if (globalUsdMode && exchangeRates) {
                const fundsIndices: { idx: number, curr: string }[] = [];
                rawHeaders.forEach((h, i) => {
                    if (h.startsWith('Funds (')) {
                        fundsIndices.push({ idx: i, curr: h.match(/\(([^)]+)\)/)?.[1] || 'USD' });
                    }
                });
                
                fundsText = rawRows.map(row => {
                    const sum = fundsIndices.reduce((acc, item) => {
                        const val = (row[item.idx] as number) || 0;
                        const rate = item.curr === 'USD' ? 1 : (exchangeRates[item.curr] || 0);
                        return acc + (val * rate);
                    }, 0);
                    return Number(sum.toFixed(2));
                }).join('\n');
            } else {
                const fundsIndices = rawHeaders.map((h, i) => h.startsWith('Funds (') ? i : -1).filter(i => i !== -1);
                fundsText = rawRows.map(row => {
                    const sum = fundsIndices.reduce((acc, idx) => acc + ((row[idx] as number) || 0), 0);
                    return Number(sum.toFixed(2));
                }).join('\n');
            }
            
            navigator.clipboard.writeText(fundsText);
            addNotification('Copied funds to clipboard', 'success');
        } catch (err) {
            addNotification('Failed to copy funds', 'error');
        }
    }, [processedData.overview.table, globalUsdMode, exchangeRates, addNotification]);

    const dailyBreakdownTable = React.useMemo(() => {
        const rawHeaders = processedData.overview.table.headers;
        const rawRows = processedData.overview.table.rows;

        if (!globalUsdMode || !exchangeRates) {
            const dateIndex = rawHeaders.indexOf(DATE_COLUMN);
            const rows = dateIndex === -1
                ? rawRows
                : rawRows.filter(row => {
                    const date = String(row[dateIndex] || '');
                    return date >= filterDateRange.from && date <= filterDateRange.to;
                });
            return { headers: rawHeaders, rows };
        }

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

        const headers = otherIndices.map(i => rawHeaders[i]);
        const detailsIdx = headers.indexOf('Details');
        const insertAt = detailsIdx !== -1 ? detailsIdx : headers.length;
        const usdCols: string[] = [];
        if (revIndices.length > 0) usdCols.push('Revenue (USD)');
        if (fundsIndices.length > 0) usdCols.push('Funds (USD)');
        if (costIndices.length > 0) usdCols.push('Cost (USD)');
        headers.splice(insertAt, 0, ...usdCols);

        const rows = rawRows.filter(row => {
            const dateIndex = rawHeaders.indexOf(DATE_COLUMN);
            if (dateIndex === -1) return true;
            const date = String(row[dateIndex] || '');
            return date >= filterDateRange.from && date <= filterDateRange.to;
        }).map(row => {
            const baseRow = otherIndices.map(i => row[i]);
            const calcUSD = (indices: { idx: number, curr: string }[]) => indices.reduce((sum, item) => {
                const val = (row[item.idx] as number) || 0;
                const rate = item.curr === 'USD' ? 1 : (exchangeRates[item.curr] || 0);
                return sum + (val * rate);
            }, 0);

            const transformedVals: number[] = [];
            if (revIndices.length > 0) transformedVals.push(calcUSD(revIndices));
            if (fundsIndices.length > 0) transformedVals.push(calcUSD(fundsIndices));
            if (costIndices.length > 0) transformedVals.push(calcUSD(costIndices));

            const finalRow = [...baseRow];
            finalRow.splice(insertAt, 0, ...transformedVals);
            return finalRow;
        });

        return { headers, rows };
    }, [processedData.overview.table, globalUsdMode, exchangeRates, filterDateRange]);

    const summaryRows = React.useMemo(() => {
        const rows = processedData.summary.table.rows;
        if (!globalUsdMode || !exchangeRates) return rows;

        const calcUsdVal = (amountMap?: { [c: string]: number }) => {
            if (!amountMap) return 0;
            return Object.entries(amountMap).reduce((sum, [curr, val]) => {
                const rate = curr === 'USD' ? 1 : (exchangeRates[curr] || 0);
                return sum + (val * rate);
            }, 0);
        };
        const usdFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatUsd = (val: number) => `$${usdFormatter.format(val)}`;

        return rows.map(row => row.map(cell => {
            if (cell && typeof cell === 'object' && 'type' in cell && cell.type === 'text_with_subtitle') {
                if (cell.mainAmountMap || cell.subtitleAmountMap) {
                    const mainUsd = calcUsdVal(cell.mainAmountMap);
                    const subUsd = calcUsdVal(cell.subtitleAmountMap);
                    return {
                        ...cell,
                        main: formatUsd(mainUsd),
                        subtitle: subUsd > 0 ? `Refund: ${formatUsd(subUsd)}` : cell.subtitle,
                        value: mainUsd
                    };
                }
                return cell;
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
                return {
                    ...cell,
                    display: formatUsd(cell.value)
                };
            }
            return cell;
        }));
    }, [processedData.summary.table.rows, globalUsdMode, exchangeRates]);

    const handleSummaryRowClick = React.useCallback((row: any[]) => {
        const shopIndex = processedData.summary.table.headers.indexOf('Shop');
        if (shopIndex !== -1 && row && row[shopIndex]) {
            const shopName = String(row[shopIndex]);
            const account = accounts.find(a => a.label === shopName || a.email === shopName);
            const accountId = account ? account.email : shopName;
            handleShopDetails(accountId);
        }
    }, [accounts, handleShopDetails, processedData.summary.table.headers]);

    return (
        <div className="p-2 md:p-6 h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">

            {/* 1. KPIs Section - Conditionally render based on permissions */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 md:gap-6 mb-6">
                {showLoadingState ? (
                    <SkeletonLoader
                        variant="kpi-card"
                        count={[
                            can('viewKpiOrders'),
                            can('viewKpiShops'),
                            can('viewKpiRevenue'),
                            can('viewKpiFunds'),
                            can('viewKpiCost'),
                            can('viewKpiEarn')
                        ].filter(Boolean).length || 1}
                    />
                ) : (
                    <>
                        {can('viewKpiOrders') && (
                            <KpiCard title="Total Orders" value={kpiValues.orders} refundInfo={getRefundInfo(kpiValues.orders)} />
                        )}
                        {can('viewKpiShops') && (
                            <KpiCard title="Shops" value={kpiValues.shops} />
                        )}
                        {can('viewKpiRevenue') && (
                            <KpiCard title="Total Revenue" value={kpiValues.revenue} onRateUpdate={updateRate} onRefresh={refreshRates} onReset={resetRates} />
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
                    </>
                )}
            </div>

            {/* 2. Charts Section */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                {/* Main Overview Chart - Takes 1/2 width */}
                <ChartErrorBoundary>
                    {showLoadingState ? (
                        <SkeletonLoader variant="chart" count={1} className="h-[200px] md:h-[450px]" />
                    ) : (
                        <Suspense fallback={<SkeletonLoader variant="chart" count={1} className="h-[200px] md:h-[450px]" />}>
                            <OverviewChart data={processedData.overview.chartData} exchangeRates={exchangeRates} />
                        </Suspense>
                    )}
                </ChartErrorBoundary>

                {/* Revenue Chart - Takes 1/2 width */}
                <ChartErrorBoundary>
                    {showLoadingState ? (
                        <SkeletonLoader variant="chart" count={1} className="h-[200px] md:h-[450px]" />
                    ) : (
                        <Suspense fallback={<SkeletonLoader variant="chart" count={1} className="h-[200px] md:h-[450px]" />}>
                            <SummaryChart
                                data={processedData.summary.chartData}
                                hideTitle={true}
                                hideFunds={!can('viewKpiFunds')}
                                exchangeRates={exchangeRates}
                            />
                        </Suspense>
                    )}
                </ChartErrorBoundary>
            </div>

            {/* 3. Detailed Tables - Split View */}
            <div className={`grid grid-cols-1 ${isSingleDay ? '' : 'xl:grid-cols-2'} gap-6 items-start`}>
                {/* Left: Daily Breakdown (Card View) - Hide if single day */}
                {!isSingleDay && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Breakdown</h3>
                            {can('viewKpiFunds') && (
                                <button 
                                    onClick={handleCopyFunds} 
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-sm transition-colors flex items-center gap-1.5"
                                    title="Copy funds (oldest to newest)"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                    Copy Funds
                                </button>
                            )}
                        </div>
                        <div className="">
                            {showLoadingState ? (
                                <div className="p-4"><SkeletonLoader variant="table-row" count={5} /></div>
                            ) : (
                            <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                                <DataTable
                                    headers={dailyBreakdownTable.headers}
                                    data={dailyBreakdownTable.rows}
                                    onViewDayDetails={handleViewDayDetails}
                                    autoHeight={true}
                                    forceCardView={true}
                                />
                            </Suspense>
                            )}
                        </div>
                    </div>
                )}

                {/* Right: Shop Summary (Table View) */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Shop Summary</h3>
                    </div>
                    <div className="min-h-[400px]">
                        {showLoadingState ? (
                            <div className="p-4"><SkeletonLoader variant="table-row" count={5} /></div>
                        ) : (
                        <Suspense fallback={<LoadingSpinner variant="table-row" count={5} />}>
                            <DataTable
                                headers={processedData.summary.table.headers}
                                data={summaryRows}
                                autoHeight={true}
                                columnWidths={SUMMARY_COLUMN_WIDTHS}
                                onRowClick={handleSummaryRowClick}
                            />
                        </Suspense>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverviewTab;
