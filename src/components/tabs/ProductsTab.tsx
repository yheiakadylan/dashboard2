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
        <div id="products-scroll-container" className="h-full overflow-y-auto overflow-x-hidden relative bg-gray-50 dark:bg-gray-900">
            <div className="p-2 md:p-6 pb-0">
                <div className="mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
                        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Top Products</h3>
                        <div>
                            <ChartErrorBoundary>
                                <TopProductsChart data={processedData.summary.topProductsByShop} />
                            </ChartErrorBoundary>
                        </div>
                    </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Product Details</h3>
                    <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                        <DataTable
                            headers={processedData.products.headers}
                            data={processedData.products.rows}
                            autoHeight={true}
                            scrollParentId="products-scroll-container"
                        />
                    </Suspense>
                </div>
            </div>
        </div>
    );
};

export default ProductsTab;
