import React, { Suspense, useMemo, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData, Record } from '../../types';
import DataTable from '../DataTable';
import { ORDER_LIST_INDICES } from '../../constants/dataIndices';
import { formatDateEfficiently } from '../../utils/dateFormatter';
import GoogleSheetModal from '../GoogleSheetModal';
import OrderSelectorModal from '../OrderSelectorModal';
import PreviewSyncModal from '../PreviewSyncModal';

interface OrderListTabProps {
    processedData: ProcessedData;
    dayFilter: string | null;
    sourceFilter: string;
    timeZone: string;
    handleViewOrderDetails: (recordId: string) => void;
    handleResyncOrder: (recordId: string) => Promise<void>;
    allRecords: Record[];
}

const OrderListTab: React.FC<OrderListTabProps> = ({
    processedData,
    dayFilter,
    sourceFilter,
    timeZone,
    handleViewOrderDetails,
    handleResyncOrder,
    allRecords
}) => {
    const [showGoogleSheetModal, setShowGoogleSheetModal] = useState(false);
    const [showOrderSelector, setShowOrderSelector] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [selectedRecords, setSelectedRecords] = useState<Record[]>([]);

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

        if (variantsIndex !== -1 || sourceIndex !== -1) {
            rows = rows.map(row => row.filter((_, i) => i !== variantsIndex && i !== sourceIndex));
        }

        return rows;
    }, [processedData.orders.rows, dayFilter, sourceFilter, timeZone, variantsIndex, sourceIndex]);

    const handleOrderSelection = (selectedIds: Set<string>) => {
        const records = allRecords.filter(r => r.id && selectedIds.has(r.id));
        setSelectedRecords(records);
        setShowOrderSelector(false);
        setShowPreviewModal(true);
    };

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] relative">
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

            {/* Floating Action Button - Select Orders to Sync */}
            <div className="fixed bottom-28 left-4 md:top-20 md:left-auto md:right-6 z-40">
                <button
                    onClick={() => setShowOrderSelector(true)}
                    className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-full p-4 shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2 group"
                    title="Select Orders to Sync"
                >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M19 19H5V5H19V19M12 13H7V11H12V13M17 9H7V7H17V9M17 17H7V15H17V17Z" />
                    </svg>
                    <span className="hidden md:group-hover:inline-block font-medium text-sm whitespace-nowrap">
                        Select Orders
                    </span>
                </button>
            </div>

            {/* Order Selector Modal */}
            <OrderSelectorModal
                isOpen={showOrderSelector}
                onClose={() => setShowOrderSelector(false)}
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
