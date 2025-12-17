import React from 'react';

interface SkeletonLoaderProps {
  variant?: 'table-row' | 'card' | 'chart' | 'kpi-card';
  count?: number;
  className?: string;
}

/**
 * Skeleton Loader Component
 * Provides animated placeholder loading states for better UX
 */
const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = 'table-row',
  count = 1,
  className = ''
}) => {
  const skeletons = Array.from({ length: count }, (_, i) => i);

  const baseClasses = 'animate-pulse bg-gray-200 dark:bg-gray-700 rounded';

  if (variant === 'table-row') {
    return (
      <>
        {skeletons.map((index) => (
          <div
            key={index}
            className={`flex items-center gap-4 p-4 border-b border-gray-200 dark:border-gray-700 h-24 ${className}`}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            {/* Image placeholder */}
            <div className={`${baseClasses} w-16 h-16 flex-shrink-0`} />

            {/* Content placeholders */}
            <div className="flex-1 space-y-3">
              <div className={`${baseClasses} h-4 w-3/4`} />
              <div className={`${baseClasses} h-3 w-1/2`} />
            </div>

            {/* Action placeholders */}
            <div className="flex gap-2">
              <div className={`${baseClasses} h-8 w-20`} />
              <div className={`${baseClasses} h-8 w-20`} />
            </div>
          </div>
        ))}
      </>
    );
  }

  if (variant === 'card') {
    return (
      <>
        {skeletons.map((index) => (
          <div
            key={index}
            className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4 min-h-[250px] ${className}`}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            {/* Card header with image and title */}
            <div className="flex gap-4 mb-3">
              <div className={`${baseClasses} w-[75px] h-[75px] flex-shrink-0`} />
              <div className="flex-1 space-y-2">
                <div className={`${baseClasses} h-3 w-1/4`} />
                <div className={`${baseClasses} h-5 w-3/4`} />
                <div className={`${baseClasses} h-3 w-1/2`} />
              </div>
            </div>

            {/* Card body - grid of fields */}
            <div className="grid grid-cols-2 gap-4 mb-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="space-y-1">
                  <div className={`${baseClasses} h-2 w-16`} />
                  <div className={`${baseClasses} h-4 w-24`} />
                </div>
              ))}
            </div>

            {/* Card footer - action buttons */}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <div className={`${baseClasses} h-8 w-20`} />
            </div>
          </div>
        ))}
      </>
    );
  }

  if (variant === 'chart') {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6 h-80 ${className}`}>
        {/* Chart title */}
        <div className={`${baseClasses} h-6 w-48 mb-6`} />

        {/* Chart bars/visualization */}
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="flex items-center gap-3">
              <div className={`${baseClasses} h-3 w-24 flex-shrink-0`} />
              <div
                className={`${baseClasses} h-8`}
                style={{ width: `${Math.random() * 60 + 40}%` }}
              />
              <div className={`${baseClasses} h-3 w-16 flex-shrink-0`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'kpi-card') {
    return (
      <>
        {skeletons.map((index) => (
          <div
            key={index}
            className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 h-32 ${className}`}
            style={{ animationDelay: `${index * 0.05}s` }}
          >
            <div className={`${baseClasses} h-4 w-32 mb-4`} />
            <div className={`${baseClasses} h-8 w-24`} />
          </div>
        ))}
      </>
    );
  }

  return null;
};

export default SkeletonLoader;
