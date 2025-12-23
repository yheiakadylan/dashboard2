import React, { Suspense, lazy } from 'react';
import ChartErrorBoundary from '../ChartErrorBoundary';
import LoadingSpinner from '../LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../DataTable';

import TopProductsChart from '../TopProductsChart';

interface ProductsTabProps {
    processedData: ProcessedData;
}

const ProductsTab: React.FC<ProductsTabProps> = ({ processedData }) => {
    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <div className="p-2 md:p-6 pb-0">
                <div className="mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
                        <div>
                            <ChartErrorBoundary>
                                <TopProductsChart data={processedData.summary.topProductsByShop} />
                            </ChartErrorBoundary>
                        </div>
                    </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Product Details</h3>
                    {/* Fixed height container for Table to fill viewport after scroll */}
                    <div style={{ height: 'calc(100vh - 140px)' }}>
                        <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                            <DataTable
                                headers={processedData.products.headers}
                                data={processedData.products.rows}
                                autoHeight={false} // Internal scroll
                                mobileRowHeight={200}
                            />
                        </Suspense>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductsTab;
