import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useLocalStorage from '../hooks/useLocalStorage';
import { Tab } from '../types';
import { useNotification } from './NotificationContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { getPathForTab, getTabFromPath } from '../routing/appRoutes';

// Constants moved here or imported? For now, defining strict types/constants.
const DEFAULT_TABS: Tab[] = ['Overview', 'Order List', 'Products', 'Support', 'Fulfill', 'KPI', 'Reviews', 'Design', 'Templete', 'Shop Evaluation', 'Workload'];
const TAB_PREFERENCES_VERSION = 5;
const normalizeTab = (value: unknown): Tab => DEFAULT_TABS.includes(value as Tab) ? value as Tab : 'Overview';

interface TabPreferences {
    tabOrder: Tab[];
    hiddenTabs: Tab[];
    version?: number;
}

interface UIContextType {
    // Layout
    isSidebarCollapsed: boolean;
    toggleSidebar: () => void;

    // Theme
    theme: 'light' | 'dark';
    toggleTheme: () => void;

    // Mobile Menu
    isMobileMenuOpen: boolean;
    setIsMobileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    toggleMobileMenu: () => void;

    // Modals
    isAccountManagerOpen: boolean;
    setIsAccountManagerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isTabSettingsOpen: boolean;
    setIsTabSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isNotificationDetailOpen: boolean;
    setIsNotificationDetailOpen: React.Dispatch<React.SetStateAction<boolean>>;
    selectedNotificationId: string | null;
    setSelectedNotificationId: React.Dispatch<React.SetStateAction<string | null>>;

    // Tabs
    activeTab: Tab;
    setActiveTab: (tab: Tab) => void;
    tabOrder: Tab[];
    setTabOrder: (order: Tab[]) => void;
    hiddenTabs: Set<Tab>;
    reorderTabs: (fromIndex: number, toIndex: number) => void;
    toggleTabVisibility: (tab: Tab) => void;
    resetTabPreferences: () => void;
    handleTabClick: (tab: Tab) => void;

    // Filters & Search
    searchTerm: string;
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    selectedAccountId: string;
    setSelectedAccountId: React.Dispatch<React.SetStateAction<string>>;
    timeZone: string;
    setTimeZone: (tz: string) => void;
    filterDateRange: { from: string; to: string };
    setFilterDateRange: React.Dispatch<React.SetStateAction<{ from: string; to: string }>>;
    dayFilter: string | null;
    setDayFilter: React.Dispatch<React.SetStateAction<string | null>>;
    sourceFilter: 'All' | 'Ebay_Sales' | 'Etsy_Sales';
    setSourceFilter: React.Dispatch<React.SetStateAction<'All' | 'Ebay_Sales' | 'Etsy_Sales'>>;
    statusFilter: 'All' | 'New' | 'Refunded';
    setStatusFilter: React.Dispatch<React.SetStateAction<'All' | 'New' | 'Refunded'>>;
    supportFilter: 'All' | 'Case' | 'Help';
    setSupportFilter: React.Dispatch<React.SetStateAction<'All' | 'Case' | 'Help'>>;
    reviewRatingFilter: 'All' | '5' | '4' | '3' | '2' | '1';
    setReviewRatingFilter: React.Dispatch<React.SetStateAction<'All' | '5' | '4' | '3' | '2' | '1'>>;

    // Global Settings
    globalUsdMode: boolean;
    setGlobalUsdMode: React.Dispatch<React.SetStateAction<boolean>>;

    // Helpers
    handleViewDayDetails: (date: string) => void;
    handleShopDetails: (accountId: string) => void;
}

type UIThemeContextType = Pick<UIContextType, 'theme' | 'toggleTheme'>;
type UILayoutContextType = Pick<UIContextType, 'isSidebarCollapsed' | 'toggleSidebar' | 'isMobileMenuOpen' | 'setIsMobileMenuOpen' | 'toggleMobileMenu'>;
type UIModalContextType = Pick<UIContextType,
    'isAccountManagerOpen' | 'setIsAccountManagerOpen' |
    'isTabSettingsOpen' | 'setIsTabSettingsOpen' |
    'isNotificationDetailOpen' | 'setIsNotificationDetailOpen' |
    'selectedNotificationId' | 'setSelectedNotificationId'
>;
type UITabContextType = Pick<UIContextType,
    'activeTab' | 'setActiveTab' | 'tabOrder' | 'setTabOrder' | 'hiddenTabs' |
    'reorderTabs' | 'toggleTabVisibility' | 'resetTabPreferences' | 'handleTabClick' |
    'handleViewDayDetails' | 'handleShopDetails'
