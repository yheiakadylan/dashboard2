import React, { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, RotateCcw, Save, Search, ShieldCheck } from 'lucide-react';
import {
  loadRolePermissionConfigurations,
  saveRolePermissionConfiguration,
} from './authenticationAdminService';
import {
  APP_IDS,
  APP_LABELS,
  SHARED_ROLES,
  type AppId,
  type RolePermissionConfiguration,
  type SharedRole,
} from './authenticationTypes';
import {
  ROLE_PERMISSION_CATALOGS,
  mergeRolePermissions,
} from './rolePermissionCatalog';

interface RolePermissionManagerProps {
  onSaved?: (message: string) => void;
  onError?: (message: string) => void;
}

const RolePermissionManager: React.FC<RolePermissionManagerProps> = ({ onSaved, onError }) => {
  const [configurations, setConfigurations] = useState<RolePermissionConfiguration[]>([]);
  const [selectedRole, setSelectedRole] = useState<SharedRole>('CS_FULFILL');
  const [selectedApp, setSelectedApp] = useState<AppId>('workload');
  const [draftPermissions, setDraftPermissions] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedConfiguration = useMemo(
    () => configurations.find(configuration => configuration.role === selectedRole),
    [configurations, selectedRole],
  );
  const selectedAppConfiguration = selectedConfiguration?.apps[selectedApp];

  const loadConfigurations = async () => {
    setLoading(true);
    try {
      setConfigurations(await loadRolePermissionConfigurations());
    } catch (error) {
      console.error(error);
      onError?.(error instanceof Error ? error.message : 'Không thể tải cấu hình quyền theo role.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfigurations();
  }, []);

  useEffect(() => {
    setDraftPermissions({ ...(selectedAppConfiguration?.permissions || {}) });
  }, [selectedApp, selectedAppConfiguration?.permissions, selectedRole]);

  const effectivePermissions = useMemo(
    () => mergeRolePermissions(selectedRole, selectedApp, draftPermissions),
    [draftPermissions, selectedApp, selectedRole],
  );

  const filteredDefinitions = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('vi');
    const definitions = ROLE_PERMISSION_CATALOGS[selectedApp];
    if (!query) return definitions;
    return definitions.filter(definition => (
      `${definition.label} ${definition.description} ${definition.key} ${definition.group}`
        .toLocaleLowerCase('vi')
        .includes(query)
    ));
  }, [searchTerm, selectedApp]);

  const groups = useMemo(() => {
    const grouped = new Map<string, typeof filteredDefinitions>();
    filteredDefinitions.forEach(definition => {
      grouped.set(definition.group, [...(grouped.get(definition.group) || []), definition]);
    });
    return Array.from(grouped.entries());
  }, [filteredDefinitions]);

  const enabledCount = ROLE_PERMISSION_CATALOGS[selectedApp]
    .filter(definition => effectivePermissions[definition.key] === true)
    .length;
  const overrideCount = Object.keys(draftPermissions).length;

  const setAllPermissions = (enabled: boolean) => {
    setDraftPermissions(current => ({
      ...current,
      ...Object.fromEntries(ROLE_PERMISSION_CATALOGS[selectedApp].map(definition => [definition.key, enabled])),
    }));
  };

  const restoreDefaults = () => {
    setDraftPermissions({});
  };

  const setOverride = (key: string, value: boolean | null) => {
    setDraftPermissions(current => {
      const next = { ...current };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveRolePermissionConfiguration(selectedRole, selectedApp, draftPermissions);
      setConfigurations(current => current.map(configuration => (
        configuration.role !== selectedRole ? configuration : {
          ...configuration,
          apps: {
            ...configuration.apps,
            [selectedApp]: {
              appId: selectedApp,
              configured: true,
              permissions: { ...draftPermissions },
            },
          },
        }
      )));
      onSaved?.(`Đã áp dụng quyền ${APP_LABELS[selectedApp]} cho toàn bộ role ${selectedRole}.`);
    } catch (error) {
      console.error(error);
      onError?.(error instanceof Error ? error.message : 'Không thể lưu cấu hình quyền theo role.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass-panel min-h-[700px] overflow-hidden rounded-3xl border border-white/70 shadow-sm dark:border-gray-800/70">
      <div className="border-b border-white/70 bg-white/30 p-5 dark:border-gray-800/70 dark:bg-gray-950/20 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black">Quyền mặc định theo role</h2>
              <p className="mt-1 max-w-3xl text-sm text-gray-500">Chỉ lưu các quyền cần ghi đè fallback code và áp dụng cho toàn bộ nhân sự giữ role tương ứng.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || ROLE_PERMISSION_CATALOGS[selectedApp].length === 0}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Lưu cho toàn role
          </button>
        </div>

        <div className="mt-5 grid items-end gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <label className="block text-xs font-bold text-gray-500">
            <span className="block h-4">Role nhân sự</span>
            <select
              value={selectedRole}
              onChange={event => setSelectedRole(event.target.value as SharedRole)}
              className="mt-1.5 block h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {SHARED_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <div>
            <span className="block h-4 text-xs font-bold text-gray-500">Ứng dụng</span>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {APP_IDS.map(appId => (
                <button
                  key={appId}
                  type="button"
                  onClick={() => setSelectedApp(appId)}
                  className={`h-11 rounded-xl border px-3 text-left text-sm font-bold transition ${selectedApp === appId
                    ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900'
                    : 'border-gray-200 bg-white/70 text-gray-600 hover:bg-white dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300 dark:hover:bg-gray-900'}`}
                >
                  {APP_LABELS[appId]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6">
        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center text-gray-500"><LoaderCircle className="h-7 w-7 animate-spin" /></div>
        ) : ROLE_PERMISSION_CATALOGS[selectedApp].length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/45 p-8 text-center dark:border-gray-700 dark:bg-gray-950/20">
            <ShieldCheck className="h-9 w-9 text-gray-400" />
            <h3 className="mt-3 font-black">Chưa có quyền chức năng riêng</h3>
            <p className="mt-1 max-w-lg text-sm text-gray-500">Ứng dụng này hiện chỉ kiểm tra trạng thái được phép đăng nhập.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white/55 p-3 dark:border-gray-800 dark:bg-gray-950/20 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  placeholder="Tìm tên hoặc mã quyền..."
                  className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-black text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{enabledCount}/{ROLE_PERMISSION_CATALOGS[selectedApp].length} đang bật</span>
                <span className="rounded-lg bg-blue-50 px-2.5 py-2 text-xs font-black text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{overrideCount} tùy chỉnh</span>
                <button type="button" onClick={() => setAllPermissions(true)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800">Bật tất cả</button>
                <button type="button" onClick={() => setAllPermissions(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800">Tắt tất cả</button>
                <button type="button" onClick={restoreDefaults} disabled={overrideCount === 0} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"><RotateCcw className="h-3.5 w-3.5" /> Theo code</button>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {groups.map(([group, definitions]) => (
                <div key={group} className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/55 dark:border-gray-800 dark:bg-gray-950/20">
                  <div className="border-b border-gray-200/80 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-500">{group}</h3>
                  </div>
                  <div className="grid gap-px bg-gray-200/80 dark:bg-gray-800 md:grid-cols-2">
                    {definitions.map(definition => {
                      const overridden = Object.prototype.hasOwnProperty.call(draftPermissions, definition.key);
                      const overrideValue = overridden ? draftPermissions[definition.key] : null;
                      const enabled = effectivePermissions[definition.key] === true;
                      return (
                        <div
                          key={definition.key}
                          className="flex min-h-28 flex-col justify-between gap-3 bg-white p-4 dark:bg-gray-950"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-black">{definition.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-gray-500">{definition.description}</span>
                            <span className="mt-1.5 block font-mono text-[10px] text-gray-400">{definition.key}</span>
                          </span>
                          <span className="grid grid-cols-3 rounded-lg border border-gray-200 bg-gray-50 p-1 text-[11px] font-bold dark:border-gray-700 dark:bg-gray-900">
                            <button type="button" onClick={() => setOverride(definition.key, null)} className={`rounded-md px-2 py-1.5 ${!overridden ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-800 dark:text-blue-300' : 'text-gray-500'}`}>Theo code · {definition.contextual ? 'Ngữ cảnh' : enabled ? 'Bật' : 'Tắt'}</button>
                            <button type="button" onClick={() => setOverride(definition.key, true)} className={`rounded-md px-2 py-1.5 ${overrideValue === true ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500'}`}>Bật role</button>
                            <button type="button" onClick={() => setOverride(definition.key, false)} className={`rounded-md px-2 py-1.5 ${overrideValue === false ? 'bg-rose-500 text-white shadow-sm' : 'text-gray-500'}`}>Tắt role</button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {groups.length === 0 && <p className="py-12 text-center text-sm text-gray-500">Không tìm thấy quyền phù hợp.</p>}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default RolePermissionManager;
