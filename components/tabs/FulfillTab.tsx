import React, { Suspense, lazy } from 'react';
import ChartErrorBoundary from '../ChartErrorBoundary';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData } from '../../api/_lib/types';
import CollapsibleContainer from '../CollapsibleContainer';
import DataTable from '../DataTable';

const FulfillChart = lazy(() => import('../FulfillChart'));

interface FulfillTabProps {
    processedData: ProcessedData;
}

const FulfillTab: React.FC<FulfillTabProps> = ({ processedData }) => {
    return (
        <div id="fulfill-scroll-container" className="h-full overflow-y-auto overflow-x-hidden relative bg-gray-50 dark:bg-gray-900">
            <div className="p-2 md:p-6 pb-0">
                <div className="mb-6 hidden md:block">
                    <ChartErrorBoundary>
                        <Suspense fallback={<LoadingSpinner />}>
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
                        </Suspense>
                    </ChartErrorBoundary>
                </div>
                <div className="md:hidden space-y-4 mb-6">
                    <ChartErrorBoundary>
                        <Suspense fallback={<LoadingSpinner />}>
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
                        </Suspense>
                    </ChartErrorBoundary>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                        All Fulfillment Records
                    </h3>
                    <Suspense fallback={<LoadingSpinner />}>
                        <DataTable
                            headers={processedData.fulfill.table.headers}
                            data={processedData.fulfill.table.rows}
                            autoHeight={true}
                            scrollParentId="fulfill-scroll-container"
                        />
                    </Suspense>
                </div>
            </div>
        </div>
    );
};

export default FulfillTab;
