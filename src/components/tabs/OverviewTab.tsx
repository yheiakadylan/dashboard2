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
const SUMMARY_COLUMN_WIDTHS = { 'Revenue': 120, 'Orders': 80 };
const DATE_COLUMN = 'Date';

type HealthDateValue = string | number | Date | { seconds?: number; toDate?: () => Date } | null | undefined;

const parseHealthDate = (value: HealthDateValue): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value.toDate === 'function') {
        const date = value.toDate();
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000);
    }
    return null;
};

const formatHealthAge = (value: HealthDateValue) => {
    const date = parseHealthDate(value);
    if (!date) return 'not checked yet';

    const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 48) return `${diffHours}h ago`;

    return `${Math.floor(diffHours / 24)}d ago`;
};

const formatHealthCheckedAt = (value: HealthDateValue) => {
    const date = parseHealthDate(value);
    if (!date) return '';
    return date.toLocaleString([], {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const isWithinHours = (value: HealthDateValue, hours: number) => {
    const date = parseHealthDate(value);
    if (!date) return false;
    const diffMs = Date.now() - date.getTime();
    return diffMs >= 0 && diffMs <= hours * 60 * 60 * 1000;
};

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
    const [isSuspendedAlertDismissed, setIsSuspendedAlertDismissed] = React.useState(false);
    const hiddenValue: KpiValue = { value: '---', direction: 'neutral' };
    const isOverviewDataStale = processedDataKeys.overview !== currentDataKey;
    const showLoadingState = isLoading || isFetchingNewRange || isProcessing || isOverviewDataStale;
    const etsyHealthAlerts = React.useMemo(
        () => accounts
            .map(account => {
                const changedAt = account.etsy_suspension_status_changed_at || account.etsy_suspended_since || account.etsy_health_checked_at;
                const newlySuspended = account.etsy_suspended === true
                    && account.etsy_newly_suspended === true
                    && account.etsy_health_status !== 'error'
                    && isWithinHours(changedAt, 48);
                const recovered = account.etsy_suspended !== true
                    && account.etsy_health_status === 'ok'
                    && typeof account.etsy_review_average === 'number'
                    && Boolean(account.etsy_suspension_status_changed_at)
                    && isWithinHours(account.etsy_suspension_status_changed_at, 48);

                if (!newlySuspended && !recovered) return null;

                return {
                    account,
                    type: newlySuspended ? 'suspended' : 'recovered',
                    changedAt
                };
            })
            .filter((alert): alert is NonNullable<typeof alert> => Boolean(alert))
            .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'suspended' ? -1 : 1;
                const aDate = parseHealthDate(a.changedAt)?.getTime() || 0;
                const bDate = parseHealthDate(b.changedAt)?.getTime() || 0;
                return bDate - aDate;
            }),
        [accounts]
    );

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
            {!isSuspendedAlertDismissed && etsyHealthAlerts.length > 0 && (
                <div className="relative mb-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 pr-12 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
                    <button
                        type="button"
                        onClick={() => setIsSuspendedAlertDismissed(true)}
                        className="absolute right-3 top-3 rounded-full px-2 py-1 text-sm font-bold text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/40 dark:hover:text-amber-200"
                        aria-label="Dismiss Etsy health alert"
                        title="Hide this alert"
                    >
                        x
                    </button>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                Etsy Health Alert
                            </div>
                            <h3 className="mt-2 text-base font-bold text-amber-900 dark:text-amber-100">
                                {etsyHealthAlerts.length} recent Etsy account update{etsyHealthAlerts.length > 1 ? 's' : ''}
                            </h3>
                            <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                                Only newly suspended or recovered accounts from the last 48 hours are shown here.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {etsyHealthAlerts.map(({ account, type, changedAt }) => {
                                const checkedAt = formatHealthCheckedAt(account.etsy_health_checked_at);
                                const changedAtLabel = formatHealthCheckedAt(changedAt);
                                const isRecovered = type === 'recovered';
                                const rating = typeof account.etsy_review_average === 'number'
                                    ? `Avg ${account.etsy_review_average.toFixed(2)} (${(account.etsy_review_count ?? 0).toLocaleString()})`
                                    : 'No rating';
                                return (
                                    <div
                                        key={`${type}-${account.id}`}
                                        className={`rounded-xl border bg-white px-3 py-2 text-sm shadow-sm dark:bg-gray-900 ${isRecovered ? 'border-emerald-200 dark:border-emerald-900/50' : 'border-red-200 dark:border-red-900/50'}`}
                                        title={account.etsy_suspended_reason || account.etsy_health_error || undefined}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white ${isRecovered ? 'bg-emerald-600' : 'bg-orange-600'}`}>
                                                {isRecovered ? 'Recovered' : 'Newly Suspended'}
                                            </span>
                                            <span className="font-bold text-gray-900 dark:text-white">{account.label}</span>
                                        </div>
                                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                                            Checked {formatHealthAge(account.etsy_health_checked_at)}{checkedAt ? ` · ${checkedAt}` : ''} · {rating}
                                        </div>
                                        {changedAtLabel && (
                                            <div className={`mt-0.5 text-xs font-semibold ${isRecovered ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                                                {isRecovered ? 'Recovered' : 'Detected'} {changedAtLabel}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

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
