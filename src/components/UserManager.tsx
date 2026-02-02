// components/UserManager.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { db, auth } from '../services/firebaseService';
import { collection, getDocs, query, where, doc, writeBatch, updateDoc } from 'firebase/firestore';
import { Account } from '../types';
import Spinner from './Spinner';
import { KeyRound } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

// Định nghĩa kiểu dữ liệu cho User Role
interface UserRole {
  id: string;
  email: string;
  role: 'owner' | 'user';
  permissions: {
    // Legacy permissions (for backward compatibility)
    viewSales?: boolean;
    viewFunds?: boolean;
    viewFulfill?: boolean;
    canManageSettings?: boolean;

    // Tab permissions
    viewOverviewTab?: boolean;
    viewOrderListTab?: boolean;
    viewProductsTab?: boolean;
    viewSupportTab?: boolean;
    viewFulfillTab?: boolean;

    // KPI permissions
    viewKpiOrders?: boolean;
    viewKpiShops?: boolean;
    viewKpiRevenue?: boolean;
    viewKpiFunds?: boolean;
    viewKpiCost?: boolean;
    viewKpiEarn?: boolean;

    // Action permissions
    canEditCost?: boolean;
    canExportData?: boolean;
    canManageUsers?: boolean;
  };
  allowedAccounts?: string[];
}

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
      title: 'Tab Permissions',
      description: 'Which tabs user can see in sidebar',
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
      title: 'KPI Permissions',
      description: 'Which KPI cards user can view',
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
      title: 'Action Permissions',
      description: 'What user can do',
      keys: ['canEditCost', 'canExportData', 'canManageUsers', 'canManageSettings'] as const,
      labels: {
        canEditCost: 'Edit Cost',
        canExportData: 'Export Data',
        canManageUsers: 'Manage Users',
        canManageSettings: 'Mail Edit',
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
  const someChecked = currentGroup.keys.some(key => localPermissions[key] === true);

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
          <button
            onClick={() => setActiveTab('tabs')}
            className={`flex-1 py-3 px-4 text-sm font-semibold ${activeTab === 'tabs' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {permissionGroups.tabs.title}
          </button>
          <button
            onClick={() => setActiveTab('kpis')}
            className={`flex-1 py-3 px-4 text-sm font-semibold ${activeTab === 'kpis' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {permissionGroups.kpis.title}
          </button>
          <button
            onClick={() => setActiveTab('actions')}
            className={`flex-1 py-3 px-4 text-sm font-semibold ${activeTab === 'actions' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {permissionGroups.actions.title}
          </button>
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


const UserManager: React.FC = () => {
  const { teamId, accounts: allMailAccounts } = useDashboard();
  const { addNotification } = useNotification();
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // State cho việc tạo user mới
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'owner'>('user');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // --- State để quản lý modal ---
  const [editingAccountsForUser, setEditingAccountsForUser] = useState<UserRole | null>(null);
  const [editingPermissionsForUser, setEditingPermissionsForUser] = useState<UserRole | null>(null);

  // --- State cho Delete User ---
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<UserRole | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // --- State cho Reset Password (Owner) ---
  const [resetPasswordUser, setResetPasswordUser] = useState<UserRole | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isResettingPass, setIsResettingPass] = useState(false);

  // Hàm tải danh sách user
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'user_roles'), where('teamId', '==', teamId));
      const querySnapshot = await getDocs(q);
      const userList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        allowedAccounts: doc.data().allowedAccounts || [],
      } as UserRole));

      userList.forEach(u => {
        if (u.role === 'user' && !u.permissions) {
          u.permissions = {
            viewSales: false,
            viewFunds: false,
            viewFulfill: false,
            canManageSettings: false,
          };
        }
      });
      setUsers(userList.sort((a, b) => a.role.localeCompare(b.role) || a.email.localeCompare(b.email)));

    } catch (err: any) {
      console.error(err);
      setError('Failed to load users. Check Firestore rules.');
    }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);





  // --- THÊM: Các hàm xử lý modal ---
  const handleOpenAccountModal = (user: UserRole) => {
    setEditingAccountsForUser(user);
  };

  const handleCloseAccountModal = () => {
    setEditingAccountsForUser(null);
  };

  const handleSaveAllowedAccounts = async (userId: string, newAllowedAccounts: string[]) => {
    try {
      const userRef = doc(db, 'user_roles', userId);
      await updateDoc(userRef, { allowedAccounts: newAllowedAccounts });
      addNotification('Allowed accounts updated successfully', 'success');
      fetchUsers();
    } catch (err: any) {
      console.error('Error updating account access:', err);
      addNotification(`Failed to update account access: ${err.message}`, 'error');
    }
    handleCloseAccountModal();
  };

  // Handler for saving permissions from modal
  const handleSavePermissions = async (userId: string, newPermissions: UserRole['permissions']) => {
    try {
      const userRef = doc(db, 'user_roles', userId);
      await updateDoc(userRef, { permissions: newPermissions });
      addNotification('Permissions updated successfully', 'success');
      fetchUsers(); // Refresh user list
    } catch (err: any) {
      console.error('Error updating permissions:', err);
      addNotification(`Failed to update permissions: ${err.message}`, 'error');
    }
  };

  // Hàm Owner đổi pass cho User
  const handleResetPasswordByOwner = async () => {
    if (!resetPasswordUser || !newAdminPassword) return;
    if (newAdminPassword.length < 6) {
      addNotification("Password must be at least 6 characters", 'error');
      return;
    }

    setIsResettingPass(true);
    try {
      const idToken = await auth.currentUser!.getIdToken();
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ userId: resetPasswordUser.id, password: newAdminPassword }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message);

      addNotification(`Success! Password for ${resetPasswordUser.email} has been updated.`, 'success');
      setResetPasswordUser(null);
      setNewAdminPassword('');

    } catch (error: any) {
      console.error("Reset pass error:", error);
      addNotification(`Failed: ${error.message}`, 'error');
    } finally {
      setIsResettingPass(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail || !newUserPassword) {
      setCreateError('Email and Password are required.');
      return;
    }
    setIsCreating(true);
    setCreateError(null);

    try {
      const idToken = await auth.currentUser!.getIdToken();

      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
          teamId: teamId,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Failed to create user.');
      }

      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('user');
      await fetchUsers();
      addNotification("User created successfully.", 'success');

    } catch (err: any) {
      console.error(err);
      setCreateError(err.message);
      addNotification(err.message, 'error');
    }
    setIsCreating(false);
  };

  // Hàm xóa user
  const handleDeleteUser = async (userId: string) => {
    setDeletingUserId(userId);
    try {
      const idToken = await auth.currentUser!.getIdToken();

      const response = await fetch('/api/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ userId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to delete user.');
      }

      // Success → Refresh user list
      await fetchUsers();
      addNotification("User deleted successfully.", 'success');
      setConfirmDeleteUser(null);

      // Nếu đang mở form reset của user này thì đóng lại
      if (resetPasswordUser?.id === userId) {
        setResetPasswordUser(null);
      }

    } catch (err: any) {
      console.error(err);
      addNotification(`Error deleting user: ${err.message}`, 'error');
    } finally {
      setDeletingUserId(null);
    }
  };


  if (loading) {
    return <div className="text-center p-4">Loading users...</div>;
  }
  if (error) {
    return <div className="text-center p-4 text-red-500">{error}</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow overflow-y-auto pr-2">
        <h3 className="text-lg font-semibold mb-3 border-b pb-2">Manage Existing Users</h3>
        <div className="space-y-4">
          {users.map(user => (
            <div key={user.id} className="bg-gray-100 dark:bg-gray-700 p-3 rounded">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{user.email}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase ${user.role === 'owner' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-200'}`}>
                    {user.role}
                  </span>
                </div>

                {/* Actions: Delete & Reset Pass */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setResetPasswordUser(user)}
                    className="px-2 py-1 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors"
                    title="Reset Password"
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteUser(user)}
                    className="px-2 py-1 text-sm font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                    title="Delete User"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {user.role === 'user' && (
                <div className="pt-3 border-t border-gray-200 dark:border-gray-600">
                  <div className="flex gap-2">
                    {/* Permissions */}
                    <button
                      onClick={() => setEditingPermissionsForUser(user)}
                      className="flex-1 px-3 py-2 text-xs font-semibold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      📋 Permissions ({Object.values(user.permissions).filter(Boolean).length})
                    </button>

                    {/* Allowed Mail Accounts */}
                    <button
                      onClick={() => handleOpenAccountModal(user)}
                      className="flex-1 px-3 py-2 text-xs font-semibold bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 transition-colors"
                    >
                      📧 Mail ({user.allowedAccounts?.length || 0})
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Auto-save indicator */}
        {saving && (
          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-blue-600 dark:text-blue-400">
            <Spinner size="sm" color="text-blue-600 dark:text-blue-400" />
            <span>Auto-saving...</span>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-3 border-b pb-2">Create New User</h3>
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="email" placeholder="New User Email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md" />
            <input type="password" placeholder="New User Password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md" />
          </div>
          <div className="flex items-center justify-end gap-4">
            <select value={newUserRole} onChange={e => setNewUserRole(e.target.value as 'user' | 'owner')} className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md">
              <option value="user">User</option>
              <option value="owner">Owner</option>
            </select>
            <button type="submit" disabled={isCreating} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold disabled:opacity-50">
              {isCreating ? 'Creating...' : 'Create User'}
            </button>
          </div>
          {createError && <p className="text-red-500 text-sm">{createError}</p>}
        </form>
      </div>

      {/* --- Render modals --- */}
      {editingAccountsForUser && (
        <AccountSelectionModal
          user={editingAccountsForUser}
          allMailAccounts={allMailAccounts}
          onSave={handleSaveAllowedAccounts}
          onClose={handleCloseAccountModal}
        />
      )}

      {/* --- Permission Modal --- */}
      {editingPermissionsForUser && (
        <PermissionModal
          user={editingPermissionsForUser}
          onSave={handleSavePermissions}
          onClose={() => setEditingPermissionsForUser(null)}
        />
      )}

      {/* --- Reset Password Modal --- */}
      {resetPasswordUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setResetPasswordUser(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-blue-100 dark:bg-blue-900/30 rounded-full">
              <KeyRound className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-center text-gray-900 dark:text-white mb-2">Set New Password</h3>
            <p className="text-center text-sm text-gray-500 mb-4">Set a new password for <b>{resetPasswordUser.email}</b>. They can login with this immediately.</p>

            <input
              type="text"
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              placeholder="Enter new password (min 6 chars)"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md mb-4 bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setResetPasswordUser(null)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleResetPasswordByOwner}
                disabled={isResettingPass}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold disabled:opacity-50"
              >
                {isResettingPass ? 'Saving...' : 'Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteUser && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4"
          onClick={() => setConfirmDeleteUser(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Warning Icon */}
            <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full">
              <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-center text-gray-900 dark:text-white mb-2">
              Delete User?
            </h3>

            <p className="text-center text-gray-600 dark:text-gray-300 mb-4">
              Are you sure you want to delete this user:
            </p>

            <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg mb-4">
              <p className="font-semibold text-center text-gray-900 dark:text-white">
                {confirmDeleteUser.email}
              </p>
              <p className="text-sm text-center text-gray-500 dark:text-gray-400 mt-1">
                Role: {confirmDeleteUser.role}
              </p>
            </div>

            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-6">
              <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-2">
                ⚠️ This action will:
              </p>
              <ul className="text-xs text-red-700 dark:text-red-300 space-y-1 ml-4">
                <li>• Delete Firebase Authentication account</li>
                <li>• Remove all permissions</li>
                <li>• User will not be able to login again</li>
              </ul>
              <p className="text-xs text-red-800 dark:text-red-200 font-bold mt-2">
                ⛔ This cannot be undone!
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteUser(null)}
                disabled={deletingUserId === confirmDeleteUser.id}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-800 dark:text-white rounded-md font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteUser(confirmDeleteUser.id)}
                disabled={deletingUserId === confirmDeleteUser.id}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deletingUserId === confirmDeleteUser.id ? (
                  <>
                    <Spinner size="sm" color="text-white" />
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(UserManager);
