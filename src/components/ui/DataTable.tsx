import React, { useState, useMemo, useLayoutEffect, useCallback } from 'react';
import { compareValues, SortDirection } from '../../utils/sortUtils';
import { FixedSizeList as List, VariableSizeList } from 'react-window';
import { HIDDEN_MOBILE_HEADERS } from '../../constants';
import EmptyState from './EmptyState';
import DesktopRow from '../datatable/DesktopRow';
import MobileCard from '../datatable/MobileCard';
import { RowData, DataTableProps } from '../datatable/types';
import ImagePreviewModal from '../modals/ImagePreviewModal';

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

const DataTable: React.FC<DataTableProps> = ({ headers, data, onViewDayDetails, onViewOrderDetails, onResyncOrder, autoHeight = false, mobileRowHeight, forceCardView = false, mobileBreakpoint = 768, columnWidths, scrollParentId, onRowClick }) => {
    const [sortColumn, setSortColumn] = useState<number | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);
    const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Config for window scrolling
    const useWindowScroll = autoHeight;
    const listRef = React.useRef<List>(null);
    const varListRef = React.useRef<VariableSizeList>(null);
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

    // Reset VariableSizeList cache khi data/sort thay đổi
    // (VariableSizeList cache item sizes — phải reset khi data rows đổi)
    React.useEffect(() => {
        if (varListRef.current) {
            varListRef.current.resetAfterIndex(0);
        }
    }, [sortedData]);

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

    // ⚠️ ALL HOOKS MUST BE DECLARED BEFORE ANY EARLY RETURN (React Rules of Hooks)
    // isMobile depends on width which may be 0 initially - that's fine, hooks still run
    const isMobile = width < mobileBreakpoint || forceCardView;

    /**
     * Tính chiều cao động cho mỗi mobile card dựa trên số field có data.
     */
    const getMobileItemHeight = useCallback((index: number): number => {
        const BASE_HEIGHT = 165;
        const GRID_ROW_H = 44;
        const FALLBACK_H = mobileRowHeight || 280;

        if (!isMobile) return 92;

        const row = sortedData[index];
        if (!row) return FALLBACK_H;

        const findH = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

        // === SUPPORT LAYOUT (Message / Help Kind) ===
        const msgIdx = findH('message') !== -1 ? findH('message') : findH('help kind');
        const hasSupportLayout = msgIdx !== -1 && (findH('order number') !== -1 || findH('order id') !== -1);

        if (hasSupportLayout) {
            const SUPPORT_BASE = 124; // header + footer + padding
            const LINE_H = 22;  // leading-relaxed 14px ≈ 22px/line
            const CHARS_PER_LINE = 36;  // ký tự/dòng tại font 14px, ~320px width

            const msgVal = String(row[msgIdx] || '');
            const estimatedLines = msgVal.split('\n').reduce((acc, line) => {
                return acc + Math.max(1, Math.ceil((line.length || 1) / CHARS_PER_LINE));
            }, 0);

            return SUPPORT_BASE + estimatedLines * LINE_H + 8;
        }

        // === PRODUCT ORDER LAYOUT (Image) ===
        const hasImage = headers.some(h => h === 'Image');
        if (!hasImage) {
            // === GENERIC LAYOUT (Fulfill, Overview, Daily Breakdown, etc.) ===
            const GENERIC_BASE = 102; // title block + padding
            const GENERIC_ROW_H = 40;  // 1 grid row (label + value)
            const GRID_COLS = 2;   // mobile: grid-cols-2
            const EXTRA_LINE_H = 20;  // extra per wrapped value line
            const CHARS_PER_CELL = 18;  // ~148px cell / 14px font
            const ACTION_H = 48;  // "Click for details" button: border + pt-2 + btn ~36px

            const actionIdx2 = findH('action') !== -1 ? findH('action') : findH('details');
            const hasAction = actionIdx2 !== -1;
            let genericBodyCount = 0;
            let extraWrapHeight = 0;

            headers.forEach((h, i) => {
                if (i === 0 || i === actionIdx2 || h === 'DateTime') return;
                const val = row[i];
                if (val === null || val === '-' || val === '' || (val === 0 && !h.toLowerCase().includes('count'))) return;
                genericBodyCount++;

                // Extra height if value text wraps
                const strVal = typeof val === 'string' ? val : String(val || '');
                const lines = Math.ceil(strVal.length / CHARS_PER_CELL);
                if (lines > 1) extraWrapHeight += (lines - 1) * EXTRA_LINE_H;
            });

            const genericRows = Math.max(1, Math.ceil(genericBodyCount / GRID_COLS));
            const actionExtra = hasAction ? ACTION_H : 0;
            return GENERIC_BASE + genericRows * GENERIC_ROW_H + extraWrapHeight + actionExtra + 8;
        }

        const imageIdx = findH('image');
        const productIdx = findH('product name');
        const orderIdIdx = findH('order number') !== -1 ? findH('order number') : findH('order id');
        const actionIdx = findH('action') !== -1 ? findH('action') : findH('details');
        const dateTimeIdx = headers.indexOf('DateTime');
        const currencyIdx = findH('currency') !== -1 ? findH('currency') : findH('curren');
        const sourceIdx = findH('source');
        const accountIdx = findH('account');
        const dateIdx = findH('date');

        const specialSet = new Set(
            [imageIdx, productIdx, orderIdIdx, actionIdx, dateTimeIdx, currencyIdx, sourceIdx, accountIdx, dateIdx]
                .filter(i => i !== -1)
        );

        let bodyCount = 0;
        headers.forEach((h, i) => {
            if (specialSet.has(i) || h === 'DateTime' || h === 'Status') return;
            const val = row[i];
            if (h === 'Cost' && (val === null || val === '-' || val === '')) { bodyCount++; return; }
            if (val === null || val === '-' || val === '' || val === 'No') return;
            if (val === 0 && !h.toLowerCase().includes('count') && h !== 'Cost') return;
            bodyCount++;
        });

        const gridRows = Math.max(1, Math.ceil(bodyCount / 2));

        // Footer ch\u1ec9 hi\u1ec7n khi c\u00f3 account ho\u1eb7c date \u2014 n\u1ebfu kh\u00f4ng c\u00f3, b\u1ecf footer h\u1ecfi kh\u1ecfi BASE
        const FOOTER_H = 36;
        const hasFooter = accountIdx !== -1 || dateIdx !== -1;
        const effectiveBase = hasFooter ? BASE_HEIGHT : BASE_HEIGHT - FOOTER_H;

        return effectiveBase + gridRows * GRID_ROW_H;
    }, [sortedData, headers, isMobile, mobileRowHeight]);

    const totalMobileHeight = useMemo(() => {
        if (!isMobile) return 0;
        return sortedData.reduce((sum, _, i) => sum + getMobileItemHeight(i), 0);
    }, [sortedData, isMobile, getMobileItemHeight]);

    // ── Early returns (AFTER all hooks) ──────────────────────────────────────
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
                    <div className="animate-pulse">
                        {/* Header Skeleton */}
                        <div className="h-12 bg-gray-100/50 dark:bg-gray-700/50 rounded-t-lg w-full mb-0.5"></div>

                        {/* Row Skeletons */}
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="flex items-center px-4 py-3 space-x-4 border-b border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-800/50 h-[92px]">
                                {/* Image Placeholder */}
                                <div className="h-[60px] w-[60px] bg-gray-200 dark:bg-gray-700 rounded-md flex-shrink-0"></div>

                                {/* Content Placeholders */}
                                <div className="flex-1 grid grid-cols-12 gap-4">
                                    {/* Product Name & Order ID */}
                                    <div className="col-span-4 space-y-2">
                                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                                        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2"></div>
                                    </div>

                                    {/* Middle Columns (Values) */}
                                    <div className="col-span-2 hidden md:block">
                                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-full mt-1"></div>
                                    </div>
                                    <div className="col-span-2 hidden md:block">
                                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-2/3 mt-1"></div>
                                    </div>

                                    {/* End/Actions */}
                                    <div className="col-span-4 md:col-span-4 flex justify-end items-center gap-2">
                                        <div className="h-8 w-20 bg-gray-100 dark:bg-gray-800 rounded"></div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // (isMobile, getMobileItemHeight, totalMobileHeight already declared above)

    // Calculate height for List
    let listHeight = 0;
    if (autoHeight) {
        listHeight = isMobile ? totalMobileHeight : sortedData.length * 92;
    } else {
        listHeight = isMobile ? height : height - 48;
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
        columnWidths,
        onRowClick
    };

    return (
        <div className={rootClasses} ref={containerRef}>
            {/* Desktop Header - Sticky if Window Scroll */}
            {!isMobile && (
                <div
                    ref={headerRef}
                    className={`flex items-center bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 font-semibold text-xs text-gray-500 dark:text-gray-300 uppercase tracking-wider h-12 flex-shrink-0 z-20 ${useWindowScroll ? 'sticky top-0 shadow-sm' : 'pr-[8px]'}`}
                    style={{ width: width }}
                >
                    {headers.map((header, index) => {
                        const isHidden = isHiddenOnDesktopMobileView(header);
                        const canSort = header !== 'Image' && header !== 'Actions';
                        let headerCellClass = `${isHidden ? 'hidden lg:flex' : 'flex'} min-w-0 items-center h-full px-3 py-2 ${canSort ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600' : ''} transition-colors `;

                        switch (header) {
                            case 'Image':
                                headerCellClass += 'flex-none w-[95px] justify-center';
                                break;
                            case 'Product Name':
                                headerCellClass += 'flex-grow-[3] basis-1/4 ';
                                break;
                            case 'Order Number':
                            case 'Order ID':
                                headerCellClass += 'flex-1 basis-[110px]'; // Compact width for order numbers
                                break;
                            case 'Revenue':
                            case 'Cost':
                            case 'Currency':
                            case 'Curren':
                                headerCellClass += 'flex-1 basis-[80px]';
                                break;
                            case 'Message':
                            case 'Help Kind':
                                headerCellClass += 'flex-[2] basis-[250px]';
                                break;
                            case 'Fulfill':
                            case 'Account':
                                headerCellClass += 'flex-1 basis-[120px]';
                                break;
                            case 'DateTime':
                            case 'Date':
                                headerCellClass += 'flex-1 basis-[110px]'; // Increased width
                                break;
                            case 'Actions':
                                headerCellClass += 'flex-none w-[90px] justify-center'; // Decreased width
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
                {isMobile ? (
                    // Mobile: VariableSizeList — mỗi card tự tính chiều cao theo data
                    <VariableSizeList
                        ref={varListRef}
                        height={listHeight}
                        itemCount={sortedData.length}
                        itemSize={getMobileItemHeight}
                        width={width}
                        itemData={itemData}
                        overscanCount={10}
                        className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
                        style={useWindowScroll ? { overflow: 'visible' } : undefined}
                        outerElementType={useWindowScroll ? WindowScrollerOuter : undefined}
                    >
                        {MobileCard}
                    </VariableSizeList>
                ) : (
                    // Desktop: FixedSizeList — tất cả row 92px
                    <List
                        ref={listRef}
                        height={listHeight}
                        itemCount={sortedData.length}
                        itemSize={92}
                        width={width}
                        itemData={itemData}
                        overscanCount={40}
                        className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
                        style={useWindowScroll ? { overflow: 'visible' } : undefined}
                        outerElementType={useWindowScroll ? WindowScrollerOuter : undefined}
                    >
                        {DesktopRow}
                    </List>
                )}
            </div>
            <ImagePreviewModal
                imageUrl={previewImage}
                onClose={() => setPreviewImage(null)}
            />
        </div >
    );
};

export default DataTable;
