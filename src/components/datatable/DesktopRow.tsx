import React from 'react';
import Spinner from '../Spinner';
import CachedImage from './CachedImage';
import { ListChildComponentProps, RowData } from './types';
import { HIDDEN_MOBILE_HEADERS } from '../../constants';

// Helper to check if a header should be hidden on mobile (Only applied in Desktop View now)
const isHiddenOnDesktopMobileView = (header: string) => HIDDEN_MOBILE_HEADERS.includes(header);

const renderActionCell = (cell: any, _cellIndex: number, loadingItems: Set<string>, onResyncClick: (id: string) => void, onViewOrderDetails?: (id: string) => void, onViewDayDetails?: (date: string) => void, rowData?: any[]) => {
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
        const actions = cell.actions;
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
                onClick={() => onViewDayDetails && onViewDayDetails(cell.id)}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-medium hover:underline focus:outline-none truncate"
                title={`View details for ${cell.id}`}
            >
                {cell.label}
            </button>
        );
    }

    return null;
}

const renderTextContent = (cell: any) => {
    if (cell && typeof cell === 'object' && cell.type === 'value_with_unit') {
        if (cell.value === 0 || cell.display === '--') {
            return <span className="text-gray-300 dark:text-gray-600">--</span>;
        }
        return cell.display;
    }
    return typeof cell === 'number'
        ? (cell === 0
            ? <span className="text-gray-300 dark:text-gray-600">--</span>
            : (Number.isInteger(cell)
                ? cell.toLocaleString('en-US')
                : cell.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        )
        : (typeof cell === 'string' ? cell : '');
}

const DesktopRow = ({ index, style, data }: ListChildComponentProps<RowData>) => {
    const { items, headers, loadingItems, onViewDayDetails, onViewOrderDetails, onResyncClick, onImageClick, columnWidths } = data;
    const row = items[index];

    return (
        <div
            style={{ ...style, willChange: 'transform' }}
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
                        cellClass += 'flex-1 basis-[110px]'; // Compact width for order numbers
                        break;
                    case 'Revenue':
                    case 'Cost':
                    case 'Currency':
                        cellClass += 'flex-1 basis-[80px]';
                        break;
                    case 'Message':
                    case 'Help Kind':
                        cellClass += 'flex-[2] basis-[250px]';
                        break;
                    default:
                        cellClass += 'flex-1 basis-[120px]';
                        break;
                }

                // Apply custom width if provided
                const customStyle = columnWidths && columnWidths[header]
                    ? { flexBasis: `${columnWidths[header]}px`, minWidth: `${columnWidths[header]}px` }
                    : undefined;

                // Check if complex object
                if (cell && typeof cell === 'object') {
                    if (cell.type === 'image') {
                        return (
                            <div key={cellIndex} className={cellClass} style={customStyle}>
                                {cell.src ? (
                                    <CachedImage src={cell.src} alt={cell.alt} onClick={() => cell.fullSrc && onImageClick(cell.fullSrc)} className="w-[75px] h-[75px] object-cover rounded-md border border-gray-200 dark:border-gray-600 cursor-pointer hover:scale-105 transition-transform" />
                                ) : (
                                    <div className="w-[75px] h-[75px] bg-gray-200 dark:bg-gray-700 rounded-md flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 text-center p-1">No Image</div>
                                )}
                            </div>
                        )
                    }
                    if (cell.type === 'button' || cell.type === 'action_group') {
                        return (
                            <div key={cellIndex} className={cellClass} style={customStyle}>
                                {renderActionCell(cell, cellIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row)}
                            </div>
                        )
                    }
                }

                if (cell === 'Click for detail') {
                    return (
                        <div key={cellIndex} className={cellClass} style={customStyle}>
                            {renderActionCell(cell, cellIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row)}
                        </div>
                    )
                }

                return (
                    <div
                        key={cellIndex}
                        className={`${cellClass} text-gray-800 dark:text-gray-200`}
                        title={(header === 'Product Name' || header === 'Message' || header === 'Message / Type') && typeof cell === 'string' ? cell : undefined}
                        style={customStyle}
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

export default React.memo(DesktopRow);
