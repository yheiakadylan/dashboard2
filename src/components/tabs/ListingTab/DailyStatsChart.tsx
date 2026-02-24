import React, { useEffect, useState } from 'react';
import {
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    ComposedChart,
    Line,
    LabelList,
    Area
} from 'recharts';
import { CustomSelect } from '../../ui/CustomSelect';
import { getDailyStats } from '../../../services/listingService';
import { DailyStats, Account } from '../../../types';
import { Loader2, ChevronDown } from 'lucide-react';

interface DailyStatsChartProps {
    teamId: string;
    days?: number;
    accounts: Account[];
}

const CustomTooltip = ({ active, payload, label, accounts, visible, coordinate, viewBox }: any) => {
    if ((active || visible) && payload && payload.length) {
        if (visible === false) return null; // Force hide if explicitly set to false
        // Find payload item with full data (usually the first one, but check)
        const data = payload[0].payload;
        const shops = data.shops || {};

        // Smart positioning: If tooltip is on the right side of the chart, render it to the left of cursor
        const xPos = coordinate?.x || 0;
        const chartWidth = viewBox?.width || 0;
        const isRightSide = chartWidth > 0 && xPos > chartWidth * 0.6;

        // Filter and sort shops
        const activeShops = Object.entries(shops)
            .filter(([_, stats]: [string, any]) => stats.new > 0 || stats.removed > 0)
            .sort((a: any, b: any) => (b[1].new + b[1].removed) - (a[1].new + a[1].removed));

        return (
            <div
                id="custom-tooltip-content"
                className="bg-white dark:bg-gray-800 p-3 border border-gray-100 dark:border-gray-700 shadow-xl rounded-xl text-xs z-50 min-w-[380px]"
                style={{
                    transform: isRightSide ? 'translateX(-100%) translateX(-20px)' : 'translateX(20px)',
                    transition: 'transform 0.1s ease-out'
                }}
            >
                <p className="font-bold mb-3 text-gray-800 dark:text-gray-100 border-b border-gray-100 dark:border-gray-700 pb-2">
                    {new Date(label).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })}
                </p>

                {/* Summary Section - Grid Layout */}
                <div className="grid grid-cols-4 gap-2 mb-3 pb-3 border-b border-gray-100 dark:border-gray-700 text-center">
                    <div className="flex flex-col">
                        <span className="text-gray-400 dark:text-gray-500 text-[9px] uppercase font-bold">New</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold text-sm">+{data.new_listings}</span>
                    </div>
                    <div className="flex flex-col border-l border-gray-50 dark:border-gray-700">
                        <span className="text-gray-400 dark:text-gray-500 text-[9px] uppercase font-bold">Removed</span>
                        <span className="text-rose-500 dark:text-rose-400 font-bold text-sm">-{data.removed_listings}</span>
                    </div>
                    <div className="flex flex-col border-l border-gray-50 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 rounded-r">
                        <span className="text-gray-400 dark:text-gray-500 text-[9px] uppercase font-bold">Net</span>
                        <span className={`${data.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'} font-bold text-sm`}>
                            {data.net > 0 ? '+' : ''}{data.net}
                        </span>
                    </div>
                    <div className="flex flex-col border-l border-gray-50 dark:border-gray-700">
                        <span className="text-blue-400 text-[9px] uppercase font-bold">Total</span>
                        <span className="text-blue-600 dark:text-blue-400 font-bold text-sm">{data.total_listings > 0 ? (data.total_listings / 1000).toFixed(1) + 'k' : '-'}</span>
                    </div>
                </div>

                <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                    {activeShops.length > 0 ? (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-50 dark:border-gray-700 text-[10px] uppercase">
                                    <th className="font-semibold py-1 pl-1">Shop</th>
                                    <th className="font-semibold py-1 text-right">New</th>
                                    <th className="font-semibold py-1 text-right">Removed</th>
                                    <th className="font-semibold py-1 text-right px-2">Net</th>
                                    <th className="font-semibold py-1 text-right pr-1">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeShops.map(([shopId, stats]: [string, any]) => {
                                    const shopLabel = accounts.find(a => a.id === shopId)?.label || shopId;
                                    const net = (stats.new || 0) - (stats.removed || 0);
                                    return (
                                        <tr key={shopId} className="border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 group">
                                            <td className="py-1.5 pl-1 truncate max-w-[140px] font-medium text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100" title={shopLabel}>
                                                {shopLabel}
                                            </td>
                                            <td className="py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                                                {stats.new > 0 ? `+${stats.new}` : '-'}
                                            </td>
                                            <td className="py-1.5 text-right font-mono text-rose-500 dark:text-rose-400 font-medium text-[11px]">
                                                {stats.removed > 0 ? `-${stats.removed}` : '-'}
                                            </td>
                                            <td className={`py-1.5 text-right px-2 font-mono font-bold text-[11px] ${net > 0 ? 'text-emerald-600 dark:text-emerald-400' : (net < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-gray-400 dark:text-gray-500')}`}>
                                                {net > 0 ? `+${net}` : net}
                                            </td>
                                            <td className="py-1.5 text-right pr-1 font-mono text-blue-600 dark:text-blue-400 font-medium text-[11px]">
                                                {stats.total ? (stats.total >= 1000 ? (stats.total / 1000).toFixed(1) + 'k' : stats.total) : '-'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-gray-400 italic py-2 text-center text-[11px]">No detailed shop data available</p>
                    )}
                </div>
            </div>
        );
    }
    return null;
};

const DailyStatsChart: React.FC<DailyStatsChartProps> = ({ teamId, days = 7, accounts }) => {
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isTooltipOpen, setIsTooltipOpen] = useState(false);
    const [selectedDays, setSelectedDays] = useState(days);

    useEffect(() => {
        setSelectedDays(days);
    }, [days]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            // Close if click is NOT within the chart wrapper (which includes tooltip usually, but we check explicitly)
            // But we specifically want to close if click is OUTSIDE both chart and tooltip.
            // Note: Recharts wrapper class is 'recharts-wrapper'.
            if (!target.closest('.recharts-wrapper') && !target.closest('#custom-tooltip-content')) {
                setIsTooltipOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const loadStats = async () => {
            if (!teamId) return;
            try {
                setLoading(true);
                const data = await getDailyStats(teamId, selectedDays);
                // Transform data for chart
                const processed = data.map(item => {
                    const net = item.new_listings - item.removed_listings;
                    const maxBarVal = Math.max(item.new_listings, item.removed_listings);

                    // Logic to position label above max bar
                    const labelPos = maxBarVal > 0 ? maxBarVal * 1.1 : 5;

                    return {
                        ...item,
                        net,
                        labelPos
                    };
                });
                setChartData(processed);
            } catch (error) {
                console.error('Failed to load daily stats:', error);
            } finally {
                setLoading(false);
            }
        };

        loadStats();
    }, [teamId, selectedDays]);



    if (loading) {
        return (
            <div className="h-[300px] flex items-center justify-center bg-gray-50/50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                <Loader2 className="w-8 h-8 animate-spin text-gray-300 dark:text-gray-600" />
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 transition-all hover:shadow-md">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-3">
                {/* Title */}
                <div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Listing Activity</h3>
                    <p className="text-xs text-gray-400 font-medium">Last {selectedDays} days</p>
                </div>

                {/* Controls: Unified Legend + Select */}
                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end mt-2 md:mt-0">
                    <div className="flex gap-2 text-[10px] md:text-xs font-medium bg-gray-50 dark:bg-gray-900/50 px-2 md:px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 shrink-0">
                        <div className="flex items-center gap-1 md:gap-1.5">
                            <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded bg-emerald-500 block"></span>
                            <span>New</span>
                        </div>
                        <div className="flex items-center gap-1 md:gap-1.5">
                            <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded bg-rose-500 block"></span>
                            <span>Del</span>
                        </div>
                    </div>

                    <CustomSelect
                        value={selectedDays}
                        onChange={(val) => setSelectedDays(Number(val))}
                        options={[
                            { label: 'Last 7 Days', value: 7 },
                            { label: 'Last 14 Days', value: 14 },
                            { label: 'Last 30 Days', value: 30 },
                            { label: 'Last 3 Months', value: 90 },
                        ]}
                        width="w-auto md:w-36"
                        renderTrigger={(value, label) => (
                            <button type="button" className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all whitespace-nowrap">
                                <span>{label}</span>
                                <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                            </button>
                        )}
                    />
                </div>
            </div>

            <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={chartData}
                        margin={{ top: 25, right: 10, left: -10, bottom: 0 }}
                        barGap={0}
                        onClick={() => setIsTooltipOpen(true)}
                    >
                        <defs>
                            <linearGradient id="gradNew" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="gradRem" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.2} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-gray-200 dark:text-gray-700" />

                        <XAxis
                            dataKey="date"
                            tickFormatter={(date) => {
                                const d = new Date(date);
                                // Shorten for compactness: "12/02"
                                return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
                            }}
                            interval={0}
                            tick={{ fontSize: 10, fill: '#9ca3af' }}
                            axisLine={false}
                            tickLine={false}
                            dy={10}
                            height={30}
                        />

                        {/* Primary Axis (Changes) - Hidden to save space */}
                        <YAxis
                            yAxisId="left"
                            hide={true}
                        />

                        <Tooltip
                            trigger="click"
                            content={<CustomTooltip accounts={accounts} visible={isTooltipOpen} />}
                            cursor={{ fill: '#f9fafb', opacity: 0.5 }}
                            allowEscapeViewBox={{ x: true, y: true }}
                            wrapperStyle={{ pointerEvents: 'auto', outline: 'none', zIndex: 100 }}
                        />

                        {/* Bars with Gradients */}
                        <Bar
                            yAxisId="left"
                            dataKey="new_listings"
                            name="New Listings"
                            fill="url(#gradNew)"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={40}
                            animationDuration={1000}
                            cursor="pointer"
                        >
                            <LabelList dataKey="new_listings" position="top" fill="#10b981" fontSize={10} fontWeight={600} formatter={(v: any) => v > 0 ? `+${v}` : ''} />
                        </Bar>
                        <Bar
                            yAxisId="left"
                            dataKey="removed_listings"
                            name="Removed Listings"
                            fill="url(#gradRem)"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={40}
                            animationDuration={1000}
                            cursor="pointer"
                        >
                            <LabelList dataKey="removed_listings" position="top" fill="#f43f5e" fontSize={10} fontWeight={600} formatter={(v: any) => v > 0 ? `-${v}` : ''} />
                        </Bar>
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
export default DailyStatsChart;
