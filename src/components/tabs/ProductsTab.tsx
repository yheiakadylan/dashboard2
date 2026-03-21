import React, { Suspense, useMemo, useCallback, useState, useEffect } from 'react';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../ui/DataTable';
import { useUI } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { hasPermission } from '../../utils/permissionHelper';
import CategoryManagementModal from '../modals/CategoryManagementModal';
import { useNotification } from '../../contexts/NotificationContext';
import TopProductsChart from '../charts/TopProductsChart';
import Pagination from '../ui/Pagination';
import { Search, Filter, CheckSquare, X, ChevronRight, Zap, Package, ChevronLeft, Check, ChevronDown, Tag } from 'lucide-react';
import { exportInventoryToExcel } from '../../utils/excelExport';

const ITEMS_PER_PAGE = 200;

interface ProductsTabProps {
    processedData: ProcessedData;
}

const ProductsTab: React.FC<ProductsTabProps> = ({ processedData }) => {
    const { globalUsdMode } = useUI();
    const { exchangeRates, categories, updateMapping, bulkSaveCategories, role, permissions } = useDashboard();
    const { addNotification } = useNotification();

    const canManageMappings = useMemo(() => hasPermission(role, permissions, 'canManageMappings'), [role, permissions]);

    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [isSavingCategories, setIsSavingCategories] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('Unmapped');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(0);
    const [viewMode, setViewMode] = useState<'product' | 'variant'>('product');
    const { bulkUpdateMappings } = useDashboard();
    
    const inventoryRef = React.useRef<HTMLDivElement>(null);

    const handleCategoryClick = useCallback((item: any) => {
        if (item.code) {
            setCategoryFilter(item.code);
        } else if (item.name === 'Unmapped') {
            setCategoryFilter('Unmapped');
        }

        // Scroll to inventory section
        inventoryRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // Auto-select Unmapped if any exist, otherwise All
    useEffect(() => {
        if (processedData.products?.rows) {
            const hasUnmapped = processedData.products.rows.some(row => !row[10] || row[10] === 'Unmapped');
            if (hasUnmapped) {
                setCategoryFilter('Unmapped');
            } else {
                setCategoryFilter('All');
            }
        }
    }, [processedData.products]);

    // Reset page when filtering
    useEffect(() => {
        setCurrentPage(0);
    }, [searchTerm, categoryFilter]);

    const handleCategoryChange = useCallback(async (name: string, variant: string, categoryCode: string) => {
        try {
            await updateMapping({
                name: name.trim(),
                variant: '', // Always map at the product level for consistency
                category_code: categoryCode
            });
            const catName = categories.find(c => c.code === categoryCode)?.name || categoryCode;
            addNotification(`Mapped "${name}" to ${catName}`, 'success');
        } catch (error) {
            addNotification('Failed to update mapping', 'error');
        }
    }, [updateMapping, addNotification, categories]);

    const handleBulkApply = useCallback(async (categoryCode: string) => {
        if (selectedIds.size === 0) return;

        setIsSavingCategories(true);
        try {
            const mappingsToUpdate = Array.from(selectedIds).map(id => {
                const [name, variant] = id.split('|');
                return {
                    name,
                    variant: '', // Consistent with handleCategoryChange
                    category_code: categoryCode
                } as any;
            });

            await bulkUpdateMappings(mappingsToUpdate);
            const catName = categories.find(c => c.code === categoryCode)?.name || categoryCode;
            addNotification(`Bulk applied ${catName} to ${selectedIds.size} products`, 'success');
            setSelectedIds(new Set());
        } catch (error) {
            addNotification('Failed to bulk apply category', 'error');
        } finally {
            setIsSavingCategories(false);
        }
    }, [selectedIds, bulkUpdateMappings, addNotification, categories]);

    const toggleSelect = useCallback((key: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

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
                if (categoryFilter === 'Unmapped') return String(rowCatCode).toLowerCase() === 'unmapped' || !rowCatCode;
                return rowCatCode === categoryFilter;
            });
        }
        if (searchTerm) {
            rows = rows.filter(row => filterByAdvancedSearch(`${row[1]} ${row[4]}`, searchTerm));
        }
        return rows;
    }, [processedData.products.rows, searchTerm, categoryFilter, filterByAdvancedSearch]);

    // 2. Filter Variants
    const filteredVariants = useMemo(() => {
        let rows = processedData.variants.rows;
        if (categoryFilter !== 'All') {
            rows = rows.filter(row => {
                const rowCatCode = row[6] || row[0];
                if (categoryFilter === 'Unmapped') return String(rowCatCode).toLowerCase() === 'unmapped' || !rowCatCode;
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
        return viewMode === 'product' ? filteredProducts : filteredVariants;
    }, [viewMode, filteredProducts, filteredVariants]);

    const handleExportInventory = useCallback(async () => {
        setIsExporting(true);
        try {
            const date = new Date().toISOString().split('T')[0];

            // For export, we always include ALL categories as per user request
            // but we still honor the search term if the user is looking for something specific
            const exportProducts = searchTerm ?
                processedData.products.rows.filter(row => filterByAdvancedSearch(`${row[1]} ${row[4]}`, searchTerm)) :
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

    const handleSelectAll = useCallback(() => {
        const allFilteredKeys = filteredRows.map(row => `${row[1]}|${row[4]}`);
        const allSelected = allFilteredKeys.every(key => selectedIds.has(key));

        if (allSelected) {
            // Unselect all in current view
            setSelectedIds(prev => {
                const next = new Set(prev);
                allFilteredKeys.forEach(key => next.delete(key));
                return next;
            });
        } else {
            // Select all in current view
            setSelectedIds(prev => {
                const next = new Set(prev);
                allFilteredKeys.forEach(key => next.add(key));
                return next;
            });
        }
    }, [filteredRows, selectedIds]);

    // Headers: ['Checkbox', 'Image', 'Product Name', 'Listing ID', 'Category', 'Variant/Size', 'Shop', 'Quantity', 'Revenue']
    const displayRows = useMemo(() => {
        const rows = filteredRows;

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
            const pName = row[1] as string;
            const pListingId = row[2] as string;
            const pCategory = row[3] as string;
            const pVariant = row[4] as string;
            const rowKey = `${pName}|${pVariant}`;

            const checkbox = {
                type: 'checkbox' as const,
                idKey: rowKey,
                checked: selectedIds.has(rowKey)
            };

            const categoryComponent = canManageMappings ? {
                type: 'mapping_select' as const,
                value: row[10] || pCategory, // Index 10 is category code
                name: pName,
                variant: pVariant,
                categories: categories,
                onCategoryChange: handleCategoryChange
            } : pCategory;

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
                checkbox,
                row[0],
                pName,
                pListingId,
                categoryComponent,
                pVariant,
                row[5], // Shop
                row[6], // Quantity
                revenueCell
            ];
        });
    }, [filteredRows, globalUsdMode, exchangeRates, categories, handleCategoryChange, selectedIds, canManageMappings, viewMode]);

    const headers = viewMode === 'product' ? ['Select', ...processedData.products.headers] : processedData.variants.headers;

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
                            {/* Improved Selection Overlay */}
                            {selectedIds.size > 0 && canManageMappings && (
                                <div className="absolute inset-x-0 -top-[1px] -bottom-[1px] z-40 bg-indigo-50/95 dark:bg-indigo-900/90 backdrop-blur-sm border-y border-indigo-200 dark:border-indigo-800 flex items-center px-4 md:px-6 animate-in slide-in-from-top duration-300">
                                    <div className="flex items-center justify-between w-full">
                                        <div className="flex items-center gap-4 md:gap-8">
                                            <div className="flex items-center gap-3">
                                                <div className="hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600">
                                                    <Check size={16} className="text-white" strokeWidth={3} />
                                                </div>
                                                <div>
                                                    <p className="text-sm md:text-base font-bold text-indigo-900 dark:text-indigo-100 leading-none">{selectedIds.size} Items Selected</p>
                                                    <p className="hidden sm:block text-[10px] text-indigo-600 dark:text-indigo-400 uppercase tracking-wider font-bold mt-1">Bulk Mapping Mode</p>
                                                </div>
                                            </div>
                                            
                                            <div className="h-8 w-px bg-indigo-200 dark:bg-indigo-800 hidden md:block"></div>

                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={() => setSelectedIds(new Set())} 
                                                    className="px-3 py-1.5 md:px-4 md:py-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-2"
                                                >
                                                    <X size={14} />
                                                    <span>Deselect</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 md:gap-4">
                                            <span className="text-xs md:text-sm font-bold text-indigo-700 dark:text-indigo-300 hidden sm:block">Assign to:</span>
                                            <div className="relative group">
                                                <select 
                                                    className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs md:text-sm font-bold rounded-xl px-4 py-2 md:px-5 md:py-2.5 min-w-[160px] md:min-w-[220px] outline-none ring-1 ring-indigo-200 dark:ring-indigo-800 focus:ring-4 focus:ring-indigo-500/10 cursor-pointer appearance-none pr-10 hover:shadow-sm transition-all shadow-sm"
                                                    onChange={(e) => e.target.value && handleBulkApply(e.target.value)}
                                                    defaultValue=""
                                                >
                                                    <option value="" disabled>Choose Category...</option>
                                                    {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
                                                        <option key={cat.code} value={cat.code}>{cat.name}</option>
                                                    ))}
                                                </select>
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                                    <ChevronDown size={14} className="text-indigo-600" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between w-full lg:w-auto gap-4">
                                <label className="relative flex items-center gap-3 cursor-pointer group select-none">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="peer sr-only"
                                            checked={filteredRows.length > 0 && filteredRows.every(row => selectedIds.has(`${row[1]}|${row[4]}`))}
                                            onChange={handleSelectAll}
                                        />
                                        <div className="w-6 h-6 bg-white dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-600 rounded-lg transition-all peer-checked:bg-indigo-600 peer-checked:border-indigo-600 group-hover:border-indigo-500 shadow-sm"></div>
                                        <Check className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={4} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors uppercase tracking-wider">
                                            {filteredRows.length > 0 && filteredRows.every(row => selectedIds.has(`${row[1]}|${row[4]}`)) ? 'Deselect All' : 'Select All'}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">({filteredRows.length} items)</span>
                                    </div>
                                </label>

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
                                        onChange={(e) => setViewMode(e.target.value as 'product' | 'variant')}
                                    >
                                        <option value="product">Group by Product</option>
                                        <option value="variant">Group by Variant</option>
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
                                        <option value="Unmapped">Unmapped</option>
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

                                {canManageMappings && (
                                    <button
                                        onClick={() => setIsCategoryModalOpen(true)}
                                        className="flex items-center justify-center gap-2 h-[38px] px-5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl shadow-sm hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-bold text-xs uppercase tracking-widest active:scale-95 w-full sm:w-auto"
                                    >
                                        <Tag size={13} className="text-indigo-500" />
                                        <span>Category</span>
                                    </button>
                                )}

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
                                    selectedKeys={selectedIds}
                                    onToggleSelect={toggleSelect}
                                    onRowClick={(row) => {
                                        if (viewMode === 'variant') return;
                                        const pName = row[2] as string;
                                        const pVariant = row[5] as string;
                                        toggleSelect(`${pName}|${pVariant}`);
                                    }}
                                    columnWidths={viewMode === 'product' ? {
                                        'Select': 50,
                                        'Image': 80,
                                        'Product Name': 300,
                                        'Listing ID': 140,
                                        'Category': 160,
                                        'Variant/Size': 180,
                                        'Shop': 120,
                                        'Quantity': 80,
                                        'Revenue': 120
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

            <CategoryManagementModal
                isOpen={isCategoryModalOpen}
                onClose={() => setIsCategoryModalOpen(false)}
                existingCategories={categories}
                onSaveAll={async (newCats) => {
                    setIsSavingCategories(true);
                    try {
                        await bulkSaveCategories(newCats);
                        addNotification('Categories updated', 'success');
                    } catch (e) {
                        addNotification('Failed to update categories', 'error');
                        throw e;
                    } finally {
                        setIsSavingCategories(false);
                    }
                }}
                isLoading={isSavingCategories}
            />
        </div>
    );
};

export default ProductsTab;
