import React, { Suspense, useMemo } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData } from '../../api/_lib/types';
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
    const orderListHeaders = processedData.orders.headers;

    // Optimizing Filtering Logic:
    // Moved filtering inside useMemo to avoid re-calculation on every render 
    // if dependencies haven't changed.
    const filteredRows = useMemo(() => {
        let rows = processedData.orders.rows;

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
        return rows;
    }, [processedData.orders.rows, dayFilter, sourceFilter, timeZone]);

    return (
        <div className="h-full flex flex-col">
            <div className="flex-grow px-2 md:px-6 pb-2 md:pb-6 overflow-hidden">
                <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                    <DataTable
                        headers={orderListHeaders}
                        data={filteredRows}
                        onViewOrderDetails={handleViewOrderDetails}
                        onResyncOrder={handleResyncOrder}
                    />
                </Suspense>
            </div>
        </div>
    );
};

export default OrderListTab;
