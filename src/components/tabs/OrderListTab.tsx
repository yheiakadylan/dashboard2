import React, { Suspense, useMemo } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../DataTable';
import { ORDER_LIST_INDICES } from '../../constants/dataIndices';
import { formatDateEfficiently } from '../../utils/dateFormatter';

interface OrderListTabProps {
    processedData: ProcessedData;
    dayFilter: string | null;
    sourceFilter: string;
    timeZone: string;
    handleViewOrderDetails: (recordId: string) => void;
    handleResyncOrder: (recordId: string) => Promise<void>;
}

const OrderListTab: React.FC<OrderListTabProps> = ({
    processedData,
    dayFilter,
    sourceFilter,
    timeZone,
    handleViewOrderDetails,
    handleResyncOrder
}) => {
    // Identify Variants and Source column indices dynamically
    const variantsIndex = processedData.orders.headers.findIndex(h => h === 'Variants');
    const sourceIndex = processedData.orders.headers.findIndex(h => h === 'Source');

    // Filter out Variants and Source from headers for UI display
    const displayHeaders = useMemo(() => {
        return processedData.orders.headers.filter((_, i) => i !== variantsIndex && i !== sourceIndex);
    }, [processedData.orders.headers, variantsIndex, sourceIndex]);

    // Optimizing Filtering Logic:
    // Moved filtering inside useMemo to avoid re-calculation on every render 
    // if dependencies haven't changed.
    const displayRows = useMemo(() => {
        let rows = processedData.orders.rows;

        // 1. Filter Rows based on criteria (using Source Indices)
        if (dayFilter) {
            rows = rows.filter(row => {
                const dtLocal = row[ORDER_LIST_INDICES.DT_LOCAL_RAW] as string;
                // Use the efficient formatter
                return formatDateEfficiently(dtLocal, timeZone) === dayFilter;
            });
        }

        if (sourceFilter !== 'All') {
            rows = rows.filter(row => {
                const source = row[ORDER_LIST_INDICES.SOURCE] as string;
                return source === sourceFilter;
            });
        }

        // 2. Filter Column (Remove Variants and Source) for UI Display
        if (variantsIndex !== -1 || sourceIndex !== -1) {
            rows = rows.map(row => row.filter((_, i) => i !== variantsIndex && i !== sourceIndex));
        }

        return rows;
    }, [processedData.orders.rows, dayFilter, sourceFilter, timeZone, variantsIndex, sourceIndex]);

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <div className="p-2 md:p-6">
                <div style={{ height: 'calc(100vh - 120px)' }}>
                    <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                        <DataTable
                            headers={displayHeaders}
                            data={displayRows}
                            onViewOrderDetails={handleViewOrderDetails}
                            onResyncOrder={handleResyncOrder}
                            mobileRowHeight={340}
                            autoHeight={false}
                        />
                    </Suspense>
                </div>
            </div>
        </div>
    );
};

export default OrderListTab;
