import React from 'react';

export type EmptyStateVariant = 'no-data' | 'no-results' | 'error' | 'no-orders';

interface EmptyStateProps {
    variant?: EmptyStateVariant;
    title?: string;
    description?: string;
    icon?: React.ReactNode;
    primaryAction?: {
        label: string;
        onClick: () => void;
    };
    secondaryAction?: {
        label: string;
        onClick: () => void;
    };
    className?: string;
}

/**
 * Empty State Component
 * Beautiful empty states with icons, messages, and action buttons
 */
const EmptyState: React.FC<EmptyStateProps> = ({
    variant = 'no-data',
    title,
    description,
    icon,
    primaryAction,
    secondaryAction,
    className = ''
}) => {
    // Default configurations for each variant
    const variantConfig = {
        'no-data': {
            icon: (
                <svg className="w-20 h-20 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
            ),
            title: 'No Data Available',
            description: 'There is no data to display at the moment. Try adjusting your filters or date range.',
            color: 'text-gray-400 dark:text-gray-500'
        },
        'no-results': {
            icon: (
                <svg className="w-20 h-20 text-blue-300 dark:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            ),
            title: 'No Results Found',
            description: 'We couldn\'t find any matches for your search. Try different keywords or clear your filters.',
            color: 'text-blue-400 dark:text-blue-500'
        },
        'error': {
            icon: (
                <svg className="w-20 h-20 text-red-300 dark:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            ),
            title: 'Oops! Something Went Wrong',
            description: 'We encountered an error while loading your data. Please try again.',
            color: 'text-red-400 dark:text-red-500'
        },
        'no-orders': {
            icon: (
                <svg className="w-20 h-20 text-purple-300 dark:text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
            ),
            title: 'No Orders Yet',
            description: 'You don\'t have any orders in this period. Orders will appear here once they\'re received.',
            color: 'text-purple-400 dark:text-purple-500'
        }
    };

    const config = variantConfig[variant];
    const displayIcon = icon || config.icon;
    const displayTitle = title || config.title;
    const displayDescription = description || config.description;

    return (
        <div className={`flex flex-col items-center justify-center p-8 md:p-12 text-center ${className}`}>
            {/* Icon */}
            <div className="mb-6 animate-in fade-in zoom-in duration-500">
                {displayIcon}
            </div>

            {/* Title */}
            <h3 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white mb-3">
                {displayTitle}
            </h3>

            {/* Description */}
            <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6 text-sm md:text-base">
                {displayDescription}
            </p>

            {/* Actions */}
            {(primaryAction || secondaryAction) && (
                <div className="flex flex-col sm:flex-row gap-3 mt-2">
                    {primaryAction && (
                        <button
                            onClick={primaryAction.onClick}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                        >
                            {primaryAction.label}
                        </button>
                    )}
                    {secondaryAction && (
                        <button
                            onClick={secondaryAction.onClick}
                            className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium rounded-lg shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                        >
                            {secondaryAction.label}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

// Memoize presentational component
export default React.memo(EmptyState);
