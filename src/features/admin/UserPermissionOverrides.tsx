import React, { useMemo, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import type { AppId, SharedRole } from './authenticationTypes';
import { mergeRolePermissions, ROLE_PERMISSION_CATALOGS } from './rolePermissionCatalog';

interface UserPermissionOverridesProps {
  appId: AppId;
  role: SharedRole | null;
  rolePermissions?: Record<string, boolean> | null;
  permissions: Record<string, boolean>;
  onChange: (permissions: Record<string, boolean>) => void;
}

const hasOwnPermission = (permissions: Record<string, boolean>, key: string) =>
  Object.prototype.hasOwnProperty.call(permissions, key);

const UserPermissionOverrides: React.FC<UserPermissionOverridesProps> = ({
  appId,
  role,
  rolePermissions,
  permissions,
  onChange,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const definitions = ROLE_PERMISSION_CATALOGS[appId];
  const inheritedPermissions = role ? mergeRolePermissions(role, appId, rolePermissions) : {};
  const filteredDefinitions = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('vi');
    if (!query) return definitions;
    return definitions.filter(definition =>
      `${definition.label} ${definition.description} ${definition.group}`
        .toLocaleLowerCase('vi')
        .includes(query),
    );
  }, [definitions, searchTerm]);

  if (!role) {
    return <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Chọn role trước khi cấu hình quyền riêng.</p>;
  }

  if (definitions.length === 0) return null;

  const setOverride = (key: string, value: boolean | null) => {
    const nextPermissions = { ...permissions };
    if (value === null) delete nextPermissions[key];
    else nextPermissions[key] = value;
    onChange(nextPermissions);
  };

  return (
    <section className="mt-5 border-t border-gray-200 pt-5 dark:border-gray-800">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h4 className="text-sm font-black text-gray-900 dark:text-white">Quyền riêng của nhân sự</h4>
          <p className="mt-1 text-xs text-gray-500">Chỉ lưu các quyền khác với template role. Chọn “Theo role” để xóa override.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({})}
          disabled={Object.keys(permissions).length === 0}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Xóa mọi override
        </button>
      </div>

      <div className="relative mt-4">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
          placeholder="Tìm quyền..."
          className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      <div className="mt-3 space-y-2">
        {filteredDefinitions.map(definition => {
          const overridden = hasOwnPermission(permissions, definition.key);
          const roleOverridden = hasOwnPermission(rolePermissions || {}, definition.key);
          const overrideValue = overridden ? permissions[definition.key] : null;
          const inheritedValue = inheritedPermissions[definition.key] === true;
          const inheritedLabel = definition.contextual && !roleOverridden
            ? 'Ngữ cảnh'
            : inheritedValue ? 'Bật' : 'Tắt';
          return (
            <div key={definition.key} className="grid gap-3 rounded-xl border border-gray-200 bg-white/70 p-3 dark:border-gray-800 dark:bg-gray-900/50 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{definition.label}</span>
                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-gray-800">{definition.group}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{definition.description}</p>
              </div>
              <div className="grid grid-cols-3 rounded-lg border border-gray-200 bg-gray-50 p-1 text-[11px] font-bold dark:border-gray-700 dark:bg-gray-950">
                <button type="button" onClick={() => setOverride(definition.key, null)} className={`rounded-md px-2 py-1.5 ${!overridden ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-800 dark:text-blue-300' : 'text-gray-500'}`}>Theo role · {inheritedLabel}</button>
                <button type="button" onClick={() => setOverride(definition.key, true)} className={`rounded-md px-2 py-1.5 ${overrideValue === true ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500'}`}>Bật riêng</button>
                <button type="button" onClick={() => setOverride(definition.key, false)} className={`rounded-md px-2 py-1.5 ${overrideValue === false ? 'bg-rose-500 text-white shadow-sm' : 'text-gray-500'}`}>Tắt riêng</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default UserPermissionOverrides;
