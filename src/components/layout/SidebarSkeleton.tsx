import React from 'react';

interface SidebarSkeletonProps {
    isCollapsed: boolean;
}

const SidebarSkeleton: React.FC<SidebarSkeletonProps> = ({ isCollapsed }) => {
    return (
        <aside
            className={`
                hidden md:flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700
                flex-shrink-0 h-screen transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                ${isCollapsed ? 'w-16' : 'w-64'}
            `}
        >
            {/* Header Placeholder */}
            <div className="h-16 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between p-4">
                <div className={`h-6 bg-gray-200 dark:bg-gray-700 rounded w-24 ${isCollapsed ? 'hidden' : 'block'}`}></div>
                <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>

            {/* Nav Items Placeholder */}
            <div className="flex-1 py-4 px-2 space-y-1">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="flex items-center px-3 py-2.5">
                        <div className="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded flex-shrink-0"></div>
                        <div className={`ml-3 h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 transition-opacity duration-300 ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}></div>
                    </div>
                ))}
            </div>

            {/* Footer Placeholder */}
            <div className={`border-t border-gray-200 dark:border-gray-700 space-y-2 ${isCollapsed ? 'p-2' : 'p-4'}`}>
                {[1, 2].map((i) => (
                    <div key={i} className="flex items-center px-3 py-2.5">
                        <div className="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded flex-shrink-0"></div>
                        <div className={`ml-3 h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 transition-opacity duration-300 ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}></div>
                    </div>
                ))}
            </div>
        </aside>
    );
};

export default SidebarSkeleton;
