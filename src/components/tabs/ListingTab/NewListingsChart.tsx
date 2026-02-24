import React, { useState, useEffect, useMemo } from 'react';
import { Account } from '../../../types';
import { getNewListingsCount, getRemovedListingsCount } from '../../../services/listingService';
import { useDashboard } from '../../../contexts/DashboardContext';
import { useCrawler } from '../../../contexts/CrawlerContext';
import { TrendingUp, Clock, ChevronDown } from 'lucide-react';
import { CustomSelect } from '../../ui/CustomSelect';

interface NewListingsChartProps {
    accounts: Account[];
    onSelectAccount: (accountId: string, tab?: 'all' | 'active' | 'new' | 'inactive') => void;
}

export default function NewListingsChart({ accounts, onSelectAccount }: NewListingsChartProps) {
    const { teamId } = useDashboard();
    const { newListingDuration, setNewListingDuration } = useCrawler();
    const duration = newListingDuration;

    const [data, setData] = useState<{ accountId: string; label: string; newCount: number; removedCount: number }[]>([]);
    const [loading, setLoading] = useState(false);

    const etsyAccounts = useMemo(
        () => accounts.filter(acc => acc.platforms?.includes('etsy')),
        [accounts]
    );

    const accountIdsStr = useMemo(
        () => etsyAccounts.map(a => a.id).sort().join(','),
        [etsyAccounts]
    );

    const lastUpdateStr = useMemo(
        () => etsyAccounts.map(a => a.last_listing_crawl ? (typeof a.last_listing_crawl === 'object' ? (a.last_listing_crawl as any).seconds : a.last_listing_crawl) : 0).join(','),
        [etsyAccounts]
    );

    // Load shop-based data
    useEffect(() => {
        if (!teamId || etsyAccounts.length === 0) {
            setData([]);
            return;
        }

        let cancelled = false;
        if (data.length === 0) setLoading(true);

        const loadData = async () => {
            try {
                const results = await Promise.all(
                    etsyAccounts.map(async (acc) => {
                        const [newCount, removedCount] = await Promise.all([
                            getNewListingsCount(teamId, acc.id, duration),
                            getRemovedListingsCount(teamId, acc.id, duration)
                        ]);

                        return {
                            accountId: acc.id,
                            label: acc.label,
                            newCount,
                            removedCount
                        };
                    })
                );

                if (!cancelled) {
                    const sorted = results.sort((a, b) => (b.newCount + b.removedCount) - (a.newCount + a.removedCount));
                    setData(sorted);
                }
            } catch (error) {
                console.error('Failed to load new listings chart:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadData();

        return () => {
            cancelled = true;
        };
    }, [teamId, accountIdsStr, duration, lastUpdateStr]);

    // Calculate values BEFORE any early returns (Rules of Hooks)
    const displayedData = useMemo(() => {
        return data.filter(d => d.newCount > 0 || d.removedCount > 0);
    }, [data]);

    const maxVal = Math.max(
        ...displayedData.map(d => Math.max(d.newCount, d.removedCount)),
        1
    );

    const totalNew = data.reduce((sum, d) => sum + d.newCount, 0);
    const totalRemoved = data.reduce((sum, d) => sum + d.removedCount, 0);
    const isCompact = displayedData.length > 12;

    // NOW safe to do early returns
    if (loading && data.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <div className="flex justify-center items-center py-8">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    <span className="ml-2 text-sm text-gray-500">Loading chart...</span>
                </div>
            </div>
        );
    }

    if (displayedData.length === 0 && !loading && data.length > 0) {
        return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <ChartHeader
                    totalNew={totalNew}
                    totalRemoved={totalRemoved}
                    duration={duration}
                    setDuration={setNewListingDuration}
                />
                <div className="text-center py-8 text-gray-500">
                    <TrendingUp className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    No listing activity in the last {duration} hours.
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <ChartHeader
                totalNew={totalNew}
                totalRemoved={totalRemoved}
                duration={duration}
                setDuration={setNewListingDuration}
            />

            {/* Desktop View: Vertical Bars - Scrollable */}
            <div className={`hidden md:block w-full overflow-x-auto custom-scrollbar ${isCompact ? 'pb-32' : 'pb-12'}`}>
                <div
                    className={`flex relative items-stretch justify-center gap-1 sm:gap-2 ${isCompact ? 'px-2' : 'px-4'}`}
                    style={{ height: '450px', minWidth: '100%' }}
                >
                    <div className="absolute top-1/2 left-0 right-0 border-t border-gray-300 w-full z-0 pointer-events-none"></div>

                    {displayedData.map((item) => (
                        <div
                            key={item.accountId}
                            className={`relative z-10 flex flex-col items-center flex-1 group cursor-pointer ${isCompact ? 'max-w-[40px]' : 'max-w-[100px]'}`}
                            style={{ minWidth: isCompact ? '32px' : '50px', flexShrink: 0 }}
                            title={`${item.label}\nNew: +${item.newCount}\nRemoved: -${item.removedCount}`}
                        >
                            <div
                                className="flex-1 w-full flex flex-col justify-end items-center pb-[1px]"
                                onClick={() => onSelectAccount(item.accountId, 'new')}
                            >
                                {item.newCount > 0 && (
                                    <>
                                        <span className="mb-1 text-[10px] sm:text-xs font-bold text-green-600 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                            +{item.newCount}
                                        </span>
                                        <div
                                            className="w-full bg-green-500 rounded-t-sm opacity-90 group-hover:opacity-100 transition-all shadow-sm hover:shadow-md"
                                            style={{
                                                height: `${Math.max((item.newCount / maxVal) * 100, 2)}%`,
                                            }}
                                        />
                                    </>
                                )}
                            </div>

                            <div
                                className="flex-1 w-full flex flex-col justify-start items-center pt-[1px]"
                                onClick={() => onSelectAccount(item.accountId, 'inactive')}
                            >
                                {item.removedCount > 0 && (
                                    <>
                                        <div
                                            className="w-full bg-red-400 rounded-b-sm opacity-90 group-hover:opacity-100 transition-all shadow-sm hover:shadow-md"
                                            style={{
                                                height: `${Math.max((item.removedCount / maxVal) * 100, 2)}%`,
                                            }}
                                        />
                                        <span className="mt-1 text-[10px] sm:text-xs font-bold text-red-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                            -{item.removedCount}
                                        </span>
                                    </>
                                )}
                            </div>

                            <div
                                className={`absolute top-full pt-3 flex justify-center pointer-events-auto ${isCompact ? 'w-32' : 'w-full'}`}
                                onClick={() => onSelectAccount(item.accountId, 'new')}
                            >
                                <span
                                    className={`
                                    text-[10px] sm:text-xs font-medium text-gray-600 group-hover:text-blue-600 transition-colors
                                    ${isCompact
                                            ? 'origin-top -rotate-90 translate-y-2'
                                            : 'text-center truncate px-1 w-full block'
                                        }
                                `}
                                >
                                    {item.label}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Mobile View: Horizontal Bars (List) for better scalability */}
            <div className="md:hidden flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {displayedData.map((item) => (
                    <div key={item.accountId} className="flex flex-col gap-1 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                        <div className="flex justify-between items-center text-xs mb-1">
                            <span className="font-medium text-gray-800 truncate max-w-[150px]" title={item.label}>
                                {item.label}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 h-6">
                            {/* New (Green) Bar */}
                            {item.newCount > 0 && (
                                <div
                                    className="h-full bg-green-500/90 rounded-r-md flex items-center justify-end px-1.5 transition-all text-[10px] font-bold text-white min-w-[24px]"
                                    style={{ width: `${Math.max((item.newCount / maxVal) * 100 * 0.5, 10)}%` }} // Scale to 50% width max to share space
                                    onClick={() => onSelectAccount(item.accountId, 'new')}
                                >
                                    +{item.newCount}
                                </div>
                            )}

                            {/* Spacer line or separator if both exist */}
                            {item.newCount > 0 && item.removedCount > 0 && <div className="w-[1px] h-4 bg-gray-200"></div>}

                            {/* Removed (Red) Bar */}
                            {item.removedCount > 0 && (
                                <div
                                    className="h-full bg-red-400/90 rounded-r-md flex items-center justify-end px-1.5 transition-all text-[10px] font-bold text-white min-w-[24px]"
                                    style={{ width: `${Math.max((item.removedCount / maxVal) * 100 * 0.5, 10)}%` }}
                                    onClick={() => onSelectAccount(item.accountId, 'inactive')}
                                >
                                    -{item.removedCount}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>


        </div>
    );
}

// ========== HEADER COMPONENT ==========
interface ChartHeaderProps {
    totalNew: number;
    totalRemoved: number;
    duration: number;
    setDuration: (val: number) => void;
}

function ChartHeader({ totalNew, totalRemoved, duration, setDuration }: ChartHeaderProps) {
    return (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-3">
            <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="p-2 bg-green-100 rounded-lg shrink-0">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div>
                    <h3 className="font-semibold text-gray-900 text-sm md:text-base">Activity Monitor</h3>
                    <p className="text-xs md:text-sm text-green-600 font-medium">
                        +{totalNew} new, <span className="text-red-500">-{totalRemoved} rem</span> ({duration}h)
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
                {/* Duration Selector */}
                <CustomSelect
                    value={duration}
                    onChange={(val) => setDuration(val)}
                    options={[
                        { label: '6 Hours', value: 6 },
                        { label: '12 Hours', value: 12 },
                        { label: '24 Hours', value: 24 },
                    ]}
                    renderTrigger={() => (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-blue-300 hover:ring-2 hover:ring-blue-50 transition-all cursor-pointer group w-full">
                            <div className="flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500" />
                                <span className="text-xs font-medium text-gray-600">Period:</span>
                                <span className="text-xs font-bold text-blue-600">{duration} Hours</span>
                            </div>
                            <ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-blue-400" />
                        </div>
                    )}
                    className="relative w-full"
                    align="right"
                    width="w-full md:w-32"
                />
            </div>
        </div>
    );
}
