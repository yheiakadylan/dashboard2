import React from 'react';
import { X } from 'lucide-react';

interface ActiveFilterTagsProps {
    sourceFilter: string;
    statusFilter: string;
    onRemoveSource: () => void;
    onRemoveStatus: () => void;
    onClearAll: () => void;
}

const ActiveFilterTags: React.FC<ActiveFilterTagsProps> = ({
    sourceFilter,
    statusFilter,
    onRemoveSource,
    onRemoveStatus,
    onClearAll
}) => {
    const hasSource = sourceFilter !== 'All';
    const hasStatus = statusFilter !== 'All';

    if (!hasSource && !hasStatus) return null;

    const formatFilterValue = (val: string) => {
        if (val === 'Etsy_Sales') return 'Etsy';
        if (val === 'Ebay_Sales') return 'eBay';
        return val;
    };

    return (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50/90 dark:bg-gray-800/90 backdrop-blur-md border-t border-gray-200 dark:border-gray-700 animate-in slide-in-from-top-1 duration-200">
            <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mr-1">
                Active:
            </span>

            {hasSource && (
                <div className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-600 shadow-sm transition-all hover:bg-gray-50 dark:hover:bg-gray-600">
                    <span className="ml-0.5">Source: <span className="text-blue-600 dark:text-blue-400 font-bold">{formatFilterValue(sourceFilter)}</span></span>
                    <button
                        onClick={onRemoveSource}
                        className="ml-1 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-full p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        title="Remove filter"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {hasStatus && (
                <div className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-600 shadow-sm transition-all hover:bg-gray-50 dark:hover:bg-gray-600">
                    <span className="ml-0.5">Status: <span className="text-purple-600 dark:text-purple-400 font-bold">{statusFilter}</span></span>
                    <button
                        onClick={onRemoveStatus}
                        className="ml-1 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-full p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        title="Remove filter"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {(hasSource || hasStatus) && (
                <button
                    onClick={onClearAll}
                    className="ml-auto text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 font-semibold hover:underline transition-colors px-2 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/10"
                >
                    Clear All
                </button>
            )}
        </div>
    );
};

export default ActiveFilterTags;
