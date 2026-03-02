import React, { Suspense, useMemo } from 'react';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../ui/DataTable';
import useMediaQuery from '../../hooks/useMediaQuery';
import { useUI } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';

import TopProductsChart from '../charts/TopProductsChart';

interface ProductsTabProps {
    processedData: ProcessedData;
}

const ProductsTab: React.FC<ProductsTabProps> = ({ processedData }) => {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const { globalUsdMode } = useUI();
    const { exchangeRates } = useDashboard();

    // Convert Revenue to USD when globalUsdMode is on
    const displayRows = useMemo(() => {
        const rows = processedData.products.rows;
        if (!globalUsdMode || !exchangeRates) {
            // Strip hidden cols [5], [6] — keep only [0..4]
            return rows.map(row => row.slice(0, 5));
        }
        return rows.map(row => {
            const currency = row[5] as string;
            const rawRevenue = row[6] as number;
            const rate = (currency && currency !== 'USD' && exchangeRates[currency])
                ? exchangeRates[currency]
                : 1;
            const usdRevenue = rawRevenue * rate;
            return [
                row[0], row[1], row[2], row[3],
                {
                    type: 'value_with_unit' as const,
                    value: usdRevenue,
                    display: `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usdRevenue)}`
                }
            ];
        });
    }, [processedData.products.rows, globalUsdMode, exchangeRates]);

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
                    <div style={isDesktop ? { height: 'calc(100vh - 140px)' } : {}}>
                        <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                            <DataTable
                                headers={processedData.products.headers}
                                data={displayRows}
                                autoHeight={!isDesktop} // Internal scroll only on desktop
                            />
                        </Suspense>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductsTab;
