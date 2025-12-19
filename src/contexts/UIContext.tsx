import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import useLocalStorage from '../hooks/useLocalStorage';
import { Tab } from '../types';
import { useNotification } from './NotificationContext';

// Constants moved here or imported? For now, defining strict types/constants.
const DEFAULT_TABS: Tab[] = ['Overview', 'Order List', 'Products', 'Support', 'Fulfill'];

interface UIContextType {
    // Layout
    isSidebarCollapsed: boolean;
    toggleSidebar: () => void;

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
    supportFilter: 'All' | 'Case' | 'Help';
    setSupportFilter: React.Dispatch<React.SetStateAction<'All' | 'Case' | 'Help'>>;

    // Helpers
    handleViewDayDetails: (date: string) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode; userUid?: string; teamId?: string }> = ({ children, userUid, teamId }) => {
    const { addNotification } = useNotification();

    // --- 1. Local Storage State ---
    const [activeTab, setActiveTabRaw] = useLocalStorage<Tab>('activeTab', 'Overview');
    const [timeZone, setTimeZone] = useLocalStorage<string>('timeZone', 'Asia/Ho_Chi_Minh');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage<boolean>('sidebarCollapsed', false);

    // Tab Preferences
    // Note: We need userUid/teamId for unique storage keys. If not provided (e.g. not logged in), 
    // we might fallback to generic key or wait. Assuming they are available for authenticated UI.
    const prefKey = userUid && teamId ? `tabPreferences_${teamId}_${userUid}` : 'tabPreferences_guest';
    const [tabPreferences, setTabPreferences] = useLocalStorage<{ tabOrder: Tab[], hiddenTabs: Tab[] }>(
        prefKey,
        { tabOrder: DEFAULT_TABS, hiddenTabs: [] }
    );

    const [tabOrder, setLocalTabOrder] = useState<Tab[]>(() => {
        // Filter out any tabs that are no longer in DEFAULT_TABS (handles stale local storage)
        const validTabs = new Set(DEFAULT_TABS);
        return tabPreferences.tabOrder.filter(tab => validTabs.has(tab));
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
            setTabPreferences({ tabOrder, hiddenTabs: Array.from(hiddenTabs) });
        }, 300); // Debounce to prevent rapid updates

        return () => clearTimeout(timeoutId);
    }, [tabOrder, hiddenTabs, setTabPreferences]);

    // Date Range
    const getTodayInTimezone = (tz: string = timeZone): string => {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
            return formatter.format(new Date());
        } catch (e) { return new Date().toISOString().split('T')[0]; }
    };

    // Always reset to Today on app launch (no localStorage persistence)
    const [filterDateRange, setFilterDateRange] = useState<{ from: string, to: string }>({
        from: getTodayInTimezone(),
        to: getTodayInTimezone()
    });

    // Effect: Update "Today" when timezone changes
    const prevTimeZone = useRef(timeZone);
    useEffect(() => {
        if (prevTimeZone.current !== timeZone) {
            const oldToday = getTodayInTimezone(prevTimeZone.current);
            const newToday = getTodayInTimezone(timeZone);

            // If the user had "Today" selected in the old timezone, update it to "Today" in the new timezone
            if (filterDateRange.from === oldToday && filterDateRange.to === oldToday) {
                console.log(`[UIContext] Timezone changed: updating "Today" from ${oldToday} to ${newToday}`);
                setFilterDateRange({ from: newToday, to: newToday });

                // Also update if they had "Yesterday" selected?
                // Heuristic: Check if from==to==yesterday(oldTimeout). 
                // For now, only implementing Today as requested.
            }

            prevTimeZone.current = timeZone;
        }
    }, [timeZone, filterDateRange, setFilterDateRange]);

    // --- 2. Transient State ---
    const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
    const [dayFilter, setDayFilter] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [sourceFilter, setSourceFilter] = useState<'All' | 'Ebay_Sales' | 'Etsy_Sales'>('All');
    const [supportFilter, setSupportFilter] = useState<'All' | 'Case' | 'Help'>('All');

    // Modals
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isAccountManagerOpen, setIsAccountManagerOpen] = useState(false);
    const [isTabSettingsOpen, setIsTabSettingsOpen] = useState(false);
    const [isNotificationDetailOpen, setIsNotificationDetailOpen] = useState(false);
    const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);


    // --- 3. Logic Functions ---
    const toggleSidebar = useCallback(() => setIsSidebarCollapsed(prev => !prev), [setIsSidebarCollapsed]);
    const toggleMobileMenu = useCallback(() => setIsMobileMenuOpen(prev => !prev), []);

    const setActiveTab = (tab: Tab) => {
        setActiveTabRaw(tab);
    };

    const handleTabClick = (tab: Tab) => {
        setActiveTabRaw(tab);
        setDayFilter(null);
    };

    const handleViewDayDetails = (date: string) => {
        setActiveTabRaw('Order List');
        setDayFilter(date);
    };

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

    return (
        <UIContext.Provider value={{
            isSidebarCollapsed, toggleSidebar,
            isMobileMenuOpen, setIsMobileMenuOpen, toggleMobileMenu,
            isAccountManagerOpen, setIsAccountManagerOpen,
            isTabSettingsOpen, setIsTabSettingsOpen,
            isNotificationDetailOpen, setIsNotificationDetailOpen,
            selectedNotificationId, setSelectedNotificationId,
            activeTab, setActiveTab,
            tabOrder, setTabOrder: setLocalTabOrder,
            hiddenTabs, reorderTabs, toggleTabVisibility, resetTabPreferences, handleTabClick,
            searchTerm, setSearchTerm,
            selectedAccountId, setSelectedAccountId,
            timeZone, setTimeZone,
            filterDateRange, setFilterDateRange,
            dayFilter, setDayFilter,
            sourceFilter, setSourceFilter,
            supportFilter, setSupportFilter,
            handleViewDayDetails
        }}>
            {children}
        </UIContext.Provider>
    );
};

export const useUI = () => {
    const context = useContext(UIContext);
    if (context === undefined) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
};
