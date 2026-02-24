import React, { useState, useEffect } from 'react';
import { Account } from '../../../types';
import { useDashboard } from '../../../contexts/DashboardContext';
import { updateAccountsInFirebase } from '../../../services/firebaseService';
import { isExtensionInstalled, getInstallInstructions } from '../../../services/extensionCrawler'; // Removed crawlShopViaExtension
import { Package, Play, Loader, AlertCircle, Clock, Store, Pause, ChevronDown, Download } from 'lucide-react'; // Added Pause, ChevronDown, Download
import { formatTimeAgo } from '../../../utils/dateFormatter';
import { getNewListingsCount } from '../../../services/listingService';
import { useCrawler } from '../../../contexts/CrawlerContext';
import CrawlerProgressBar from '../../CrawlerProgressBar';
import AutoCrawlMenu from './AutoCrawlMenu';
import { CustomSelect } from '../../ui/CustomSelect';
import NewListingsChart from './NewListingsChart';
import DailyStatsChart from './DailyStatsChart';

interface AccountsListProps {
    onSelectAccount: (accountId: string, tab?: 'all' | 'active' | 'new' | 'inactive') => void;
}


const NewListing24hBadge = ({ count }: { count: number | null }) => {
    if (count === null) return <span className="text-gray-300 text-xs animate-pulse">...</span>;
    if (count === 0) return <span className="text-gray-400 text-xs">-</span>;

    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            +{count}
        </span>
    );
};

interface AccountRowProps {
    account: Account;
    status: { status: 'pending' | 'success' | 'error' | 'crawling' | 'waiting'; message?: string } | undefined;
    newCount: number | null;
    isCrawling: boolean;
    onSelectAccount: (id: string) => void;
    onToggleTracking: (id: string, enabled: boolean) => void;
}

