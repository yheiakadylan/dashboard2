import React, { useMemo, Suspense, useEffect, useState } from 'react';
import DataTable from '../ui/DataTable';
import { ProcessedData, Record as DashboardRecord } from '../../types';
import LoadingSpinner from '../ui/LoadingSpinner';
import { useUIFilters } from '../../contexts/UIContext';
import useMediaQuery from '../../hooks/useMediaQuery';
import Pagination from '../ui/Pagination';
import KpiCard from '../ui/KpiCard';
import { useDashboard } from '../../contexts/DashboardContext';
import { getRecordsForDateRange } from '../../services/firebaseService';
import { buildNumericKpi, getPreviousDateRange, getPreviousPeriodLabel } from '../../utils/periodComparison';
import { buildAccountLabelMap, resolveAccountLabel } from '../../utils/accountLabels';

const ITEMS_PER_PAGE = 200;


interface SupportTabProps {
    processedData: ProcessedData;
}

const SupportTab: React.FC<SupportTabProps> = ({ processedData }) => {
    const { accounts, teamId } = useDashboard();
    const accountLabelMap = useMemo(() => buildAccountLabelMap(accounts), [accounts]);
    const getShopLabel = (shopId?: string | number | null) => resolveAccountLabel(accountLabelMap, shopId);
    const { supportFilter, filterDateRange, selectedAccountId, searchTerm, timeZone } = useUIFilters();
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [currentPage, setCurrentPage] = React.useState(0);
    const [previousRecords, setPreviousRecords] = useState<DashboardRecord[] | null>(null);
    const [selectedSupportShop, setSelectedSupportShop] = useState<string | null>(null);

    const previousRange = useMemo(() => getPreviousDateRange(filterDateRange), [filterDateRange]);
    const previousLabel = useMemo(() => getPreviousPeriodLabel(filterDateRange), [filterDateRange]);

    // Reset page when filtering
    React.useEffect(() => {
        setCurrentPage(0);
    }, [supportFilter, selectedSupportShop]);

    useEffect(() => {
        let cancelled = false;
        setPreviousRecords(null);

        getRecordsForDateRange(teamId, previousRange.from, previousRange.to, timeZone)
            .then(records => {
                if (!cancelled) setPreviousRecords(records);
            })
            .catch(error => {
                if (!cancelled) {
                    console.error('Failed to load previous support period:', error);
                    setPreviousRecords([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [teamId, previousRange.from, previousRange.to, timeZone]);

    const displayData = useMemo(() => {
        const caseRows = processedData.cases.rows;
        const helpRows = processedData.help.rows;

        // Common headers for consistent display
        const commonHeaders = [
            "Order Number",
            "Message",
            "Source",
            "Account",
            "DateTime", // Index  4
            "DateTimeRaw" // Index 5 (Hidden)
        ];

        const displayHeaders = commonHeaders.slice(0, 5);

        if (supportFilter === 'Case') {
            const rows = selectedSupportShop ? caseRows.filter(row => row[3] === selectedSupportShop) : caseRows;
            return { headers: displayHeaders, rows: rows.map(row => row.slice(0, 5)) };
        }
        if (supportFilter === 'Help') {
            const rows = selectedSupportShop ? helpRows.filter(row => row[3] === selectedSupportShop) : helpRows;
            return { headers: displayHeaders, rows: rows.map(row => row.slice(0, 5)) };
        }

        // Combine for 'All'
        const combinedRows = [
            ...(selectedSupportShop ? caseRows.filter(row => row[3] === selectedSupportShop) : caseRows),
            ...(selectedSupportShop ? helpRows.filter(row => row[3] === selectedSupportShop) : helpRows)
        ].sort((a, b) => {
            const dateA = new Date(a[5] as string).getTime();
            const dateB = new Date(b[5] as string).getTime();
            return dateB - dateA;
        });

        // Filter out the "DateTimeRaw" column (Index 5) for display
        // Note: commonHeaders is already sliced above into displayHeaders constant but we are in a different scope block potentially or just need to reuse
        // Actually, let's just use the sliced version.

        const displayRows = combinedRows.map(row => row.slice(0, 5));

        return { headers: displayHeaders, rows: displayRows };

    }, [processedData.cases.rows, processedData.help.rows, selectedSupportShop, supportFilter]);

    const supportKpis = useMemo(() => {
        const current = {
            cases: processedData.cases.rows.length,
            help: processedData.help.rows.length
        };

        const allowedEmails = new Set(accounts.map(account => account.email).filter(Boolean));
        const lowerSearchTerm = searchTerm.trim().toLowerCase();

        const previous = (previousRecords || []).reduce((acc, record) => {
            if (!record.account || !allowedEmails.has(record.account)) return acc;
            if (selectedAccountId && selectedAccountId !== 'all' && record.account !== selectedAccountId) return acc;

            if (lowerSearchTerm) {
                const fields = [
                    record.order_id,
                    record.details?.customerName,
                    record.product_name,
                    record.ff_code
                ].map(value => String(value || '').toLowerCase());
                if (!fields.some(field => field.includes(lowerSearchTerm))) return acc;
            }

            if (record.kind === 'case') acc.cases += 1;
            if (record.kind === 'help') acc.help += 1;
            return acc;
        }, { cases: 0, help: 0 });

        const currentTotal = current.cases + current.help;
        const previousTotal = previous.cases + previous.help;

        // Aggregate current cases count per shop (excluding help requests)
        const currentCounts = new Map<string, number>();
        processedData.cases.rows.forEach(row => {
            const shopName = row[3] || 'Unknown Shop';
            currentCounts.set(shopName, (currentCounts.get(shopName) || 0) + 1);
        });

        // Aggregate previous cases count per shop (excluding help requests)
        const previousCounts = new Map<string, number>();
        (previousRecords || []).forEach(record => {
            if (!record.account || !allowedEmails.has(record.account)) return;
            if (selectedAccountId && selectedAccountId !== 'all' && record.account !== selectedAccountId) return;

            if (lowerSearchTerm) {
                const fields = [
                    record.order_id,
                    record.details?.customerName,
                    record.product_name,
                    record.ff_code
                ].map(value => String(value || '').toLowerCase());
                if (!fields.some(field => field.includes(lowerSearchTerm))) return;
            }

            const shopName = getShopLabel(record.account) || 'Unknown Shop';
            if (record.kind === 'case') {
                previousCounts.set(shopName, (previousCounts.get(shopName) || 0) + 1);
            }
        });

        // Compute changes for all shops
        const allShopNames = new Set([...currentCounts.keys(), ...previousCounts.keys()]);
        const changes: Array<{ shopName: string; current: number; previous: number; diff: number }> = [];

        allShopNames.forEach(shopName => {
            const currentVal = currentCounts.get(shopName) || 0;
            const previousVal = previousCounts.get(shopName) || 0;
            changes.push({ shopName, current: currentVal, previous: previousVal, diff: currentVal - previousVal });
        });

        // Sort to find the highest spike (diff > 0)
        const spikesList = changes.filter(c => c.diff > 0).sort((a, b) => b.diff - a.diff);
        const topSpike = spikesList[0];

        // Sort to find the highest drop (diff < 0)
        const dropsList = changes.filter(c => c.diff < 0).sort((a, b) => a.diff - b.diff);
        const topImprovement = dropsList[0];

        const spikeKpi = {
            value: topSpike ? topSpike.shopName : 'None',
            direction: 'neutral' as const,
            detailLines: topSpike ? [
                { label: 'Current', value: String(topSpike.current) },
                { label: previousLabel, value: String(topSpike.previous), tone: 'muted' as const },
                { label: 'Increased', value: `+${topSpike.diff}`, tone: 'bad' as const }
            ] : undefined
        };

        const dropKpi = {
            value: topImprovement ? topImprovement.shopName : 'None',
            direction: 'neutral' as const,
            detailLines: topImprovement ? [
                { label: 'Current', value: String(topImprovement.current) },
                { label: previousLabel, value: String(topImprovement.previous), tone: 'muted' as const },
                { label: 'Reduced', value: String(topImprovement.diff), tone: 'good' as const }
            ] : undefined
        };

        return {
            total: buildNumericKpi(currentTotal, previousRecords ? previousTotal : undefined, String, previousLabel),
            cases: buildNumericKpi(current.cases, previousRecords ? previous.cases : undefined, String, previousLabel),
            help: buildNumericKpi(current.help, previousRecords ? previous.help : undefined, String, previousLabel),
            spike: spikeKpi,
            drop: dropKpi
        };
    }, [
        accounts,
        processedData.cases.rows,
        processedData.help.rows,
        previousLabel,
        previousRecords,
        getShopLabel,
        searchTerm,
        selectedAccountId
    ]);

    const shopSupportBreakdown = useMemo(() => {
        const counts = new Map<string, {
            shopName: string;
            cases: number;
            help: number;
            total: number;
            previousTotal: number;
            delta: number;
        }>();
        const ensureRow = (shopName: string) => {
            if (!counts.has(shopName)) {
                counts.set(shopName, { shopName, cases: 0, help: 0, total: 0, previousTotal: 0, delta: 0 });
            }
            return counts.get(shopName)!;
        };

        processedData.cases.rows.forEach(row => {
            const shopName = String(row[3] || 'Unknown Shop');
            const data = ensureRow(shopName);
            data.cases += 1;
            data.total += 1;
        });

        processedData.help.rows.forEach(row => {
            const shopName = String(row[3] || 'Unknown Shop');
            const data = ensureRow(shopName);
            data.help += 1;
            data.total += 1;
        });

        const allowedEmails = new Set(accounts.map(account => account.email).filter(Boolean));
        const lowerSearchTerm = searchTerm.trim().toLowerCase();

        (previousRecords || []).forEach(record => {
            if (!record.account || !allowedEmails.has(record.account)) return;
            if (selectedAccountId && selectedAccountId !== 'all' && record.account !== selectedAccountId) return;
            if (record.kind !== 'case' && record.kind !== 'help') return;

            if (lowerSearchTerm) {
                const fields = [
                    record.order_id,
                    record.details?.customerName,
                    record.product_name,
                    record.ff_code
                ].map(value => String(value || '').toLowerCase());
                if (!fields.some(field => field.includes(lowerSearchTerm))) return;
            }

            const data = ensureRow(getShopLabel(record.account) || 'Unknown Shop');
            data.previousTotal += 1;
        });

        return Array.from(counts.values())
            .filter(row => !selectedSupportShop || row.shopName === selectedSupportShop)
            .map(row => ({ ...row, delta: row.total - row.previousTotal }))
            .sort((a, b) => b.total - a.total || b.delta - a.delta);
    }, [accounts, getShopLabel, previousRecords, processedData.cases.rows, processedData.help.rows, searchTerm, selectedAccountId, selectedSupportShop]);



    const totalPages = Math.ceil(displayData.rows.length / ITEMS_PER_PAGE);
    const paginatedRows = useMemo(() => {
        return displayData.rows.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
    }, [displayData.rows, currentPage]);

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <div className="p-2 md:p-6">
                <div className="w-full mb-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                    {/* Left Column: KPI Cards (Vertical Stack) */}
                    <div className="lg:col-span-4 flex flex-col gap-4">
                        <KpiCard title="Total Support" value={supportKpis.total} />
                        <KpiCard title="Cases" value={supportKpis.cases} />
                        <KpiCard title="Help Requests" value={supportKpis.help} />
                        <KpiCard
                            title="Case Spikes"
                            value={supportKpis.spike}
                            onClick={() => {
                                if (supportKpis.spike.value !== 'None') setSelectedSupportShop(current => current === supportKpis.spike.value ? null : supportKpis.spike.value);
                            }}
                            isActive={selectedSupportShop === supportKpis.spike.value}
                        />
                        <KpiCard
                            title="Case Drops"
                            value={supportKpis.drop}
                            onClick={() => {
                                if (supportKpis.drop.value !== 'None') setSelectedSupportShop(current => current === supportKpis.drop.value ? null : supportKpis.drop.value);
                            }}
                            isActive={selectedSupportShop === supportKpis.drop.value}
                        />
                    </div>

                    {/* Right Column: Shop Breakdown */}
                    <div className="lg:col-span-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col h-[400px] lg:h-0 lg:min-h-full">
                        <div className="flex flex-col h-full">
                            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-sm font-bold uppercase tracking-widest text-gray-700 dark:text-gray-300">Shop Breakdown</h3>
                                    {selectedSupportShop && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSupportShop(null)}
                                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                            Clear {selectedSupportShop}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0 relative [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-gray-750 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                                <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400 relative border-collapse">
                                    <thead className="text-xs uppercase text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-4 py-3 font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">Shop Name</th>
                                            <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">Total</th>
                                            <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">Cases</th>
                                            <th className="px-3 py-3 text-center font-bold bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">Help</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {shopSupportBreakdown.map(row => (
                                            <tr key={row.shopName} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                <td className="px-4 py-3 font-bold text-gray-900 dark:text-white truncate max-w-[180px]" title={row.shopName}>{row.shopName}</td>
                                                <td className="px-3 py-3 text-center">
                                                    <div className="flex items-baseline justify-center gap-2">
                                                        <span className="font-bold text-gray-900 dark:text-white">{row.total}</span>
                                                        <span className={`text-[11px] font-bold ${row.delta > 0 ? 'text-red-600 dark:text-red-400' : row.delta < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                                            {row.delta > 0 ? `+${row.delta}` : row.delta}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                                                        prev {row.previousTotal}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-center font-semibold text-red-600 dark:text-red-400">{row.cases}</td>
                                                <td className="px-3 py-3 text-center font-semibold text-cyan-600 dark:text-cyan-400">{row.help}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                <div style={isDesktop ? { height: 'calc(100vh - 160px)' } : {}} className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                    <div className="flex-1 min-h-0 relative">
                        <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                            <DataTable
                                headers={displayData.headers}
                                data={paginatedRows}
                                autoHeight={!isDesktop}
                            />
                        </Suspense>
                    </div>
                    <Pagination 
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                    />
                </div>
            </div>
        </div>
    );
};

export default SupportTab;
