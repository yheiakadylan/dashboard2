import React, { useState, useEffect } from 'react';
import { Listing } from '../../../types/listing';
import { getListingsForAccount, getListingCount, getAllListingsPaginated, getAllListingsCount } from '../../../services/listingService';
import { useDashboard } from '../../../contexts/DashboardContext';
import { ArrowLeft, Search, ChevronLeft, ChevronRight, Store, Clock, ChevronDown } from 'lucide-react';
import { formatTimeAgo } from '../../../utils/dateFormatter';
import { CustomSelect } from '../../ui/CustomSelect';

import { useCrawler } from '../../../contexts/CrawlerContext';

interface ListingTableProps {
    accountId: string;
    onBack: () => void;
    initialTab?: 'all' | 'active' | 'new' | 'inactive';
}

type ListingTab = 'all' | 'active' | 'new' | 'inactive';

export default function ListingTable({ accountId, onBack, initialTab = 'new' }: ListingTableProps) {
    const { teamId, accounts } = useDashboard();
    const { newListingDuration, setNewListingDuration } = useCrawler();
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<ListingTab>(initialTab);
    const [searchTerm, setSearchTerm] = useState('');
    const [totalCount, setTotalCount] = useState(0);

    // Server-side Pagination
    const ITEMS_PER_PAGE = 50;
    const [currentPage, setCurrentPage] = useState(1);
    const [cursors, setCursors] = useState<any[]>([null]); // cursors[i] = lastDoc used to fetch page i+1
    const [hasMore, setHasMore] = useState(true);

    const isAllShops = accountId === 'all_shops';
    const account = isAllShops ? null : accounts.find(a => a.id === accountId);

    useEffect(() => {
        loadInitialData();
    }, [accountId, activeTab]);

    // Reload when page changes (search/filter currently applied client-side on fetched batch, ideal to move server-side later)
    useEffect(() => {
        if (currentPage > 1) { // loadInitialData handles page 1
            loadListings(currentPage);
        }
    }, [currentPage]);

    const loadInitialData = async () => {
        if (!teamId) return;
        setLoading(true);
        try {
            // Calculate time filter for 'new' tab
            const timeFilter = activeTab === 'new'
                ? new Date(Date.now() - newListingDuration * 60 * 60 * 1000)
                : null;

            // Get total count
            const count = isAllShops
                ? await getAllListingsCount(teamId, activeTab, timeFilter)
                : await getListingCount(teamId, accountId, activeTab, timeFilter);
            setTotalCount(count);

            // Load page 1
            setCurrentPage(1);
            setCursors([null]);
            await loadListings(1, null);
        } catch (error) {
            console.error('Failed to load initial data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadListings = async (page: number, overrideCursor?: any) => {
        if (!teamId) return;
        setLoading(true);
        try {
            const cursor = overrideCursor !== undefined ? overrideCursor : cursors[page - 1];

            // Calculate time filter (re-calculate to be safe or pass from arg, but re-calc is cheap)
            const timeFilter = activeTab === 'new'
                ? new Date(Date.now() - newListingDuration * 60 * 60 * 1000)
                : null;

            const result = isAllShops
                ? await getAllListingsPaginated(teamId, ITEMS_PER_PAGE, cursor, activeTab, timeFilter)
                : await getListingsForAccount(
                    teamId,
                    accountId,
                    ITEMS_PER_PAGE,
                    cursor,
                    activeTab,
                    timeFilter
                );

            setListings(result.listings);

            // Store cursor for next page
            if (result.lastDoc) {
                const newCursors = [...cursors];
                newCursors[page] = result.lastDoc; // Cursor for page+1
                setCursors(newCursors);
                setHasMore(result.listings.length === ITEMS_PER_PAGE);
            } else {
                setHasMore(false);
            }

        } catch (error) {
            console.error('Failed to load listings:', error);
        } finally {
            setLoading(false);
        }
    };

    const isNewListing = (date: Date) => {
        const now = new Date();
        // Handle Firestore Timestamp or Date string
        const d = new Date(date);
        const diff = now.getTime() - d.getTime();
        return diff < newListingDuration * 60 * 60 * 1000;
    };

    const filterListings = (listing: Listing) => {
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            if (!listing.title.toLowerCase().includes(term) &&
                !listing.listing_id.includes(term)) {
                return false;
            }
        }

        switch (activeTab) {
            case 'active': return listing.status === 'active';
            case 'new': return listing.status === 'active' && isNewListing(listing.createdAt);
            case 'inactive': return listing.status === 'inactive';
            default: return true;
        }
    };

    const filteredListings = listings.filter(filterListings);

    // Mock counts for tabs since we don't query them specifically
    // We only know total ALL count
    const tabs = [
        { id: 'new', label: 'New', count: null },
        { id: 'active', label: 'Active', count: null },
        { id: 'inactive', label: 'Inactive', count: null },
        { id: 'all', label: 'All', count: null },
    ];

    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

    return (
        <div className="p-2 md:p-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    title="Back to Accounts"
                >
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                </button>
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        {isAllShops ? (
                            <>
                                <Store className="w-6 h-6" />
                                All Listings
                            </>
                        ) : (
                            <>
                                {account?.label || 'Unknown Shop'}
                                <span className="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                    {account?.total_listings || 0} items
                                </span>
                            </>
                        )}
                    </h2>
                </div>
            </div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mt-4 mb-6 gap-4">
                <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">

                    {/* New Duration Setting - Desktop Only */}
                    <div className="hidden md:block">
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
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-full shadow-sm hover:border-blue-300 hover:ring-2 hover:ring-blue-50 transition-all cursor-pointer group">
                                    <Clock className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500" />
                                    <span className="text-xs font-medium text-gray-600">New:</span>
                                    <span className="text-xs font-bold text-blue-600">{newListingDuration}h</span>
                                    <ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-blue-400" />
                                </div>
                            )}
                            className="relative"
                            align="left"
                            width="w-40"
                        />
                    </div>
                </div>

                {/* Search */}
                <div className="relative w-full md:w-auto">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="Search by title or ID..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full md:w-80"
                    />
                </div>
            </div>

            {/* Tabs & Pagination Header */}
            {/* Tabs & Pagination Header */}
            <div className="flex flex-col md:flex-row items-stretch md:items-end justify-between border-b border-gray-200 mb-6 gap-4">
                <nav className="-mb-px flex space-x-6 overflow-x-auto pb-1 no-scrollbar w-full md:w-auto">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as ListingTab)}
                            className={`
                whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeTab === tab.id
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }
              `}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                {/* Pagination Controls & Mobile Duration Selector */}
                <div className="flex items-center justify-between md:justify-start w-full md:w-auto gap-4 md:gap-2 pb-2 md:pb-0">

                    {/* Duration Select - Mobile Only (Left side) */}
                    <div className="md:hidden">
                        <CustomSelect
                            value={newListingDuration}
                            onChange={(val) => setNewListingDuration(val)}
                            options={[
                                { label: '6h', value: 6 },
                                { label: '12h', value: 12 },
                                { label: '24h', value: 24 },
                                { label: '48h', value: 48 },
                                { label: '3d', value: 72 },
                            ]}
                            renderTrigger={() => (
                                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border border-gray-200 rounded-lg shadow-sm">
                                    <Clock className="w-3 h-3 text-gray-400" />
                                    <span className="text-[10px] font-bold text-blue-600">{newListingDuration}h</span>
                                    <ChevronDown className="w-3 h-3 text-gray-300" />
                                </div>
                            )}
                            className="relative"
                            align="left"
                            width="w-24"
                        />
                    </div>

                    {/* Pagination - Right side on mobile */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1 || loading}
                            className="p-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Previous Page"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <span className="text-sm text-gray-700 mx-2 font-medium bg-gray-50 px-2 py-1 rounded border border-gray-100 min-w-[60px] text-center md:bg-transparent md:border-0 md:p-0 md:min-w-0">
                            {currentPage} / {totalPages || 1}
                        </span>

                        <button
                            onClick={() => setCurrentPage(prev => prev + 1)}
                            disabled={!hasMore || loading}
                            className="p-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Next Page"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            {loading && listings.length === 0 ? (
                <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                    <p className="mt-4 text-gray-600">Loading listings...</p>
                </div>
            ) : filteredListings.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-600">No listings found on this page</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
                        {filteredListings.map((listing) => (
                            <div
                                key={listing.listing_id}
                                className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden flex flex-col h-full"
                            >
                                {/* Image */}
                                <div className="relative flex-shrink-0">
                                    <img
                                        src={listing.image}
                                        alt={listing.title}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full aspect-square object-cover"
                                    />
                                    {listing.status === 'active' && isNewListing(listing.createdAt) && (
                                        <span className="absolute top-2 right-2 px-2 py-1 bg-green-500 text-white text-xs font-bold rounded shadow-sm">
                                            NEW ({newListingDuration}h)
                                        </span>
                                    )}
                                    {listing.status === 'inactive' && (
                                        <span className="absolute top-2 right-2 px-2 py-1 bg-red-500 text-white text-xs font-bold rounded shadow-sm">
                                            INACTIVE
                                        </span>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="p-2 md:p-4 flex flex-col flex-grow">
                                    <h3
                                        className="font-medium text-gray-900 line-clamp-2 mb-2 min-h-[2.5rem]"
                                        title={listing.title}
                                    >
                                        {listing.title}
                                    </h3>

                                    <div className="text-sm text-gray-500 mb-2 md:mb-4">
                                        <div className="flex flex-col gap-0.5 mb-2">
                                            <p className="text-[10px] md:text-xs text-gray-400 font-mono">#{listing.listing_id}</p>
                                            {isAllShops && (
                                                <span className="text-[10px] md:text-xs font-semibold text-blue-600 w-fit max-w-full truncate" title={accounts.find(a => a.id === listing.account_id)?.label}>
                                                    {accounts.find(a => a.id === listing.account_id)?.label || 'Unknown'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex justify-between text-[10px] md:text-xs text-gray-400">
                                            <span>{formatTimeAgo(listing.createdAt)}</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            const width = 1200;
                                            const height = 800;
                                            const left = (window.screen.width - width) / 2;
                                            const top = (window.screen.height - height) / 2;
                                            window.open(
                                                listing.url,
                                                'EtsyListingView',
                                                `width=${width},height=${height},top=${top},left=${left},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
                                            );
                                        }}
                                        className="block w-full text-center py-1.5 md:py-2 px-4 bg-blue-600 text-white rounded-md md:rounded-lg hover:bg-blue-700 transition-colors mt-auto text-xs md:text-sm font-medium"
                                    >
                                        View
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>


                </>
            )}
        </div>
    );
}
