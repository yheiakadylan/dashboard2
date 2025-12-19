import React, { useState, useMemo, useLayoutEffect } from 'react';
import { compareValues, SortDirection } from '../utils/sortUtils';
import { FixedSizeList as List } from 'react-window';
import { HIDDEN_MOBILE_HEADERS } from '../constants';
import EmptyState from './EmptyState';
import DesktopRow from './datatable/DesktopRow';
import MobileCard from './datatable/MobileCard';
import { RowData, DataTableProps } from './datatable/types';
import ImagePreviewModal from './ImagePreviewModal';

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

// Custom hook to track container size
const useContainerSize = (ref: React.RefObject<HTMLDivElement>) => {
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        if (!ref.current) return;

        const updateSize = () => {
            if (ref.current) {
                const { width, height } = ref.current.getBoundingClientRect();
                setSize({ width, height });
            }
        };

        // Initial measurement
        updateSize();

        // Use ResizeObserver for efficient tracking
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(ref.current);

        // Fallback for older browsers
        window.addEventListener('resize', updateSize);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', updateSize);
        };
    }, [ref]);

    return size;
};

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

    // Use custom size tracker instead of AutoSizer
    const { width, height } = useContainerSize(containerRef);

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

    // Measure table absolute position once (and on resize) - Simpler version just for tooltip/modal pos if needed
    React.useLayoutEffect(() => {
        if (!useWindowScroll || !containerRef.current) return;
        const measureOffset = () => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) tableOffsetRef.current = window.scrollY + rect.top;
        };
        measureOffset();
        window.addEventListener('resize', measureOffset);
        return () => window.removeEventListener('resize', measureOffset);
    }, [useWindowScroll]);

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <EmptyState
                    variant="no-data"
                />
            </div>
        );
    }

    // Determine root container classes
    const rootClasses = `flex flex-col ${autoHeight ? '' : 'h-full'} bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${autoHeight ? '' : 'overflow-hidden'}`;

    // Render Skeleton if dimensions are not yet available
    if (!width || (!autoHeight && !height)) {
        return (
            <div className={rootClasses} ref={containerRef}>
                <div style={{ width: '100%', height: autoHeight ? 400 : '100%' }} className="p-4">
                    <div className="animate-pulse space-y-4">
                        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded w-full"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const isMobile = width < mobileBreakpoint || forceCardView;
    const itemSize = isMobile ? (mobileRowHeight || 250) : 92;
    const RowComponent = isMobile ? MobileCard : DesktopRow;

    // Calculate height for List
    let listHeight = 0;
    if (autoHeight) {
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
        columnWidths
    };

    return (
        <div className={rootClasses} ref={containerRef}>
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
            <ImagePreviewModal
                imageUrl={previewImage}
                onClose={() => setPreviewImage(null)}
            />
        </div >
    );
};

export default DataTable;
