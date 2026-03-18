import React from 'react';
import Spinner from '../ui/Spinner';
import CachedImage from './CachedImage';
import { getHighResImageUrl } from '../../utils/imageUtils';
import { ListChildComponentProps, RowData } from './types';
import { HIDDEN_MOBILE_HEADERS } from '../../constants';
import { getColumnStyle } from '../../constants/columnConfigs';

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

const renderTextContent = (cell: any, selectedKeys?: Set<string>, onToggleSelect?: (key: string) => void) => {
    if (cell && typeof cell === 'object' && cell.type === 'value_with_unit') {
        if (cell.value === 0 || cell.display === '--') {
            return <span className="text-gray-300 dark:text-gray-600">--</span>;
        }
        return cell.display;
    }

    if (cell && typeof cell === 'object' && cell.type === 'checkbox') {
        const isChecked = cell.checked !== undefined ? cell.checked : (selectedKeys && cell.idKey ? selectedKeys.has(cell.idKey) : false);
        const handleCheck = (e: React.ChangeEvent<HTMLInputElement>) => {
            if (cell.onChange) {
                cell.onChange(e.target.checked);
            } else if (onToggleSelect && cell.idKey) {
                onToggleSelect(cell.idKey);
            }
        };

        return (
            <input
                type="checkbox"
                checked={isChecked}
                onChange={handleCheck}
                onClick={(e) => e.stopPropagation()} // Prevent row click
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
        );
    }

    if (cell && typeof cell === 'object' && cell.type === 'mapping_select') {
        return (
            <select
                title="Select Category"
                className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={cell.value === 'Unmapped' ? '' : cell.value}
                onChange={(e) => cell.onCategoryChange(cell.name, cell.variant, e.target.value)}
                onClick={(e) => e.stopPropagation()}
            >
                <option value="">-- Unmapped --</option>
                {[...cell.categories].sort((a, b) => a.name.localeCompare(b.name)).map((cat: any) => (
                    <option key={cat.code} value={cat.code}>
                        {cat.name}
                    </option>
                ))}
            </select>
        );
    }

    if (cell && typeof cell === 'object' && cell.type === 'mapping_action') {
        return (
            <button
                onClick={async (e) => {
                    e.stopPropagation();
                    const code = prompt(`Enter category code for "${cell.name}":`, cell.currentCategory === 'Unmapped' ? '' : cell.currentCategory);
                    if (code) await cell.onCategoryChange(cell.name, cell.variant, code.toUpperCase());
                }}
                className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                title="Manual Entry"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
            </button>
        );
    }

    return typeof cell === 'number'
        ? (cell === 0
            ? <span className="text-gray-300 dark:text-gray-600">--</span>
            : (Number.isInteger(cell)
                ? cell.toLocaleString('en-US')
                : cell.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        )
        : (typeof cell === 'string' ? cell : cell); // Fallback to cell itself if it's a React Node or unknown object
}

const DesktopRow = ({ index, style, data }: ListChildComponentProps<RowData>) => {
    const { items, headers, loadingItems, onViewDayDetails, onViewOrderDetails, onResyncClick, onImageClick, columnWidths, onRowClick } = data;
    const row = items[index];

    // isRefunded is stored as last hidden element (index 16)
    const isRefunded = row[row.length - 1] === true;

    // Row background: refunded = light red, others = alternating white/gray
    const rowBg = isRefunded
        ? 'bg-red-50 dark:bg-red-900/15'
        : (index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-800/80');

    return (
        <div
            style={{ ...style, willChange: 'transform' }}
            className={`relative flex items-center border-b text-sm transition-colors duration-150 group ${onRowClick ? 'cursor-pointer' : ''} ${isRefunded
                ? 'border-red-200 dark:border-red-900/40 hover:bg-red-100/60 dark:hover:bg-red-950/30'
                : 'border-gray-100 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/10'
                } ${rowBg}`}
            onClick={() => onRowClick && onRowClick(row)}
        >
            {/* Hover/refund indicator strip */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 transform transition-all duration-150 origin-left ${isRefunded
                ? 'bg-red-400 dark:bg-red-600 scale-y-100'
                : 'bg-blue-500 scale-y-0 group-hover:scale-y-100'
                }`} />

            {headers.map((header, cellIndex) => {
                const cell = row[cellIndex];
                const isHidden = isHiddenOnDesktopMobileView(header);

                const hiddenClass = isHidden ? 'hidden lg:flex' : 'flex';

                const cellClassBase = `${hiddenClass} text-sm items-center h-full overflow-hidden px-3 py-2 text-gray-700 dark:text-gray-300 min-w-0 `;
                let cellClass = cellClassBase;

                // Use centralized column config
                const config = getColumnStyle(header);
                if (config.justify) cellClass += `justify-${config.justify} `;

                // Special styling based on column type
                if (header === 'Product Name') {
                    cellClass += 'font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200';
                } else if (header === 'Order Number' || header === 'Order ID') {
                    cellClass += 'font-semibold text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200';
                } else if (['Revenue', 'Cost', 'Cost (USD)', 'Currency', 'Curren'].includes(header)) {
                    cellClass += `font-medium group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors ${isRefunded ? 'text-gray-400 dark:text-gray-500' : ''}`;
                } else if (header === 'Message' || header === 'Help Kind') {
                    cellClass += 'italic text-gray-500';
                }

                // Apply dynamic flex styles
                const customStyle = {
                    flexGrow: config.flexGrow ?? 1,
                    flexShrink: 0,
                    flexBasis: config.basis.includes('/') ? `${(eval(config.basis) * 100)}%` : config.basis,
                    ...(columnWidths && columnWidths[header] ? { minWidth: `${columnWidths[header]}px`, flexBasis: `${columnWidths[header]}px` } : {})
                };


                // 1. First Priority: Check for complex object types
                if (cell && typeof cell === 'object') {
                    if (cell.type === 'image') {
                        return (
                            <div key={cellIndex} className={cellClass} style={customStyle} onClick={(e) => e.stopPropagation()}>
                                {cell.src ? (
                                    <CachedImage src={cell.src} alt={cell.alt} onClick={() => onImageClick(cell.fullSrc || getHighResImageUrl(cell.src) || cell.src)} className="w-[60px] h-[60px] object-cover rounded-md border border-gray-200 dark:border-gray-600 cursor-pointer shadow-sm group-hover:shadow-md hover:scale-110 transition-transform duration-200" />
                                ) : (
                                    <div className="w-[60px] h-[60px] bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center text-[10px] text-gray-400 dark:text-gray-500 text-center p-1 border border-dashed border-gray-300 dark:border-gray-600">No Image</div>
                                )}
                            </div>
                        )
                    }
                    if (cell.type === 'button' || cell.type === 'action_group') {
                        return (
                            <div key={cellIndex} className={cellClass} style={customStyle} onClick={(e) => e.stopPropagation()}>
                                {renderActionCell(cell, cellIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row)}
                            </div>
                        )
                    }
                    if (cell.type === 'checkbox') {
                        return (
                            <div key={cellIndex} className={cellClass} style={customStyle}>
                                {renderTextContent(cell, data.selectedKeys, data.onToggleSelect)}
                            </div>
                        )
                    }
                    if (cell.type === 'text_with_subtitle') {
                         return (
                            <div key={cellIndex} className={cellClass} style={customStyle}>
                                <div className="flex flex-col min-w-0">
                                    <span className="font-semibold truncate">{cell.main}</span>
                                    <span className={`text-[10px] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${cell.subtitleClass || 'text-gray-500 dark:text-gray-400'}`}>
                                        {cell.subtitle}
                                    </span>
                                </div>
                            </div>
                        );
                    }
                }

                // 2. Second Priority: Special Headers with specific layout but potentially simple values
                if (header === 'Order ID' || header === 'Order Number') {
                    return (
                        <div key={cellIndex} className={cellClass} style={customStyle}>
                            <div className="flex flex-col min-w-0">
                                <span className="truncate">{typeof cell === 'object' ? cell.main : String(cell || '')}</span>
                                {isRefunded && !cell?.type && (
                                    <span className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                                        <span>↩</span>
                                        <span>Refunded</span>
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                }

                if (cell === 'Click for detail') {
                    return (
                        <div key={cellIndex} className={cellClass} style={customStyle}>
                            {renderActionCell(cell, cellIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row)}
                        </div>
                    );
                }


                // Default cell rendering
                return (
                    <div
                        key={cellIndex}
                        className={cellClass}
                        title={(header === 'Product Name' || header === 'Variant' || header === 'Message' || header === 'Message / Type') && typeof cell === 'string' ? cell : undefined}
                        style={customStyle}
                    >
                        <span className="truncate w-full block">
                            {renderTextContent(cell, data.selectedKeys, data.onToggleSelect)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

export default React.memo(DesktopRow);
