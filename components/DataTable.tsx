import React, { useState, useMemo, CSSProperties } from 'react';
import { FixedSizeList as List, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { HIDDEN_MOBILE_HEADERS } from '../constants';

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
  data: (string | number | null | { type: 'button', label: string, id: string } | { type: 'action_group', actions: any[] })[][];
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
  isMobile: boolean;
}

// Helper to check if a header should be hidden on mobile (Only applied in Desktop View now)
const isHiddenOnDesktopMobileView = (header: string) => HIDDEN_MOBILE_HEADERS.includes(header);

const renderActionCell = (cell: any, cellIndex: number, loadingItems: Set<string>, onResyncClick: (id: string) => void, onViewOrderDetails?: (id: string) => void, onViewDayDetails?: (date: string) => void, rowData?: any[]) => {
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
        return (
            <div className="flex items-center gap-3">
                {cell.actions.map((action: any, i: number) => {
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
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                )}
                              
                            </button>
                        );
                    }
                    return null;
                })}
            </div>
        );
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
  const { items, headers, loadingItems, onViewDayDetails, onViewOrderDetails, onResyncClick } = data;
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

        const cellClass = `${hiddenClass} flex-1 min-w-[120px] px-6 py-2 text-sm items-center h-full overflow-hidden`;
        const isProductName = header === 'Product Name';

        // Check if complex object
        if ((typeof cell === 'object' && cell !== null) || cell === 'Click for detail') {
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
            title={isProductName && typeof cell === 'string' ? cell : undefined}
          >
             <span className={`truncate w-full ${isProductName ? 'block' : ''}`}>
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
    const { items, headers, loadingItems, onViewDayDetails, onViewOrderDetails, onResyncClick } = data;
    const row = items[index];
    
    // 1. Identify "Title" (First Column) - e.g., Shop Name or Order ID
    const titleHeader = headers[0];
    const titleValue = row[0];

    // 2. Identify "Action" column
    const findIdx = (name: string) => headers.findIndex(h => h === name);
    const actionIndex = findIdx('Actions') !== -1 ? findIdx('Actions') : findIdx('Details');
    const actions = actionIndex !== -1 ? row[actionIndex] : null;

    // 3. Process other columns for Body
    // Rule: Hide 0 values for Revenue/Funds/Cost to avoid clutter. Always show Orders.
    const bodyItems = headers.map((h, i) => {
        if (i === 0 || i === actionIndex) return null; // Skip Title and Actions
        
        let val = row[i];
        
        // Skip if value is 0 (unless it is "Orders" count which might be 0 but relevant, though typically 0 orders means row shouldn't exist)
        // We strictly hide 0 for Revenue, Funds, Cost to solve the "multi-currency 0 value" issue.
        if ((val === 0 || val === null || val === '-') && h !== 'Orders' && h !== 'Order Count') {
            return null;
        }

        // Rename "Cost (USD)" to "Cost"
        let displayHeader = h;
        if (h === 'Cost (USD)') {
            displayHeader = 'Cost';
        }

        return { h: displayHeader, val, i };
    }).filter(item => item !== null) as { h: string, val: any, i: number }[];

    return (
        <div style={style} className="px-4 py-2">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 h-full flex flex-col justify-between">
                
                {/* Header: Title Only (Shop Name / Order ID) */}
                <div className="flex justify-between items-start mb-3 border-b border-gray-100 dark:border-gray-700 pb-2">
                    <div className="w-full">
                        <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">{titleHeader}</span>
                        <h4 className="text-lg font-bold text-gray-900 dark:text-white truncate" title={String(titleValue)}>
                             {renderTextContent(titleValue)}
                        </h4>
                    </div>
                </div>

                {/* Body: Grid of Non-Zero Key-Values */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-2 mb-3 flex-grow overflow-y-auto content-start">
                     {bodyItems.map((item) => {
                         // Skip "Click for detail" text strings if they are just triggers
                         if (item.val === 'Click for detail') return null;

                         const isMoney = item.h.includes('Revenue') || item.h.includes('Funds') || item.h.includes('Cost') || item.h.includes('Amount');
                         const valueClass = isMoney 
                            ? 'text-gray-900 dark:text-white font-bold' 
                            : 'text-gray-700 dark:text-gray-300 font-medium';

                         return (
                            <div key={item.i} className="flex flex-col min-w-0">
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate" title={item.h}>
                                    {item.h}
                                </span>
                                <span className={`text-sm truncate ${valueClass}`}>
                                    {renderTextContent(item.val)}
                                </span>
                            </div>
                         )
                     })}
                </div>

                {/* Footer: Actions */}
                {actions && (
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700 mt-auto flex justify-end">
                        {renderActionCell(actions, actionIndex, loadingItems, onResyncClick, onViewOrderDetails, onViewDayDetails, row)}
                    </div>
                )}
            </div>
        </div>
    );
};

// Wrap Row components with React.memo to prevent unnecessary re-renders
const MemoizedDesktopRow = React.memo(DesktopRow, areEqual);
const MemoizedMobileCard = React.memo(MobileCard, areEqual);

const DataTable: React.FC<DataTableProps> = ({ headers, data, onViewDayDetails, onViewOrderDetails, onResyncOrder, autoHeight = false, mobileRowHeight }) => {
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());

  const handleSort = (columnIndex: number) => {
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
      } catch (e) {
         // handled up stream
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
          if('type' in valA && valA.type === 'button') valA = valA.label;
          else if('type' in valA && valA.type === 'action_group') valA = '';
      }
      if (valB && typeof valB === 'object') {
          if('type' in valB && valB.type === 'button') valB = valB.label;
          else if('type' in valB && valB.type === 'action_group') valB = '';
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
      return <div className="p-8 text-center text-gray-500 dark:text-gray-400">No data available for this view.</div>
  }

  // Determine root container classes
  // If autoHeight is true, remove 'h-full' and 'overflow-hidden' to allow expansion
  const rootClasses = `flex flex-col ${autoHeight ? '' : 'h-full'} bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${autoHeight ? '' : 'overflow-hidden'}`;

  return (
    <div className={rootClasses}>
        <AutoSizer disableHeight={autoHeight as any}>
          {({ height, width }: { height: number; width: number }) => {
            // Safety check for width
            if (!width) return null;
            // If NOT autoHeight, height is required
            if (!autoHeight && !height) return null;
            
            const isMobile = width < 768; // Mobile Breakpoint
            const itemSize = isMobile ? (mobileRowHeight || 240) : 56; // Fixed height: Cards vs Rows
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
                isMobile
            };

            return (
              <>
                {/* Desktop Header - Only show if not mobile */}
                {!isMobile && (
                    <div className="flex items-center bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 font-semibold text-xs text-gray-500 dark:text-gray-300 uppercase tracking-wider h-12 flex-shrink-0 z-10" style={{ width: width }}>
                        {headers.map((header, index) => (
                            <div
                                key={header}
                                className={`flex-1 min-w-[120px] px-6 py-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors h-full flex items-center ${isHiddenOnDesktopMobileView(header) ? 'hidden lg:flex' : 'flex'}`}
                                onClick={() => handleSort(index)}
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
                        ))}
                    </div>
                )}

                {/* Virtualized Body */}
                <div style={{ height: listHeight }}> 
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
    </div>
  );
};

export default DataTable;