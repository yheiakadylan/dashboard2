import React, { useState, useEffect, useMemo } from 'react';
import { KpiReport } from '../types';
import { getKpiReports } from '../services/kpiService';
import * as XLSX from 'xlsx';
import { ArrowDownTrayIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import { useUI } from '../contexts/UIContext';

interface KpiPersonalReportProps {
    teamId: string;
}

const KpiPersonalReport: React.FC<KpiPersonalReportProps> = ({ teamId }) => {
    const { filterDateRange } = useUI();
    const [reports, setReports] = useState<KpiReport[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

    const toggleRow = (id: string) => {
        setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
    };

    useEffect(() => {
        if (!teamId || !filterDateRange.from || !filterDateRange.to) return;
        
        setLoading(true);
        getKpiReports(teamId, filterDateRange.from, filterDateRange.to)
            .then(data => setReports(data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, [teamId, filterDateRange]);

    // Derived State
    const summary = useMemo(() => {
        const init = { ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0, baseCost: 0, grossProfit: 0 };
        const sums = reports.reduce((acc, curr) => {
            const ideaSum = curr.ideas.reduce((s, i) => s + i.count, 0);
            return {
                ideas: acc.ideas + ideaSum,
                mockup: acc.mockup + curr.mockup,
                listing: acc.listing + curr.listing,
                fulfill: acc.fulfill + curr.fulfill,
                revenue: acc.revenue + curr.revenue,
                baseCost: acc.baseCost + curr.baseCost,
                grossProfit: acc.grossProfit + curr.grossProfit,
            };
        }, init);
        
        const profitMargin = sums.revenue > 0 ? (sums.grossProfit / sums.revenue) * 100 : 0;
        return { ...sums, profitMargin };
    }, [reports]);

    const handleExport = () => {
        const exportData = reports.map(r => {
            const ideasStr = r.ideas.map(i => `${i.count} ${i.type}`).join(', ');
            return {
                Date: r.date.split('T')[0],
                Seller: r.sellerName,
                Ideas: ideasStr,
                Mockup: r.mockup,
                Listing: r.listing,
                Fulfill: r.fulfill,
                'Revenue ($)': r.revenue,
                'Base Cost ($)': r.baseCost,
                'Gross Profit ($)': r.grossProfit,
                'Tỉ lệ LN (%)': r.profitMargin.toFixed(1),
                'Note': r.note || ''
            };
        });

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Personal Report");
        XLSX.writeFile(wb, `KPI_Report_${filterDateRange.from}_${filterDateRange.to}.xlsx`);
    };

    return (
        <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Showing data for {filterDateRange.from} to {filterDateRange.to} <span className="text-gray-500 font-normal">(Vietnam Time - GMT+7)</span>
                    </span>
                </div>
                <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md transition-colors">
                    <ArrowDownTrayIcon className="w-4 h-4" /> Export XLSX
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                <StatCard title="Total Ideas" value={summary.ideas} />
                <StatCard title="Mockups" value={summary.mockup} />
                <StatCard title="Listings" value={summary.listing} />
                <StatCard title="Fulfill" value={summary.fulfill} />
                <StatCard title="Revenue" value={`$${summary.revenue.toFixed(2)}`} />
                <StatCard title="Base Cost" value={`$${summary.baseCost.toFixed(2)}`} />
                <StatCard title="Gross Profit" value={`$${summary.grossProfit.toFixed(2)}`} isPositive={summary.grossProfit >= 0} />
                <StatCard title="Tỉ lệ LN" value={`${summary.profitMargin.toFixed(1)}%`} isPositive={summary.profitMargin >= 0} />
            </div>

            {/* Data Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                                <th className="p-4 font-semibold">Date</th>
                                <th className="p-4 font-semibold">Seller</th>
                                <th className="p-4 font-semibold">Ideas</th>
                                <th className="p-4 font-semibold">Mockup</th>
                                <th className="p-4 font-semibold">Listing</th>
                                <th className="p-4 font-semibold w-16 text-center">Fulfill</th>
                                <th className="p-4 font-semibold text-right">Revenue</th>
                                <th className="p-4 font-semibold text-right">Gross Profit</th>
                                <th className="p-4 font-semibold text-right">Tỉ lệ LN</th>
                                <th className="p-4 font-semibold min-w-[200px]">Note</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                            {loading ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center"><Spinner size="md" /></td>
                                </tr>
                            ) : reports.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-gray-500">No reports found for this period.</td>
                                </tr>
                            ) : (
                                reports.map((r, idx) => {
                                    const totalIdeas = r.ideas.reduce((acc, i) => acc + i.count, 0);
                                    const rowId = r.id || String(idx);
                                    return (
                                        <React.Fragment key={rowId}>
                                            <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                <td className="p-4">{r.date.split('T')[0]}</td>
                                                <td className="p-4 font-medium text-gray-900 dark:text-gray-100">{r.sellerName}</td>
                                                <td className="p-4">
                                                    <div 
                                                        className="flex items-center gap-2 cursor-pointer text-blue-600 dark:text-blue-400 font-medium hover:text-blue-800 dark:hover:text-blue-300 transition-colors select-none"
                                                        onClick={() => toggleRow(rowId)}
                                                    >
                                                        <span>{totalIdeas}</span>
                                                        {totalIdeas > 0 && (
                                                            <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${expandedRows[rowId] ? 'rotate-180' : ''}`} />
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4">{r.mockup}</td>
                                                <td className="p-4">{r.listing}</td>
                                                <td className="p-4 text-center">{r.fulfill}</td>
                                                <td className="p-4 text-right font-medium">${r.revenue.toFixed(2)}</td>
                                                <td className={`p-4 text-right font-medium ${r.grossProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    ${r.grossProfit.toFixed(2)}
                                                </td>
                                                <td className="p-4 text-right text-blue-600 dark:text-blue-400 font-medium">{r.profitMargin.toFixed(1)}%</td>
                                                <td className="p-4 text-gray-600 dark:text-gray-400 italic text-xs min-w-[200px] max-w-[300px] break-words whitespace-pre-wrap">{r.note}</td>
                                            </tr>
                                            {expandedRows[rowId] && totalIdeas > 0 && (
                                                <tr className="bg-blue-50/30 dark:bg-blue-900/10">
                                                    <td colSpan={10} className="px-6 py-4 border-t border-gray-100 dark:border-gray-800">
                                                        <div className="flex flex-col gap-2">
                                                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Detailed Ideas</span>
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-4">
                                                                {r.ideas.map((i, iIdx) => (
                                                                    <div key={iIdx} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                                                                        <span className="font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 rounded text-xs min-w-[2rem] text-center">
                                                                            {i.count}
                                                                        </span>
                                                                        <span className="font-medium truncate">{i.type}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ title, value, isPositive }: { title: string, value: string | number, isPositive?: boolean }) => (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col justify-center shadow-sm">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1 truncate">{title}</p>
        <p className={`text-xl font-bold ${isPositive === true ? 'text-green-600 dark:text-green-400' : isPositive === false ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
            {value}
        </p>
    </div>
);

export default KpiPersonalReport;
