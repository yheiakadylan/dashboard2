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
    const [activeTable, setActiveTable] = React.useState<'daily' | 'shops'>('shops');
    const visibleTable = isSingleDay ? 'shops' : activeTable;

    // Permission helper - checks new permissions with fallback to legacy
    const can = (permission: keyof typeof permissions) => hasPermission(role, permissions, permission);

    const hasKpiData = React.useCallback((value: any): boolean => {
        if (!value) return false;
        if (typeof value !== 'object') return true;
        if ('value' in value) {
            const rawValue = String(value.value ?? '').trim();
            return rawValue !== '' && rawValue !== '---' && rawValue !== '--';
        }
        return Object.values(value).some(hasKpiData);
    }, []);

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

    const kpiCards = React.useMemo(() => [
        {
            key: 'orders',
            visible: can('viewKpiOrders'),
            title: 'Total Orders',
            value: kpiValues.orders,
            refundInfo: getRefundInfo(kpiValues.orders)
        },
        {
            key: 'shops',
            visible: can('viewKpiShops'),
            title: 'Shops',
            value: kpiValues.shops
        },
        {
            key: 'revenue',
            visible: can('viewKpiRevenue'),
            title: 'Total Revenue',
            value: kpiValues.revenue,
            onRateUpdate: updateRate,
            onRefresh: refreshRates,
            onReset: resetRates
        },
        {
            key: 'funds',
            visible: can('viewKpiFunds'),
            title: 'Funds',
            value: kpiValues.funds,
            onRateUpdate: updateRate,
            onRefresh: refreshRates,
            onReset: resetRates
        },
        {
            key: 'cost',
            visible: can('viewKpiCost'),
            title: 'Cost',
            value: kpiValues.cost
        },
        {
            key: 'earn',
            visible: can('viewKpiEarn'),
            title: 'Earn',
            value: kpiValues.earn,
            onRateUpdate: updateRate,
            onRefresh: refreshRates,
            onReset: resetRates
        }
    ].filter(card => card.visible && hasKpiData(card.value)), [kpiValues, role, permissions, updateRate, refreshRates, resetRates, hasKpiData]);

    const kpiGridColumnsClass = React.useMemo(() => {
        if (kpiCards.length >= 6) return 'xl:grid-cols-5 2xl:grid-cols-6';
        if (kpiCards.length === 5) return 'xl:grid-cols-5';
        if (kpiCards.length === 4) return 'xl:grid-cols-4';
        return '';
    }, [kpiCards.length]);

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

    const handleCopyFunds = React.useCallback(() => {
        try {
            const fundsIndices = dailyBreakdownTable.headers
                .map((header, index) => header.startsWith('Funds (') ? index : -1)
                .filter(index => index !== -1);

            if (fundsIndices.length === 0) {
                addNotification('No funds column in the visible table', 'info');
                return;
            }

            const formatCell = (value: unknown) => {
                const numericValue = typeof value === 'number' ? value : Number(value || 0);
                if (!Number.isFinite(numericValue)) return String(value ?? '');
                return numericValue === 0 ? '0' : numericValue.toFixed(2);
            };

            const dateIndex = dailyBreakdownTable.headers.indexOf(DATE_COLUMN);
            const rowsForCopy = [...dailyBreakdownTable.rows].sort((a, b) => {
                if (dateIndex === -1) return 0;
                return String(a[dateIndex] || '').localeCompare(String(b[dateIndex] || ''));
            });

            const fundsText = rowsForCopy
                .map(row => fundsIndices.map(index => formatCell(row[index])).join('\t'))
                .join('\n');

            navigator.clipboard.writeText(fundsText);
            addNotification(`Copied ${rowsForCopy.length} visible funds row(s) oldest to newest`, 'success');
        } catch (err) {
            addNotification('Failed to copy funds', 'error');
        }
    }, [dailyBreakdownTable, addNotification]);

    const dailyHeaderActions = React.useMemo(() => {
        const actions: { [header: string]: React.ReactNode } = {};
        dailyBreakdownTable.headers.forEach(header => {
            if (!header.startsWith('Funds (')) return;
            actions[header] = (
                <button
                    type="button"
                    onClick={handleCopyFunds}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                    title="Copy visible funds column"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy
                </button>
            );
        });
        return actions;
    }, [dailyBreakdownTable.headers, handleCopyFunds]);

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
                const nextCell = { ...cell };
                if (cell.mainAmountMap) {
                    const mainUsd = calcUsdVal(cell.mainAmountMap);
                    nextCell.main = formatUsd(mainUsd);
                    nextCell.value = mainUsd;
                }
                if (cell.subtitleAmountMap) {
                    const subUsd = calcUsdVal(cell.subtitleAmountMap);
                    const label = cell.subtitleLabel || 'Refund';
                    const delta = cell.subtitleDelta ? ` (${cell.subtitleDelta})` : '';
                    nextCell.subtitleValue = formatUsd(subUsd);
                    nextCell.subtitle = `${label}: ${formatUsd(subUsd)}${delta}`;
                }
                if (cell.extraSubtitleAmountMap) {
                    const extraUsd = calcUsdVal(cell.extraSubtitleAmountMap);
                    const label = cell.extraSubtitleLabel || 'Refund';
                    const delta = cell.extraSubtitleDelta ? ` (${cell.extraSubtitleDelta})` : '';
                    nextCell.extraSubtitle = `${label}: ${formatUsd(extraUsd)}${delta}`;
                }
                return nextCell;
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
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${kpiGridColumnsClass} gap-3 md:gap-4 mb-6`}>
                {showLoadingState ? (
                    <SkeletonLoader
                        variant="kpi-card"
                        count={kpiCards.length || 1}
                    />
                ) : (
                    <>
                        {kpiCards.map(card => (
                            <KpiCard
                                key={card.key}
                                title={card.title}
                                value={card.value}
                                refundInfo={card.refundInfo}
                                onRateUpdate={card.onRateUpdate}
                                onRefresh={card.onRefresh}
                                onReset={card.onReset}
                            />
                        ))}
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

            {/* 3. Detailed Tables - Full Width Toggle */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {visibleTable === 'daily' ? 'Daily Breakdown' : 'Shop Summary'}
                        </h3>
                        {!isSingleDay && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Switch between daily view and shop view.</p>
                        )}
                    </div>
                    <div className="flex flex-col items-stretch sm:items-end gap-2">
                        {!isSingleDay && (
                            <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-900 p-1 border border-gray-200 dark:border-gray-700">
                                <button
                                    type="button"
                                    onClick={() => setActiveTable('shops')}
                                    className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${visibleTable === 'shops' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                                >
                                    Shop Summary
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTable('daily')}
                                    className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${visibleTable === 'daily' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                                >
                                    Daily Breakdown
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="min-h-[400px]">
                    {showLoadingState ? (
                        <div className="p-4"><SkeletonLoader variant="table-row" count={5} /></div>
                    ) : visibleTable === 'daily' ? (
                        <Suspense fallback={<LoadingSpinner variant="table-row" count={5} />}>
                            <DataTable
                                headers={dailyBreakdownTable.headers}
                                data={dailyBreakdownTable.rows}
                                onViewDayDetails={handleViewDayDetails}
                                autoHeight={true}
                                headerActions={dailyHeaderActions}
                            />
                        </Suspense>
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
    );
};

export default OverviewTab;
