// components/AccountManager.tsx
import React, { useState, useEffect } from 'react';
import { Account } from '../../../types';
import { RULES } from '../../../services/rules';

interface ReSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
  onConfirm: (account: Account, ruleNames?: string[]) => void;
}

export const ReSyncModal: React.FC<ReSyncModalProps> = ({ isOpen, onClose, account, onConfirm }) => {
  const [mode, setMode] = useState<'full' | 'custom'>('full');
  const [selectedRules, setSelectedRules] = useState<string[]>([]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode('full');
      setSelectedRules([]);
    }
  }, [isOpen]);

  if (!isOpen || !account) return null;

  const handleToggleRule = (ruleName: string) => {
    setSelectedRules(prev =>
      prev.includes(ruleName)
        ? prev.filter(r => r !== ruleName)
        : [...prev, ruleName]
    );
  };

  const handleConfirm = () => {
    if (mode === 'custom' && selectedRules.length === 0) {
      alert("Please select at least one rule.");
      return;
    }
    onConfirm(account, mode === 'custom' ? selectedRules : undefined);
    onClose();
  };

  // Group rules for better UX? Or just list them.
  // Grouping by "Order", "Funds", "Status" etc. might be nice.
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
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700 overflow-hidden animate-scale-in">
        <div className="p-5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Re-Sync Account</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {account.email}
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* Mode Selection */}
          <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg">
            <button
              onClick={() => setMode('full')}
              className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-all ${mode === 'full'
                ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
            >
              Full Re-Sync
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

          <div className="space-y-3">
            {mode === 'full' ? (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300">
                <p className="font-semibold mb-1">Full Synchronization</p>
                <p>This will re-process ALL rules for the entire history. This is comprehensive but may take a while.</p>
              </div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-600">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Select Rules</p>

                {Object.entries(groupedRules).map(([category, rules]) => (
                  <div key={category} className="mb-4">
                    <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 pl-1">{category}</h4>
                    <div className="space-y-2">
                      {rules.map(rule => (
                        <label key={rule.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-600">
                          <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${selectedRules.includes(rule.name)
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800'
                            }`}>
                            {selectedRules.includes(rule.name) && (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            )}
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={selectedRules.includes(rule.name)}
                              onChange={() => handleToggleRule(rule.name)}
                            />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{rule.name}</div>
                            {/* <div className="text-xs text-gray-400 truncate w-48">{rule.query}</div> */}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg shadow-lg shadow-blue-500/30 transition-all"
          >
            {mode === 'full' ? 'Start Full Sync' : `Sync ${selectedRules.length} Rules`}
          </button>
        </div>
      </div>
    </div>
  );
};

