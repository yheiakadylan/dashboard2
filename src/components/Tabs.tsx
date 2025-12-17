import React, { useCallback } from 'react';
import { Tab } from '../types';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import { TABS_TO_HIDE_ON_MOBILE } from '../constants';

const Tabs: React.FC = () => {
  // Get tab customization state from context
  const {
    role,
    permissions
  } = useDashboard();

  const {
    activeTab,
    handleTabClick,
    tabOrder,
    hiddenTabs,
    setIsTabSettingsOpen
  } = useUI();

  // Filter TABS based on permissions
  const getPermittedTabs = (tabs: Tab[]): Tab[] => {
    return tabs.filter(tab => {
      if (role === 'owner') {
        return true; // Owner sees all
      }

      // User role - check permissions
      switch (tab) {
        case 'Overview':
        case 'Order List':
        case 'Products':
        case 'Support':
          return permissions.viewSales;

        case 'Fulfill':
          return permissions.viewFulfill;



        default:
          return false;
      }
    });
  };

  // Get tabs in custom order, filtered by permissions and visibility
  const visibleTabs = getPermittedTabs(tabOrder).filter(tab => !hiddenTabs.has(tab));

  // Memoized handlers
  const handleClick = useCallback((tab: Tab) => {
    handleTabClick(tab);
  }, [handleTabClick]);

  const handleSettingsOpen = useCallback(() => {
    setIsTabSettingsOpen(true);
  }, [setIsTabSettingsOpen]);

  return (
    <div className="hidden md:flex items-center w-full">
      {/* Tab Navigation - Only visible on desktop */}
      <nav
        className="-mb-px flex space-x-2 px-4 flex-1"
        aria-label="Tabs"
      >
        {visibleTabs.map((tab) => {
          const isHiddenOnMobile = TABS_TO_HIDE_ON_MOBILE.includes(tab);
          return (
            <button
              key={tab}
              onClick={() => handleClick(tab)}
              className={`${activeTab === tab
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500'
                } ${isHiddenOnMobile ? 'hidden md:inline-block' : 'inline-block'
                } whitespace-nowrap py-3 px-2 border-b-2 font-medium text-sm transition-colors focus:outline-none tracking-wider uppercase flex-shrink-0`}
            >
              {tab}
            </button>
          );
        })}
      </nav>

      {/* Settings Button - Only visible on desktop */}
      <button
        onClick={handleSettingsOpen}
        className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors mr-2 flex-shrink-0"
        title="Tab Settings"
        aria-label="Open tab settings"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>
  );
};

export default Tabs;
