import React, { Suspense, useMemo, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData, Record } from '../../types';
import DataTable from '../DataTable';
import { ORDER_LIST_INDICES } from '../../constants/dataIndices';
import { formatDateEfficiently } from '../../utils/dateFormatter';
import GoogleSheetModal from '../GoogleSheetModal';
import OrderSelectorModal from '../OrderSelectorModal';
import PreviewSyncModal from '../PreviewSyncModal';
import { useUI } from '../../contexts/UIContext';
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
    const { isOrderSelectorOpen, setIsOrderSelectorOpen } = useUI();
    const [showGoogleSheetModal, setShowGoogleSheetModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [selectedRecords, setSelectedRecords] = useState<Record[]>([]);
    const isDesktop = useMediaQuery('(min-width: 768px)');

    // Identify Variants and Source column indices dynamically
    const variantsIndex = processedData.orders.headers.findIndex(h => h === 'Variants');
    const sourceIndex = processedData.orders.headers.findIndex(h => h === 'Source');

    // Filter out Variants and Source from headers for UI display
    const displayHeaders = useMemo(() => {
        return processedData.orders.headers.filter((_, i) => i !== variantsIndex && i !== sourceIndex);
    }, [processedData.orders.headers, variantsIndex, sourceIndex]);

    // Optimizing Filtering Logic
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
                const status = row[ORDER_LIST_INDICES.STATUS] as string;
                return status === statusFilter;
            });
        }

        if (variantsIndex !== -1 || sourceIndex !== -1) {
            rows = rows.map(row => row.filter((_, i) => i !== variantsIndex && i !== sourceIndex));
        }

        return rows;
    }, [processedData.orders.rows, dayFilter, sourceFilter, statusFilter, timeZone, variantsIndex, sourceIndex]);

    const handleOrderSelection = (selectedIds: Set<string>) => {
        const records = allRecords.filter(r => r.id && selectedIds.has(r.id));
        setSelectedRecords(records);
        setIsOrderSelectorOpen(false);
        setShowPreviewModal(true);
    };

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] relative">
            <div className="p-2 md:p-6">
                <div style={isDesktop ? { height: 'calc(100vh - 120px)' } : {}}>
                    <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                        <DataTable
                            headers={displayHeaders}
                            data={displayRows}
                            onViewOrderDetails={handleViewOrderDetails}
                            onResyncOrder={handleResyncOrder}
                            mobileRowHeight={390}
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