>;
type UIFilterContextType = Pick<UIContextType,
    'searchTerm' | 'setSearchTerm' |
    'selectedAccountId' | 'setSelectedAccountId' |
    'timeZone' | 'setTimeZone' |
    'filterDateRange' | 'setFilterDateRange' |
    'dayFilter' | 'setDayFilter' |
    'sourceFilter' | 'setSourceFilter' |
    'statusFilter' | 'setStatusFilter' |
    'supportFilter' | 'setSupportFilter' |
    'reviewRatingFilter' | 'setReviewRatingFilter'
>;
type UISettingsContextType = Pick<UIContextType, 'globalUsdMode' | 'setGlobalUsdMode'>;

const UIContext = createContext<UIContextType | undefined>(undefined);
const UIThemeContext = createContext<UIThemeContextType | undefined>(undefined);
const UILayoutContext = createContext<UILayoutContextType | undefined>(undefined);
const UIModalContext = createContext<UIModalContextType | undefined>(undefined);
const UITabContext = createContext<UITabContextType | undefined>(undefined);
const UIFilterContext = createContext<UIFilterContextType | undefined>(undefined);
const UISettingsContext = createContext<UISettingsContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode; userUid?: string; teamId?: string }> = ({ children, userUid, teamId }) => {
    const { addNotification } = useNotification();
    const location = useLocation();
    const navigate = useNavigate();

    const [storedActiveTab, setActiveTabRaw] = useLocalStorage<Tab>('activeTab', getTabFromPath(location.pathname) || 'Overview');
    const activeTab = normalizeTab(storedActiveTab);
    const [operationTimeZone, setOperationTimeZone] = useLocalStorage<string>('timeZone', 'Asia/Ho_Chi_Minh');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage<boolean>('sidebarCollapsed', false);
    const [globalUsdMode, setGlobalUsdMode] = useLocalStorage<boolean>('globalUsdMode', false);
    const timeZone = operationTimeZone;
    const setTimeZone = useCallback((nextTimeZone: string) => {
        setOperationTimeZone(nextTimeZone);
    }, [setOperationTimeZone]);

    // Tab Preferences
    const prefKey = userUid && teamId ? `tabPreferences_${teamId}_${userUid}` : 'tabPreferences_guest';
    const [tabPreferences, setTabPreferences] = useLocalStorage<TabPreferences>(
        prefKey,
        { tabOrder: DEFAULT_TABS, hiddenTabs: [], version: TAB_PREFERENCES_VERSION }
    );

    const [tabOrder, setLocalTabOrder] = useState<Tab[]>(() => {
        // Merge logic: Add any new tabs from DEFAULT_TABS that aren't in saved preferences
        const savedTabs = new Set(tabPreferences.tabOrder);
        const validTabs = new Set(DEFAULT_TABS);

        // Filter out invalid tabs from saved preferences
        const filteredSaved = tabPreferences.tabOrder.filter(tab => validTabs.has(tab));

        // Find new tabs in DEFAULT_TABS that aren't in saved preferences
        const newTabs = DEFAULT_TABS.filter(tab => !savedTabs.has(tab));

        return [...filteredSaved, ...newTabs];
    });
    // Convert array back to Set for internal logic
    const [hiddenTabs, setHiddenTabs] = useState<Set<Tab>>(new Set(tabPreferences.hiddenTabs));

    // Use ref to track if we're initializing to prevent infinite loop
    const isInitialized = useRef(false);

    // Sync tabPreferences from local storage/state - but only when user changes them, not on every render
    useEffect(() => {
        // Skip initial render to prevent loop
        if (!isInitialized.current) {
            isInitialized.current = true;
            return;
        }

        const timeoutId = setTimeout(() => {
            setTabPreferences({ tabOrder, hiddenTabs: Array.from(hiddenTabs), version: TAB_PREFERENCES_VERSION });
        }, 300); // Debounce to prevent rapid updates

        return () => clearTimeout(timeoutId);
    }, [tabOrder, hiddenTabs, setTabPreferences]);

    useEffect(() => {
        if ((tabPreferences.version || 0) >= TAB_PREFERENCES_VERSION) return;
        setTabPreferences({ tabOrder, hiddenTabs: Array.from(hiddenTabs), version: TAB_PREFERENCES_VERSION });
    }, [hiddenTabs, setTabPreferences, tabOrder, tabPreferences.version]);

    // Date Range
    const getTodayInTimezone = (tz: string = timeZone): string => {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
            return formatter.format(new Date());
        } catch (e) { return new Date().toISOString().split('T')[0]; }
    };

    // Always reset to Today on app launch (no localStorage persistence)
    const [filterDateRange, setFilterDateRange] = useState<{ from: string, to: string }>(() => {
        const today = getTodayInTimezone();
        return { from: today, to: today };
    });

    // Effect: Update "Today" when timezone changes
    const prevTimeZone = useRef(timeZone);
    useEffect(() => {
        if (prevTimeZone.current !== timeZone) {
            const oldToday = getTodayInTimezone(prevTimeZone.current);
            const newToday = getTodayInTimezone(timeZone);

            if (filterDateRange.from === oldToday && filterDateRange.to === oldToday) {
                setFilterDateRange({ from: newToday, to: newToday });
            }

            prevTimeZone.current = timeZone;
        }
    }, [timeZone, filterDateRange, setFilterDateRange]);

    // --- 2. Transient State ---
    const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
    const [dayFilter, setDayFilter] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [sourceFilter, setSourceFilter] = useState<'All' | 'Ebay_Sales' | 'Etsy_Sales'>('All');
    const [statusFilter, setStatusFilter] = useState<'All' | 'New' | 'Refunded'>('All');
    const [supportFilter, setSupportFilter] = useState<'All' | 'Case' | 'Help'>('All');
    const [reviewRatingFilter, setReviewRatingFilter] = useState<'All' | '5' | '4' | '3' | '2' | '1'>('All');

    // Modals
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isAccountManagerOpen, setIsAccountManagerOpen] = useState(false);
    const [isTabSettingsOpen, setIsTabSettingsOpen] = useState(false);
    const [isNotificationDetailOpen, setIsNotificationDetailOpen] = useState(false);
    const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);


    // --- 3. Logic Functions ---
    const toggleSidebar = useCallback(() => setIsSidebarCollapsed(prev => !prev), [setIsSidebarCollapsed]);
    const toggleMobileMenu = useCallback(() => setIsMobileMenuOpen(prev => !prev), []);

    const navigateToTab = useCallback((tab: Tab, replace = false) => {
        setActiveTabRaw(tab);
        navigate(getPathForTab(tab), { replace });
    }, [navigate, setActiveTabRaw]);

    useEffect(() => {
        const routeTab = getTabFromPath(location.pathname);
        if (routeTab) {
            if (routeTab !== activeTab) setActiveTabRaw(routeTab);
            return;
        }
        if (location.pathname === '/') {
            navigate(getPathForTab(activeTab), { replace: true });
            return;
        }
        if (location.pathname === '/kpi' || location.pathname.startsWith('/kpi/')) {
            navigate(getPathForTab('KPI'), { replace: true });
            return;
        }
        if (location.pathname === '/operations/listings') {
            navigate(getPathForTab('Overview'), { replace: true });
        }
    }, [activeTab, location.pathname, navigate, setActiveTabRaw]);

    const setActiveTab = useCallback((tab: Tab) => {
        navigateToTab(tab);
    }, [navigateToTab]);

    const handleTabClick = useCallback((tab: Tab) => {
        navigateToTab(tab);
        setDayFilter(null);
    }, [navigateToTab]);

    const handleViewDayDetails = useCallback((date: string) => {
        navigateToTab('Order List');
        setDayFilter(date);
    }, [navigateToTab]);

    const handleShopDetails = useCallback((accountId: string) => {
        navigateToTab('Order List');
        setSelectedAccountId(accountId);
        setSearchTerm('');
    }, [navigateToTab]);

    const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
        setLocalTabOrder(prev => {
            const newOrder = [...prev];
            const [moved] = newOrder.splice(fromIndex, 1);
            newOrder.splice(toIndex, 0, moved);
            return newOrder;
        });
    }, []);

    const toggleTabVisibility = useCallback((tab: Tab) => {
        setHiddenTabs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(tab)) newSet.delete(tab);
            else newSet.add(tab);
            return newSet;
        });
    }, []);

    const resetTabPreferences = useCallback(() => {
        setLocalTabOrder(DEFAULT_TABS);
        setHiddenTabs(new Set());
        addNotification('Tab preferences reset.', 'success');
    }, [addNotification]);

    // --- Theme State (Lifted from ThemeToggle) ---
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) {
            return localStorage.getItem('theme') as 'light' | 'dark';
        }
        if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    });

    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme(prevTheme => (prevTheme === 'dark' ? 'light' : 'dark'));
    }, []);

    const themeValue = useMemo<UIThemeContextType>(() => ({
        theme,
        toggleTheme
    }), [theme, toggleTheme]);

    const layoutValue = useMemo<UILayoutContextType>(() => ({
        isSidebarCollapsed,
        toggleSidebar,
        isMobileMenuOpen,
        setIsMobileMenuOpen,
        toggleMobileMenu
    }), [isSidebarCollapsed, toggleSidebar, isMobileMenuOpen, toggleMobileMenu]);

    const modalValue = useMemo<UIModalContextType>(() => ({
        isAccountManagerOpen,
        setIsAccountManagerOpen,
        isTabSettingsOpen,
        setIsTabSettingsOpen,
        isNotificationDetailOpen,
        setIsNotificationDetailOpen,
        selectedNotificationId,
        setSelectedNotificationId
    }), [
        isAccountManagerOpen,
        isTabSettingsOpen,
        isNotificationDetailOpen,
        selectedNotificationId
    ]);

    const tabValue = useMemo<UITabContextType>(() => ({
        activeTab,
        setActiveTab,
        tabOrder,
        setTabOrder: setLocalTabOrder,
        hiddenTabs,
        reorderTabs,
        toggleTabVisibility,
        resetTabPreferences,
        handleTabClick,
        handleViewDayDetails,
        handleShopDetails
    }), [
        activeTab,
        setActiveTab,
        tabOrder,
        hiddenTabs,
        reorderTabs,
        toggleTabVisibility,
        resetTabPreferences,
        handleTabClick,
        handleViewDayDetails,
        handleShopDetails
    ]);

    const filterValue = useMemo<UIFilterContextType>(() => ({
        searchTerm,
        setSearchTerm,
        selectedAccountId,
        setSelectedAccountId,
        timeZone,
        setTimeZone,
        filterDateRange,
        setFilterDateRange,
        dayFilter,
        setDayFilter,
        sourceFilter,
        setSourceFilter,
        statusFilter,
        setStatusFilter,
        supportFilter,
        setSupportFilter,
        reviewRatingFilter,
        setReviewRatingFilter
    }), [
        searchTerm,
        selectedAccountId,
        timeZone,
        setTimeZone,
        filterDateRange,
        dayFilter,
        sourceFilter,
        statusFilter,
        supportFilter,
        reviewRatingFilter
    ]);

    const settingsValue = useMemo<UISettingsContextType>(() => ({
        globalUsdMode,
        setGlobalUsdMode
    }), [globalUsdMode, setGlobalUsdMode]);

    const contextValue = useMemo<UIContextType>(() => ({
        ...themeValue,
        ...layoutValue,
        ...modalValue,
        ...tabValue,
        ...filterValue,
        ...settingsValue
    }), [themeValue, layoutValue, modalValue, tabValue, filterValue, settingsValue]);

    return (
        <UIThemeContext.Provider value={themeValue}>
            <UILayoutContext.Provider value={layoutValue}>
                <UIModalContext.Provider value={modalValue}>
                    <UITabContext.Provider value={tabValue}>
                        <UIFilterContext.Provider value={filterValue}>
                            <UISettingsContext.Provider value={settingsValue}>
                                <UIContext.Provider value={contextValue}>
                                    {children}
                                </UIContext.Provider>
                            </UISettingsContext.Provider>
                        </UIFilterContext.Provider>
                    </UITabContext.Provider>
                </UIModalContext.Provider>
            </UILayoutContext.Provider>
        </UIThemeContext.Provider>
    );
};

export const useUI = () => {
    const context = useContext(UIContext);
    if (context === undefined) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
};

export const useUITheme = () => {
    const context = useContext(UIThemeContext);
    if (context === undefined) {
        throw new Error('useUITheme must be used within a UIProvider');
    }
    return context;
};

export const useUILayout = () => {
    const context = useContext(UILayoutContext);
    if (context === undefined) {
        throw new Error('useUILayout must be used within a UIProvider');
    }
    return context;
};

export const useUIModals = () => {
    const context = useContext(UIModalContext);
    if (context === undefined) {
        throw new Error('useUIModals must be used within a UIProvider');
    }
    return context;
};

export const useUITabs = () => {
    const context = useContext(UITabContext);
    if (context === undefined) {
        throw new Error('useUITabs must be used within a UIProvider');
    }
    return context;
};

export const useUIFilters = () => {
    const context = useContext(UIFilterContext);
    if (context === undefined) {
        throw new Error('useUIFilters must be used within a UIProvider');
    }
    return context;
};

export const useUISettings = () => {
    const context = useContext(UISettingsContext);
    if (context === undefined) {
        throw new Error('useUISettings must be used within a UIProvider');
    }
    return context;
};
