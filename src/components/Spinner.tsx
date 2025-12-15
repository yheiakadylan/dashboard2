import React from 'react';

interface SpinnerProps {
    /** Size of the spinner: 'xs' | 'sm' | 'md' | 'lg' | 'xl' */
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    /** Custom color classes for the spinner (e.g., 'text-blue-600 dark:text-blue-500') */
    color?: string;
    /** Additional CSS classes */
    className?: string;
}

/**
 * Reusable Spinner Component
 * A flexible loading spinner with customizable size and color
 */
const Spinner: React.FC<SpinnerProps> = ({
    size = 'md',
    color = 'text-blue-600 dark:text-blue-500',
    className = ''
}) => {
    // Size mappings
    const sizeClasses = {
        xs: 'h-3 w-3',
        sm: 'h-4 w-4',
        md: 'h-5 w-5',
        lg: 'h-8 w-8',
        xl: 'h-10 w-10'
    };

    return (
        <svg
            className={`animate-spin ${sizeClasses[size]} ${color} ${className}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
        >
            <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
            />
            <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
        </svg>
    );
};

export default Spinner;
