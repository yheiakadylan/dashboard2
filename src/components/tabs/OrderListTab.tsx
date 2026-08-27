import React, { Suspense, useMemo, useState } from 'react';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../ui/DataTable';
import { ORDER_LIST_INDICES } from '../../constants/dataIndices';
import { formatDateEfficiently } from '../../utils/dateFormatter';
import { useUISettings } from '../../contexts/UIContext';
import { useDashboard, useDashboardAccess } from '../../contexts/DashboardContext';
import useMediaQuery from '../../hooks/useMediaQuery';
import Pagination from '../ui/Pagination';

const ITEMS_PER_PAGE = 200;
const DESKTOP_TABLE_STYLE = { height: 'calc(100vh - 160px)' };

interface OrderListTabProps {
    processedData: ProcessedData;
    dayFilter: string | null;
    sourceFilter: string;
    statusFilter: string;
    timeZone: string;
    handleViewOrderDetails: (recordId: string) => void;
    handleResyncOrder: (recordId: string) => Promise<void>;
}

const OrderListTab: React.FC<OrderListTabProps> = ({
    processedData,
    dayFilter,
    sourceFilter,
    statusFilter,
    timeZone,
    handleViewOrderDetails,
    handleResyncOrder
}) => {
    const { globalUsdMode } = useUISettings();
    const { exchangeRates } = useDashboardAccess();
    const { updateOrderManualCost, updateOrderFfCode, updateOrderProvider } = useDashboard();
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [currentPage, setCurrentPage] = useState(0);

    // Reset page when filtering
    React.useEffect(() => {
        setCurrentPage(0);
    }, [dayFilter, sourceFilter, statusFilter]);

    // Identify column indices safely
    const orderHeaders = processedData.orders.headers;
    const variantsIndex = orderHeaders.findIndex(h => h.toLowerCase().includes('variant'));
    const sourceIndex = orderHeaders.findIndex(h => h.toLowerCase() === 'source');
    const recordIdIndex = ORDER_LIST_INDICES.RECORD_ID;

    // Indices of columns we actually want to show in the table
    const displayIndices = useMemo(() => {
        return orderHeaders
            .map((_, i) => i)
            .filter(i => i !== variantsIndex && i !== sourceIndex);
    }, [orderHeaders.length, variantsIndex, sourceIndex]);

    // Derived headers for UI display
    const displayHeaders = useMemo(() => {
        return displayIndices.map(i => orderHeaders[i]);
    }, [orderHeaders, displayIndices]);

    // Optimizing Filtering Logic — keeps original rows intact before stripping
    const displayRows = useMemo(() => {
        let rows = processedData.orders.rows;

        if (dayFilter) {
            rows = rows.filter(row => {
                const dtLocal = row[ORDER_LIST_INDICES.DT_LOCAL_RAW] as string;
                return formatDateEfficiently(dtLocal, timeZone) === dayFilter;
            });
        }

        if (sourceFilter !== 'All') {
            rows = rows.filter(row => {
                const source = row[ORDER_LIST_INDICES.SOURCE] as string;
                return source === sourceFilter;
            });
        }

        if (statusFilter !== 'All') {
            rows = rows.filter(row => {
                const isRefunded = row[ORDER_LIST_INDICES.IS_REFUNDED] as unknown as boolean;
                if (statusFilter === 'Refunded') return isRefunded;
                if (statusFilter === 'New') return !isRefunded;
                return true;
            });
        }

        // Strip hidden columns for display but KEEP recordId and isRefunded at the end
        let stripped = rows.map(row => {
            const displayPart = displayIndices.map(i => row[i]);
            
            // Re-append hidden metadata needed for UI logic (click & highlight)
            // isRefunded MUST be the last element for DesktopRow/MobileCard to pick it up
            return [
                ...displayPart, 
                row[recordIdIndex], 
                row[ORDER_LIST_INDICES.IS_REFUNDED]
            ];
        });

        // USD conversion: convert Revenue to USD using exchange rates
        if (globalUsdMode && exchangeRates) {
            const revIdx = displayHeaders.indexOf('Revenue');
            const curIdx = displayHeaders.indexOf('Curren');
            if (revIdx !== -1 && curIdx !== -1) {
                stripped = stripped.map(row => {
                    const currency = row[curIdx] as string;
                    const revenue = row[revIdx] as number;
                    if (currency && currency !== 'USD' && exchangeRates[currency]) {
                        const newRow = [...row];
                        newRow[revIdx] = +((revenue * exchangeRates[currency]).toFixed(2));
                        newRow[curIdx] = 'USD';
                        return newRow;
                    }
                    return row;
                });
            }
        }

        return stripped;
    }, [processedData.orders.rows, dayFilter, sourceFilter, statusFilter, timeZone, variantsIndex, sourceIndex, recordIdIndex, displayHeaders, globalUsdMode, exchangeRates]);

    const totalPages = Math.ceil(displayRows.length / ITEMS_PER_PAGE);
    React.useEffect(() => {
        setCurrentPage(page => Math.min(page, Math.max(0, totalPages - 1)));
    }, [totalPages]);

    const paginatedRows = useMemo(() => {
        return displayRows.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
    }, [displayRows, currentPage]);

    // When a row is clicked, the recordId is now the second to last element
    // because isRefunded was appended afterwards at the very end.
    const handleRowClick = React.useCallback((row: any[]) => {
        const recordId = row[row.length - 2] as string | undefined;
        if (recordId) {
            handleViewOrderDetails(recordId);
        }
    }, [handleViewOrderDetails]);

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] relative">
            <div className="p-2 md:p-6">
                <div style={isDesktop ? DESKTOP_TABLE_STYLE : undefined} className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                    <div className="flex-1 min-h-0 relative">
                        <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                            <DataTable
                                headers={displayHeaders}
                                data={paginatedRows}
                                onResyncOrder={handleResyncOrder}
                                onUpdateCost={updateOrderManualCost}
                                onUpdateFfCode={updateOrderFfCode}
                                onUpdateProvider={updateOrderProvider}
                                onRowClick={handleRowClick}
                                autoHeight={!isDesktop}
                            />
                        </Suspense>
                    </div>
                    <Pagination 
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                    />
                </div>
            </div>


        </div>
    );
};

export default OrderListTab;
