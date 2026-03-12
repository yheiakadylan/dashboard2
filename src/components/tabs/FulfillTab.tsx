import React, { Suspense, lazy } from 'react';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import CollapsibleContainer from '../ui/CollapsibleContainer';
import DataTable from '../ui/DataTable';
import Pagination from '../ui/Pagination';

const ITEMS_PER_PAGE = 200;

import FulfillChart from '../charts/FulfillChart';

interface FulfillTabProps {
    processedData: ProcessedData;
}

import useMediaQuery from '../../hooks/useMediaQuery';

// ... (other imports)

const FulfillTab: React.FC<FulfillTabProps> = ({ processedData }) => {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [currentPage, setCurrentPage] = React.useState(0);

    // Reset page when data changes
    React.useEffect(() => {
        setCurrentPage(0);
    }, [processedData.fulfill.table.rows]);

    const displayRows = processedData.fulfill.table.rows;
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
                            <div className="flex flex-col md:flex-row gap-6 mb-6">
                                <FulfillChart
                                    title="Top 10 Merchize Products"
                                    data={processedData.fulfill.merchizeChartData}
                                />
                                <FulfillChart
                                    title="Top 10 Printway Products"
                                    data={processedData.fulfill.printwayChartData}
                                />
                            </div>
                        </ChartErrorBoundary>
                    </div>
                ) : (
                    <div className="space-y-4 mb-6 fade-in">
                        <ChartErrorBoundary>
                            <CollapsibleContainer title="Top 10 Merchize Products">
                                <FulfillChart
                                    title="Top 10 Merchize Products"
                                    data={processedData.fulfill.merchizeChartData}
                                />
                            </CollapsibleContainer>
                            <CollapsibleContainer title="Top 10 Printway Products">
                                <FulfillChart
                                    title="Top 10 Printway Products"
                                    data={processedData.fulfill.printwayChartData}
                                />
                            </CollapsibleContainer>
                        </ChartErrorBoundary>
                    </div>
                )}
            </div>

            <div className="px-2 md:px-6 pb-2">
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center justify-between">
                        <span>All Fulfillment Records</span>
                        <span className="text-xl text-red-600 dark:text-red-400">
                            Total: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(processedData.fulfill.totalCost || 0)}
                        </span>
                    </h3>
                    <div style={isDesktop ? { height: 'calc(100vh - 140px)' } : {}} className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                        <div className="flex-1 min-h-0 relative">
                            <Suspense fallback={<LoadingSpinner />}>
                                <DataTable
                                    headers={processedData.fulfill.table.headers}
                                    data={paginatedRows}
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
        </div>
    );
};

export default FulfillTab;
