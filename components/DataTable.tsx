import React, { useState, useMemo, CSSProperties } from 'react';
import { FixedSizeList as List, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { HIDDEN_MOBILE_HEADERS } from '../constants';
import EmptyState from './EmptyState';
import Spinner from './Spinner';

// Define ListChildComponentProps manually since named import might fail in some environments
interface ListChildComponentProps<T = any> {
    index: number;
    style: CSSProperties;
    data: T;
    isScrolling?: boolean;
}

type SortDirection = 'asc' | 'desc' | null;

interface DataTableProps {
    headers: string[];
    data: (string | number | null | { type: 'button', label: string, id: string } | { type: 'image', src: string, alt: string, fullSrc?: string } | { type: 'action_group', actions: any[] })[][];
    onViewDayDetails?: (date: string) => void;
    onViewOrderDetails?: (recordId: string) => void;
    onResyncOrder?: (recordId: string) => Promise<void>;
    autoHeight?: boolean; // Prop to enable full-height rendering without internal scrolling
    mobileRowHeight?: number; // Prop to set custom row height for mobile view
}

interface RowData {
    items: any[][];
    headers: string[];
    loadingItems: Set<string>;
    onViewDayDetails?: (date: string) => void;
    onViewOrderDetails?: (recordId: string) => void;
    onResyncClick: (id: string) => void;
    onImageClick: (src: string) => void;
    isMobile: boolean;
}

// Helper to check if a header should be hidden on mobile (Only applied in Desktop View now)
const isHiddenOnDesktopMobileView = (header: string) => HIDDEN_MOBILE_HEADERS.includes(header);

const renderActionCell = (cell: any, cellIndex: number, loadingItems: Set<string>, onResyncClick: (id: string) => void, onViewOrderDetails?: (id: string) => void, onViewDayDetails?: (date: string) => void, rowData?: any[], isMobile: boolean = false) => {
    if (cell === 'Click for detail' && onViewDayDetails && rowData) {
        const date = rowData[0] as string;
        return (
            <button
                onClick={() => onViewDayDetails(date)}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-medium hover:underline focus:outline-none truncate"
                title={`View details for ${date}`}
            >
                {cell}
            </button>
        );
    }

    // Handle "Action Group"
    if (cell && typeof cell === 'object' && 'type' in cell && cell.type === 'action_group') {
        const actions = isMobile ? cell.actions.filter((a: any) => a.type !== 'resync') : cell.actions;
        return actions.map((action: any, i: number) => { // Directly return array of buttons
            if (action.type === 'view') {
                return (
                    <button
                        key={i}
                        onClick={() => onViewOrderDetails && onViewOrderDetails(action.id)}
                        className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 text-xs font-semibold transition-colors"
                    >
                        {action.label}
                    </button>
                );
            }
            if (action.type === 'resync') {
                const isLoading = loadingItems.has(action.id);
                return (
                    <button
                        key={i}
                        onClick={() => onResyncClick(action.id)}
                        className={`px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-xs font-semibold transition-colors flex items-center gap-1 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Resync Order"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <Spinner size="xs" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        )}

                    </button>
                );
            }
            return null;
        });
    }

    // Handle simple button
    if (cell && typeof cell === 'object' && 'type' in cell && cell.type === 'button') {
        return (
            <button
                onClick={() => onViewOrderDetails && onViewOrderDetails(cell.id)}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-medium hover:underline focus:outline-none truncate"
            >
                {cell.label}
            </button>
        );
    }

    return null;
}

const renderTextContent = (cell: any) => {
    return typeof cell === 'number'
        ? (cell === 0
            ? <span className="text-gray-300 dark:text-gray-600">0</span>
            : (Number.isInteger(cell)
                ? cell.toLocaleString('en-US')
                : cell.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        )
        : (typeof cell === 'string' ? cell : '');
}

// --- DESKTOP ROW RENDERER ---
const DesktopRow = ({ index, style, data }: ListChildComponentProps<RowData>) => {
    const { items, headers, loadingItems, onViewDayDetails, onViewOrderDetails, onResyncClick, onImageClick } = data;
    const row = items[index];

    return (
        <div
            style={style}
            className={`flex items-center border-b border-gray-200 dark:border-gray-700 ${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50'} hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}
        >
            {headers.map((header, cellIndex) => {
                const cell = row[cellIndex];
                const isHidden = isHiddenOnDesktopMobileView(header);

                const hiddenClass = isHidden ? 'hidden lg:flex' : 'flex';

                let cellClass = `${hiddenClass} text-sm items-center h-full overflow-hidden px-3 py-2 `; // Changed py-1 to py-2

                // --- NEW: Column-specific styling ---
                switch (header) {
                    case 'Image':
                        cellClass += 'flex-none w-[95px] justify-center'; // 75px + padding
                        break;
                    case 'Product Name':
                        cellClass += 'flex-grow-[3] basis-1/4'; // Give it more weight
                        break;
                    case 'Order Number':
                        cellClass += 'flex-grow-[2] basis-1/6';
                        break;
                    case 'Revenue':
                    case 'Cost':
                    case 'Currency':
                        cellClass += 'flex-1 basis-[80px]';
                        break;
                    default:
                        cellClass += 'flex-1 basis-[120px]';
                        break;
                }

                // Check if complex object
                if (cell && typeof cell === 'object') {
                    if (cell.type === 'image') {
                        return (
                            <div key={cellIndex} className={cellClass}>
                                {cell.src ? (
                                    <img src={cell.src} alt={cell.alt} onClick={() => cell.fullSrc && onImageClick(cell.fullSrc)} className="w-[75px] h-[75px] object-cover rounded-md border border-gray-200 dark:border-gray-600 cursor-pointer transition-transform hover:scale-105" />
                                ) : (
                                    <div className="w-[75px] h-[75px] bg-gray-200 dark:bg-gray-700 rounded-md flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 text-center p-1">No Image</div>
                                )}
                            </div>
                        )
                    }
                    if (cell.type === 'button' || cell.type === 'action_group') {
                        return (
                            <div key={cellIndex} className={cellClass}>
                                {renderActionCell(cell, cellIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row)}
                            </div>
                        )
                    }
                }

                if (cell === 'Click for detail') {
                    return (
                        <div key={cellIndex} className={cellClass}>
                            {renderActionCell(cell, cellIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row)}
                        </div>
                    )
                }

                return (
                    <div
                        key={cellIndex}
                        className={`${cellClass} text-gray-800 dark:text-gray-200`}
                        title={header === 'Product Name' && typeof cell === 'string' ? cell : undefined}
                    >
                        <span className="truncate w-full">
                            {renderTextContent(cell)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

// --- MOBILE CARD RENDERER ---
const MobileCard = ({ index, style, data }: ListChildComponentProps<RowData>) => {
    const { items, headers, loadingItems, onViewDayDetails, onViewOrderDetails, onResyncClick, onImageClick, isMobile } = data;
    const row = items[index];

    const findIdx = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

    const imageIndex = findIdx('Image');
    const hasProductImage = imageIndex !== -1;

    const actionIndex = findIdx('Actions') !== -1 ? findIdx('Actions') : findIdx('Details');
    const actions = actionIndex !== -1 ? row[actionIndex] : null;

    // --- Conditional layout ---

    if (hasProductImage) {
        // DETAILED PRODUCT/ORDER LAYOUT
        const productIndex = findIdx('Product Name');
        const orderIdIndex = findIdx('Order Number');
        const dateTimeIndex = headers.indexOf('DateTime'); // Find DateTime header index

        const imageCell = row[imageIndex];
        const productValue = productIndex !== -1 ? row[productIndex] : 'N/A';
        const orderIdValue = orderIdIndex !== -1 ? row[orderIdIndex] : 'N/A';
        const dateTimeValue = dateTimeIndex !== -1 ? row[dateTimeIndex] : null; // Get DateTime value

        const specialIndexes = new Set([imageIndex, productIndex, orderIdIndex, actionIndex, dateTimeIndex]);
        const bodyItems = headers
            .map((h, i) => {
                if (specialIndexes.has(i) || h === 'DateTime') return null;
                let val = row[i];
                if (val === null || val === '-' || val === '' || (val === 0 && !h.toLowerCase().includes('count'))) return null;
                return { h, val, i };
            })
            .filter((item): item is { h: string; val: any; i: number } => item !== null);

        return (
            <div style={style} className="px-4 py-2">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 h-full flex flex-col justify-between">
                    <div className="flex gap-4 mb-3 items-start">
                        {imageCell?.src ? (
                            <img src={imageCell.src} alt={imageCell.alt} onClick={() => imageCell.fullSrc && onImageClick(imageCell.fullSrc)} className="w-[75px] h-[75px] object-cover rounded-md border border-gray-200 dark:border-gray-600 cursor-pointer transition-transform hover:scale-105" />
                        ) : (
                            <div className="w-[75px] h-[75px] bg-gray-200 dark:bg-gray-700 rounded-md flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 text-center p-1">No Image</div>
                        )}
                        <div className="flex-grow min-w-0">
                            <div className="pb-1">
                                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Order #{orderIdValue}</span>
                                <h4 className="text-base font-bold text-gray-900 dark:text-white leading-tight mt-0.5 truncate" title={String(productValue)}>
                                    {renderTextContent(productValue)}
                                </h4>
                                {dateTimeValue && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{renderTextContent(dateTimeValue)}</p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3 flex-grow content-start border-t border-gray-100 dark:border-gray-700 pt-3">
                        {bodyItems.map((item) => {
                            const isMoney = typeof item.val === 'number' && (item.h.includes('Revenue') || item.h.includes('Cost') || item.h.includes('Amount'));
                            const valueClass = isMoney ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-700 dark:text-gray-300';
                            return (
                                <div key={item.i} className="flex flex-col min-w-0">
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate" title={item.h}>{item.h}</span>
                                    <span className={`text-sm truncate ${valueClass}`}>{renderTextContent(item.val)}</span>
                                </div>
                            )
                        })}
                    </div>
                    {actions && (
                        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 mt-auto flex justify-end flex-wrap gap-2">
                            {renderActionCell(actions, actionIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row, isMobile)}
                        </div>
                    )}
                </div>
            </div>
        );

    } else {
        // GENERIC LAYOUT (for Overview, Summary, etc.)
        const titleHeader = headers[0];
        const titleValue = row[0];

        const bodyItems = headers.map((h, i) => {
            if (i === 0 || i === actionIndex || h === 'DateTime') return null;
            let val = row[i];
            if (val === null || val === '-' || val === '' || (val === 0 && !h.toLowerCase().includes('count'))) return null;
            return { h, val, i };
        }).filter((item): item is { h: string; val: any; i: number } => item !== null);

        return (
            <div style={style} className="px-4 py-2">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 h-full flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-3 border-b border-gray-100 dark:border-gray-700 pb-2">
                        <div className="w-full">
                            <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">{titleHeader}</span>
                            <h4 className="text-lg font-bold text-gray-900 dark:text-white truncate" title={String(titleValue)}>
                                {renderTextContent(titleValue)}
                            </h4>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-2 mb-3 flex-grow overflow-y-auto content-start">
                        {bodyItems.map((item) => {
                            if (item.val === 'Click for detail') return null;
                            const isMoney = typeof item.val === 'number' && (item.h.includes('Revenue') || item.h.includes('Funds') || item.h.includes('Cost'));
                            const valueClass = isMoney ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-700 dark:text-gray-300 font-medium';
                            return (
                                <div key={item.i} className="flex flex-col min-w-0">
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate" title={item.h}>{item.h}</span>
                                    <span className={`text-sm truncate ${valueClass}`}>{renderTextContent(item.val)}</span>
                                </div>
                            )
                        })}
                    </div>
                    {actions && (
                        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 mt-auto flex justify-end flex-wrap gap-2">
                            {renderActionCell(actions, actionIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row, isMobile)}
                        </div>
                    )}
                </div>
            </div>
        );
    }
};

// Wrap Row components with React.memo to prevent unnecessary re-renders
const MemoizedDesktopRow = React.memo(DesktopRow, areEqual);
const MemoizedMobileCard = React.memo(MobileCard, areEqual);

const DataTable: React.FC<DataTableProps> = ({ headers, data, onViewDayDetails, onViewOrderDetails, onResyncOrder, autoHeight = false, mobileRowHeight }) => {
    const [sortColumn, setSortColumn] = useState<number | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);
    const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());
    const [previewImage, setPreviewImage] = useState<string | null>(null);

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
            let valA = a[sortColumn];
            let valB = b[sortColumn];

            if (valA && typeof valA === 'object') {
                if ('type' in valA && valA.type === 'button') valA = valA.label;
                else if ('type' in valA && valA.type === 'image') valA = valA.alt;
                else if ('type' in valA && valA.type === 'action_group') valA = '';
            }
            if (valB && typeof valB === 'object') {
                if ('type' in valB && valB.type === 'button') valB = valB.label;
                else if ('type' in valB && valB.type === 'image') valB = valB.alt;
                else if ('type' in valB && valB.type === 'action_group') valB = '';
            }

            const isNumericA = typeof valA === 'number';
            const isNumericB = typeof valB === 'number';

            const isValANull = valA === null || valA === undefined;
            const isValBNull = valB === null || valB === undefined;

            if (isValANull && isValBNull) return 0;
            if (isValANull) return sortDirection === 'asc' ? 1 : -1;
            if (isValBNull) return sortDirection === 'asc' ? -1 : 1;

            if (isNumericA && isNumericB) {
                return sortDirection === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
            }

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();

            if (strA < strB) return sortDirection === 'asc' ? -1 : 1;
            if (strA > strB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, sortColumn, sortDirection]);

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
    // If autoHeight is true, remove 'h-full' and 'overflow-hidden' to allow expansion
    const rootClasses = `flex flex - col ${autoHeight ? '' : 'h-full'} bg - white dark: bg - gray - 800 rounded - lg shadow border border - gray - 200 dark: border - gray - 700 ${autoHeight ? '' : 'overflow-hidden'} `;

    return (
        <div className={rootClasses}>
            <AutoSizer disableHeight={autoHeight as any}>
                {({ height, width }: { height: number; width: number }) => {
                    // Safety check for width
                    if (!width) return null;
                    // If NOT autoHeight, height is required
                    if (!autoHeight && !height) return null;

                    const isMobile = width < 768; // Mobile Breakpoint
                    const itemSize = isMobile ? (mobileRowHeight || 250) : 92;
                    const RowComponent = isMobile ? MemoizedMobileCard : MemoizedDesktopRow;

                    // Calculate height for List
                    // If autoHeight, use content height. 
                    // If normal, use container height (minus header on desktop).
                    let listHeight = 0;
                    if (autoHeight) {
                        listHeight = sortedData.length * itemSize;
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
                        isMobile
                    };

                    return (
                        <>
                            {/* Desktop Header - Only show if not mobile */}
                            {!isMobile && (
                                <div className="flex items-center bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 font-semibold text-xs text-gray-500 dark:text-gray-300 uppercase tracking-wider h-12 flex-shrink-0 z-10" style={{ width: width }}>
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
                                                headerCellClass += 'flex-grow-[2] basis-1/6';
                                                break;
                                            case 'Revenue':
                                            case 'Cost':
                                            case 'Currency':
                                                headerCellClass += 'flex-1 basis-[80px]';
                                                break;
                                            default:
                                                headerCellClass += 'flex-1 basis-[120px]';
                                                break;
                                        }

                                        return (
                                            <div
                                                key={header}
                                                className={headerCellClass}
                                                onClick={() => canSort && handleSort(index)}
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
                            <div style={{ height: listHeight, width: width }}>
                                <List
                                    height={listHeight}
                                    itemCount={sortedData.length}
                                    itemSize={itemSize}
                                    width={width}
                                    itemData={itemData}
                                    className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
                                    style={autoHeight ? { overflow: 'hidden' } : undefined} // Hide inner scrollbar if autoHeight
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