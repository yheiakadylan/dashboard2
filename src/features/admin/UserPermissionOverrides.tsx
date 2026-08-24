import React, { useMemo, useState } from 'react';
import { ChevronDown, RotateCcw, Search } from 'lucide-react';
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
  const groups = useMemo(() => {
    const grouped = new Map<string, typeof filteredDefinitions>();
    filteredDefinitions.forEach(definition => {
      grouped.set(definition.group, [...(grouped.get(definition.group) || []), definition]);
    });
    return Array.from(grouped.entries());
  }, [filteredDefinitions]);
  const visibleOverrideCount = definitions.filter(definition => hasOwnPermission(permissions, definition.key)).length;

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
          onClick={() => {
            const visibleKeys = new Set(definitions.map(definition => definition.key));
            onChange(Object.fromEntries(Object.entries(permissions).filter(([key]) => !visibleKeys.has(key))));
          }}
          disabled={visibleOverrideCount === 0}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Xóa quyền riêng đang hiển thị
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

      <div className="mt-3 space-y-3">
        {groups.map(([group, groupDefinitions]) => {
          const overrideCount = groupDefinitions.filter(definition => hasOwnPermission(permissions, definition.key)).length;
          return <details key={group} open={Boolean(searchTerm) || overrideCount > 0} className="group overflow-hidden rounded-xl border border-gray-200 bg-white/55 dark:border-gray-800 dark:bg-gray-950/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-black marker:content-none">
              <span>{group}</span>
              <span className="flex items-center gap-2 text-[11px] text-gray-500"><span>{overrideCount}/{groupDefinitions.length} quyền riêng</span><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
            </summary>
            <div className="space-y-2 border-t border-gray-200 p-2 dark:border-gray-800">
              {groupDefinitions.map(definition => {
                const overridden = hasOwnPermission(permissions, definition.key);
                const roleOverridden = hasOwnPermission(rolePermissions || {}, definition.key);
                const overrideValue = overridden ? permissions[definition.key] : null;
                const inheritedValue = inheritedPermissions[definition.key] === true;
                const inheritedLabel = definition.contextual && !roleOverridden
                  ? 'Ngữ cảnh'
                  : inheritedValue ? 'Bật' : 'Tắt';
                return (
                  <div key={definition.key} className="grid gap-3 rounded-lg border border-gray-200 bg-white/70 p-3 dark:border-gray-800 dark:bg-gray-900/50 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="min-w-0"><span className="text-sm font-bold">{definition.label}</span><p className="mt-1 text-xs text-gray-500">{definition.description}</p></div>
                    <div className="grid grid-cols-3 rounded-lg border border-gray-200 bg-gray-50 p-1 text-[11px] font-bold dark:border-gray-700 dark:bg-gray-950">
                      <button type="button" onClick={() => setOverride(definition.key, null)} className={`rounded-md px-2 py-1.5 ${!overridden ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-800 dark:text-blue-300' : 'text-gray-500'}`}>Theo role · {inheritedLabel}</button>
                      <button type="button" onClick={() => setOverride(definition.key, true)} className={`rounded-md px-2 py-1.5 ${overrideValue === true ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500'}`}>Bật riêng</button>
                      <button type="button" onClick={() => setOverride(definition.key, false)} className={`rounded-md px-2 py-1.5 ${overrideValue === false ? 'bg-rose-500 text-white shadow-sm' : 'text-gray-500'}`}>Tắt riêng</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>;
        })}
        {groups.length === 0 && <p className="py-6 text-center text-xs text-gray-500">Không tìm thấy quyền phù hợp.</p>}
      </div>
    </section>
  );
};

export default UserPermissionOverrides;
