import React, { useState } from 'react';
import { UserRole } from '../types';

// --- BẮT ĐẦU: Component Modal Permissions ---
interface PermissionModalProps {
  user: UserRole;
  onSave: (userId: string, permissions: UserRole['permissions']) => void;
  onClose: () => void;
}

const PermissionModal: React.FC<PermissionModalProps> = ({ user, onSave, onClose }) => {
  const [localPermissions, setLocalPermissions] = useState<UserRole['permissions']>(() => ({ ...user.permissions }));
  const [activeTab, setActiveTab] = useState<'tabs' | 'kpis' | 'actions'>('tabs');

  const permissionGroups = {
    tabs: {
      title: 'Tabs',
      description: 'Which sections user can see in sidebar',
      keys: ['viewOverviewTab', 'viewOrderListTab', 'viewProductsTab', 'viewSupportTab', 'viewFulfillTab'] as const,
      labels: {
        viewOverviewTab: 'Overview',
        viewOrderListTab: 'Order List',
        viewProductsTab: 'Products',
        viewSupportTab: 'Support',
        viewFulfillTab: 'Fulfill',
      }
    },
    kpis: {
      title: 'KPIs',
      description: 'Which summary data blocks user can view',
      keys: ['viewKpiOrders', 'viewKpiShops', 'viewKpiRevenue', 'viewKpiFunds', 'viewKpiCost', 'viewKpiEarn'] as const,
      labels: {
        viewKpiOrders: 'Total Orders',
        viewKpiShops: 'Shops',
        viewKpiRevenue: 'Revenue',
        viewKpiFunds: 'Funds',
        viewKpiCost: 'Cost',
        viewKpiEarn: 'Earn',
      }
    },
    actions: {
      title: 'Actions',
      description: 'System actions & Data access',
      keys: ['canEditCost', 'canExportData', 'canResyncOrder', 'canSyncData', 'canManageUsers', 'canManageMailSettings', 'canManageSettings', 'canManageMappings', 'viewMerchizeData', 'viewPrintwayData', 'viewEbayData', 'viewEtsyData'] as const,
      labels: {
        canEditCost: 'Edit Manual Cost',
        canExportData: 'Export Data',
        canResyncOrder: 'Resync Single Order',
        canSyncData: 'Sync All/New Data',
        canManageUsers: 'Admin Users',
        canManageMailSettings: 'Admin Mail Accounts',
        canManageSettings: 'Admin General Settings',
        canManageMappings: 'Admin Mappings (Category)',
        viewMerchizeData: 'Merchize POD Data',
        viewPrintwayData: 'Printway POD Data',
        viewEbayData: 'Ebay Sales Data',
        viewEtsyData: 'Etsy Sales Data',
      }
    }
  };

  const handleTogglePermission = (key: string) => {
    setLocalPermissions(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleToggleAll = (keys: readonly string[], isChecked: boolean) => {
    const updates = Object.fromEntries(keys.map(key => [key, isChecked]));
    setLocalPermissions(prev => ({ ...prev, ...updates }));
  };



  const handleSave = () => {
    onSave(user.id, localPermissions);
    onClose();
  };

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  const currentGroup = permissionGroups[activeTab];
  const allChecked = currentGroup.keys.every(key => localPermissions[key] === true);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh]" onClick={stopPropagation}>
        {/* Header */}
        <div className="flex justify-between items-start p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-lg text-gray-900 dark:text-white">Manage Permissions</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-md">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(['tabs', 'kpis', 'actions'] as const).map((tabId) => (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              className={`flex-1 py-3 px-2 text-xs md:text-sm font-semibold transition-all ${activeTab === tabId ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              {permissionGroups[tabId].title}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-grow overflow-y-auto p-4">
          <div className="mb-3 flex justify-between items-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">{currentGroup.description}</p>
            <button
              onClick={() => handleToggleAll(currentGroup.keys, !allChecked)}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {allChecked ? 'Uncheck All' : 'Check All'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {currentGroup.keys.map(key => (
              <label
                key={key}
                className="flex items-center space-x-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={localPermissions[key] === true}
                  onChange={() => handleTogglePermission(key)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {currentGroup.labels[key]}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {Object.values(localPermissions).filter(Boolean).length} permissions enabled
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              Save Permissions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
// --- KẾT THÚC: Component Modal Permissions ---
export default PermissionModal;
