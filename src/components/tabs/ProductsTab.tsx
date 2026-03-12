import React, { Suspense, useMemo, useCallback, useState, useEffect } from 'react';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { ProcessedData } from '../../types';
import DataTable from '../ui/DataTable';
import useMediaQuery from '../../hooks/useMediaQuery';
import { useUI } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { Tag } from 'lucide-react';
import CategoryManagementModal from '../modals/CategoryManagementModal';
import { useNotification } from '../../contexts/NotificationContext';

import TopProductsChart from '../charts/TopProductsChart';
import Pagination from '../ui/Pagination';
import { Search, Filter, CheckSquare, X, ChevronRight, Zap, Package, ChevronLeft } from 'lucide-react';

const ITEMS_PER_PAGE = 200;

interface ProductsTabProps {
    processedData: ProcessedData;
}

const ProductsTab: React.FC<ProductsTabProps> = ({ processedData }) => {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const { globalUsdMode } = useUI();
    const { exchangeRates, categories, updateMapping, bulkSaveCategories } = useDashboard();
    const { addNotification } = useNotification();
    
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [isSavingCategories, setIsSavingCategories] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('Unmapped');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(0);
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

    // Filtered Rows based on Search and Category
    const filteredRows = useMemo(() => {
        let rows = processedData.products.rows;

        // Apply Category Filter first (faster)
        if (categoryFilter !== 'All') {
            rows = rows.filter(row => {
                const rowCatCode = row[9] || row[2]; // Use hidden code or fallback to display name
                if (categoryFilter === 'Unmapped') {
                    return String(rowCatCode).toLowerCase() === 'unmapped' || !rowCatCode;
                }
                return rowCatCode === categoryFilter;
            });
        }

        // Apply Advanced Search (Name + Variant)
        if (searchTerm) {
            rows = rows.filter(row => {
                const name = String(row[1] || '');
                const variant = String(row[3] || '');
                const combined = `${name} ${variant}`;
                return filterByAdvancedSearch(combined, searchTerm);
            });
        }
        
        return rows;
    }, [processedData.products.rows, searchTerm, categoryFilter, filterByAdvancedSearch]);

    const handleSelectAll = useCallback(() => {
        const allFilteredKeys = filteredRows.map(row => `${row[1]}|${row[3]}`);
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

    // Headers: ['Checkbox', 'Image', 'Product Name', 'Category', 'Variant/Size', 'Shop', 'Quantity', 'Revenue']
    const displayRows = useMemo(() => {
        const rows = filteredRows;
        
        return rows.map(row => {
            const pName = row[1] as string;
            const pCategory = row[2] as string;
            const pVariant = row[3] as string;
            const rowKey = `${pName}|${pVariant}`;

            const checkbox = {
                type: 'checkbox' as const,
                idKey: rowKey,
                checked: selectedIds.has(rowKey)
            };

            const categoryComponent = {
                type: 'mapping_select' as const,
                value: row[9] || pCategory, // Use code (row[9]) for select value, fallback to display name
                name: pName,
                variant: pVariant,
                categories: categories,
                onCategoryChange: handleCategoryChange
            };

            const currency = row[7] as string;
            const rawRevenue = row[8] as number;
            
            let revenueCell = row[6];
            
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
                categoryComponent, 
                pVariant, 
                row[4], 
                row[5], 
                revenueCell
            ];
        });
    }, [filteredRows, globalUsdMode, exchangeRates, categories, handleCategoryChange, selectedIds]);

    const headers = ['Select', ...processedData.products.headers];

    const totalPages = Math.ceil(displayRows.length / ITEMS_PER_PAGE);
    const paginatedRows = useMemo(() => {
        return displayRows.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
    }, [displayRows, currentPage]);

    return (
        <div className="flex flex-col min-h-0 h-full bg-gray-50 dark:bg-gray-900">
            <div className="flex-1 overflow-y-auto p-2 md:p-6 pb-24 md:pb-6">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
                        <ChartErrorBoundary>
                            <TopProductsChart
                                data={processedData.summary.topProductsByShop}
                                title="Top Products by Shop"
                            />
                        </ChartErrorBoundary>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
                        <ChartErrorBoundary>
                            <TopProductsChart
                                data={{ "Comparison": processedData.summary.categoryComparison }}
                                title="Sales by Category"
                                hideTitle={false}
                                onItemClick={handleCategoryClick}
                            />
                        </ChartErrorBoundary>
                    </div>
                </div>

                <div className="mb-8" ref={inventoryRef} id="inventory-section">
                    <div className="flex flex-col h-[750px] border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50/50 dark:bg-gray-800/50 relative">
                            {/* Simple Selection Overlay (Overlay Header when selecting) */}
                            {selectedIds.size > 0 && (
                                <div className="absolute inset-0 z-20 bg-indigo-600 text-white flex flex-col sm:flex-row items-center justify-between p-4 gap-4 animate-in fade-in duration-200">
                                    <div className="flex items-center gap-6">
                                        <div className="flex flex-col">
                                            <span className="text-lg font-bold leading-tight">{selectedIds.size} Selected</span>
                                            <div className="flex gap-4">
                                                <button onClick={handleSelectAll} className="text-[10px] underline text-indigo-100 hover:text-white uppercase font-bold tracking-wider">Select all {filteredRows.length}</button>
                                                <button onClick={() => setSelectedIds(new Set())} className="text-[10px] underline text-indigo-100 hover:text-white uppercase font-bold tracking-wider">Clear Selection</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 w-full sm:w-auto">
                                        <span className="text-xs font-semibold whitespace-nowrap">Bulk Map to:</span>
                                        <select 
                                            className="bg-indigo-700 border border-indigo-500 text-white text-sm rounded-lg p-2 focus:ring-2 focus:ring-white/50 outline-none w-full sm:w-56"
                                            onChange={(e) => e.target.value && handleBulkApply(e.target.value)}
                                            defaultValue=""
                                        >
                                            <option value="" disabled>-- Select Category --</option>
                                            {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
                                                <option key={cat.code} value={cat.code}>{cat.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}
                            <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
                                <div className="flex items-center gap-4">
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                        <Package size={20} className="text-indigo-600" />
                                        Details
                                    </h3>
                                    <button
                                        onClick={handleSelectAll}
                                        className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 hover:text-indigo-600 transition-all shadow-sm"
                                    >
                                        {filteredRows.length > 0 && filteredRows.every(row => selectedIds.has(`${row[1]}|${row[3]}`)) ? (
                                            <React.Fragment key="deselect">
                                                <X size={12} className="text-red-500" />
                                                <span>Deselect All</span>
                                            </React.Fragment>
                                        ) : (
                                            <React.Fragment key="select">
                                                <CheckSquare size={12} className="text-indigo-500" />
                                                <span>Select All</span>
                                            </React.Fragment>
                                        )}
                                    </button>
                                </div>
                                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                                    <div className="relative w-full sm:w-96 group">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Search size={14} className="text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                                        </div>
                                        <input
                                            type="text"
                                            placeholder="Search (+include, -exclude)..."
                                            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-900 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-sm"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-[10px] text-gray-400 font-mono">
                                            {filteredRows.length} found
                                        </div>
                                    </div>
                                    <div className="relative w-full sm:w-48 group">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Filter size={14} className="text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                                        </div>
                                        <select
                                            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-900 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                                            value={categoryFilter}
                                            onChange={(e) => setCategoryFilter(e.target.value)}
                                        >
                                            <option value="All">All Categories</option>
                                            <option value="Unmapped">Unmapped</option>
                                            <optgroup label="Category">
                                                {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
                                                    <option key={cat.code} value={cat.code}>{cat.name}</option>
                                                ))}
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 w-full md:w-auto">
                                {totalPages > 1 && (
                                    <div className="flex items-center gap-2 bg-white dark:bg-gray-700 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-600 shadow-sm">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                                            disabled={currentPage === 0}
                                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronLeft size={16} />
                                        </button>
                                        <span className="text-xs font-bold text-gray-600 dark:text-gray-300 min-w-[60px] text-center">
                                            {currentPage + 1} / {totalPages}
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                                            disabled={currentPage >= totalPages - 1}
                                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                )}
                                <button
                                    onClick={() => setIsCategoryModalOpen(true)}
                                    className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md hover:shadow-lg transition-all font-semibold text-sm flex-1 md:flex-none active:scale-95"
                                >
                                    <Tag size={16} />
                                    <span>Category</span>
                                </button>
                            </div>
                        </div>



                        <div className="flex-1 min-h-0 relative">
                            <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                                <DataTable
                                    headers={headers}
                                    data={paginatedRows}
                                    autoHeight={!isDesktop}
                                    selectedKeys={selectedIds}
                                    onToggleSelect={toggleSelect}
                                    onRowClick={(row) => {
                                        const pName = row[2] as string;
                                        const pVariant = row[4] as string;
                                        toggleSelect(`${pName}|${pVariant}`);
                                    }}
                                    columnWidths={{
                                        'Select': 50,
                                        'Image': 80,
                                        'Product Name': 350,
                                        'Category': 160,
                                        'Variant/Size': 180,
                                        'Shop': 120,
                                        'Quantity': 80,
                                        'Revenue': 120
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
