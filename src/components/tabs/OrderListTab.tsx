import React, { Suspense, useMemo, useState } from 'react';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData, Record } from '../../types';
import DataTable from '../ui/DataTable';
import { ORDER_LIST_INDICES } from '../../constants/dataIndices';
import { formatDateEfficiently } from '../../utils/dateFormatter';
import GoogleSheetModal from '../modals/GoogleSheetModal';
import OrderSelectorModal from '../modals/OrderSelectorModal';
import PreviewSyncModal from '../modals/PreviewSyncModal';
import { useUI } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';
import useMediaQuery from '../../hooks/useMediaQuery';

interface OrderListTabProps {
    processedData: ProcessedData;
    dayFilter: string | null;
    sourceFilter: string;
    statusFilter: string;
    timeZone: string;
    handleViewOrderDetails: (recordId: string) => void;
    handleResyncOrder: (recordId: string) => Promise<void>;
    allRecords: Record[];
}

const OrderListTab: React.FC<OrderListTabProps> = ({
    processedData,
    dayFilter,
    sourceFilter,
    statusFilter,
    timeZone,
    handleViewOrderDetails,
    handleResyncOrder,
    allRecords
}) => {
    const { isOrderSelectorOpen, setIsOrderSelectorOpen, globalUsdMode } = useUI();
    const { exchangeRates } = useDashboard();
    const [showGoogleSheetModal, setShowGoogleSheetModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [selectedRecords, setSelectedRecords] = useState<Record[]>([]);
    const isDesktop = useMediaQuery('(min-width: 768px)');

    // Identify hidden column indices
    const variantsIndex = processedData.orders.headers.findIndex(h => h === 'Variants');
    const sourceIndex = processedData.orders.headers.findIndex(h => h === 'Source');
    const recordIdIndex = ORDER_LIST_INDICES.RECORD_ID; // Hidden record ID column (index 14)

    // Filter out Variants, Source, and hidden record ID from headers for UI display
    const displayHeaders = useMemo(() => {
        return processedData.orders.headers.filter((_, i) =>
            i !== variantsIndex && i !== sourceIndex && i !== recordIdIndex
        );
    }, [processedData.orders.headers, variantsIndex, sourceIndex, recordIdIndex]);

    // Optimizing Filtering Logic — keeps original rows intact before stripping
    const [filteredOriginalRows, displayRows] = useMemo(() => {
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

        // Keep a reference to filtered (but not stripped) original rows for record ID lookup
        const filtered = rows;

        // Strip hidden columns for display
        let stripped = rows.map(row =>
            row.filter((_, i) => i !== variantsIndex && i !== sourceIndex && i !== recordIdIndex)
        );

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

        return [filtered, stripped];
    }, [processedData.orders.rows, dayFilter, sourceFilter, statusFilter, timeZone, variantsIndex, sourceIndex, recordIdIndex, displayHeaders, globalUsdMode, exchangeRates]);

    // Build a fast lookup: stripped row index → record ID (filteredOriginalRows is same-length & same-order as displayRows)
    const rowRecordIds = useMemo(() =>
        filteredOriginalRows.map(orig => orig[recordIdIndex] as string | undefined),
        [filteredOriginalRows, recordIdIndex]
    );

    // When a row is clicked, use its index in displayRows to look up the record ID
    const handleRowClick = (row: any[]) => {
        // The row passed by DataTable is the stripped display row.
        // We find the matching index from displayRows to get the record ID.
        const rowIndex = displayRows.indexOf(row);
        const recordId = rowIndex !== -1 ? rowRecordIds[rowIndex] : undefined;
        if (recordId) {
            handleViewOrderDetails(recordId);
        }
    };

    const handleOrderSelection = (selectedIds: Set<string>) => {
        const records = allRecords.filter(r => r.id && selectedIds.has(r.id));
        setSelectedRecords(records);
        setIsOrderSelectorOpen(false);
        setShowPreviewModal(true);
    };

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] relative">
            <div className="p-2 md:p-6">
                <div style={isDesktop ? { height: 'calc(100vh - 160px)' } : {}}>
                    <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                        <DataTable
                            headers={displayHeaders}
                            data={displayRows}
                            onResyncOrder={handleResyncOrder}
                            onRowClick={handleRowClick}
                            autoHeight={!isDesktop}
                        />
                    </Suspense>
                </div>
            </div>


            {/* Order Selector Modal */}
            <OrderSelectorModal
                isOpen={isOrderSelectorOpen}
                onClose={() => setIsOrderSelectorOpen(false)}
                allRecords={allRecords}
                onConfirm={handleOrderSelection}
                onOpenSettings={() => setShowGoogleSheetModal(true)}
            />

            {/* Google Sheet Config Modal - NO records */}
            {showGoogleSheetModal && (
                <GoogleSheetModal
                    isOpen={showGoogleSheetModal}
                    onClose={() => setShowGoogleSheetModal(false)}
                    records={[]}
                />
            )}

            {/* Preview Sync Modal */}
            <PreviewSyncModal
                isOpen={showPreviewModal}
                onClose={() => {
                    setShowPreviewModal(false);
                    setSelectedRecords([]);
                }}
                selectedRecords={selectedRecords}
                onSuccess={() => {
                    setShowPreviewModal(false);
                    setSelectedRecords([]);
                }}
            />
        </div>
    );
};

export default OrderListTab;
