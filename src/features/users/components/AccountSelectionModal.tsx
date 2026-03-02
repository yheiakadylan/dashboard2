import React, { useState } from 'react';
import { Account } from '../../../types';

import { UserRole } from '../types';

// --- BẮT ĐẦU: Component Modal mới để chọn Account ---
interface AccountSelectionModalProps {
  user: UserRole;
  allMailAccounts: Account[];
  onSave: (userId: string, allowedAccounts: string[]) => void;
  onClose: () => void;
}

const AccountSelectionModal: React.FC<AccountSelectionModalProps> = ({ user, allMailAccounts, onSave, onClose }) => {
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(() => user.allowedAccounts || []);
  const [searchTerm, setSearchTerm] = useState('');

  const handleToggleAccount = (email: string) => {
    setSelectedAccounts(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    );
  };

  const filteredAccounts = allMailAccounts.filter(acc =>
    (acc.label || acc.email).toLowerCase().includes(searchTerm.toLowerCase()) ||
    acc.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectAllFiltered = (isChecked: boolean) => {
    const filteredEmails = new Set(filteredAccounts.map(a => a.email));
    if (isChecked) {
      setSelectedAccounts(prev => Array.from(new Set([...prev, ...filteredEmails])));
    } else {
      setSelectedAccounts(prev => prev.filter(email => !filteredEmails.has(email)));
    }
  };

  const isAllFilteredSelected = filteredAccounts.length > 0 && filteredAccounts.every(acc => selectedAccounts.includes(acc.email));

  const handleDone = () => {
    onSave(user.id, selectedAccounts);
  };

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg border border-gray-200 dark:border-gray-700 flex flex-col h-[600px] max-h-[85vh]" onClick={stopPropagation}>
        <div className="flex justify-between items-start p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-lg text-gray-900 dark:text-white">Allowed accounts for</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800 focus:ring-blue-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <label className="flex items-center space-x-2 text-sm font-medium text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={isAllFilteredSelected}
              onChange={e => handleSelectAllFiltered(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500"
            />
            <span>Select all ({filteredAccounts.length})</span>
          </label>
        </div>

        <div className="flex-grow overflow-y-auto p-2 space-y-1">
          {filteredAccounts.map(account => {
            const isSelected = selectedAccounts.includes(account.email);
            return (
              <label key={account.id} className={`flex items-center space-x-3 p-2 rounded-md border cursor-pointer transition-colors duration-150 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600' : 'bg-transparent border-transparent hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleAccount(account.email)}
                  className="rounded h-4 w-4 text-blue-600 focus:ring-blue-500"
                />
                {account.provider === 'gmail' ? (
                  <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5 flex-shrink-0" />
                ) : (
                  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/512px-Microsoft_logo.svg.png?20210729021049" alt="Microsoft" className="w-5 h-5 flex-shrink-0" />
                )}
                <div className="flex-grow min-w-0">
                  <p className="font-medium text-gray-800 dark:text-gray-100 truncate" title={account.label || account.email}>{account.label || account.email}</p>
                  {account.label && <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={account.email}>{account.email}</p>}
                </div>
              </label>
            )
          })}
          {filteredAccounts.length === 0 && (
            <div className="text-center py-10 px-4">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-200">No accounts found</h3>
              <p className="mt-1 text-sm text-gray-500">No accounts match your search term.</p>
            </div>
          )}
        </div>

        <div className="p-4 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-md font-semibold text-gray-800 dark:text-gray-100">
            Cancel
          </button>
          <button onClick={handleDone} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
// --- KẾT THÚC: Component Modal chọn Account ---
export default AccountSelectionModal;
