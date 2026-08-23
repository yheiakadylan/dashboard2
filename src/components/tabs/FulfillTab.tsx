import React, { Suspense } from 'react';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import CollapsibleContainer from '../ui/CollapsibleContainer';
import DataTable from '../ui/DataTable';
import Pagination from '../ui/Pagination';

const ITEMS_PER_PAGE = 200;

const FulfillChart = React.lazy(() => import('../charts/FulfillChart'));

const isFulfillRowRefunded = (row: any[]) => row[row.length - 2] === true;

import { useNotification } from '../../contexts/NotificationContext';

interface FulfillTabProps {
    processedData: ProcessedData;
}

import useMediaQuery from '../../hooks/useMediaQuery';

// ... (other imports)

const FulfillTab: React.FC<FulfillTabProps> = ({ processedData }) => {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const { addNotification } = useNotification();
    const [currentPage, setCurrentPage] = React.useState(0);
    const [statusFilter, setStatusFilter] = React.useState<'All' | 'Active' | 'Refunded'>('All');
    const { activeCount, refundedCount } = React.useMemo(() => {
        let active = 0;
        let refunded = 0;
        processedData.fulfill.table.rows.forEach(r => {
            if (isFulfillRowRefunded(r)) refunded++;
            else active++;
        });
        return { activeCount: active, refundedCount: refunded };
    }, [processedData.fulfill.table.rows]);

    // Reset page when data or filter changes
    React.useEffect(() => {
        setCurrentPage(0);
    }, [processedData.fulfill.table.rows, statusFilter]);

    const displayRows = React.useMemo(() => {
        const rows = processedData.fulfill.table.rows;
        if (statusFilter === 'All') return rows;
        return rows.filter(row => {
            const isRefunded = isFulfillRowRefunded(row);
            return statusFilter === 'Refunded' ? isRefunded : !isRefunded;
        });
    }, [processedData.fulfill.table.rows, statusFilter]);

    const totalPages = Math.ceil(displayRows.length / ITEMS_PER_PAGE);
    const paginatedRows = React.useMemo(() => {
        return displayRows.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
    }, [displayRows, currentPage]);

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <div className="p-2 md:p-6 pb-0">
                {isDesktop ? (
                    <div className="mb-6 fade-in">
                        <ChartErrorBoundary>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                                <FulfillChart
                                    title="Top 10 Products"
                                    data={processedData.fulfill.allProductChartData}
                                />
                                <FulfillChart
                                    title="Top 10 Refunded Products"
                                    data={processedData.fulfill.refundedChartData}
                                    fill="#ef4444"
                                />
                            </div>
                        </ChartErrorBoundary>
                    </div>
                ) : (
                    <div className="space-y-4 mb-6 fade-in">
                        <ChartErrorBoundary>
                            <CollapsibleContainer title="Top 10 Products">
                                <FulfillChart
                                    title="Top 10 Products"
                                    data={processedData.fulfill.allProductChartData}
                                />
                            </CollapsibleContainer>
                            <CollapsibleContainer title="Top 10 Refunded Products">
                                <FulfillChart
                                    title="Top 10 Refunded Products"
                                    data={processedData.fulfill.refundedChartData}
                                    fill="#ef4444"
                                />
                            </CollapsibleContainer>
                        </ChartErrorBoundary>
                    </div>
                )}
            </div>

            <div className="px-2 md:px-6 pb-2">
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                        <div className="flex flex-col gap-2">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Fulfillment Records</h3>
                            <div className="flex items-center p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit border border-gray-200 dark:border-gray-700">
                                {(['All', 'Active', 'Refunded'] as const).map((status) => {
                                    const count = status === 'All' 
                                        ? processedData.fulfill.table.rows.length 
                                        : (status === 'Refunded' ? refundedCount : activeCount);

                                    return (
                                        <button
                                            key={status}
                                            onClick={() => setStatusFilter(status)}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                                                statusFilter === status
                                                    ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                                            }`}
                                        >
                                            {status}
                                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                                                statusFilter === status 
                                                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600' 
                                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                            }`}>
                                                {count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="flex items-center gap-8">
                            <div className="text-right">
                                <span className="text-sm text-gray-500 dark:text-gray-400 block mb-1">Refund Rate</span>
                                <span className="text-2xl font-black text-orange-600 dark:text-orange-400 tracking-tight">
                                    {(processedData.fulfill.refundRate || 0).toFixed(1)}%
                                </span>
                            </div>
                            <div className="text-right">
                                <span className="text-sm text-gray-500 dark:text-gray-400 block mb-1">Total Cost</span>
                                <span className="text-2xl font-black text-red-600 dark:text-red-400 tracking-tight">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(processedData.fulfill.totalCost || 0)}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div style={isDesktop ? { height: 'calc(100vh - 140px)' } : {}} className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                        <div className="flex-1 min-h-0 relative">
                            <Suspense fallback={<LoadingSpinner />}>
                                <DataTable
                                    headers={processedData.fulfill.table.headers}
                                    data={paginatedRows}
                                    autoHeight={!isDesktop}
                                    onRowClick={(row) => {
                                        const isRefunded = isFulfillRowRefunded(row);
                                        if (isRefunded) {
                                            const orderId = row[1] as string;
                                            const productNameCell = row[2] as any;
                                            const reason = typeof productNameCell === 'object' ? productNameCell.subtitle?.replace(/^Refund:\s*/i, '').replace('↩ ', '') : null;
                                            
                                            if (reason) {
                                                addNotification(`Reason for #${orderId}: ${reason}`, 'info');
                                            } else {
                                                addNotification(`Order #${orderId} was refunded.`, 'info');
                                            }
                                        }
                                    }}
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
        </div>
    );
};

export default FulfillTab;
