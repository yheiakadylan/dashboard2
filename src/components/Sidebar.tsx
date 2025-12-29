import React from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import { getPermittedTabs } from '../utils/permissions';
import {
    Home,
    FileText,
    HelpCircle,
    Truck,
    Tag,
    ChevronLeft,
    ChevronRight,
    SlidersHorizontal,
    Settings,
    LogOut,
    FileSpreadsheet
} from 'lucide-react';

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
        setIsOrderSelectorOpen
    } = useUI();


    // Filter tabs logic
    const permittedTabs = getPermittedTabs(tabOrder, role, permissions);

    const getIconForTab = (tab: string, className: string = "h-5 w-5") => {
        switch (tab) {
            case 'Overview': return <Home className={className} />;
            case 'Order List': return <FileText className={className} />;

            case 'Support': return <HelpCircle className={className} />;
            case 'Fulfill': return <Truck className={className} />;

            case 'Products': return <Tag className={className} />;
            default: return <Home className={className} />;
        }
    };

    return (
        <aside
            className={`
        hidden md:flex flex-col glass-base border-r border-gray-200 dark:border-gray-700
        transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] h-screen overflow-hidden flex-shrink-0
        ${isCollapsed ? 'w-16' : 'w-64'}
      `}
            style={{ willChange: 'width' }}
        >
            <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className={`${isCollapsed ? 'hidden' : 'block'}`}></div>
                <button
                    onClick={toggleSidebar}
                    className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 focus:outline-none ml-auto"
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    {isCollapsed ? (
                        <ChevronRight className="h-5 w-5" />
                    ) : (
                        <ChevronLeft className="h-5 w-5" />
                    )}
                </button>
            </div>

            <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4">
                <ul className="space-y-1 px-2">
                    {tabOrder.filter(tab => {
                        // 1. Check permissions
                        if (!permittedTabs.includes(tab)) return false;

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
                {/* Sync to Sheet Button - Added here */}
                <button
                    onClick={() => {
                        if (activeTab !== 'Order List') handleTabClick('Order List');
                        setIsOrderSelectorOpen(true);
                    }}
                    className={`
                    w-full flex items-center py-2.5 rounded-lg transition-colors group relative
                    ${isCollapsed ? 'justify-center px-0' : 'px-3'}
                    text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-300
                `}
                    title={isCollapsed ? "Sync to Sheet" : undefined}
                >
                    <div className="flex-shrink-0">
                        <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <span
                        className={`
                      font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300
                      ${isCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[150px] ml-3'}
                    `}
                    >
                        Sync to Sheet
                    </span>
                    {isCollapsed && (
                        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            Sync to Sheet
                        </div>
                    )}
                </button>

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
                        <SlidersHorizontal className="h-5 w-5" />
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
                        <Settings className="h-5 w-5" />
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
                        <LogOut className="h-5 w-5" />
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
