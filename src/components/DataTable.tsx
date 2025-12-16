import React, { useState, useMemo, useEffect } from 'react';
import { compareValues, SortDirection } from '../utils/sortUtils';
import { FixedSizeList as List, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { HIDDEN_MOBILE_HEADERS } from '../constants';
import EmptyState from './EmptyState';
import Spinner from './Spinner';
import DesktopRow from './datatable/DesktopRow';
import MobileCard from './datatable/MobileCard';
import { RowData, DataTableProps } from './datatable/types';

// Helper to check if a header should be hidden on mobile (Only applied in Desktop View now)
const isHiddenOnDesktopMobileView = (header: string) => HIDDEN_MOBILE_HEADERS.includes(header);

// Custom outer element to allow document scroll
const WindowScrollerOuter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
    const { style, ...rest } = props;
    return (
        <div
            ref={ref}
            style={{
                ...style,
                position: 'relative',
                width: '100%',
                height: 'auto',
                overflow: 'visible'
            }}
            {...rest}
        />
    );
});

// SortDirection type imported from utils now

const DataTable: React.FC<DataTableProps> = ({ headers, data, onViewDayDetails, onViewOrderDetails, onResyncOrder, autoHeight = false, mobileRowHeight, forceCardView = false, mobileBreakpoint = 768, columnWidths, scrollParentId }) => {
    const [sortColumn, setSortColumn] = useState<number | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);
    const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Config for window scrolling
    const useWindowScroll = autoHeight;
    const listRef = React.useRef<List>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const headerRef = React.useRef<HTMLDivElement>(null);

    // Store table offset in a ref to avoid re-binding scroll listeners
    const tableOffsetRef = React.useRef<number>(0);

    const handleSort = (columnIndex: number) => {
        // Disable sorting for image column
        if (headers[columnIndex] === 'Image') {
            setSortColumn(null);
            setSortDirection(null);
            return;
        }
        if (sortColumn === columnIndex) {
            setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortColumn(columnIndex);
            setSortDirection('asc');
        }
    };

    const handleResyncClick = async (id: string) => {
        if (!onResyncOrder) return;
        setLoadingItems(prev => new Set(prev).add(id));
        try {
            await onResyncOrder(id);
        } finally {
            setLoadingItems(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const sortedData = useMemo(() => {
        if (sortColumn === null || sortDirection === null) {
            return data;
        }

        return [...data].sort((a, b) => {
            const valA = a[sortColumn];
            const valB = b[sortColumn];
            return compareValues(valA, valB, sortDirection);
        });
    }, [data, sortColumn, sortDirection]);

    // Measure table absolute position once (and on resize)
    React.useLayoutEffect(() => {
        if (!useWindowScroll || !containerRef.current) return;

        const measureOffset = () => {
            // If using a custom scroll parent, we need offset relative to THAT parent.
            if (scrollParentId) {
                const parent = document.getElementById(scrollParentId);
                if (parent && containerRef.current) {
                    tableOffsetRef.current = containerRef.current.offsetTop;
                }
            } else if (containerRef.current) {
                // Fallback to Window: absolute top = scrollY + viewport top
                const rect = containerRef.current.getBoundingClientRect();
                tableOffsetRef.current = window.scrollY + rect.top;
            }
        };

        measureOffset();
        window.addEventListener('resize', measureOffset);
        return () => window.removeEventListener('resize', measureOffset);
    }, [useWindowScroll, data.length, scrollParentId]);

    // Sync Window (or Container) Scroll with optimized handler
    React.useLayoutEffect(() => {
        if (!useWindowScroll || !listRef.current) return;

        const handleScroll = () => {
            if (listRef.current) {
                let scrollY = 0;
                let offset = 0;

                if (scrollParentId) {
                    const parent = document.getElementById(scrollParentId);
                    if (parent) {
                        scrollY = parent.scrollTop;
                        offset = Math.max(0, scrollY - tableOffsetRef.current);
                    }
                } else {
                    scrollY = window.scrollY;
                    offset = Math.max(0, scrollY - tableOffsetRef.current);
                }

                // Direct call to react-window's internal scrollTo (synchronous)
                listRef.current.scrollTo(offset);
            }
        };

        const target = scrollParentId ? document.getElementById(scrollParentId) : window;
        if (!target && scrollParentId) {
            console.warn(`DataTable: scrollParentId "${scrollParentId}" not found.`);
            return;
        }

        // Passive listener is better for scroll performance
        target?.addEventListener('scroll', handleScroll, { passive: true });

        // Initial sync
        handleScroll();

        return () => target?.removeEventListener('scroll', handleScroll);
    }, [useWindowScroll, scrollParentId]);

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <EmptyState
                    variant="no-data"
                    primaryAction={{
                        label: 'Refresh',
                        onClick: () => window.location.reload()
                    }}
                />
            </div>
        );
    }

    // Determine root container classes
    // If autoHeight (window scroll) is true, remove 'h-full' and 'overflow-hidden' to allow expansion
    const rootClasses = `flex flex-col ${autoHeight ? '' : 'h-full'} bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${autoHeight ? '' : 'overflow-hidden'}`;

    return (
        <div className={rootClasses} ref={containerRef}>
            <AutoSizer disableHeight={autoHeight as any}>
                {({ height, width }: { height: number; width: number }) => {
                    // Render Skeleton if dimensions are not yet available (prevent CLS)
                    if (!width || (!autoHeight && !height)) {
                        return (
                            <div style={{ width: '100%', height: autoHeight ? 400 : '100%' }} className="p-4">
                                <div className="animate-pulse space-y-4">
                                    <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
                                    {[...Array(10)].map((_, i) => (
                                        <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded w-full"></div>
                                    ))}
                                </div>
                            </div>
                        );
                    }

                    const isMobile = width < mobileBreakpoint || forceCardView; // Mobile Breakpoint or forced card view
                    const itemSize = isMobile ? (mobileRowHeight || 250) : 92;
                    const RowComponent = isMobile ? MobileCard : DesktopRow;

                    // Calculate height for List
                    // If autoHeight, use content height. 
                    // If normal, use container height (minus header on desktop).
                    let listHeight = 0;
                    if (autoHeight) {
                        // For Window Scroll, trick react-window into thinking viewport is full screen (or parent height).
                        // If we use scrollParentId, we might want to use parent.clientHeight? 
                        // Actually window.innerHeight is usually safe enough approximation for "viewport size" unless the container is very small.
                        listHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
                    } else {
                        listHeight = isMobile ? height : height - 48; // Subtract header height on desktop
                    }

                    // Create item data object to pass to FixedSizeList
                    const itemData: RowData = {
                        items: sortedData,
                        headers,
                        loadingItems,
                        onViewDayDetails,
                        onViewOrderDetails,
                        onResyncClick: handleResyncClick,
                        onImageClick: setPreviewImage,
                        isMobile,
                        columnWidths // Pass custom width map
                    };

                    return (
                        <>
                            {/* Desktop Header - Sticky if Window Scroll */}
                            {!isMobile && (
                                <div
                                    ref={headerRef}
                                    className={`flex items-center bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 font-semibold text-xs text-gray-500 dark:text-gray-300 uppercase tracking-wider h-12 flex-shrink-0 z-20 ${useWindowScroll ? 'sticky top-0 shadow-sm' : ''}`}
                                    style={{ width: width }}
                                >
                                    {headers.map((header, index) => {
                                        const isHidden = isHiddenOnDesktopMobileView(header);
                                        const canSort = header !== 'Image' && header !== 'Actions';
                                        let headerCellClass = `${isHidden ? 'hidden lg:flex' : 'flex'} items-center h-full px-3 py-2 ${canSort ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600' : ''} transition-colors `;

                                        switch (header) {
                                            case 'Image':
                                                headerCellClass += 'flex-none w-[95px] justify-center';
                                                break;
                                            case 'Product Name':
                                                headerCellClass += 'flex-grow-[3] basis-1/4';
                                                break;
                                            case 'Order Number':
                                                headerCellClass += 'flex-1 basis-[110px]'; // Compact width for order numbers
                                                break;
                                            case 'Revenue':
                                            case 'Cost':
                                            case 'Currency':
                                                headerCellClass += 'flex-1 basis-[80px]';
                                                break;
                                            case 'Message':
                                            case 'Help Kind':
                                                headerCellClass += 'flex-[2] basis-[250px]';
                                                break;
                                            case 'Fulfill':
                                            case 'DateTime':
                                            case 'Account':
                                                headerCellClass += 'flex-1 basis-[120px]';
                                                break;
                                            default:
                                                headerCellClass += 'flex-1 basis-[120px]';
                                                break;
                                        }

                                        // Apply custom width if provided
                                        const customHeaderStyle = columnWidths && columnWidths[header]
                                            ? { flexBasis: `${columnWidths[header]}px`, minWidth: `${columnWidths[header]}px`, width: `${columnWidths[header]}px` }
                                            : { width: undefined }; // Need to reset width if used in style tag previously

                                        return (
                                            <div
                                                key={header}
                                                className={headerCellClass}
                                                onClick={() => canSort && handleSort(index)}
                                                style={customHeaderStyle}
                                            >
                                                <div className="flex items-center">
                                                    {header}
                                                    {sortColumn === index && (
                                                        <span className="ml-2">
                                                            {sortDirection === 'asc' ? '▲' : '▼'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Virtualized Body */}
                            <div style={{ height: useWindowScroll ? 'auto' : listHeight, width: width }}>
                                <List
                                    ref={listRef}
                                    height={listHeight}
                                    itemCount={sortedData.length}
                                    itemSize={itemSize}
                                    width={width}
                                    itemData={itemData}
                                    overscanCount={40} // Increased to 40 for smoother fast scrolling
                                    className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
                                    style={useWindowScroll ? { overflow: 'visible' } : undefined} // Override to visible for Window Scroll
                                    outerElementType={useWindowScroll ? WindowScrollerOuter : undefined} // Use custom outer for Window Scroll
                                >
                                    {RowComponent}
                                </List>
                            </div>
                        </>
                    );
                }}
            </AutoSizer>
            {previewImage && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 cursor-pointer"
                    onClick={() => setPreviewImage(null)}
                    title="Click anywhere to close"
                >
                    <div className="relative max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 p-2 rounded-lg shadow-2xl">
                        <img
                            src={previewImage}
                            alt="Product Mockup"
                            className="max-w-full max-h-[85vh] object-contain rounded"
                        />
                        <div className="absolute top-0 right-0 -mt-3 -mr-3">
                            <button className="bg-red-500 text-white rounded-full p-1 hover:bg-red-600 shadow-lg">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DataTable;
