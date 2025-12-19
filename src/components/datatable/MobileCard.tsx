import React from 'react';
import Spinner from '../Spinner';
import CachedImage from './CachedImage';
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
        const orderIdIndex = findIdx('Order Number') !== -1 ? findIdx('Order Number') : findIdx('Order ID');
        const dateTimeIndex = headers.indexOf('DateTime'); // Find DateTime header index

        const imageCell = row[imageIndex];
        const productValue = productIndex !== -1 ? row[productIndex] : 'N/A';
        const orderIdValue = orderIdIndex !== -1 ? row[orderIdIndex] : 'N/A';
        const dateTimeValue = dateTimeIndex !== -1 ? row[dateTimeIndex] : null; // Get DateTime value

        const currencyIndex = findIdx('Currency');
        const specialIndexes = new Set([imageIndex, productIndex, orderIdIndex, actionIndex, dateTimeIndex, currencyIndex]);
        const bodyItems = headers
            .map((h, i) => {
                if (specialIndexes.has(i) || h === 'DateTime') return null;
                let val = row[i];
                if (h === 'Cost' && (val === null || val === '-' || val === '')) {
                    val = 0;
                }

                if (val === null || val === '-' || val === '' || (val === 0 && !h.toLowerCase().includes('count') && h !== 'Cost')) return null;

                // Merge Currency into Revenue
                if (h === 'Revenue' && currencyIndex !== -1) {
                    const currency = row[currencyIndex];
                    if (currency) {
                        return { h, val: `${renderTextContent(val)} ${currency}`, i, isMoney: true };
                    }
                }

                return { h, val, i };
            })
            .filter((item) => item !== null) as { h: string; val: any; i: number; isMoney?: boolean }[];

        const viewAction = actions?.actions?.find((a: any) => a.type === 'view');
        const viewId = viewAction?.id;

        return (
            <div style={{ ...style, willChange: 'transform' }} className="px-4 py-2">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 h-full flex flex-col justify-between">
                    <div className="flex gap-4 mb-3 items-start">
                        {imageCell?.src ? (
                            <CachedImage src={imageCell.src} alt={imageCell.alt} onClick={() => imageCell.fullSrc && onImageClick(imageCell.fullSrc)} className="w-[85px] h-[85px] min-w-[85px] flex-shrink-0 object-cover rounded-md border border-gray-200 dark:border-gray-600 cursor-pointer hover:scale-105 transition-transform" />
                        ) : (
                            <div className="w-[85px] h-[85px] min-w-[85px] flex-shrink-0 bg-gray-200 dark:bg-gray-700 rounded-md flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 text-center p-1">No Image</div>
                        )}
                        <div className="flex-grow min-w-0">
                            <div className="pb-1">
                                {orderIdIndex !== -1 && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Order #{orderIdValue}</span>
                                )}
                                <h4
                                    className={`text-base font-bold text-gray-900 dark:text-white leading-tight mt-0.5 truncate ${viewId ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400' : ''}`}
                                    title={String(productValue)}
                                    onClick={() => viewId && onViewOrderDetails && onViewOrderDetails(viewId)}
                                >
                                    {renderTextContent(productValue)}
                                </h4>
                                {dateTimeValue && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{renderTextContent(dateTimeValue)}</p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className={`grid ${orderIdIndex === -1 ? 'grid-cols-3 gap-2' : 'grid-cols-2 gap-x-4 gap-y-2'} mb-3 flex-grow content-start border-t border-gray-100 dark:border-gray-700 pt-3`}>
                        {bodyItems.map((item) => {
                            const isMoney = item.isMoney || (typeof item.val === 'number' && (item.h.includes('Revenue') || item.h.includes('Cost') || item.h.includes('Amount')));
                            const valueClass = isMoney ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-700 dark:text-gray-300';
                            return (
                                <div key={item.i} className="flex flex-col min-w-0">
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate" title={item.h}>{item.h}</span>
                                    <span className={`text-sm truncate ${valueClass}`}>{item.isMoney ? item.val : renderTextContent(item.val)}</span>
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
            <div style={{ ...style, willChange: 'transform' }} className="px-4 py-2">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 h-full flex flex-col">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-bold text-gray-900 dark:text-white">
                            #{renderTextContent(orderIdValue)}
                        </span>
                        {sourceValue && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                {renderTextContent(sourceValue)}
                            </span>
                        )}
                    </div>

                    {/* Message Body */}
                    <div className="flex-grow mb-3">
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed line-clamp-4">
                            {renderTextContent(messageValue)}
                        </p>
                    </div>

                    {/* Footer - Meta Info */}
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                        <div className="font-medium truncate max-w-[50%]">
                            {accountValue && (
                                <span className="flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                    {renderTextContent(accountValue)}
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
            if (i === 0 || i === actionIndex || h === 'DateTime') return null;
            let val = row[i];
            if (val === null || val === '-' || val === '' || (val === 0 && !h.toLowerCase().includes('count'))) return null;
            return { h, val, i };
        }).filter((item): item is { h: string; val: any; i: number } => item !== null);


        return (

            <div style={{ ...style, willChange: 'transform' }} className="px-2 py-1.5 has-mobile-card">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 h-full flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                        <div className="w-full">
                            <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">{titleHeader}</span>
                            <h4 className="text-base font-bold text-gray-900 dark:text-white truncate" title={String(titleValue)}>
                                {renderTextContent(titleValue)}
                            </h4>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-2 gap-y-1 mb-2 flex-grow overflow-y-auto content-start">
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

export default React.memo(MobileCard);
