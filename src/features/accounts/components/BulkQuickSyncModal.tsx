// components/AccountManager.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Account } from '../../../types';
import { signInWithGoogle, signInWithMicrosoft } from '../../auth/services/authService';
import { useDashboard } from '../../../contexts/DashboardContext';
import { useUI } from '../../../contexts/UIContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { RULES } from '../../../services/rules'; // Import RULES

import UserManager from '../../users/components/UserManager';
import ManualCostManager from '../../costs/components/ManualCostManager';
import NotificationSettings from '../../notifications/components/NotificationSettings';
import Spinner from '../../../components/ui/Spinner';

// --- BULK QUICK SYNC MODAL ---
interface BulkQuickSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onConfirm: (selectedAccounts: Account[], syncType: 'quick' | 'history', ruleNames?: string[]) => void;
}

export const BulkQuickSyncModal: React.FC<BulkQuickSyncModalProps> = ({ isOpen, onClose, accounts, onConfirm }) => {
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [syncType, setSyncType] = useState<'quick' | 'history'>('quick');
  const [mode, setMode] = useState<'all' | 'custom'>('all');
  const [selectedRules, setSelectedRules] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedAccounts([]);
      setSyncType('quick');
      setMode('all');
      setSelectedRules([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleAccount = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const handleToggleRule = (ruleName: string) => {
    setSelectedRules(prev =>
      prev.includes(ruleName)
        ? prev.filter(r => r !== ruleName)
        : [...prev, ruleName]
    );
  };

  const handleConfirm = () => {
    if (selectedAccounts.length === 0) {
      alert("Please select at least one account.");
      return;
    }
    if (mode === 'custom' && selectedRules.length === 0) {
      alert("Please select at least one rule.");
      return;
    }

    const accountsToSync = accounts.filter(acc => selectedAccounts.includes(acc.id));
    onConfirm(accountsToSync, syncType, mode === 'custom' ? selectedRules : undefined);
    onClose();
  };

  const groupedRules = RULES.reduce((acc, rule) => {
    const category = rule.kind === 'Funds' ? 'Funds' :
      (rule.name.includes('Refunded')) ? 'Status' :
        rule.kind === 'case' ? 'Cases' :
          rule.kind === 'help' ? 'Help Requests' : 'Orders';
    if (!acc[category]) acc[category] = [];
    acc[category].push(rule);
    return acc;
  }, {} as Record<string, typeof RULES>);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-scale-in max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Bulk Sync</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {syncType === 'quick'
              ? 'Sync recent data (last 7 days) for multiple accounts'
              : 'Re-sync complete history for multiple accounts'}
          </p>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Sync Type Selection */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Sync Type</h4>
            <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg">
              <button
                onClick={() => setSyncType('quick')}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-all ${syncType === 'quick'
                  ? 'bg-white dark:bg-gray-600 text-teal-600 dark:text-teal-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Quick Sync (7D)
                </div>
              </button>
              <button
                onClick={() => setSyncType('history')}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-all ${syncType === 'history'
                  ? 'bg-white dark:bg-gray-600 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Full Re-Sync (History)
                </div>
              </button>
            </div>
            {syncType === 'history' && (
              <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                <p className="font-semibold mb-1">⚠️ Historical Re-sync</p>
                <p>This will reset and re-process the complete email history for selected accounts. This may take a while.</p>
              </div>
            )}
          </div>

          {/* Account Selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200">Select Accounts</h4>
              <button
                onClick={() => setSelectedAccounts(selectedAccounts.length === accounts.length ? [] : accounts.map(a => a.id))}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
              >
                {selectedAccounts.length === accounts.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-2">
              {accounts.map(account => (
                <label key={account.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-600">
                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${selectedAccounts.includes(account.id)
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800'
                    }`}>
                    {selectedAccounts.includes(account.id) && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    )}
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={selectedAccounts.includes(account.id)}
                      onChange={() => handleToggleAccount(account.id)}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{account.label || account.email}</div>
                    <div className="text-[10px] text-gray-400 truncate">{account.email}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Rule Selection */}
          <div>
            <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg mb-3">
              <button
                onClick={() => setMode('all')}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-all ${mode === 'all'
                  ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
              >
                All Rules
              </button>
              <button
                onClick={() => setMode('custom')}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-all ${mode === 'custom'
                  ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
              >
                Custom Rules
              </button>
            </div>

            {mode === 'all' ? (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300">
                <p className="font-semibold mb-1">All Rules Sync</p>
                <p>This will sync all email rules for the last 7 days for selected accounts.</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-600">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Select Rules</p>

                {Object.entries(groupedRules).map(([category, rules]) => (
                  <div key={category} className="mb-3">
                    <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 pl-1">{category}</h4>
                    <div className="space-y-1">
                      {rules.map(rule => (
                        <label key={rule.name} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-600">
                          <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${selectedRules.includes(rule.name)
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800'
                            }`}>
                            {selectedRules.includes(rule.name) && (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            )}
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={selectedRules.includes(rule.name)}
                              onChange={() => handleToggleRule(rule.name)}
                            />
                          </div>
                          <div className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-200">{rule.name}</div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex justify-between items-center">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-semibold">{selectedAccounts.length}</span> account(s) selected
            {mode === 'custom' && <>, <span className="font-semibold">{selectedRules.length}</span> rule(s)</>}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedAccounts.length === 0}
              className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg shadow-lg shadow-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Sync
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
