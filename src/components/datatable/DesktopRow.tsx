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
            className={`flex items-center border-b border-gray-100 dark:border-gray-800 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors duration-150 ${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-800/80'} group`}
        >
            {/* Hover indicator strip */}
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 transform scale-y-0 group-hover:scale-y-100 transition-transform origin-left"></div>

            {headers.map((header, cellIndex) => {
                const cell = row[cellIndex];
                const isHidden = isHiddenOnDesktopMobileView(header);

                const hiddenClass = isHidden ? 'hidden lg:flex' : 'flex';

                const cellClassBase = `${hiddenClass} text-sm items-center h-full overflow-hidden px-3 py-2 text-gray-700 dark:text-gray-300 min-w-0 `;
                let cellClass = cellClassBase;

                // --- NEW: Column-specific styling ---
                switch (header) {
                    case 'Image':
                        cellClass += 'flex-none w-[95px] justify-center'; // 75px + padding
                        break;
                    case 'Product Name':
                        cellClass += 'flex-grow-[3] basis-1/4 font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200'; // Added hover effect
                        break;
                    case 'Order Number':
                    case 'Order ID':
                        cellClass += 'flex-1 basis-[110px] font-semibold text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200';
                        break;
                    case 'Revenue':
                    case 'Cost':
                    case 'Currency':
                    case 'Curren':
                        cellClass += 'flex-1 basis-[80px] font-medium group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'; // Added revenue hover color
                        break;
                    case 'Message':
                    case 'Help Kind':
                        cellClass += 'flex-[2] basis-[250px] italic text-gray-500';
                        break;
                    case 'Status':
                        cellClass += 'flex-none w-[95px] justify-center'; // Reduced width for badge
                        break;
                    case 'DateTime':
                    case 'Date':
                        cellClass += 'flex-1 basis-[110px]'; // Increased width for full timestamp
                        break;
                    case 'Actions':
                        cellClass += 'flex-none w-[90px] justify-center'; // Decreased width
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
                                    <CachedImage src={cell.src} alt={cell.alt} onClick={() => cell.fullSrc && onImageClick(cell.fullSrc)} className="w-[60px] h-[60px] object-cover rounded-md border border-gray-200 dark:border-gray-600 cursor-pointer shadow-sm group-hover:shadow-md hover:scale-110 transition-transform duration-200" />
                                ) : (
                                    <div className="w-[60px] h-[60px] bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center text-[10px] text-gray-400 dark:text-gray-500 text-center p-1 border border-dashed border-gray-300 dark:border-gray-600">No Image</div>
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
                    );
                }

                // Render Status as badge
                if (header === 'Status') {
                    const statusValue = String(cell || 'New').trim();
                    let badgeClass = 'px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ';

                    if (statusValue === 'Refunded') {
                        badgeClass += 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800';
                    } else {
                        // New or default
                        badgeClass += 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800';
                    }

                    return (
                        <div key={cellIndex} className={cellClass} style={customStyle}>
                            <span className={badgeClass}>{statusValue}</span>
                        </div>
                    );
                }

                // Render text with subtitle
                if (cell && typeof cell === 'object' && cell.type === 'text_with_subtitle') {
                    return (
                        <div key={cellIndex} className={cellClass} style={customStyle}>
                            <div className="flex flex-col">
                                <span className="font-medium">{cell.main}</span>
                                <span className={`text-[10px] mt-0.5 ${cell.subtitleClass || 'text-gray-500 dark:text-gray-400'}`}>
                                    {cell.subtitle}
                                </span>
                            </div>
                        </div>
                    );
                }

                // Default cell rendering
                return (
                    <div
                        key={cellIndex}
                        className={cellClass}
                        title={(header === 'Product Name' || header === 'Message' || header === 'Message / Type') && typeof cell === 'string' ? cell : undefined}
                        style={customStyle}
                    >
                        <span className="truncate w-full block">
                            {renderTextContent(cell)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

export default React.memo(DesktopRow);
