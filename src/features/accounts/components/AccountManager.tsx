// components/AccountManager.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Account } from '../../../types';
import { useDashboard } from '../../../contexts/DashboardContext';
import { useUI } from '../../../contexts/UIContext';
import { useNotification } from '../../../contexts/NotificationContext';

import UserManager from '../../users/components/UserManager';
import ManualCostManager from '../../costs/components/ManualCostManager';
import NotificationSettings from '../../notifications/components/NotificationSettings';
import { MailManager } from './MailManager';
import UserProfileSettings from '../../users/components/UserProfileSettings';

const AccountManager: React.FC = () => {
  const { role, permissions } = useDashboard();
  const { setIsAccountManagerOpen } = useUI();

  // Permissions for specific tabs
  const canManageMail = role === 'owner' || permissions.canManageMailSettings;
  const canManageUsers = role === 'owner' || permissions.canManageUsers;
  const canEditCost = role === 'owner' || permissions.canEditCost;

  // Default tab logic: Profile should be default for personalization
  const [activeTab, setActiveTab] = useState<'profile' | 'mail' | 'users' | 'costs' | 'notifications'>('profile');

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setIsAccountManagerOpen(false);
    }
  };

  return (
    <div onClick={handleBackdropClick}
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[100] p-2 md:p-4 animate-modal-backdrop" >
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl w-full max-w-3xl border border-gray-200 dark:border-gray-700 flex flex-col h-[90vh] md:h-[720px] md:max-h-[90vh] animate-slide-in-right" >
        {/* Header */}
        <div className="flex justify-between items-center p-3 md:p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
          <button onClick={() => setIsAccountManagerOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="20px" height="20px" viewBox="0 0 24 24" fill="none">
              <path fillRule="evenodd" clipRule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'profile' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            Profile
          </button>

          {canManageMail && (
            <button
              onClick={() => setActiveTab('mail')}
              className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'mail' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              Mail Accounts
            </button>
          )}

          <button
            onClick={() => setActiveTab('notifications')}
            className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'notifications' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            Notifications
          </button>

          {canManageUsers && (
            <button
              onClick={() => setActiveTab('users')}
              className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'users' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              User Management
            </button>
          )}

          {canEditCost && (
            <button
              onClick={() => setActiveTab('costs')}
              className={`flex-1 py-2 md:py-3 px-2 md:px-4 font-semibold text-center transition-colors whitespace-nowrap text-sm md:text-base ${activeTab === 'costs' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              Manual Costs
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-3 md:p-6 flex-grow flex flex-col overflow-hidden bg-transparent">
          {activeTab === 'profile' && <UserProfileSettings />}
          {activeTab === 'mail' && <MailManager />}
          {activeTab === 'users' && <UserManager />}
          {activeTab === 'costs' && <ManualCostManager />}
          {activeTab === 'notifications' && <NotificationSettings />}
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(AccountManager);