const AccountRow = React.memo(({ account, status, newCount, isCrawling, onSelectAccount, onToggleTracking }: AccountRowProps) => {
    return (
        <tr className="hover:bg-gray-50">
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900">{account.label}</div>
                <button
                    onClick={() => window.open(`https://www.etsy.com/shop/${account.label}`, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes')}
                    className="text-xs text-blue-500 hover:underline bg-transparent border-0 p-0 cursor-pointer text-left font-normal"
                >
                    View Shop
                </button>
            </td>

            {/* Status Column */}
            <td className="px-6 py-4">
                {status ? (
                    <div className="flex flex-col">
                        <span className={`text-xs font-bold uppercase ${status.status === 'success' ? 'text-green-600' :
                            status.status === 'error' ? 'text-red-600' :
                                status.status === 'crawling' ? 'text-blue-600' :
                                    status.status === 'waiting' ? 'text-orange-600' :
                                        'text-gray-400'
                            }`}>
                            {status.status}
                        </span>
                        {status.message && (
                            <span className="text-xs text-gray-500 truncate max-w-[150px]" title={status.message}>
                                {status.message}
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {/* ✅ Show Error Badge if last crawl failed */}
                        {account.last_crawl_error && (
                            <div className="flex items-center gap-1.5 mb-1.5 px-2 py-1 bg-red-50 border border-red-200 rounded" title={account.last_crawl_error}>
                                <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                                <span className="text-xs font-semibold text-red-700">Error</span>
                                <span className="text-xs text-red-600 truncate max-w-[120px]">
                                    {account.last_crawl_error}
                                </span>
                            </div>
                        )}

                        {/* Last Crawl Time */}
                        <div className="text-sm text-gray-500" title={account.last_listing_crawl ? new Date((account.last_listing_crawl as any).seconds ? (account.last_listing_crawl as any).seconds * 1000 : account.last_listing_crawl).toLocaleString() : ''}>
                            {formatTimeAgo(account.last_listing_crawl)}
                        </div>

                        {/* Stats: +added -removed (only show if NO error) */}
                        {account.last_crawl_stats && !account.last_crawl_error && (
                            <div className="text-xs flex gap-2 mt-0.5 font-mono">
                                {account.last_crawl_stats.added > 0 && (
                                    <span className="text-green-600 font-semibold" title="New items found in last scan">+{account.last_crawl_stats.added}</span>
                                )}
                                {account.last_crawl_stats.removed > 0 && (
                                    <span className="text-red-500 font-semibold" title="Items removed/sold out in last scan">-{account.last_crawl_stats.removed}</span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </td>

            <td className="px-6 py-4 whitespace-nowrap">
                <NewListing24hBadge count={newCount} />
            </td>

            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {account.total_listings || 0}
            </td>

            <td className="px-6 py-4 whitespace-nowrap">
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={account.listing_tracking_enabled || false}
                        onChange={(e) => onToggleTracking(account.id, e.target.checked)}
                        disabled={isCrawling}
                        className="sr-only peer disabled:cursor-not-allowed"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 disabled:opacity-60"></div>
                </label>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm">
                <button
                    onClick={() => onSelectAccount(account.id)}
                    className="text-blue-600 hover:text-blue-900 font-medium"
                >
                    View Listings
                </button>
            </td>
        </tr>
    );
});

const MobileAccountCard = React.memo(({ account, status, newCount, isCrawling, onSelectAccount, onToggleTracking }: AccountRowProps) => {
    return (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 space-y-3">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-medium text-gray-900">{account.label}</h3>
                    <button
                        onClick={() => window.open(`https://www.etsy.com/shop/${account.label}`, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes')}
                        className="text-xs text-blue-500 hover:underline"
                    >
                        View Shop
                    </button>
                </div>
                <NewListing24hBadge count={newCount} />
            </div>

            <div className="flex justify-between items-center text-sm text-gray-500">
                <span>Listings: {account.total_listings || 0}</span>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={account.listing_tracking_enabled || false}
                        onChange={(e) => onToggleTracking(account.id, e.target.checked)}
                        disabled={isCrawling}
                        className="sr-only peer disabled:cursor-not-allowed"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 disabled:opacity-60"></div>
                </label>
            </div>

            {/* Status Section */}
            <div className="pt-2 border-t border-gray-50 flex justify-between items-center">
                <div className="flex flex-col text-xs">
                    {status ? (
                        <>
                            <span className={`font-bold uppercase ${status.status === 'success' ? 'text-green-600' :
                                status.status === 'error' ? 'text-red-600' :
                                    status.status === 'crawling' ? 'text-blue-600' :
                                        status.status === 'waiting' ? 'text-orange-600' :
                                            'text-gray-400'
                                }`}>
                                {status.status}
                            </span>
                            {status.message && <span className="text-gray-400 truncate max-w-[150px]">{status.message}</span>}
                        </>
                    ) : (
                        <>
                            <span className="text-gray-400">Last crawled:</span>
                            <span className="text-gray-600">{formatTimeAgo(account.last_listing_crawl)}</span>
                            {account.last_crawl_stats && !account.last_crawl_error && (
                                <div className="flex gap-2 mt-0.5">
                                    {account.last_crawl_stats.added > 0 && <span className="text-green-600 font-semibold">+{account.last_crawl_stats.added}</span>}
                                    {account.last_crawl_stats.removed > 0 && <span className="text-red-500 font-semibold">-{account.last_crawl_stats.removed}</span>}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <button
                    onClick={() => onSelectAccount(account.id)}
                    className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-medium hover:bg-blue-100"
                >
                    View Listings
                </button>
            </div>
            {account.last_crawl_error && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-200 rounded text-xs mt-1">
                    <AlertCircle className="w-3 h-3 text-red-500" />
                    <span className="text-red-600 truncate">{account.last_crawl_error}</span>
                </div>
            )}
        </div>
    );
});

export default function AccountsList({ onSelectAccount }: AccountsListProps) {
    const { accounts, teamId, records, setRecords, filterDateRange, timeZone } = useDashboard();
    // Filter accounts có platforms includes 'etsy'
    const etsyAccounts = accounts.filter(acc => acc.platforms?.includes('etsy'));

    // Use Global Crawler Context
    // Use Global Crawler Context
    const {
        isCrawling,
        // progress,
        crawlStatuses,
        startBatchCrawl,
        stopCrawl,
        extensionAvailable,
        autoCrawlEnabled, setAutoCrawlEnabled,
        autoCrawlInterval, setAutoCrawlInterval,
        nextCrawlTime,
        newListingDuration, setNewListingDuration // New
    } = useCrawler();

    const [isMapping, setIsMapping] = useState(false);

    // Performance Optimization: Centralized Metrics State
    const [newListingCounts, setNewListingCounts] = useState<Record<string, number | null>>({});

    // Fetch metrics sequentially / batched to prevent network/RAM spike
    useEffect(() => {
        if (!teamId || etsyAccounts.length === 0) return;

        let isMounted = true;
        const fetchMetrics = async () => {
            const queue = [...etsyAccounts];
            const CONCURRENCY = 5; // Process 5 requests at a time

            while (queue.length > 0 && isMounted) {
                const batch = queue.splice(0, CONCURRENCY);

                // Fetch batch in parallel
                const results = await Promise.all(batch.map(async (acc) => {
                    try {
                        const count = await getNewListingsCount(teamId, acc.id, newListingDuration);
                        return { id: acc.id, count };
                    } catch (e) {
                        console.warn(`Failed to fetch count for ${acc.id}`, e);
                        return { id: acc.id, count: 0 };
                    }
                }));

                // Update state once per batch
                if (isMounted) {
                    setNewListingCounts(prev => {
                        const next = { ...prev };
                        results.forEach(r => next[r.id] = r.count);
                        return next;
                    });
                }
            }
        };

        fetchMetrics();
        return () => { isMounted = false; };
    }, [teamId, etsyAccounts.length, newListingDuration]);

    // Countdown logic for UI only
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        if (!nextCrawlTime) {
            setTimeLeft('');
            return;
        }

        const updateTimeLeft = () => {
            const now = new Date();
            const diff = nextCrawlTime.getTime() - now.getTime();
            if (diff <= 0) {
                setTimeLeft('Due now');
            } else {
                const h = Math.floor(diff / (1000 * 60 * 60));
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                setTimeLeft(`in ${h}h ${m}m`);
            }
        };

        updateTimeLeft(); // Initial run
        const timer = setInterval(updateTimeLeft, 60000); // Update every minute

        return () => clearInterval(timer);
    }, [nextCrawlTime]);

    const handleToggleTracking = async (accountId: string, enabled: boolean) => {
        try {
            await updateAccountsInFirebase(teamId!, [{
                id: accountId,
                listing_tracking_enabled: enabled
            }]);
        } catch (error) {
            console.error('Failed to toggle tracking:', error);
            alert('Failed to update tracking status');
        }
    };

    const handleToggleAllTracking = async () => {
        if (!teamId || etsyAccounts.length === 0) return;

        const allEnabled = etsyAccounts.every(acc => acc.listing_tracking_enabled);
        const newState = !allEnabled; // If all enabled -> disable all, otherwise enable all

        const updates = etsyAccounts.map(acc => ({
            id: acc.id,
            listing_tracking_enabled: newState
        }));

        try {
            await updateAccountsInFirebase(teamId, updates);
        } catch (error) {
            console.error('Failed to bulk toggle tracking:', error);
            alert('Failed to update tracking status for all accounts');
        }
    };

    // UI Wrapper for startBatchCrawl
    const triggerCrawl = () => {
        if (isCrawling) {
            stopCrawl();
            return;
        }

        const enabledAccounts = etsyAccounts.filter(a => a.listing_tracking_enabled);
        if (enabledAccounts.length === 0) {
            alert('No accounts enabled for tracking');
            return;
        }
        startBatchCrawl(enabledAccounts);
    };

    // Map Orders Handler
    const handleMapOrders = async () => {
        if (!teamId || isMapping) return;

        const confirmMap = window.confirm(
            `Start mapping Listing IDs for ${records.length} displayed orders?\n` +
            'This works on currently loaded orders (date range selected).\n' +
            'Ensure you have selected the desired date range on the dashboard.'
        );
        if (!confirmMap) return;

        setIsMapping(true);
        try {
            const { mapSpecificRecords } = await import('../../../services/listingService');
            // Use mapSpecificRecords with current records
            const result = await mapSpecificRecords(teamId, records);

            // Reload records to reflect changes
            const { getRecordsForDateRange } = await import('../../../services/firebaseService');
            // Assuming default timezone if not set. But context should have it.
            const updatedRecords = await getRecordsForDateRange(teamId, filterDateRange.from, filterDateRange.to, timeZone);
            setRecords(updatedRecords);

            alert(`Mapping Complete!\nScanned: ${result.processed} records\nMapped: ${result.mapped} new links\nDashboard updated.`);
        } catch (error) {
            console.error('Mapping failed:', error);
            alert('Failed to map orders. See console for details.');
        } finally {
            setIsMapping(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Actions */}


            <div className="p-2 md:p-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
                            <Package className="w-6 h-6 md:w-7 md:h-7" />
                            Etsy Listing Tracker
                        </h1>
                        <p className="text-sm md:text-base text-gray-600 mt-1">
                            Manage and track your Etsy shop listings
                        </p>
                    </div>

                    <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-2 md:pb-0 no-scrollbar">

                        {/* Mobile: Scrollable horizontal list of actions */}
                        <div className="flex items-center gap-2 flex-nowrap min-w-min">
                            <div className="text-sm text-gray-500 whitespace-nowrap px-1">
                                {extensionAvailable ? (
                                    <span className="flex items-center" title="Extension Ready">
                                        <span className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-sm ring-1 ring-white"></span>
                                        <span className="hidden sm:inline-flex items-center gap-1 text-green-600 ml-1.5">Ready</span>
                                    </span>
                                ) : (
                                    <span className="flex items-center" title="Extension Missing">
                                        <AlertCircle className="w-5 h-5 text-red-500" />
                                        <span className="hidden sm:inline-flex items-center gap-1 text-red-600 ml-1">Missing</span>
                                    </span>
                                )}
                            </div>

                            <a
                                href="/extension.zip"
                                download="EtsyCrawlerExtension.zip"
                                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium whitespace-nowrap"
                                title="Download Extension ZIP"
                            >
                                <Download className="w-4 h-4" />
                                <span className="hidden sm:inline">Extension</span>
                            </a>

                            <button
                                onClick={handleMapOrders}
                                disabled={isMapping}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm whitespace-nowrap ${isMapping
                                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                    : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'
                                    }`}
                                title="Link Orders to Listings by Image"
                            >
                                {isMapping ? (
                                    <Loader className="w-4 h-4 animate-spin" />
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-link"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                                )}
                                <span className="hidden sm:inline">{isMapping ? 'Mapping...' : 'Map Orders'}</span>
                            </button>

                            <button
                                onClick={() => onSelectAccount('all_shops')}
                                disabled={isCrawling}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-sm whitespace-nowrap"
                            >
                                <Store className="w-4 h-4" />
                                <span className="hidden sm:inline">All Listings</span>
                                <span className="sm:hidden">All</span>
                            </button>

                            <button
                                onClick={triggerCrawl}
                                disabled={!isCrawling && etsyAccounts.filter(a => a.listing_tracking_enabled).length === 0}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium text-sm whitespace-nowrap ${isCrawling
                                    ? 'bg-red-600 text-white hover:bg-red-700'
                                    : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
                                    }`}
                            >
                                {isCrawling ? (
                                    <>
                                        <Pause className="w-4 h-4" />
                                        <span className="hidden sm:inline">Stop Crawl</span>
                                        <span className="sm:hidden">Stop</span>
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4" />
                                        <span className="hidden sm:inline">Crawl</span>
                                        <span className="sm:hidden">Crawl</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                <div className={`grid grid-cols-1 ${etsyAccounts.length > 15 ? 'lg:grid-cols-1' : 'lg:grid-cols-2'} gap-4 mb-6`}>
                    {/* Daily Stats Chart (Historical Trend) */}
                    <div className="w-full min-w-0">
                        <DailyStatsChart teamId={teamId || ''} days={7} accounts={etsyAccounts} />
                    </div>

                    {/* New Listings Chart (Shop Breakdown) */}
                    <div className="w-full min-w-0">
                        <NewListingsChart
                            accounts={etsyAccounts}
                            onSelectAccount={onSelectAccount}
                        />
                    </div>
                </div>

                {isCrawling && <CrawlerProgressBar />}

                {
                    etsyAccounts.length === 0 ? (
                        <div className="text-center py-12 bg-gray-50 rounded-lg">
                            <Package className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                            <h3 className="text-lg font-medium text-gray-900 mb-2">No Etsy Accounts Found</h3>
                            <p className="text-gray-600">
                                Add an account with platform 'etsy' in Account Manager to start tracking listings.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="bg-white rounded-lg shadow overflow-hidden hidden md:block">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Shop Name
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Status
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                <div className="flex items-center gap-1 group w-fit">
                                                    <span>New</span>
                                                    <CustomSelect
                                                        value={newListingDuration}
                                                        onChange={(val) => setNewListingDuration(val)}
                                                        options={[
                                                            { label: '6 Hours', value: 6 },
                                                            { label: '12 Hours', value: 12 },
                                                            { label: '24 Hours', value: 24 },
                                                            { label: '48 Hours', value: 48 },
                                                            { label: '3 Days', value: 72 },
                                                        ]}
                                                        renderTrigger={() => (
                                                            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 hover:border-blue-300 transition-all cursor-pointer inline-flex items-center gap-0.5">
                                                                {newListingDuration}h
                                                                <ChevronDown className="w-3 h-3 opacity-50" />
                                                            </span>
                                                        )}
                                                        width="w-32"
                                                    />
                                                </div>
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Total
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                <div className="flex items-center gap-2">
                                                    Tracking
                                                    <label className="relative inline-flex items-center cursor-pointer" title="Toggle All">
                                                        <input
                                                            type="checkbox"
                                                            checked={etsyAccounts.length > 0 && etsyAccounts.every(acc => acc.listing_tracking_enabled)}
                                                            onChange={handleToggleAllTracking}
                                                            disabled={isCrawling}
                                                            className="sr-only peer disabled:cursor-not-allowed"
                                                        />
                                                        <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600 disabled:opacity-60"></div>
                                                    </label>
                                                </div>
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {etsyAccounts.map((account) => (
                                            <AccountRow
                                                key={account.id}
                                                account={account}
                                                status={crawlStatuses[account.id]}
                                                newCount={newListingCounts[account.id] ?? null}
                                                isCrawling={isCrawling}
                                                onSelectAccount={onSelectAccount}
                                                onToggleTracking={handleToggleTracking}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="md:hidden space-y-3">
                                {etsyAccounts.map((account) => (
                                    <MobileAccountCard
                                        key={account.id}
                                        account={account}
                                        status={crawlStatuses[account.id]}
                                        newCount={newListingCounts[account.id] ?? null}
                                        isCrawling={isCrawling}
                                        onSelectAccount={onSelectAccount}
                                        onToggleTracking={handleToggleTracking}
                                    />
                                ))}
                            </div>
                        </>
                    )
                }
            </div >
        </div >
    );
}

// function formatTimeAgo removed

// function formatTimeAgo removed
