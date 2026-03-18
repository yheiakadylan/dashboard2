import React, { useState, useEffect } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { useUI } from '../../contexts/UIContext';
import { getPermittedTabs } from '../../utils/permissions';
import { hasPermission } from '../../utils/permissionHelper';
import { getImageFromDB } from '../../utils/indexedDB'; // Import IndexedDB utility
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
    FileSpreadsheet,
    LayoutDashboard,
    Users,
    Package,
    Map
} from 'lucide-react';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar }) => {
    const { role, permissions, handleLogout, user, boards, selectedBoardId, setSelectedBoardId } = useDashboard();
    const {
        activeTab,
        handleTabClick,
        tabOrder,
        hiddenTabs,
        setIsAccountManagerOpen,
        isAccountManagerOpen,
        setIsTabSettingsOpen,
        setIsOrderSelectorOpen,
        globalUsdMode,
        setGlobalUsdMode
    } = useUI();

    const [localPhotoURL, setLocalPhotoURL] = useState(user?.photoURL || '');

    // --- Custom Dropdown State ---
    const [isBoardDropdownOpen, setIsBoardDropdownOpen] = useState(false);
    const boardDropdownRef = React.useRef<HTMLDivElement>(null);

    // Click outside handler for board dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (boardDropdownRef.current && !boardDropdownRef.current.contains(event.target as Node)) {
                setIsBoardDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load avatar (prefer local IndexedDB if available)
    useEffect(() => {
        if (user) {
            // Start with Firebase URL (or previous state)
            // We don't necessarily reset to user.photoURL immediately to avoid flash if local exists?
            // But user.photoURL is the "source of truth" fallback.
            setLocalPhotoURL(user.photoURL || '');

            getImageFromDB(user.uid).then((blob) => {
                if (blob) {
                    setLocalPhotoURL(URL.createObjectURL(blob));
                }
            }).catch(e => console.error("Sidebar avatar load failed", e));
        }
    }, [user, isAccountManagerOpen]); // Refresh when user changes or Settings modal closes (potential update)

    // Filter tabs logic
    const permittedTabs = getPermittedTabs(tabOrder, role, permissions);

    const getIconForTab = (tab: string, className: string = "h-5 w-5") => {
        switch (tab) {
            case 'Overview': return <Home className={className} />;
            case 'Order List': return <FileText className={className} />;
            case 'Support': return <HelpCircle className={className} />;
            case 'Fulfill': return <Truck className={className} />;
            case 'Products': return <Tag className={className} />;
            case 'Listing': return <Package className={className} />;
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
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600 dark:text-blue-500 flex-shrink-0" aria-hidden="true">
                        <path d="M4 4V20H8V4H4ZM10 10V20H14V10H10ZM16 16V20H20V16H16Z" fill="currentColor" />
                        <path d="M4 15L9 9L14 13L20 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-gray-900" />
                    </svg>
                    {!isCollapsed && (
                        <h1 className="text-xl font-bold text-gray-800 dark:text-white truncate">
                            Dashboard
                        </h1>
                    )}
                </div>
                {!isCollapsed && (
                    <button
                        onClick={toggleSidebar}
                        className="p-1 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none ml-auto"
                        title="Collapse Sidebar"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                )}
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




                {/* Profile & Logout Section (Card Style) */}
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <div className={`
                        flex items-center justify-between 
                         ${isCollapsed ? 'flex-col gap-4' : ''}
                    `}>
                        {/* Avatar & Info - Click to Settings */}
                        <div
                            onClick={() => setIsAccountManagerOpen(true)}
                            className={`
                                flex items-center gap-3 cursor-pointer 
                                hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg p-2 transition-colors
                                ${isCollapsed ? 'justify-center p-1' : 'flex-1 min-w-0'}
                            `}
                            title="Profile Settings"
                        >
                            <div className="relative flex-shrink-0">
                                {localPhotoURL ? (
                                    <img
                                        src={localPhotoURL}
                                        alt="User"
                                        className="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-gray-600"
                                    />
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                                        {user?.displayName ? user.displayName.charAt(0).toUpperCase() : (user?.email?.charAt(0).toUpperCase() || 'U')}
                                    </div>
                                )}
                                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></span>
                            </div>

                            {!isCollapsed && (
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                        {user?.displayName || 'User'}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {role === 'owner' ? 'Owner' : 'Staff'}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Separate Logout Button */}
                        <button
                            onClick={handleLogout}
                            className={`
                                flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors
                                ${isCollapsed ? '' : 'px-2'}
                            `}
                            title="Logout"
                        >
                            <LogOut className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
