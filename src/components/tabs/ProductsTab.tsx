import React, { Suspense, useMemo, useCallback, useState, useEffect } from 'react';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../ui/DataTable';
import { useUI } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { hasPermission } from '../../utils/permissionHelper';
import { useNotification } from '../../contexts/NotificationContext';
import Pagination from '../ui/Pagination';
import { Search, Filter, CheckSquare, X, ChevronRight, Zap, Package, ChevronLeft, Check, ChevronDown, Tag } from 'lucide-react';
import { exportInventoryToExcel } from '../../utils/excelExport';

const TopProductsChart = React.lazy(() => import('../charts/TopProductsChart'));
import { db } from '../../services/firebaseService';
import { collection, getDocs } from 'firebase/firestore';

const ITEMS_PER_PAGE = 200;

const getStaffFromSku = (sku: string): string => {
    if (!sku || sku === '-') return 'Unknown';
    const parts = sku.split('-');
    if (parts.length > 1) {
        return parts[1] || 'Unknown';
    }
    return 'Unknown';
};

interface ProductsTabProps {
    processedData: ProcessedData;
}

const ProductsTab: React.FC<ProductsTabProps> = ({ processedData }) => {
    const { globalUsdMode } = useUI();
    const { exchangeRates, categories } = useDashboard();
    const { addNotification } = useNotification();

    const [isExporting, setIsExporting] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [currentPage, setCurrentPage] = useState(0);
    const [viewMode, setViewMode] = useState<'product' | 'variant' | 'staff'>('product');

    const [userDisplayNames, setUserDisplayNames] = useState<{ [empID: string]: string }>({});

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const usersCol = collection(db, 'users');
                const usersSnapshot = await getDocs(usersCol);
                const mapping: { [empID: string]: string } = {};
                usersSnapshot.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.empID && data.displayName) {
                        mapping[String(data.empID).trim()] = data.displayName;
                    }
                });
                setUserDisplayNames(mapping);
            } catch (e) {
                console.error("Error fetching users for staff mapping:", e);
            }
        };
        fetchUsers();
    }, []);
    
    const inventoryRef = React.useRef<HTMLDivElement>(null);

    const handleCategoryClick = useCallback((item: any) => {
        if (item.code) {
            setCategoryFilter(item.code);
        }

        // Scroll to inventory section
        inventoryRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // Reset page when filtering
    useEffect(() => {
        setCurrentPage(0);
    }, [searchTerm, categoryFilter]);



    // Advanced search logic: +include, -exclude
    const filterByAdvancedSearch = useCallback((text: string, query: string) => {
        if (!query) return true;
        const normalizedText = text.toLowerCase();
        const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);

        const positive = tokens.filter(t => !t.startsWith('-')).map(t => t.startsWith('+') ? t.substring(1) : t);
        const negative = tokens.filter(t => t.startsWith('-')).map(t => t.substring(1));

        // Must match ALL positive tokens
        const matchesPositive = positive.every(p => normalizedText.includes(p));
        if (!matchesPositive) return false;

        // Must match NONE of the negative tokens
        const matchesNegative = negative.some(n => normalizedText.includes(n));
        if (matchesNegative) return false;

        return true;
    }, []);

    // 1. Filter Products
    const filteredProducts = useMemo(() => {
        let rows = processedData.products.rows;
        if (categoryFilter !== 'All') {
            rows = rows.filter(row => {
                const rowCatCode = row[10] || row[3];
                return rowCatCode === categoryFilter;
            });
        }
        if (searchTerm) {
            rows = rows.filter(row => filterByAdvancedSearch(`${row[1]} ${row[2]} ${row[4]}`, searchTerm));
        }
        return rows;
    }, [processedData.products.rows, searchTerm, categoryFilter, filterByAdvancedSearch]);

    // 2. Filter Variants
    const filteredVariants = useMemo(() => {
        let rows = processedData.variants.rows;
        if (categoryFilter !== 'All') {
            rows = rows.filter(row => {
                const rowCatCode = row[6] || row[0];
                return rowCatCode === categoryFilter;
            });
        }
        if (searchTerm) {
            rows = rows.filter(row => filterByAdvancedSearch(String(row[1] || ''), searchTerm));
        }
        return rows;
    }, [processedData.variants.rows, searchTerm, categoryFilter, filterByAdvancedSearch]);

    // Final filtered list for display
    const filteredRows = useMemo(() => {
        if (viewMode === 'product') return filteredProducts;
        if (viewMode === 'variant') return filteredVariants;

        const staffMap = new Map<string, {
            staffCode: string;
            quantity: number;
            revenueUSD: number;
            revenuesByCurrency: { [currency: string]: number };
        }>();

        filteredProducts.forEach(row => {
            const sku = row[1] as string;
            const staffCode = getStaffFromSku(sku);
            const quantity = (row[6] as number) || 0;
            const currency = (row[8] as string) || 'USD';
            const rawRevenue = (row[9] as number) || 0;

            let rate = 1;
            if (exchangeRates && currency !== 'USD') {
                rate = exchangeRates[currency] || 1;
            }
            const revenueUSD = rawRevenue * rate;

            if (!staffMap.has(staffCode)) {
                staffMap.set(staffCode, {
                    staffCode,
                    quantity: 0,
                    revenueUSD: 0,
                    revenuesByCurrency: {}
                });
            }

            const staffData = staffMap.get(staffCode)!;
            staffData.quantity += quantity;
            staffData.revenueUSD += revenueUSD;
            staffData.revenuesByCurrency[currency] = (staffData.revenuesByCurrency[currency] || 0) + rawRevenue;
        });

        return Array.from(staffMap.values())
            .filter(staffData => !!userDisplayNames[staffData.staffCode])
            .sort((a, b) => b.revenueUSD - a.revenueUSD)
            .map(staffData => {
                let revenueCell;
                if (globalUsdMode && exchangeRates) {
                    revenueCell = {
                        type: 'value_with_unit' as const,
                        value: staffData.revenueUSD,
                        display: `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(staffData.revenueUSD)}`
                    };
                } else {
                    const currencies = Object.keys(staffData.revenuesByCurrency);
                    if (currencies.length === 0) {
                        revenueCell = {
                            type: 'value_with_unit' as const,
                            value: 0,
                            display: '$0.00 USD'
                        };
                    } else if (currencies.length === 1) {
                        const cur = currencies[0];
                        const val = staffData.revenuesByCurrency[cur];
                        revenueCell = {
                            type: 'value_with_unit' as const,
                            value: val,
                            display: `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)} ${cur}`
                        };
                    } else {
                        const displayStr = currencies
                            .map(cur => `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(staffData.revenuesByCurrency[cur])} ${cur}`)
                            .join(' + ');
                        revenueCell = {
                            type: 'value_with_unit' as const,
                            value: staffData.revenueUSD,
                            display: displayStr
                        };
                    }
                }

                const displayName = userDisplayNames[staffData.staffCode] || 'Unknown';

                return [
                    staffData.staffCode,
                    displayName,
                    staffData.quantity,
                    revenueCell
                ];
            });
    }, [viewMode, filteredProducts, filteredVariants, exchangeRates, globalUsdMode, userDisplayNames]);

    const handleExportInventory = useCallback(async () => {
        setIsExporting(true);
        try {
            const date = new Date().toISOString().split('T')[0];

            // For export, we always include ALL categories as per user request
            // but we still honor the search term if the user is looking for something specific
            const exportProducts = searchTerm ?
                processedData.products.rows.filter(row => filterByAdvancedSearch(`${row[1]} ${row[2]} ${row[4]}`, searchTerm)) :
                processedData.products.rows;

            const exportVariants = searchTerm ?
                processedData.variants.rows.filter(row => filterByAdvancedSearch(String(row[1] || ''), searchTerm)) :
                processedData.variants.rows;

            await exportInventoryToExcel(
                { ...processedData.products, rows: exportProducts },
                { ...processedData.variants, rows: exportVariants },
                true, // includeImages
                globalUsdMode,
                exchangeRates,
                `inventory_${date}.xlsx`
            );
        } catch (e) {
            addNotification('Export failed. Please try again.', 'error');
        } finally {
            setIsExporting(false);
        }
    }, [processedData.products, processedData.variants, searchTerm, filterByAdvancedSearch, globalUsdMode, exchangeRates, addNotification]);



    // Headers: ['Checkbox', 'Image', 'Product Name', 'Listing ID', 'Category', 'Variant/Size', 'Shop', 'Quantity', 'Revenue']
    const displayRows = useMemo(() => {
        const rows = filteredRows;

        if (viewMode === 'staff') {
            return rows;
        }

        if (viewMode === 'variant') {
            return rows.map(row => {
                const pCategory = row[0] as string;
                const pVariant = row[1] as string;
                const quantity = row[2];

                const currency = row[4] as string;
                const rawRevenue = row[5] as number;
                let revenueCell = row[3];

                if (globalUsdMode && exchangeRates) {
                    const rate = (currency && currency !== 'USD' && exchangeRates[currency]) ? exchangeRates[currency] : 1;
                    const usdRevenue = rawRevenue * rate;
                    revenueCell = {
                        type: 'value_with_unit' as const,
                        value: usdRevenue,
                        display: `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usdRevenue)}`
                    };
                }

                return [
                    pCategory,
                    pVariant,
                    quantity,
                    revenueCell
                ];
            });
        }

        return rows.map(row => {
            const pSku = row[1] as string;
            const pName = row[2] as string;
            const pCategory = row[3] as string;
            const pVariant = row[4] as string;
            const pGroupingKey = row[11] as string;


            const currency = row[8] as string; // Index 8 is currency
            const rawRevenue = row[9] as number; // Index 9 is raw revenue

            let revenueCell = row[7]; // Index 7 is formatted revenue

            if (globalUsdMode && exchangeRates) {
                const rate = (currency && currency !== 'USD' && exchangeRates[currency])
                    ? exchangeRates[currency]
                    : 1;
                const usdRevenue = rawRevenue * rate;
                revenueCell = {
                    type: 'value_with_unit' as const,
                    value: usdRevenue,
                    display: `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usdRevenue)}`
                };
            }

            return [
                row[0],
                pSku,
                pName,
                pCategory,
                pVariant,
                row[5], // Shop
                row[6], // Quantity
                revenueCell
            ];
        });
    }, [filteredRows, globalUsdMode, exchangeRates, categories, viewMode]);

    const headers = viewMode === 'product'
        ? processedData.products.headers
        : viewMode === 'staff'
            ? ['Staff Code', 'Staff Name', 'Quantity', 'Revenue']
            : processedData.variants.headers;

    const totalPages = Math.ceil(displayRows.length / ITEMS_PER_PAGE);
    const paginatedRows = useMemo(() => {
        return displayRows.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
    }, [displayRows, currentPage]);

    return (
        <div className="flex flex-col min-h-0 h-full bg-gray-50 dark:bg-gray-900">
            <div className="flex-1 overflow-y-auto p-2 md:p-6 pb-24 md:pb-6">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 relative hover:z-50 transition-all duration-300">
                        <ChartErrorBoundary>
                            <TopProductsChart
                                data={processedData.summary.topProductsByShop}
                                title="Top Products by Shop"
                            />
                        </ChartErrorBoundary>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 relative hover:z-50 transition-all duration-300">
                        <ChartErrorBoundary>
                            <TopProductsChart
                                data={{ "Comparison": processedData.summary.categoryComparison }}
                                detailedData={processedData.summary.topProductsByCategory}
                                title="Sales by Category"
                                hideTitle={false}
                                onItemClick={handleCategoryClick}
                            />
                        </ChartErrorBoundary>
                    </div>
                </div>

                <div className="mb-8" ref={inventoryRef} id="inventory-section">
                    <div className="flex flex-col h-auto md:h-[800px] border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-visible md:overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md relative z-30">
                            <div className="flex items-center justify-between w-full lg:w-auto gap-4">
                                {viewMode === 'product' ? (
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
                                            Product Summary
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">({filteredRows.length} items)</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
                                            {viewMode === 'staff' ? 'Staff Summary' : 'Variant Summary'}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">({filteredRows.length} items)</span>
                                    </div>
                                )}

                                {/* Export Button - Mobile Only here */}
                                <div className="lg:hidden flex-shrink-0">
                                    <button
                                        onClick={handleExportInventory}
                                        disabled={isExporting}
                                        className="flex items-center justify-center p-2.5 bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40 dark:text-green-400 rounded-xl transition-colors border border-green-200 dark:border-green-800 disabled:opacity-50 shadow-sm"
                                        title="Export Inventory"
                                    >
                                        {isExporting
                                            ? <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                                            : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto flex-1 lg:justify-end">
                                <div className="relative w-full sm:w-80 group">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Search size={16} className="text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Search products..."
                                        className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <span className="px-1.5 py-0.5 bg-gray-200/50 dark:bg-gray-800 rounded text-[9px] font-bold text-gray-500  tracking-tighter">
                                            {filteredRows.length} found
                                        </span>
                                    </div>
                                </div>

                                <div className="relative w-full sm:w-52">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Filter size={14} className="text-gray-400" />
                                    </div>
                                    <select
                                        className="w-full pl-9 pr-10 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none appearance-none cursor-pointer font-medium"
                                        value={viewMode}
                                        onChange={(e) => setViewMode(e.target.value as 'product' | 'variant' | 'staff')}
                                    >
                                        <option value="product">Group by Product</option>
                                        <option value="variant">Group by Variant</option>
                                        <option value="staff">Group by Staff</option>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <ChevronDown size={14} className="text-gray-400" />
                                    </div>
                                </div>

                                <div className="relative w-full sm:w-52">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Filter size={14} className="text-indigo-600" />
                                    </div>
                                    <select
                                        className="w-full pl-9 pr-10 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none appearance-none cursor-pointer font-medium"
                                        value={categoryFilter}
                                        onChange={(e) => setCategoryFilter(e.target.value)}
                                    >
                                        <option value="All">All Categories</option>
                                        <optgroup label="Categories">
                                            {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
                                                <option key={cat.code} value={cat.code}>{cat.name}</option>
                                            ))}
                                        </optgroup>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <ChevronDown size={14} className="text-gray-400" />
                                    </div>
                                </div>



                                {/* Export Button - Desktop Only here */}
                                <button
                                    onClick={handleExportInventory}
                                    disabled={isExporting}
                                    className="hidden lg:flex items-center justify-center p-2 bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40 dark:text-green-400 rounded-lg transition-colors border border-green-200 dark:border-green-800 disabled:opacity-50"
                                    title="Export Inventory (By Product + By Variant)"
                                >
                                    {isExporting
                                        ? <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                                        : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                                </button>
                            </div>
                        </div>



                        <div className="flex-1 min-h-0 relative">
                            <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                                <DataTable
                                    headers={headers}
                                    data={paginatedRows}
                                    columnWidths={viewMode === 'product' ? {
                                        'Image': 80,
                                        'SKU': 200,
                                        'Product Name': 300,
                                        'Category': 160,
                                        'Variant/Size': 180,
                                        'Shop': 120,
                                        'Quantity': 80,
                                        'Revenue': 120
                                    } : viewMode === 'staff' ? {
                                        'Staff Code': 150,
                                        'Staff Name': 200,
                                        'Quantity': 100,
                                        'Revenue': 150
                                    } : {
                                        'Category': 200,
                                        'Variant/Size': 400,
                                        'Quantity': 100,
                                        'Revenue': 200
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

export default ProductsTab;
