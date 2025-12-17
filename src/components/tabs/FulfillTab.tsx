import React, { Suspense, lazy } from 'react';
import ChartErrorBoundary from '../ChartErrorBoundary';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData } from '../../types';
import CollapsibleContainer from '../CollapsibleContainer';
import DataTable from '../DataTable';

import FulfillChart from '../FulfillChart';

interface FulfillTabProps {
    processedData: ProcessedData;
}

import useMediaQuery from '../../hooks/useMediaQuery';

// ... (other imports)

const FulfillTab: React.FC<FulfillTabProps> = ({ processedData }) => {
    const isDesktop = useMediaQuery('(min-width: 768px)');

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
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                        All Fulfillment Records
                    </h3>
                    <div style={{ height: 'calc(100vh - 140px)' }}>
                        <Suspense fallback={<LoadingSpinner />}>
                            <DataTable
                                headers={processedData.fulfill.table.headers}
                                data={processedData.fulfill.table.rows}
                                autoHeight={false}
                            />
                        </Suspense>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FulfillTab;
