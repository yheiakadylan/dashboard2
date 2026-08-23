import React from 'react';
import { Star } from 'lucide-react';
import Spinner from '../ui/Spinner';
import CachedImage from './CachedImage';
import { getHighResImageUrl } from '../../utils/imageUtils';
import { ListChildComponentProps, RowData } from './types';

const renderActionCell = (cell: any, _cellIndex: number, loadingItems: Set<string>, onResyncClick: (id: string) => void, onViewOrderDetails?: (id: string) => void, onViewDayDetails?: (date: string) => void, rowData?: any[], isMobile: boolean = false) => {
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
                        className="px-4 py-1.5 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 active:bg-blue-800 text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                        <span>View Details</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
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

const renderTrendArrow = (direction?: 'up' | 'down' | 'neutral') => {
    if (direction === 'up') {
        return <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>;
    }
    if (direction === 'down') {
        return <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>;
    }
    return null;
};

const getTrendDeltaClass = (direction?: 'up' | 'down' | 'neutral') => {
    if (direction === 'up') return 'text-emerald-600 dark:text-emerald-400';
    if (direction === 'down') return 'text-red-500 dark:text-red-400';
    return 'text-gray-500 dark:text-gray-400';
};

const renderTrendDelta = (cell: any, className = '') => {
    const direction = cell.subtitleDeltaDirection || cell.trendDirection;
    if (!cell.subtitleDelta) return null;

    return (
        <span className={`inline-flex items-center gap-0.5 font-bold ${getTrendDeltaClass(direction)} ${className}`}>
            {renderTrendArrow(direction)}
            <span>{cell.subtitleDelta}</span>
        </span>
    );
};

const renderStructuredSubtitle = (cell: any) => {
    if (!cell.subtitleLabel || cell.subtitleValue === undefined) {
        return cell.subtitle;
    }

    return (
        <span className="truncate">{cell.subtitleLabel}: {cell.subtitleValue}</span>
    );
};

const renderTextContent = (cell: any, selectedKeys?: Set<string>, onToggleSelect?: (key: string) => void) => {
    if (cell && typeof cell === 'object') {
        if (cell.type === 'checkbox') {
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
                    onClick={(e) => e.stopPropagation()}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
            );
        }
        if (cell.type === 'value_with_unit') {
            if (cell.value === 0 || cell.display === '--') {
                return <span className="text-gray-300 dark:text-gray-600">--</span>;
            }
            return cell.display;
        }
        if (cell.type === 'text_with_subtitle') {
            return (
                <span className="flex flex-col items-start leading-tight group">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span className={`text-[15px] font-bold truncate ${cell.mainClass || ''}`}>{cell.main}</span>
                        {renderTrendDelta(cell, 'text-[11px] shrink-0')}
                    </span>
                    {cell.subtitle && (
                        <span className={`text-[10px] ${cell.subtitleClass || 'text-gray-500'}`}>
                            {renderStructuredSubtitle(cell)}
                        </span>
                    )}
                    {cell.extraSubtitle && (
                        <span className={`text-[10px] ${cell.extraSubtitleClass || 'text-gray-500'}`}>
                            {cell.extraSubtitle}
                        </span>
                    )}
                </span>
            );
        }

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


const MobileCard = ({ index, style, data }: ListChildComponentProps<RowData>) => {
    const { items, headers, loadingItems, onViewDayDetails, onViewOrderDetails, onResyncClick, onImageClick, isMobile, onRowClick } = data;
    const row = items[index];

    // isRefunded is stored as last hidden element
    const isRefunded = row[row.length - 1] === true;

    const findIdx = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

    const imageIndex = findIdx('Image');
    const hasProductImage = imageIndex !== -1;

    // Use 'Action' (singular/plural via includes) to find column.
    const actionIndex = findIdx('Action') !== -1 ? findIdx('Action') : findIdx('Details');
    const actions = actionIndex !== -1 ? row[actionIndex] : null;

    // --- Conditional layout ---

    if (hasProductImage) {
        // DETAILED PRODUCT/ORDER LAYOUT
        const productIndex = findIdx('Product Name');
        const orderIdIndex = findIdx('Order Number') !== -1 ? findIdx('Order Number') : findIdx('Order ID');
        const sourceIndex = findIdx('Source');
        const dateTimeIndex = headers.indexOf('DateTime'); // Find DateTime header index

        const imageCell = row[imageIndex];
        const productValue = productIndex !== -1 ? row[productIndex] : 'N/A';
        const orderIdValue = orderIdIndex !== -1 ? row[orderIdIndex] : 'N/A';
        const sourceValue = sourceIndex !== -1 ? row[sourceIndex] : null;
        const currencyIndex = findIdx('Currency') !== -1 ? findIdx('Currency') : findIdx('Curren');
        const accountIndex = findIdx('Account');
        const dateIndex = findIdx('Date');
        const specialIndexes = new Set([imageIndex, productIndex, orderIdIndex, actionIndex, dateTimeIndex, currencyIndex, sourceIndex, accountIndex, dateIndex]);
        const accountValue = accountIndex !== -1 ? row[accountIndex] : null;
        const dateValue = dateIndex !== -1 ? row[dateIndex] : null;
        const bodyItems = headers
            .map((h, i) => {
                if (specialIndexes.has(i) || h === 'DateTime' || h === 'Status' || h === 'Select') return null; // skip redundant columns
                let val = row[i];
                if (h === 'Cost' && (val === null || val === '-' || val === '')) {
                    val = 0;
                }

                if (val === null || val === '-' || val === '' || val === 'No' || (val === 0 && !h.toLowerCase().includes('count') && h !== 'Cost')) return null;

                // Merge Currency into Revenue
                if (h === 'Revenue' && currencyIndex !== -1) {
                    const currency = row[currencyIndex];
                    if (currency) {
                        return { h, val: `${renderTextContent(val, data.selectedKeys, data.onToggleSelect)} ${currency}`, i, isMoney: true };
                    }
                }

                return { h, val, i };
            })
            .filter((item) => item !== null) as { h: string; val: any; i: number; isMoney?: boolean }[];

        return (
            <div style={{ ...style, willChange: 'transform' }} className="px-2 py-1.5">
                <div
                    className={`rounded-lg shadow-sm border-2 p-3 h-full flex flex-col gap-2 transition-colors ${isRefunded
                        ? 'bg-red-50/80 dark:bg-red-900/10 border-red-400 dark:border-red-700 shadow-red-100 dark:shadow-none'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                        } ${onRowClick ? 'cursor-pointer hover:border-blue-300 dark:hover:border-blue-600' : ''}`}
                    onClick={() => onRowClick && onRowClick(row)}
                >
                    {/* Top Header: Checkbox + Badges */}
                    {(headers.includes('Select') || sourceValue || isRefunded) && (
                        <div className="flex justify-between items-center mb-1">
                            <div className="flex items-center gap-2">
                                {headers.indexOf('Select') !== -1 && (
                                    <div className="flex items-center justify-center">
                                        {renderTextContent(row[headers.indexOf('Select')], data.selectedKeys, data.onToggleSelect)}
                                    </div>
                                )}
                                {sourceValue && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                                        {renderTextContent(sourceValue, data.selectedKeys, data.onToggleSelect)}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {isRefunded && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                                        <span>Refunded</span>
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Content Section: Image + Info */}
                    <div className="flex gap-3 items-start">
                        {imageCell?.src ? (
                            <CachedImage src={imageCell.src} alt={imageCell.alt} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onImageClick(imageCell.fullSrc || getHighResImageUrl(imageCell.src) || imageCell.src); }} className="w-16 h-16 min-w-[64px] flex-shrink-0 object-cover rounded-md border border-gray-200 dark:border-gray-600 cursor-pointer hover:scale-105 transition-transform" />
                        ) : (
                            <div className="w-16 h-16 min-w-[64px] flex-shrink-0 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center text-[10px] text-gray-400 text-center">No Image</div>
                        )}
                        <div className="flex-grow min-w-0">
                            {orderIdIndex !== -1 && (
                                <div className="mb-0.5">
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider truncate">
                                        #{typeof orderIdValue === 'object' ? orderIdValue.main : orderIdValue}
                                    </span>
                                </div>
                            )}
                            <p className="text-sm font-bold text-gray-900 dark:text-white leading-tight line-clamp-2" title={String(productValue)}>
                                {renderTextContent(productValue, data.selectedKeys, data.onToggleSelect)}
                            </p>
                        </div>
                    </div>

                    {/* Middle: Key fields grid — flex-grow để luôn dãn đầy không gian giữa top và footer */}
                    <div className="flex-grow grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-gray-100 dark:border-gray-700 pt-2 content-start">
                        {bodyItems.map((item) => {
                            const isMoney = item.isMoney || (typeof item.val === 'number' && (item.h.includes('Revenue') || item.h.includes('Cost') || item.h.includes('Amount')));
                            const valueClass = isMoney ? `text-gray-900 dark:text-white font-bold ${isRefunded ? 'text-gray-400 dark:text-gray-500' : ''}` : 'text-gray-700 dark:text-gray-300';
                            return (
                                <div key={item.i} className="flex flex-col min-w-0">
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{item.h}</span>
                                    <span className={`text-sm flex items-center gap-0.5 truncate ${valueClass}`}>
                                        {item.isMoney ? item.val : renderTextContent(item.val, data.selectedKeys, data.onToggleSelect)}
                                        {item.h === 'Rating' && item.val !== '-' && (
                                            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Footer: Account + Date — mt-auto để luôn dính đáy card dù bodyItems ít hay nhiều */}
                    {(accountValue || dateValue) && (
                        <div className="mt-auto flex justify-between items-center border-t border-gray-100 dark:border-gray-700 pt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                            {accountValue && <span className="font-semibold truncate max-w-[55%]">{renderTextContent(accountValue, data.selectedKeys, data.onToggleSelect)}</span>}
                            {dateValue && <span className="text-right">{renderTextContent(dateValue, data.selectedKeys, data.onToggleSelect)}</span>}
                        </div>
                    )}
                </div>
            </div>
        );

    } else if (findIdx('Message') !== -1 && (findIdx('Order Number') !== -1 || findIdx('Order ID') !== -1)) {
        // SUPPORT / CASE LAYOUT
        const orderIdIndex = findIdx('Order Number') !== -1 ? findIdx('Order Number') : findIdx('Order ID');
        const messageIndex = findIdx('Message');
        const sourceIndex = findIdx('Source');
        const accountIndex = findIdx('Account');
        const dateTimeIndex = headers.indexOf('DateTime');

        const orderIdValue = row[orderIdIndex];
        const messageValue = row[messageIndex];
        const sourceValue = sourceIndex !== -1 ? row[sourceIndex] : null;
        const accountValue = accountIndex !== -1 ? row[accountIndex] : null;
        const dateTimeValue = dateTimeIndex !== -1 ? renderTextContent(row[dateTimeIndex]) : null;

        return (
            <div style={{ ...style, willChange: 'transform' }} className="px-2 py-1.5">
                <div className={`rounded-lg shadow-sm border p-3 h-full flex flex-col transition-colors ${isRefunded ? 'bg-red-50/80 dark:bg-red-900/10 border-red-400 dark:border-red-700' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    {/* Header */}
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                            {headers.indexOf('Select') !== -1 && (
                                <div className="flex items-center justify-center">
                                    {renderTextContent(row[headers.indexOf('Select')], data.selectedKeys, data.onToggleSelect)}
                                </div>
                            )}
                            <span className="text-sm font-bold text-gray-900 dark:text-white">
                                #{renderTextContent(orderIdValue, data.selectedKeys, data.onToggleSelect)}
                            </span>
                        </div>
                        {sourceValue && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                {renderTextContent(sourceValue, data.selectedKeys, data.onToggleSelect)}
                            </span>
                        )}
                    </div>

                    {/* Message Body — không flex-grow/clamp: tự co theo nội dung */}
                    <div className="mb-2">
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {renderTextContent(messageValue, data.selectedKeys, data.onToggleSelect)}
                        </p>
                    </div>

                    {/* Footer - Meta Info — mt-auto để luôn dính đáy dù message ngắn */}
                    <div className="mt-auto pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                        <div className="font-medium truncate max-w-[50%]">
                            {accountValue && (
                                <span className="flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                    {renderTextContent(accountValue, data.selectedKeys, data.onToggleSelect)}
                                </span>
                            )}
                        </div>
                        <div>
                            {dateTimeValue}
                        </div>
                    </div>
                </div>
            </div>
        );

    } else {
        // GENERIC LAYOUT (for Overview, Summary, etc.)
        const titleHeader = headers[0];
        const titleValue = row[0];

        const bodyItems = headers.map((h, i) => {
            if (i === 0 || i === actionIndex || h === 'DateTime' || h === 'Select') return null;
            let val = row[i];
            const isFunds = h.toLowerCase().includes('funds');
            if (val === null || val === '-' || val === '' || (val === 0 && !h.toLowerCase().includes('count'))) {
                if (!isFunds) return null;
                else val = 0; // Force 0 so renderTextContent shows '--' or 0
            }
            return { h, val, i, isFunds };
        }).filter((item): item is { h: string; val: any; i: number; isFunds: boolean } => item !== null);


        return (

            <div
                style={{ ...style, willChange: 'transform' }}
                className={`px-2 py-1.5 has-mobile-card ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick && onRowClick(row)}
            >
                <div className={`rounded-lg shadow-sm border p-3 h-full flex flex-col justify-between hover:shadow-md transition-shadow ${isRefunded ? 'bg-red-50/80 dark:bg-red-900/10 border-red-300 dark:border-red-700' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    <div className="flex justify-between items-start mb-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                        <div className="w-full relative flex items-center">
                            {/* Checkbox placement at the very start of Generic Layout */}
                            {headers.includes('Select') && (
                                <div className="mr-2 h-full flex items-center">
                                    {renderTextContent(row[0], data.selectedKeys, data.onToggleSelect)}
                                </div>
                            )}
                            <div>
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">{titleHeader}</span>
                                <h4 className="text-base font-bold text-gray-900 dark:text-white truncate" title={String(titleValue)}>
                                    {renderTextContent(titleValue, data.selectedKeys, data.onToggleSelect)}
                                </h4>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-2 gap-y-1 mb-2">
                        {bodyItems.map((item) => {
                            if (item.val === 'Click for detail') return null;
                            const isMoney = typeof item.val === 'number' && (item.h.includes('Revenue') || item.h.includes('Funds') || item.h.includes('Cost'));
                            let valueClass = isMoney ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-700 dark:text-gray-300 font-medium';
                            let headerClass = 'text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate';
                            let containerClass = 'flex flex-col min-w-0';

                            if (item.isFunds) {
                                valueClass = 'text-emerald-700 dark:text-emerald-300 font-bold';
                                headerClass = 'text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-bold tracking-wide truncate';
                                containerClass = 'flex flex-col min-w-0 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1.5 -mx-2 -my-1 rounded-md border border-emerald-200 dark:border-emerald-700 shadow-sm justify-self-start';
                            }

                            return (
                                <div key={item.i} className={containerClass}>
                                    <span className={headerClass} title={item.h}>{item.h}</span>
                                    {/* Removed truncate to allow wrapped text (subtitles) to show */}
                                    <span className={`text-sm ${valueClass}`}>{renderTextContent(item.val, data.selectedKeys, data.onToggleSelect)}</span>
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

export default React.memo(MobileCard);
