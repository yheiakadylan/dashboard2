import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

/**
 * Shared Pagination component to ensure consistent UI across all tabs
 */
const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;

    return (
        <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center gap-4">
            <button
                onClick={() => onPageChange(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-30 transition-all shadow-sm"
            >
                <ChevronLeft size={14} /> Previous
            </button>
            <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    // Show pages around current page
                    let pageNum = i;
                    if (totalPages > 5) {
                        if (currentPage > 2) {
                            pageNum = currentPage - 2 + i;
                            if (pageNum >= totalPages) pageNum = totalPages - (5 - i);
                        }
                    }

                    return (
                        <button
                            key={pageNum}
                            onClick={() => onPageChange(pageNum)}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${currentPage === pageNum ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
                        >
                            {pageNum + 1}
                        </button>
                    );
                })}
            </div>
            <button
                onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
                disabled={currentPage >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-30 transition-all shadow-sm"
            >
                Next <ChevronRight size={14} />
            </button>
        </div>
    );
};

export default Pagination;
