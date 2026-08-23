import React from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUIModals, useUISettings, useUITabs } from '../../contexts/UIContext';
import { getPermittedTabs } from '../../utils/permissions';
import { hasPermission } from '../../utils/permissionHelper';
import {
    Home,
    FileText,
    HelpCircle,
    Truck,
    Tag,
    ChevronsLeft,
    ChevronsRight,
    SlidersHorizontal,
    Download,
    Star,
    Palette,
    ClipboardCheck,
    FileSpreadsheet,
    BriefcaseBusiness
} from 'lucide-react';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar }) => {
    const { role, permissions, handleExport, isExporting } = useDashboard();
    const {
        activeTab,
        handleTabClick,
        tabOrder,
        hiddenTabs
    } = useUITabs();
    const { setIsTabSettingsOpen } = useUIModals();
    const { globalUsdMode, setGlobalUsdMode } = useUISettings();



    // Filter tabs logic
    const permittedTabs = getPermittedTabs(tabOrder, role, permissions);

    const getIconForTab = (tab: string, className: string = "h-5 w-5") => {
        switch (tab) {
            case 'Overview': return <Home className={className} />;
            case 'Order List': return <FileText className={className} />;
            case 'Support': return <HelpCircle className={className} />;
            case 'Fulfill': return <Truck className={className} />;
            case 'Products': return <Tag className={className} />;
            case 'Reviews': return <Star className={className} />;
            case 'Design': return <Palette className={className} />;
            case 'Templete': return <FileSpreadsheet className={className} />;
            case 'Shop Evaluation': return <ClipboardCheck className={className} />;
            case 'Workload': return <BriefcaseBusiness className={className} />;
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
                <div
                    className={`flex items-center gap-3 min-w-0 ${isCollapsed ? 'justify-center w-full cursor-pointer' : ''}`}
                    onClick={isCollapsed ? toggleSidebar : undefined}
                    title={isCollapsed ? "Expand Sidebar" : undefined}
                >
                    <img
                        src={isCollapsed ? '/nh-logo-icon.png' : '/nh-logo-name.png'}
                        alt="NHMedia"
                        className={isCollapsed
                            ? 'h-8 w-8 flex-shrink-0 object-contain'
                            : 'h-8 w-auto max-w-[180px] flex-shrink-0 object-contain'}
                    />
                </div>
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

            <div className={`border-t border-gray-200 dark:border-gray-700 space-y-2 ${isCollapsed ? 'p-2' : 'p-2'}`}>

                {/* Global Currency Toggle */}
                <div
                    onClick={() => setGlobalUsdMode(!globalUsdMode)}
                    className={`
                    w-full flex items-center py-2.5 rounded-lg transition-colors group relative cursor-pointer
                    ${isCollapsed ? 'justify-center px-0' : 'px-3 justify-between'}
                    hover:bg-gray-100 dark:hover:bg-gray-700
                    `}
                >
                    <span
                        className={`
                          font-medium text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap overflow-hidden transition-all duration-300
                          ${isCollapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-[150px]'}
                        `}
                    >
                        USD Mode
                    </span>
                    <button
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-all duration-300 ease-in-out focus:outline-none ${globalUsdMode ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'} ${isCollapsed ? '-rotate-90 my-1.5' : ''}`}
                        role="switch"
                        aria-checked={globalUsdMode}
                    >
                        <span className="sr-only">Use USD Mode</span>
                        <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-300 ease-in-out ${globalUsdMode ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                    </button>
                    {isCollapsed && (
                        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            {globalUsdMode ? "USD (On)" : "USD (Off)"}
                        </div>
                    )}
                </div>


                {hasPermission(role, permissions, 'canExportData') && (
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className={`
                        w-full flex items-center py-2.5 rounded-lg transition-colors group relative
                        ${isCollapsed ? 'justify-center px-0' : 'px-3'}
                        text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-300
                        ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                        title={isCollapsed ? (isExporting ? 'Exporting...' : 'Export Excel') : undefined}
                    >
                        <div className="flex-shrink-0">
                            <Download className="h-5 w-5" />
                        </div>
                        <span
                            className={`
                          font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300
                          ${isCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[150px] ml-3'}
                        `}
                        >
                            {isExporting ? 'Exporting...' : 'Export Excel'}
                        </span>
                        {isCollapsed && (
                            <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                                {isExporting ? 'Exporting...' : 'Export Excel'}
                            </div>
                        )}
                    </button>
                )}

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

                {/* Sidebar Collapse/Expand Toggle (Bottom) */}
                <button
                    onClick={toggleSidebar}
                    className="w-full flex items-center justify-center py-3 rounded-lg transition-colors group relative text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    <div className="flex-shrink-0">
                        {isCollapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
                    </div>
                    {isCollapsed && (
                        <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            Expand Sidebar
                        </div>
                    )}
                </button>




            </div>
        </aside>
    );
};

export default Sidebar;
