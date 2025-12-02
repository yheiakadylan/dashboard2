import React from 'react';
import { Tab } from '../api/_lib/types';
import { useDashboard } from '../contexts/DashboardContext';
import { TABS, TABS_TO_HIDE_ON_MOBILE } from '../constants';

const Tabs: React.FC = () => {
  // THÊM: Lấy role và permissions
  const { activeTab, handleTabClick, role, permissions } = useDashboard();

  // THÊM: Lọc TABS dựa trên quyền
  const availableTabs = TABS.filter(tab => {
    if (role === 'owner') {
      return true; // Owner thấy hết
    }

    // User thường
    switch (tab) {
      case 'Overview':
      case 'Order List':
      case 'eBay':
      case 'Etsy':
      case 'Case':
      case 'Help':
        // Các tab này chung quyền "Sales"
        // (Chúng ta cũng sẽ lọc quyền xem Funds/Cost trong data, đừng lo)
        return permissions.viewSales;
      
      case 'Fulfill':
        return permissions.viewFulfill;

      case 'Summary':
        return permissions.viewSummary;

      default:
        return false;
    }
  });
  
  return (
    <div>
      <nav className="-mb-px flex space-x-2 px-4" aria-label="Tabs">
        {/* THAY ĐỔI: Dùng availableTabs */}
        {availableTabs.map((tab) => {
          const isHiddenOnMobile = TABS_TO_HIDE_ON_MOBILE.includes(tab);
          return (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500'
              } ${
                isHiddenOnMobile ? 'hidden md:inline-block' : 'inline-block'
              } whitespace-nowrap py-3 px-2 border-b-2 font-medium text-sm transition-colors focus:outline-none tracking-wider uppercase`}
            >
              {tab}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default Tabs;