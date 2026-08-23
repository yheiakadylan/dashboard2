import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Database,
  LoaderCircle,
  LogOut,
  RefreshCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  createAuthenticationUser,
  deleteAuthenticationUser,
  loadAuthenticationAccounts,
  loadRolePermissionConfigurations,
  loadAuthenticationUsers,
  resetAuthenticationUserPassword,
  saveAuthenticationUser,
  syncLegacyAuthenticationUsers,
  type AuthenticationAccountOption,
} from './authenticationAdminService';
import {
  APP_IDS,
  APP_LABELS,
  AUTHENTICATION_ADMIN_EMAIL,
  SHARED_TEAM_ID,
  SHARED_ROLES,
  getDepartmentFromRole,
  type AppId,
  type AuthenticationUserRecord,
  type RolePermissionConfiguration,
  type SharedRole,
} from './authenticationTypes';
import RolePermissionManager from './RolePermissionManager';
import { useNotification } from '../../contexts/NotificationContext';
import UserPermissionOverrides from './UserPermissionOverrides';

interface AuthenticationAdminPageProps {
  user: User;
  logout: () => Promise<void>;
}

interface AccountPickerProps {
  options: AuthenticationAccountOption[];
  value: string[];
  onChange: (accounts: string[]) => void;
}

const AccountPicker: React.FC<AccountPickerProps> = ({ options, value, onChange }) => {
  const searchInputId = useId();
  const [searchTerm, setSearchTerm] = useState('');
  const filteredOptions = useMemo(() => {
    const queries = searchTerm
      .split(',')
      .map(term => term.trim().toLocaleLowerCase('vi'))
      .filter(Boolean);
    if (queries.length === 0) return options;
    return options.filter(option => queries.some(query => option.searchText.includes(query)));
  }, [options, searchTerm]);
  const selectedAccounts = new Set(value);
  const allFilteredSelected = filteredOptions.length > 0 && filteredOptions.every(option => selectedAccounts.has(option.email));

  const toggleAccount = (email: string) => {
    onChange(selectedAccounts.has(email) ? value.filter(item => item !== email) : [...value, email]);
  };

  const toggleAllFiltered = () => {
    const filteredEmails = new Set(filteredOptions.map(option => option.email));
    onChange(allFilteredSelected
      ? value.filter(email => !filteredEmails.has(email))
      : Array.from(new Set([...value, ...filteredEmails])));
  };

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <label htmlFor={searchInputId} className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Tìm shop/account</label>
          <Search className="absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" />
          <input id={searchInputId} type="search" autoComplete="off" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Stitchsoulbyani, AnidecorStudio, Ebay Kavari..." className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-950" />
          {searchTerm && <button type="button" onClick={() => setSearchTerm('')} aria-label="Xóa nội dung tìm kiếm" className="absolute bottom-2 right-2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>}
        </div>
        <button type="button" onClick={toggleAllFiltered} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          {allFilteredSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500"><span>{searchTerm ? `${filteredOptions.length} kết quả` : `${options.length} shop/account`}</span><span>{options.filter(option => !option.hasShopName).length} chưa có tên shop</span></div>
      <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
        {filteredOptions.map(option => {
          const selected = selectedAccounts.has(option.email);
          return (
            <button key={option.id} type="button" onClick={() => toggleAccount(option.email)} title={`${option.label} · ${option.email} · ID: ${option.id}`} className={`flex min-h-[58px] items-center gap-2 rounded-lg border p-2 text-left transition ${selected ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>{selected && <Check className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0"><span className={`block truncate text-xs font-semibold ${option.hasShopName ? 'text-slate-800 dark:text-slate-100' : 'text-amber-700 dark:text-amber-300'}`}>{option.label}</span><span className="block truncate text-[10px] text-slate-500">{option.email}</span>{!option.hasShopName && <span className="mt-0.5 block truncate text-[9px] font-semibold text-amber-600 dark:text-amber-400">Cần đặt label trong quản lý shop/account</span>}</span>
            </button>
          );
        })}
        {filteredOptions.length === 0 && <p className="py-6 text-center text-xs text-slate-500 sm:col-span-2 xl:col-span-3">Không tìm thấy shop/account.</p>}
      </div>
      <p className="mt-2 text-xs text-slate-500">Đã chọn {value.length}/{options.length} shop/account. Có thể tìm nhiều shop bằng dấu phẩy.</p>
    </div>
  );
};

const cloneRecord = (record: AuthenticationUserRecord): AuthenticationUserRecord => ({
  ...record,
  common: { ...record.common },
  apps: {
    dashboard: {
      ...record.apps.dashboard,
      allowedAccounts: [...record.apps.dashboard.allowedAccounts],
      permissions: { ...record.apps.dashboard.permissions },
    },
    workload: {
      ...record.apps.workload,
      allowedAccounts: [...record.apps.workload.allowedAccounts],
      permissions: { ...record.apps.workload.permissions },
    },
  },
});

const recordsMatch = (
  left: AuthenticationUserRecord | null | undefined,
  right: AuthenticationUserRecord | null | undefined,
): boolean => Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));

const statusLabel = (enabled: boolean | null) => {
  if (enabled === true) return 'Đang bật';
  if (enabled === false) return 'Đã tắt';
  return 'Chưa cấu hình';
};

const createEmptyAppSelection = (): Record<AppId, boolean> => ({
  dashboard: false,
  workload: false,
});

const getInitials = (value: string): string => value
  .split(/\s+/)
  .filter(Boolean)
  .slice(-2)
  .map(part => part[0]?.toUpperCase() || '')
  .join('') || 'U';

interface UserAvatarProps {
  imageUrl?: string | null;
  name: string;
  selected?: boolean;
  large?: boolean;
}

const UserAvatar: React.FC<UserAvatarProps> = ({ imageUrl, name, selected = false, large = false }) => {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [imageUrl]);
  const sizeClass = large ? 'h-12 w-12 rounded-2xl text-sm' : 'h-10 w-10 rounded-xl text-xs';
  const fallbackClass = selected
    ? 'bg-blue-600 text-white'
    : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200';

  if (imageUrl && !imageFailed) {
    return (
      <img
        src={imageUrl}
        alt={name}
        loading="lazy"
        onError={() => setImageFailed(true)}
        className={`${sizeClass} shrink-0 object-cover ring-1 ring-black/5 dark:ring-white/10`}
      />
    );
  }

  return <div className={`${sizeClass} ${fallbackClass} flex shrink-0 items-center justify-center font-black`}>{getInitials(name)}</div>;
};

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, disabled = false, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative h-7 w-12 shrink-0 overflow-hidden rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
  >
    <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
  </button>
);

const AuthenticationAdminPageContent: React.FC<AuthenticationAdminPageProps> = ({ user, logout }) => {
  const { addNotification } = useNotification();
  const isAdmin = user.email?.toLowerCase() === AUTHENTICATION_ADMIN_EMAIL;
  const [records, setRecords] = useState<AuthenticationUserRecord[]>([]);
  const [accountOptions, setAccountOptions] = useState<AuthenticationAccountOption[]>([]);
  const [roleConfigurations, setRoleConfigurations] = useState<RolePermissionConfiguration[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthenticationUserRecord | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppId>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    fullName: '',
    displayName: '',
    empID: '',
    role: '' as SharedRole | '',
    apps: createEmptyAppSelection(),
  });
  const [creating, setCreating] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [syncingLegacy, setSyncingLegacy] = useState(false);
  const [adminView, setAdminView] = useState<'users' | 'roles'>('users');
  const latestDraftRef = useRef<AuthenticationUserRecord | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const lastQueuedFingerprintRef = useRef<string | null>(null);

  const refreshRecords = async (preferredUid?: string) => {
    setLoading(true);
    try {
      const [nextRecords, nextAccounts, nextRoleConfigurations] = await Promise.all([
        loadAuthenticationUsers(),
        loadAuthenticationAccounts(),
        loadRolePermissionConfigurations(),
      ]);
      setRecords(nextRecords);
      setAccountOptions(nextAccounts);
      setRoleConfigurations(nextRoleConfigurations);
      const nextUid = preferredUid
        || selectedUid
        || nextRecords.find(record => record.common.email === AUTHENTICATION_ADMIN_EMAIL)?.uid
        || nextRecords[0]?.uid
        || null;
      setSelectedUid(nextUid);
      const selectedRecord = nextRecords.find(record => record.uid === nextUid) || null;
      setDraft(selectedRecord ? cloneRecord(selectedRecord) : null);
    } catch (error) {
      console.error(error);
      addNotification('Không thể tải dữ liệu phân quyền.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) void refreshRecords();
  }, [isAdmin]);

  useEffect(() => {
    const record = records.find(item => item.uid === selectedUid);
    setDraft(current => current?.uid === selectedUid
      ? current
      : record ? cloneRecord(record) : null);
  }, [records, selectedUid]);

  useEffect(() => {
    setNewPassword('');
    setDeleteDialogOpen(false);
    setDeleteConfirmation('');
  }, [selectedUid]);

  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

  const filteredRecords = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('vi');
    if (!query) return records;
    return records.filter(record => [
      record.common.fullName,
      record.common.displayName,
      record.common.email,
      record.common.empID || '',
      record.common.department || '',
    ].some(value => value.toLocaleLowerCase('vi').includes(query)));
  }, [records, searchTerm]);

  const selectedAuthorization = draft?.apps[selectedApp] || null;
  const activeRecordCount = records.filter(record => record.common.active).length;
  const configuredRoleCount = roleConfigurations.filter(configuration =>
    APP_IDS.some(appId => configuration.apps[appId].configured),
  ).length;
  const appAccessCounts = useMemo(() => APP_IDS.reduce((counts, appId) => {
    counts[appId] = records.filter(record => record.apps[appId].enabled === true).length;
    return counts;
  }, {} as Record<AppId, number>), [records]);
  const currentAdminRecord = records.find(record => record.uid === user.uid) || null;

  const queueAutoSave = useCallback((recordToSave: AuthenticationUserRecord) => {
    const storedRecord = records.find(record => record.uid === recordToSave.uid);
    if (!storedRecord || recordsMatch(storedRecord, recordToSave)) return;

    const payload = cloneRecord(recordToSave);
    const fingerprint = JSON.stringify(payload);
    if (lastQueuedFingerprintRef.current === fingerprint) return;
    lastQueuedFingerprintRef.current = fingerprint;
    const shouldSyncFirebaseAuthName = storedRecord.common.displayName !== payload.common.displayName
      || storedRecord.common.photoURL !== payload.common.photoURL;

    pendingSaveCountRef.current += 1;
    setSaving(true);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const savedRecord = await saveAuthenticationUser(payload, { syncFirebaseAuthName: shouldSyncFirebaseAuthName });
          setRecords(current => current.map(record => record.uid === savedRecord.uid ? savedRecord : record));
          setDraft(current => recordsMatch(current, payload) ? cloneRecord(savedRecord) : current);
          addNotification('Đã tự động lưu thay đổi.', 'success');
        } catch (error) {
          console.error(error);
          addNotification(error instanceof Error ? error.message : 'Không thể tự động lưu dữ liệu.', 'error');
        } finally {
          pendingSaveCountRef.current -= 1;
          if (lastQueuedFingerprintRef.current === fingerprint) lastQueuedFingerprintRef.current = null;
          if (pendingSaveCountRef.current === 0) setSaving(false);
        }
      });
  }, [addNotification, records]);

  const flushAutoSave = useCallback(async (recordToSave?: AuthenticationUserRecord | null) => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const currentDraft = recordToSave === undefined ? latestDraftRef.current : recordToSave;
    if (currentDraft) queueAutoSave(currentDraft);
    await saveQueueRef.current;
  }, [queueAutoSave]);

  useEffect(() => {
    const storedRecord = draft ? records.find(record => record.uid === draft.uid) : null;
    if (!draft || !storedRecord || recordsMatch(storedRecord, draft)) return;
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      queueAutoSave(draft);
    }, 300);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [draft, queueAutoSave, records]);
  const updateCommon = <Key extends keyof AuthenticationUserRecord['common']>(
    key: Key,
    value: AuthenticationUserRecord['common'][Key],
  ) => {
    setDraft(current => current ? {
      ...current,
      common: { ...current.common, [key]: value },
    } : current);
  };

  const updateSharedRole = (role: SharedRole | null) => {
    setDraft(current => current ? {
      ...current,
      common: {
        ...current.common,
        role,
        department: getDepartmentFromRole(role),
      },
    } : current);
  };

  const updateSelectedApp = (
    updates: Partial<AuthenticationUserRecord['apps'][AppId]>,
  ) => {
    setDraft(current => {
      if (!current) return current;
      const nextAuthorization = {
        ...current.apps[selectedApp],
        ...updates,
      };
      return {
        ...current,
        apps: {
          ...current.apps,
          [selectedApp]: {
            ...nextAuthorization,
            configured: nextAuthorization.enabled !== null
              || nextAuthorization.allowedAccounts.length > 0
              || Object.keys(nextAuthorization.permissions).length > 0,
          },
        },
      };
    });
  };

  const handleSelectUser = (uid: string) => {
    void flushAutoSave(draft);
    setSelectedUid(uid);
    setSelectedApp('dashboard');
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createForm.email || !createForm.password || (!createForm.fullName.trim() && !createForm.displayName.trim()) || !createForm.empID.trim() || !createForm.role) {
      addNotification('Email, mật khẩu, ít nhất một tên, mã nhân viên và role là bắt buộc.', 'error');
      return;
    }
    if (createForm.password.length < 6) {
      addNotification('Mật khẩu phải có ít nhất 6 ký tự.', 'error');
      return;
    }
    const enabledApps = APP_IDS.filter(appId => createForm.apps[appId]);
    if (enabledApps.length === 0) {
      addNotification('Chọn ít nhất một ứng dụng được phép truy cập.', 'error');
      return;
    }

    setCreating(true);
    try {
      const uid = await createAuthenticationUser({
        email: createForm.email,
        password: createForm.password,
        fullName: createForm.fullName,
        displayName: createForm.displayName,
        empID: createForm.empID,
        role: createForm.role || null,
        enabledApps,
      });
      setCreateForm({ email: '', password: '', fullName: '', displayName: '', empID: '', role: '', apps: createEmptyAppSelection() });
      setShowCreateForm(false);
      setSearchTerm('');
      setSelectedApp(enabledApps[0]);
      await refreshRecords(uid);
      addNotification('Đã tạo tài khoản. Hãy cấu hình shop và quyền chi tiết cho từng ứng dụng.', 'success');
    } catch (error) {
      console.error(error);
      addNotification(error instanceof Error ? error.message : 'Không thể tạo tài khoản.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async () => {
    if (!draft || newPassword.length < 6) {
      addNotification('Mật khẩu mới phải có ít nhất 6 ký tự.', 'error');
      return;
    }
    setResettingPassword(true);
    try {
      await resetAuthenticationUserPassword(draft.uid, newPassword);
      setNewPassword('');
      addNotification(`Đã đổi mật khẩu cho ${draft.common.email}.`, 'success');
    } catch (error) {
      console.error(error);
      addNotification(error instanceof Error ? error.message : 'Không thể đổi mật khẩu.', 'error');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!draft || deleteConfirmation.trim().toLowerCase() !== draft.common.email.toLowerCase()) return;
    const deletedRecord = draft;
    setDeleting(true);
    try {
      await deleteAuthenticationUser(deletedRecord.uid);
      const remainingRecords = records.filter(record => record.uid !== deletedRecord.uid);
      const nextRecord = remainingRecords.find(record => record.common.email === AUTHENTICATION_ADMIN_EMAIL)
        || remainingRecords[0]
        || null;
      setRecords(remainingRecords);
      setSelectedUid(nextRecord?.uid || null);
      setDraft(nextRecord ? cloneRecord(nextRecord) : null);
      setDeleteDialogOpen(false);
      setDeleteConfirmation('');
      addNotification(`Đã xóa hoàn toàn ${deletedRecord.common.email}. Email này có thể được tạo lại.`, 'success');
    } catch (error) {
      console.error(error);
      addNotification(error instanceof Error ? error.message : 'Không thể xóa tài khoản.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleSyncLegacy = async () => {
    setSyncingLegacy(true);
    try {
      await flushAutoSave(draft);
      const result = await syncLegacyAuthenticationUsers();
      await refreshRecords(selectedUid || undefined);
      addNotification(`Đã sync ${result.synced} hồ sơ legacy. Bỏ qua ${result.skipped}${result.warnings ? `, ${result.warnings} cảnh báo role` : ''}.`, 'success');
    } catch (error) {
      console.error(error);
      addNotification(error instanceof Error ? error.message : 'Không thể sync dữ liệu legacy.', 'error');
    } finally {
      setSyncingLegacy(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
          <ShieldCheck className="mx-auto h-12 w-12 text-amber-400" />
          <h1 className="mt-5 text-2xl font-semibold">Không có quyền truy cập</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Trang quản trị authentication chỉ dành cho {AUTHENTICATION_ADMIN_EMAIL}.
          </p>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="mt-6 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950"
          >
            Quay lại Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-mesh text-gray-900 dark:text-gray-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-blue-300/20 blur-3xl dark:bg-blue-600/10" />
        <div className="absolute -bottom-32 left-1/4 h-80 w-80 rounded-full bg-cyan-200/20 blur-3xl dark:bg-cyan-500/10" />
      </div>

      {deleteDialogOpen && draft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-user-title" className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-5 shadow-2xl dark:border-rose-900 dark:bg-slate-950 md:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-300"><AlertTriangle className="h-5 w-5" /></div>
              <div><h2 id="delete-user-title" className="text-lg font-black">Xóa hoàn toàn tài khoản?</h2><p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">Firebase Authentication và toàn bộ cây <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">authentication/{draft.uid}</code> sẽ bị xóa. Email có thể được tạo lại sau đó.</p></div>
            </div>
            <label className="mt-5 block text-xs font-bold text-gray-600 dark:text-gray-300">Nhập chính xác email để xác nhận
              <input autoFocus value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder={draft.common.email} className="mt-2 w-full rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 dark:border-rose-900 dark:bg-gray-900" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setDeleteDialogOpen(false); setDeleteConfirmation(''); }} disabled={deleting} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900">Hủy</button>
              <button type="button" onClick={() => void handleDeleteUser()} disabled={deleting || deleteConfirmation.trim().toLowerCase() !== draft.common.email.toLowerCase()} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">{deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Xóa vĩnh viễn</button>
            </div>
          </div>
        </div>
      )}

      <header className="glass-base sticky top-0 z-40 border-b border-white/60 px-4 py-3 shadow-sm dark:border-gray-800/80 md:px-6">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="rounded-xl border border-gray-200/80 bg-white/70 p-2 text-gray-500 shadow-sm transition hover:-translate-x-0.5 hover:bg-white dark:border-gray-700 dark:bg-gray-900/70 dark:hover:bg-gray-800"
              title="Quay lại Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-600/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold md:text-xl">Quản trị nhân sự</h1>
                <span className="hidden rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-blue-700 dark:bg-blue-950 dark:text-blue-300 sm:inline">Authentication Hub</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentAdminRecord && (
              <div className="hidden items-center gap-2 pr-1 sm:flex">
                <UserAvatar imageUrl={currentAdminRecord.common.photoURL} name={currentAdminRecord.common.displayName || currentAdminRecord.common.fullName} />
                <div className="hidden max-w-40 lg:block"><p className="truncate text-xs font-black">{currentAdminRecord.common.displayName}</p><p className="truncate text-[10px] text-gray-500">{currentAdminRecord.common.role}</p></div>
              </div>
            )}
            <button
              type="button"
              onClick={() => void flushAutoSave(draft).then(() => refreshRecords())}
              disabled={loading || syncingLegacy}
              className="rounded-xl border border-gray-200/80 bg-white/70 p-2 text-gray-600 shadow-sm transition hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300 dark:hover:bg-gray-800"
              title="Tải lại"
            >
              <RefreshCcw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void handleSyncLegacy()}
              disabled={syncingLegacy || loading}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950"
              title="Sync user_roles/users_roles/users sang authentication"
            >
              {syncingLegacy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              Sync legacy
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-xl border border-gray-200/80 bg-white/70 p-2 text-gray-600 shadow-sm transition hover:bg-white dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300 dark:hover:bg-gray-800"
              title="Đăng xuất"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1680px] p-3 md:p-6">
        <section className="glass-panel mb-4 overflow-hidden rounded-3xl border border-white/70 dark:border-gray-800/70">
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center md:p-6">
            <div className="flex min-w-0 items-start gap-4">
              <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gray-950 text-white shadow-xl dark:bg-white dark:text-gray-950 sm:flex">
                <Database className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black tracking-tight md:text-2xl">Authentication Control Center</h2>
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">Quản lý nhân sự, role dùng chung và quyền truy cập hai ứng dụng.</p>
              </div>
            </div>
          </div>

          <div className="grid border-t border-white/70 bg-white/35 sm:grid-cols-2 xl:grid-cols-4 dark:border-gray-800/70 dark:bg-gray-950/20">
            <div className="border-b border-white/70 p-4 sm:border-r xl:border-b-0 dark:border-gray-800/70">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-gray-500"><span>Tổng hồ sơ</span><Users className="h-4 w-4 text-blue-500" /></div>
              <p className="mt-2 text-2xl font-black">{records.length}</p>
              <p className="mt-1 text-xs text-gray-500">{activeRecordCount} đang hoạt động</p>
            </div>
            <div className="border-b border-white/70 p-4 xl:border-b-0 xl:border-r dark:border-gray-800/70">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-gray-500"><span>Role đã cấu hình</span><Database className="h-4 w-4 text-emerald-500" /></div>
              <p className="mt-2 text-2xl font-black">{configuredRoleCount}<span className="text-sm text-gray-400">/{SHARED_ROLES.length}</span></p>
              <p className="mt-1 text-xs text-gray-500">Template quyền động theo từng ứng dụng</p>
            </div>
            <div className="border-b border-white/70 p-4 sm:border-r xl:border-b-0 dark:border-gray-800/70">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Quyền ứng dụng</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-lg bg-blue-100 px-2 py-1 text-blue-700 dark:bg-blue-950 dark:text-blue-300">Dashboard {appAccessCounts.dashboard}</span>
                <span className="rounded-lg bg-cyan-100 px-2 py-1 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">Workload {appAccessCounts.workload}</span>
              </div>
            </div>
            <div className="bg-emerald-50/70 p-4 dark:bg-emerald-950/20">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Nguồn dữ liệu</p>
              <p className="mt-2 text-sm font-black">Authentication canonical</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Quyền hiệu lực = template role + override riêng của từng nhân sự.</p>
            </div>
          </div>
        </section>

        <div className="mb-4 flex w-fit rounded-2xl border border-white/70 bg-white/60 p-1 shadow-sm backdrop-blur dark:border-gray-800/70 dark:bg-gray-950/40">
          <button
            type="button"
            onClick={() => { void flushAutoSave(draft); setAdminView('users'); }}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${adminView === 'users' ? 'bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
          >
            Nhân sự
          </button>
          <button
            type="button"
            onClick={() => { void flushAutoSave(draft); setAdminView('roles'); }}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${adminView === 'roles' ? 'bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
          >
            Quyền theo role
          </button>
        </div>

        {adminView === 'roles' && (
          <RolePermissionManager
            onSaved={text => {
              addNotification(text, 'success');
              void loadRolePermissionConfigurations().then(setRoleConfigurations);
            }}
            onError={text => addNotification(text, 'error')}
          />
        )}

        {adminView === 'users' && <>
        {showCreateForm && (
          <form onSubmit={handleCreateUser} className="glass-panel mb-4 rounded-3xl border border-white/70 p-5 shadow-sm dark:border-gray-800/70 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><UserPlus className="h-4 w-4" /></div>
                  <div><h2 className="font-bold">Tạo tài khoản nhân sự</h2><p className="text-xs text-gray-500">Khởi tạo Firebase Auth, hồ sơ dùng chung và quyền ứng dụng mặc định.</p></div>
                </div>
              </div>
              <button type="button" onClick={() => setShowCreateForm(false)} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/70 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs font-bold text-gray-500">Email đăng nhập<input type="email" required placeholder="name@workload.vn" value={createForm.email} onChange={event => setCreateForm(value => ({ ...value, email: event.target.value }))} className="mt-1 w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900/70" /></label>
              <label className="text-xs font-bold text-gray-500">Họ và tên quản lý<input type="text" placeholder="Dùng trong hồ sơ quản trị" value={createForm.fullName} onChange={event => setCreateForm(value => ({ ...value, fullName: event.target.value }))} className="mt-1 w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900/70" /></label>
              <label className="text-xs font-bold text-gray-500">Tên hiển thị<input type="text" placeholder="Dùng trong các ứng dụng" value={createForm.displayName} onChange={event => setCreateForm(value => ({ ...value, displayName: event.target.value }))} className="mt-1 w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900/70" /></label>
              <label className="text-xs font-bold text-gray-500">Mã nhân viên<input type="text" required placeholder="VD: DS001" value={createForm.empID} onChange={event => setCreateForm(value => ({ ...value, empID: event.target.value }))} className="mt-1 w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900/70" /></label>
              <label className="text-xs font-bold text-gray-500">Mật khẩu ban đầu<input type="password" required minLength={6} placeholder="Tối thiểu 6 ký tự" value={createForm.password} onChange={event => setCreateForm(value => ({ ...value, password: event.target.value }))} className="mt-1 w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900/70" /></label>
              <label className="text-xs font-bold text-gray-500">Role dùng chung<select required value={createForm.role} onChange={event => setCreateForm(value => ({ ...value, role: event.target.value as SharedRole | '' }))} className="mt-1 w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900/70">
                  <option value="">Chọn role nhân sự</option>
                  {SHARED_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                </select></label>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-2xl border border-gray-200 bg-white/60 p-4 dark:border-gray-800 dark:bg-gray-950/20">
                <p className="text-xs font-bold text-gray-700 dark:text-gray-200">Ứng dụng được phép truy cập</p>
                <p className="mt-1 text-xs text-gray-500">Chỉ bật quyền đăng nhập tại bước này. Shop/account và quyền riêng được cấu hình sau khi tài khoản được tạo.</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {APP_IDS.map(appId => (
                    <div key={appId} className={`flex min-h-[70px] items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${createForm.apps[appId] ? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-gray-200 bg-white/70 dark:border-gray-700 dark:bg-gray-900/70'}`}>
                      <span className="min-w-0"><span className="block truncate text-sm font-black">{APP_LABELS[appId]}</span><span className="mt-0.5 block text-[11px] text-gray-500">{createForm.apps[appId] ? 'Sẽ được bật' : 'Không truy cập'}</span></span>
                      <ToggleSwitch checked={createForm.apps[appId]} label={`Bật ${APP_LABELS[appId]}`} onChange={enabled => setCreateForm(value => ({ ...value, apps: { ...value.apps, [appId]: enabled } }))} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 text-xs dark:border-blue-900/60 dark:bg-blue-950/30">
                <p className="font-bold text-blue-700 dark:text-blue-300">Thông tin tự động</p>
                <p className="mt-2"><strong>Team ID:</strong><br />{SHARED_TEAM_ID}</p>
                <p className="mt-2"><strong>Phòng ban:</strong><br />{getDepartmentFromRole(createForm.role || null) || 'Chọn role để xác định'}</p>
                <p className="mt-2 text-gray-500 dark:text-gray-400">Role được dùng chung cho cả hệ thống. Sau khi tạo, hồ sơ mới tự mở để cấu hình quyền theo từng app.</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button type="submit" disabled={creating} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60">
                {creating ? 'Đang tạo...' : 'Tạo tài khoản'}
              </button>
            </div>
          </form>
        )}

        <div className="grid min-h-[700px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="glass-panel overflow-hidden rounded-3xl border border-white/70 shadow-sm dark:border-gray-800/70">
            <div className="border-b border-white/70 p-3 dark:border-gray-800/70">
              <div className="mb-3 flex items-center justify-between px-1">
                <div><h2 className="text-sm font-black">Danh bạ nhân sự</h2><p className="text-xs text-gray-500">{filteredRecords.length}/{records.length} hồ sơ</p></div>
                <button type="button" onClick={() => setShowCreateForm(true)} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700"><UserPlus className="h-4 w-4" /> Thêm</button>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Tên, email, empID, phòng ban..." className="w-full rounded-xl border border-gray-200 bg-white/75 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900/70" />
                </div>
              </div>
            </div>
            <div className="max-h-[780px] overflow-y-auto p-2.5">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-500"><LoaderCircle className="h-6 w-6 animate-spin" /></div>
              ) : filteredRecords.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">Không tìm thấy nhân sự.</p>
              ) : filteredRecords.map(record => {
                const activeApps = APP_IDS.filter(appId => record.apps[appId].enabled === true).length;
                const selected = record.uid === selectedUid;
                return (
                  <button
                    key={record.uid}
                    type="button"
                    onClick={() => handleSelectUser(record.uid)}
                    className={`mb-1.5 w-full rounded-2xl border p-3 text-left transition ${selected
                      ? 'border-blue-300 bg-blue-50/90 shadow-sm ring-1 ring-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:ring-blue-900/40'
                      : 'border-transparent bg-white/35 hover:border-gray-200 hover:bg-white/75 dark:bg-gray-950/10 dark:hover:border-gray-700 dark:hover:bg-gray-900/60'}`}
                  >
                    <div className="flex items-start gap-3">
                      <UserAvatar imageUrl={record.common.photoURL} name={record.common.displayName || record.common.fullName} selected={selected} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0"><p className="truncate text-sm font-bold">{record.common.fullName}</p><p className="truncate text-[11px] text-gray-500">{record.common.displayName} · {record.common.empID || 'Chưa có empID'}</p></div>
                          <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${record.common.active ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]' : 'bg-gray-400'}`} title={record.common.active ? 'Active' : 'Inactive'} />
                      </div>
                        <p className="mt-1 truncate text-xs text-gray-500">{record.common.email || record.uid}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{record.common.role || 'No role'}</span>
                          {APP_IDS.map(appId => <span key={appId} title={APP_LABELS[appId]} className={`h-2 w-2 rounded-full ${record.apps[appId].enabled === true ? 'bg-emerald-500' : record.apps[appId].enabled === false ? 'bg-gray-400' : 'bg-amber-400'}`} />)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-gray-800"><span>{record.common.department || 'Chưa có phòng ban'}</span><span>{activeApps}/{APP_IDS.length} app</span></div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="glass-panel min-w-0 overflow-hidden rounded-3xl border border-white/70 shadow-sm dark:border-gray-800/70">
            {!draft ? (
              <div className="flex h-full min-h-[500px] items-center justify-center text-sm text-slate-500">Chọn một nhân sự để cấu hình.</div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/70 bg-white/30 p-4 dark:border-gray-800/70 dark:bg-gray-950/20 md:p-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar imageUrl={draft.common.photoURL} name={draft.common.displayName || draft.common.fullName} selected large />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-black">{draft.common.fullName}</h2><span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{draft.common.role || 'Chưa có role'}</span></div>
                      <p className="truncate text-xs text-gray-500">{draft.common.displayName} · {draft.common.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/70"><span className={`text-xs font-bold ${draft.common.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>{draft.common.active ? 'Active' : 'Inactive'}</span><ToggleSwitch checked={draft.common.active} disabled={draft.common.email === AUTHENTICATION_ADMIN_EMAIL} label="Thay đổi trạng thái nhân sự" onChange={active => updateCommon('active', active)} /></div>
                    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${saving ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'}`} aria-live="polite">
                      {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {saving ? 'Đang tự động lưu...' : 'Tự động lưu'}
                    </div>
                    <button type="button" onClick={() => setDeleteDialogOpen(true)} disabled={deleting || draft.uid === user.uid || draft.common.email === AUTHENTICATION_ADMIN_EMAIL} className="flex items-center gap-2 rounded-xl border border-rose-200 bg-white/80 px-3 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-900 dark:bg-gray-900/80 dark:text-rose-300 dark:hover:bg-rose-950/40" title={draft.uid === user.uid || draft.common.email === AUTHENTICATION_ADMIN_EMAIL ? 'Không thể xóa tài khoản quản trị hiện tại' : 'Xóa Firebase Auth và toàn bộ hồ sơ authentication'}>
                      <Trash2 className="h-4 w-4" /> Xóa tài khoản
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 md:p-5">
                  <section className="rounded-2xl border border-gray-200/80 bg-white/55 p-4 dark:border-gray-800 dark:bg-gray-950/20 md:p-5">
                    <div className="mb-4"><h3 className="font-black">Thông tin định danh</h3><p className="text-xs text-gray-500">Thông tin dùng chung cho Dashboard và Workload.</p></div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <label className="text-xs font-bold text-gray-500">Email đăng nhập
                      <input value={draft.common.email} disabled className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm font-normal text-gray-500 dark:border-gray-700 dark:bg-gray-900" />
                    </label>
                    <label className="text-xs font-bold text-gray-500">Mã nhân viên
                      <input value={draft.common.empID || ''} onChange={event => updateCommon('empID', event.target.value || null)} onBlur={() => void flushAutoSave(draft)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                    </label>
                    <label className="text-xs font-bold text-gray-500">Role dùng chung
                      <select value={draft.common.role || ''} onChange={event => updateSharedRole((event.target.value || null) as SharedRole | null)} disabled={draft.common.email === AUTHENTICATION_ADMIN_EMAIL} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:disabled:bg-gray-800">
                        <option value="">Chưa gán role</option>{SHARED_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-gray-500">Họ và tên quản lý
                      <input value={draft.common.fullName} onChange={event => updateCommon('fullName', event.target.value)} onBlur={() => void flushAutoSave(draft)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                    </label>
                    <label className="text-xs font-bold text-gray-500">Tên hiển thị trong ứng dụng
                      <input value={draft.common.displayName} onChange={event => updateCommon('displayName', event.target.value)} onBlur={() => void flushAutoSave(draft)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                    </label>
                    <label className="text-xs font-bold text-gray-500">Phòng ban từ role
                      <input value={draft.common.department || ''} disabled className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm font-normal text-gray-500 dark:border-gray-700 dark:bg-gray-900" />
                    </label>
                    </div>
                    <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
                      <span className="text-xs font-bold text-gray-500">Đặt lại mật khẩu</span>
                      <div className="mt-1 flex gap-2">
                        <input type="password" minLength={6} value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="Mật khẩu mới, tối thiểu 6 ký tự" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900" />
                        <button type="button" onClick={() => void handleResetPassword()} disabled={resettingPassword || newPassword.length < 6} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800">
                          {resettingPassword ? 'Đang đổi...' : 'Đổi mật khẩu'}
                        </button>
                      </div>
                    </div>
                  </section>

                  <div className="mt-5 grid gap-2 md:grid-cols-2">
                    {APP_IDS.map(appId => {
                      const app = draft.apps[appId];
                      return (
                        <button key={appId} type="button" onClick={() => setSelectedApp(appId)} className={`rounded-2xl border p-3 text-left transition ${selectedApp === appId ? 'border-blue-300 bg-blue-50 shadow-sm ring-1 ring-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:ring-blue-900/40' : 'border-gray-200 bg-white/50 hover:bg-white dark:border-gray-800 dark:bg-gray-950/20 dark:hover:bg-gray-900/60'}`}>
                          <div className="flex items-center justify-between gap-2"><span className="text-sm font-black">{APP_LABELS[appId]}</span><span className={`h-2.5 w-2.5 rounded-full ${app.enabled === true ? 'bg-emerald-500' : app.enabled === false ? 'bg-gray-400' : 'bg-amber-400'}`} /></div>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500"><span>{statusLabel(app.enabled)}</span>{appId === 'dashboard' && <span>{app.allowedAccounts.length} account</span>}</div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedAuthorization && (
                    <div className="mt-3 rounded-2xl border border-gray-200/80 bg-white/55 p-4 dark:border-gray-800 dark:bg-gray-950/20 md:p-5">
                      <div className="mb-4"><h3 className="font-black">{APP_LABELS[selectedApp]}</h3><p className="text-xs text-gray-500">Bật hoặc tắt quyền truy cập ứng dụng cho nhân sự này.</p></div>
                      <div className="max-w-sm">
                        <div className="text-xs font-bold text-gray-500">Truy cập ứng dụng
                          <div className="mt-1 flex min-h-[42px] items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{statusLabel(selectedAuthorization.enabled)}</span>
                            <ToggleSwitch
                              checked={selectedAuthorization.enabled === true}
                              disabled={selectedApp === 'dashboard' && draft.common.email === AUTHENTICATION_ADMIN_EMAIL}
                              label={`Thay đổi truy cập ${APP_LABELS[selectedApp]}`}
                              onChange={enabled => updateSelectedApp({ enabled })}
                            />
                          </div>
                        </div>
                      </div>

                      {selectedApp === 'dashboard' && (
                        <div className="mt-4 text-xs font-semibold text-slate-500">Shop/account được phép xem
                          <div className="mt-1"><AccountPicker options={accountOptions} value={selectedAuthorization.allowedAccounts} onChange={allowedAccounts => updateSelectedApp({ allowedAccounts })} /></div>
                        </div>
                      )}

                      <UserPermissionOverrides
                        appId={selectedApp}
                        role={draft.common.role}
                        rolePermissions={roleConfigurations.find(configuration => configuration.role === draft.common.role)?.apps[selectedApp].permissions}
                        permissions={selectedAuthorization.permissions}
                        onChange={permissions => updateSelectedApp({ permissions })}
                      />

                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
        </>}
      </main>
    </div>
  );
};

export default AuthenticationAdminPageContent;
