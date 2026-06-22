import React, { useState, useMemo, useLayoutEffect, useCallback } from 'react';
import { compareValues, SortDirection } from '../../utils/sortUtils';
import { FixedSizeList as List, VariableSizeList } from 'react-window';
import { HIDDEN_MOBILE_HEADERS } from '../../constants';
import { getColumnStyle } from '../../constants/columnConfigs';
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
                setSize(prev => {
                    // Ignore sub-pixel changes to prevent ResizeObserver infinite loops
                    if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
                        return prev;
                    }
                    return { width, height };
                });
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

const DataTable: React.FC<DataTableProps> = ({ headers, data, onViewDayDetails, onViewOrderDetails, onResyncOrder, autoHeight = false, mobileRowHeight, forceCardView = false, mobileBreakpoint = 768, columnWidths, scrollParentId, onRowClick, onItemsRendered, selectedKeys, onToggleSelect }) => {
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

    const handleResyncClick = useCallback(async (id: string) => {
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
    }, [onResyncOrder]);

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

    // isMobile detection: more robust by checking both container and window width
    // Initialize with a safe guess to avoid flickering
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.innerWidth < mobileBreakpoint || forceCardView;
        }
        return forceCardView;
    });

    React.useEffect(() => {
        const updateDeviceType = () => {
            const currentWidth = (width > 0) ? width : (typeof window !== 'undefined' ? window.innerWidth : 0);
            if (currentWidth > 0) {
                const nextIsMobile = currentWidth < mobileBreakpoint || forceCardView;
                if (nextIsMobile !== isMobile) {
                    setIsMobile(nextIsMobile);
                }
            }
        };

        updateDeviceType();
        
        // Window resize specifically to handle manual browser scaling
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', updateDeviceType);
            return () => window.removeEventListener('resize', updateDeviceType);
        }
    }, [width, mobileBreakpoint, forceCardView, isMobile]);

    // Reset VariableSizeList cache khi data/sort/width thay đổi
    // (VariableSizeList cache item sizes — phải reset khi data hoặc width đổi)
    React.useEffect(() => {
        if (varListRef.current) {
            varListRef.current.resetAfterIndex(0);
        }
    }, [sortedData, width, isMobile]);

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

        // --- Helper: Count lines including subtitles ---
        const getExtraHeight = (val: any, charsPerLine: number, lineH: number) => {
            if (!val) return 0;
            let str = '';
            let subtitleExtra = 0;
            if (typeof val === 'object' && val.type === 'text_with_subtitle') {
                str = String(val.main || '');
                if (val.subtitle) subtitleExtra = lineH;
            } else {
                str = String(val);
            }
            const lines = Math.ceil(str.length / charsPerLine);
            return (Math.max(0, lines - 1) * lineH) + subtitleExtra;
        };

        const findH = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

        // === SUPPORT LAYOUT (Message / Help Kind) ===
        const msgIdx = findH('message') !== -1 ? findH('message') : findH('help kind');
        const hasSupportLayout = msgIdx !== -1 && (findH('order number') !== -1 || findH('order id') !== -1);

        if (hasSupportLayout) {
            const SUPPORT_BASE = 124; // header + footer + padding
            const LINE_H = 22;  // leading-relaxed 14px ≈ 22px/line
            const CHARS_PER_LINE = 36;  

            const msgVal = String(row[msgIdx] || '');
            const estimatedLines = msgVal.split('\n').reduce((acc, line) => {
                return acc + Math.max(1, Math.ceil((line.length || 1) / CHARS_PER_LINE));
            }, 0);

            return SUPPORT_BASE + estimatedLines * LINE_H + 8;
        }

        // === PRODUCT ORDER LAYOUT (Image) ===
        const imageIdx = findH('image');
        const hasImage = imageIdx !== -1;

        if (!hasImage) {
            // === GENERIC LAYOUT (Fulfill, Overview, Daily Breakdown, etc.) ===
            let genericBase = 102; // title block + padding
            const GENERIC_ROW_H = 40; 
            const EXTRA_LINE_H = 18;
            const CHARS_PER_CELL = 18;

            // Detect subtitle in header (Index 0)
            genericBase += getExtraHeight(row[0], 25, EXTRA_LINE_H);

            let GRID_COLS = 2;
            if (typeof window !== 'undefined') {
                const vw = window.innerWidth;
                if (vw >= 1024) GRID_COLS = 5;
                else if (vw >= 768) GRID_COLS = 4;
                else if (vw >= 640) GRID_COLS = 3;
            }

            const actionIdx2 = findH('action') !== -1 ? findH('action') : findH('details');
            const hasAction = actionIdx2 !== -1;
            let genericBodyCount = 0;
            let extraWrapHeight = 0;

            headers.forEach((h, i) => {
                if (i === 0 || i === actionIdx2 || h === 'DateTime') return;
                const val = row[i];
                const isFunds = h.toLowerCase().includes('funds');
                if (!isFunds && (val === null || val === '-' || val === '' || (val === 0 && !h.toLowerCase().includes('count')))) return;
                
                genericBodyCount++;
                extraWrapHeight += getExtraHeight(val, CHARS_PER_CELL, EXTRA_LINE_H);
            });

            const genericRows = Math.max(1, Math.ceil(genericBodyCount / GRID_COLS));
            const actionExtra = hasAction ? 48 : 0;
            return genericBase + genericRows * GENERIC_ROW_H + extraWrapHeight + actionExtra + 12;
        }



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
        
        // Calculate extra height for wrap/subtitle in product name or other fields
        let extraWrapHeight = 0;
        const EXTRA_LINE_H = 18;
        
        // Product name wrapping (capped at 2 lines by line-clamp-2)
        const productVal = productIdx !== -1 ? row[productIdx] : '';
        if (productVal) {
            const str = typeof productVal === 'object' ? String(productVal.main || '') : String(productVal);
            if (str.length > 30) extraWrapHeight += EXTRA_LINE_H; // ~30 chars per line in mobile layout
            if (typeof productVal === 'object' && productVal.subtitle) extraWrapHeight += EXTRA_LINE_H;
        }

        // Footer chỉ hiện khi có account hoặc date — nếu không có, bỏ footer hỏi khỏi BASE
        const FOOTER_H = 36;
        const hasFooter = accountIdx !== -1 || dateIdx !== -1;
        const effectiveBase = hasFooter ? BASE_HEIGHT : BASE_HEIGHT - FOOTER_H;

        return effectiveBase + gridRows * GRID_ROW_H + extraWrapHeight + 8;

    }, [sortedData, headers, isMobile, mobileRowHeight, width]);

    const totalMobileHeight = useMemo(() => {
        if (!isMobile) return 0;
        return sortedData.reduce((sum, _, i) => sum + getMobileItemHeight(i), 0);
    }, [sortedData, isMobile, getMobileItemHeight, width]);

    const itemData = useMemo<RowData>(() => ({
        items: sortedData,
        headers,
        loadingItems,
        onViewDayDetails,
        onViewOrderDetails,
        onResyncClick: handleResyncClick,
        onImageClick: setPreviewImage,
        isMobile,
        columnWidths,
        onRowClick,
        selectedKeys,
        onToggleSelect
    }), [sortedData, headers, loadingItems, onViewDayDetails, onViewOrderDetails, handleResyncClick, setPreviewImage, isMobile, columnWidths, onRowClick, selectedKeys, onToggleSelect]);

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
    const rootClasses = `flex flex-col w-full h-full min-h-0 overflow-hidden bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${autoHeight ? 'auto-height' : ''}`;


    // Calculate height for List
    let listHeight = 0;
    const measuredWidth = width || (containerRef.current?.offsetWidth) || 0;
    const measuredHeight = height || (containerRef.current?.offsetHeight) || 0;

    if (autoHeight) {
        listHeight = isMobile ? totalMobileHeight : sortedData.length * 92;
    } else {
        // Use a minimum height of 400 to prevent zero-height collapse
        // Ensure height matches the container minus header (48px)
        listHeight = isMobile ? Math.max(400, measuredHeight) : Math.max(400, measuredHeight - 48);
    }
    
    // Safety: ensure listHeight and width are non-negative
    const safeListHeight = Math.max(0, listHeight);
    const safeWidth = Math.max(0, measuredWidth);

    return (
        <div className={rootClasses} ref={containerRef}>
            {/* Desktop Header - Sticky if Window Scroll */}
            {!isMobile && (
                <div
                    ref={headerRef}
                    className={`flex items-center bg-indigo-50/40 dark:bg-indigo-950/20 border-b border-gray-200 dark:border-gray-700 font-bold text-xs text-gray-700 dark:text-gray-300 uppercase tracking-wider h-14 flex-shrink-0 z-20 ${useWindowScroll ? 'sticky top-0 shadow-sm backdrop-blur-md' : 'pr-[8px]'}`}
                    style={{ width: safeWidth || '100%' }}
                >
                    {headers.map((header, index) => {
                        const config = getColumnStyle(header);
                        const isHidden = isHiddenOnDesktopMobileView(header);
                        const canSort = header !== 'Image' && header !== 'Actions';
                        
                        let headerCellClass = `${isHidden ? 'hidden lg:flex' : 'flex'} min-w-0 items-center h-full px-4 py-2 ${canSort ? 'cursor-pointer hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10' : ''} transition-all duration-200 group `;
                        if (config.justify) headerCellClass += `justify-${config.justify} `;

                        const customHeaderStyle = {
                            flexGrow: config.flexGrow ?? 1,
                            flexShrink: 0,
                            flexBasis: config.basis.includes('/') ? `${(eval(config.basis) * 100)}%` : config.basis,
                            ...(columnWidths && columnWidths[header] ? { minWidth: `${columnWidths[header]}px`, width: `${columnWidths[header]}px`, flexBasis: `${columnWidths[header]}px` } : {})
                        };

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

            {/* Virtualized Body Wrapper */}
            <div className={`transition-opacity duration-300 ${width > 0 ? 'opacity-100' : 'opacity-100'}`}>
                <div style={{ height: useWindowScroll ? 'auto' : safeListHeight, width: safeWidth || '100%' }}>
                    {isMobile ? (
                        // Mobile: VariableSizeList — mỗi card tự tính chiều cao theo data
                        <VariableSizeList
                            ref={varListRef}
                            height={safeListHeight}
                            itemCount={sortedData.length}
                            itemSize={getMobileItemHeight}
                            width={safeWidth}
                            itemData={itemData}
                            overscanCount={10}
                            onItemsRendered={onItemsRendered}
                            className={isMobile ? "scrollbar-hide" : "scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"}
                            style={useWindowScroll ? { overflow: 'visible' } : undefined}
                            outerElementType={useWindowScroll ? WindowScrollerOuter : undefined}
                        >
                            {MobileCard}
                        </VariableSizeList>
                    ) : (
                        // Desktop: FixedSizeList — tất cả row 92px
                        <List
                            ref={listRef}
                            height={safeListHeight}
                            itemCount={sortedData.length}
                            itemSize={92}
                            width={safeWidth}
                            itemData={itemData}
                            overscanCount={20}
                            onItemsRendered={onItemsRendered}
                            className={isMobile ? "scrollbar-hide" : "scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"}
                            style={useWindowScroll ? { overflow: 'visible' } : undefined}
                            outerElementType={useWindowScroll ? WindowScrollerOuter : undefined}
                        >
                            {DesktopRow}
                        </List>
                    )}
                </div>
            </div>
            <ImagePreviewModal
                imageUrl={previewImage}
                onClose={() => setPreviewImage(null)}
            />
        </div>
    );
};

export default DataTable;
