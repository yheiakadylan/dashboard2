import React, { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';

interface FilterPopoverProps {
    sourceFilter: string;
    statusFilter: string;
    onApply: (source: string, status: string) => void;
    className?: string;
}

const FilterPopover: React.FC<FilterPopoverProps> = ({
    sourceFilter,
    statusFilter,
    onApply,
    className = ''
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const hasActiveFilters = sourceFilter !== 'All' || statusFilter !== 'All';

    const handleOptionClick = (type: 'source' | 'status', value: string) => {
        if (type === 'source') {
            onApply(value, statusFilter);
        } else {
            onApply(sourceFilter, value);
        }
        // Keep open for multiple selections
    };

    const handleReset = () => {
        onApply('All', 'All');
        setIsOpen(false); // Close on full reset? Or keep open? Usually Reset closes or resets view. Closing is fine.
    };

    const renderOption = (label: string, value: string, current: string, type: 'source' | 'status') => (
        <button
            onClick={() => handleOptionClick(type, value)}
            className={`
                px-3 py-1.5 text-xs font-medium rounded-md border transition-all
                ${current === value
                    ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/40 dark:border-blue-800 dark:text-blue-400 shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700'
                }
            `}
        >
            {label}
        </button>
    );

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors
                    ${hasActiveFilters || isOpen
                        ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400'
                        : 'bg-gray-100 border-gray-300 text-gray-800 hover:bg-gray-200 dark:text-white dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                    }
                `}
            >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">Filter</span>
                {hasActiveFilters && (
                    <span className="flex h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400 ml-0.5" />
                )}
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 p-4 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    <div className="space-y-5">
                        {/* Source Section */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Source
                                </label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {renderOption('All', 'All', sourceFilter, 'source')}
                                {renderOption('Etsy', 'Etsy_Sales', sourceFilter, 'source')}
                                {renderOption('eBay', 'Ebay_Sales', sourceFilter, 'source')}
                            </div>
                        </div>

                        {/* Status Section */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Status
                                </label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {renderOption('All', 'All', statusFilter, 'status')}
                                {renderOption('New', 'New', statusFilter, 'status')}
                                {renderOption('Refunded', 'Refunded', statusFilter, 'status')}
                            </div>
                        </div>
                    </div>

                    {/* Footer - Reset Only */}
                    {hasActiveFilters && (
                        <div className="mt-5 pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
                            <button
                                onClick={handleReset}
                                className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors flex items-center gap-1"
                            >
                                Reset All Filters
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default FilterPopover;
