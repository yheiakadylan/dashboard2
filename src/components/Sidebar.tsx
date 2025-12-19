import React from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';

import { getPermittedTabs } from '../utils/permissions';
import {
    HomeIcon,
    DocumentTextIcon,
    QuestionMarkCircleIcon,
    TruckIcon,
    TagIcon
} from '@heroicons/react/24/outline';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar }) => {
    const { role, permissions, handleLogout } = useDashboard();
    const {
        activeTab,
        handleTabClick,
        tabOrder,
        hiddenTabs,
        setIsAccountManagerOpen,
        setIsTabSettingsOpen,
    } = useUI();


    // Filter tabs logic (duplicated from App.tsx temporarily, can be refactored)
    // Filter tabs logic
    const permittedTabs = getPermittedTabs(tabOrder, role, permissions);

    const getIconForTab = (tab: string, className: string = "h-5 w-5") => {
        switch (tab) {
            case 'Overview': return <HomeIcon className={className} />;
            case 'Order List': return <DocumentTextIcon className={className} />;

            case 'Support': return <QuestionMarkCircleIcon className={className} />;
            case 'Fulfill': return <TruckIcon className={className} />;

            case 'Products': return <TagIcon className={className} />;
            default: return <HomeIcon className={className} />;
        }
    };

    return (
        <aside
            className={`
        hidden md:flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700
        transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] h-screen overflow-hidden flex-shrink-0
        ${isCollapsed ? 'w-16' : 'w-64'}
      `}
            style={{ willChange: 'width' }}
        >
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
                {/* Header Title Removed */}
                <div className={`${isCollapsed ? 'hidden' : 'block'}`}></div>
                <button
                    onClick={toggleSidebar}
                    className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 focus:outline-none ml-auto"
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    {isCollapsed ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                    )}
                </button>
            </div>

            <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4">
                <ul className="space-y-1 px-2">
                    {/* Filter tabs based on explicit logic + user preferences */}
                    {tabOrder.filter(tab => {
                        // 1. Check permissions
                        if (!permittedTabs.includes(tab)) return false;

                        // 2. Hardcoded exclusions (Legacy tabs already removed from types, but double check)
                        // Removed distinct check for eBay/Etsy as they are no longer in Tab type

                        // 3. Check user preference
                        if (hiddenTabs.has(tab)) return false;

                        return true;
                    }).map(tab => {
                        const isActive = activeTab === tab;
                        return (
                            <li key={tab}>
                                <button
                                    onClick={() => handleTabClick(tab)}
                                    className={`
                    w-full flex items-center px-3 py-2.5 rounded-lg transition-colors group relative
                    ${isActive
                                            ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200'
                                        }
                  `}
                                    title={isCollapsed ? tab : undefined}
                                >
                                    <div className={`flex-shrink-0 ${isActive && !isCollapsed ? 'animate-bounce-subtle' : ''}`}>
                                        {getIconForTab(tab)}
                                    </div>
                                    <span
                                        className={`
                      font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300
                      ${isCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[150px] ml-3'}
                    `}
                                    >
                                        {tab.toUpperCase()}
                                    </span>

                                    {/* Tooltip for collapsed mode */}
                                    {isCollapsed && (
                                        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                                            {tab.toUpperCase()}
                                        </div>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            <div className={`border-t border-gray-200 dark:border-gray-700 space-y-2 ${isCollapsed ? 'p-2' : 'p-4'}`}>
                <button
                    onClick={() => setIsTabSettingsOpen(true)}
                    className={`
                    w-full flex items-center py-2.5 rounded-lg transition-colors group relative
                    ${isCollapsed ? 'justify-center px-0' : 'px-3'}
                    text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200
                `}
                    title={isCollapsed ? "Customize Tabs" : undefined}
                >
                    <div className="flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                    </div>
                    <span
                        className={`
                      font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300
                      ${isCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[150px] ml-3'}
                    `}
                    >
                        Customize Tab
                    </span>
                    {isCollapsed && (
                        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            Customize Tab
                        </div>
                    )}
                </button>

                {/* Settings - All users can access for notification preferences */}
                <button
                    onClick={() => setIsAccountManagerOpen(true)}
                    className={`
                    w-full flex items-center py-2.5 rounded-lg transition-colors group relative
                    ${isCollapsed ? 'justify-center px-0' : 'px-3'}
                    text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200
                `}
                    title={isCollapsed ? "Settings" : undefined}
                >
                    <div className="flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </div>
                    <span
                        className={`
                      font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300
                      ${isCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[150px] ml-3'}
                    `}
                    >
                        Settings
                    </span>
                    {isCollapsed && (
                        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            Settings
                        </div>
                    )}
                </button>

                <button
                    onClick={handleLogout}
                    className={`
                w-full flex items-center py-2.5 rounded-lg transition-colors group relative
                ${isCollapsed ? 'justify-center px-0' : 'px-3'}
                text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-400
            `}
                    title={isCollapsed ? "Logout" : undefined}
                >
                    <div className="flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </div>
                    <span
                        className={`
                  font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300
                  ${isCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[150px] ml-3'}
                `}
                    >
                        Logout
                    </span>
                    {isCollapsed && (
                        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            Logout
                        </div>
                    )}
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;

