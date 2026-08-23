import React, { useState, useEffect } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useNotification } from '../contexts/NotificationContext';
import { getSettings, saveSettings } from '../services/firebaseService';
import type { FulfillmentAccount } from '../types';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import LoadingSpinner from './LoadingSpinner';

const generateId = () => Math.random().toString(36).substring(2, 9);

const FulfillmentConfigManager: React.FC = () => {
  const { teamId } = useDashboard();
  const { addNotification } = useNotification();
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [accounts, setAccounts] = useState<FulfillmentAccount[]>([]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await getSettings(teamId);
        setAccounts(settings.fulfillmentAccounts || []);
      } catch (error) {
        console.error('Error fetching settings:', error);
        addNotification('Failed to load settings', 'error');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, [teamId, addNotification]);

  const handleAddAccount = (provider: 'printway' | 'merchize') => {
    setAccounts(prev => [
      ...prev,
      {
        id: generateId(),
        provider,
        name: `New ${provider === 'printway' ? 'Printway' : 'Merchize'} Account`,
        base_url: provider === 'printway' ? 'https://apis.printway.io/v3' : 'https://bo-group-1-1.merchize.com/qj0tksw/bo-api',
        api_token: ''
      }
    ]);
  };

  const handleUpdateAccount = (id: string, field: keyof FulfillmentAccount, value: string) => {
    setAccounts(prev => prev.map(acc => acc.id === id ? { ...acc, [field]: value } : acc));
  };

  const handleRemoveAccount = (id: string) => {
    setAccounts(prev => prev.filter(acc => acc.id !== id));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveSettings(teamId, { fulfillmentAccounts: accounts });
      addNotification('Settings saved successfully', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      addNotification('Failed to save settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const printwayAccounts = accounts.filter(a => a.provider === 'printway');
  const merchizeAccounts = accounts.filter(a => a.provider === 'merchize');

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow overflow-y-auto pr-2 scrollbar-hide space-y-6">
        
        {/* Printway Section */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold flex items-center">
              Printway Accounts
              <span className="ml-2 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 py-0.5 px-2.5 rounded-full text-xs">
                {printwayAccounts.length}
              </span>
            </h3>
            <button
              onClick={() => handleAddAccount('printway')}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-xs font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              <PlusIcon className="-ml-1 mr-1 h-4 w-4" />
              Add Printway
            </button>
          </div>
          
          {printwayAccounts.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800/50 p-4 rounded-md border border-dashed border-gray-300 dark:border-gray-600">
              No Printway accounts configured.
            </div>
          ) : (
            <div className="space-y-4">
              {printwayAccounts.map(acc => (
                <div key={acc.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 relative hover:shadow-md transition-all duration-200">
                  <button
                    onClick={() => handleRemoveAccount(acc.id)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove account"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                  <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-6 pr-8">
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Account Name</label>
                      <input
                        type="text"
                        value={acc.name}
                        onChange={(e) => handleUpdateAccount(acc.id, 'name', e.target.value)}
                        className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                        placeholder="e.g. My Main Store"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Base URL</label>
                      <input
                        type="text"
                        value={acc.base_url}
                        onChange={(e) => handleUpdateAccount(acc.id, 'base_url', e.target.value)}
                        className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md font-mono text-xs"
                      />
                    </div>
                    <div className="sm:col-span-6">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">API Token</label>
                      <input
                        type="password"
                        value={acc.api_token}
                        onChange={(e) => handleUpdateAccount(acc.id, 'api_token', e.target.value)}
                        className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md font-mono text-xs"
                        placeholder="Printway API Access Token"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Merchize Section */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold flex items-center">
              Merchize Accounts
              <span className="ml-2 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 py-0.5 px-2.5 rounded-full text-xs">
                {merchizeAccounts.length}
              </span>
            </h3>
            <button
              onClick={() => handleAddAccount('merchize')}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-xs font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              <PlusIcon className="-ml-1 mr-1 h-4 w-4" />
              Add Merchize
            </button>
          </div>
          
          {merchizeAccounts.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800/50 p-4 rounded-md border border-dashed border-gray-300 dark:border-gray-600">
              No Merchize accounts configured.
            </div>
          ) : (
            <div className="space-y-4">
              {merchizeAccounts.map(acc => (
                <div key={acc.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 relative hover:shadow-md transition-all duration-200">
                  <button
                    onClick={() => handleRemoveAccount(acc.id)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove account"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                  <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-6 pr-8">
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Account Name</label>
                      <input
                        type="text"
                        value={acc.name}
                        onChange={(e) => handleUpdateAccount(acc.id, 'name', e.target.value)}
                        className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                        placeholder="e.g. My Merchize Account"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Base URL</label>
                      <input
                        type="text"
                        value={acc.base_url}
                        onChange={(e) => handleUpdateAccount(acc.id, 'base_url', e.target.value)}
                        className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md font-mono text-xs"
                      />
                    </div>
                    <div className="sm:col-span-6">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">API Token</label>
                      <input
                        type="password"
                        value={acc.api_token}
                        onChange={(e) => handleUpdateAccount(acc.id, 'api_token', e.target.value)}
                        className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md font-mono text-xs"
                        placeholder="Merchize API Access Token"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

export default FulfillmentConfigManager;
