import type { DocumentData } from 'firebase/firestore';
import { auth } from '../../services/firebaseService';
import {
  APP_IDS,
  SHARED_ROLES,
  SHARED_TEAM_ID,
  isAuthenticationAdminEmail,
  getDepartmentFromRole,
  normalizeSharedRole,
  type AppAuthorization,
  type AppId,
  type AuthenticationUserRecord,
  type CommonAuthenticationData,
  type RolePermissionConfiguration,
  type SharedRole,
} from './authenticationTypes';

export interface AuthenticationAccountOption {
  id: string;
  email: string;
  label: string;
  hasShopName: boolean;
  provider: string | null;
  searchText: string;
}

const normalizeEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeNullableText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const normalizeNames = (fullNameValue: unknown, displayNameValue: unknown, fallback: string) => {
  const inputFullName = normalizeText(fullNameValue);
  const inputDisplayName = normalizeText(displayNameValue);
  return {
    fullName: inputFullName || inputDisplayName || fallback,
    displayName: inputDisplayName || inputFullName || fallback,
  };
};

const normalizeAllowedAccounts = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)));
};

const normalizePermissions = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
};

const normalizeAppAuthorization = (appId: AppId, value: DocumentData | null): AppAuthorization => ({
  appId,
  configured: value != null,
  enabled: value?.enabled === true,
  allowedAccounts: normalizeAllowedAccounts(value?.allowedAccounts),
  permissions: normalizePermissions(value?.permissions),
});

const buildRecord = (
  uid: string,
  authentication: DocumentData,
  appDocuments: Partial<Record<AppId, DocumentData | null>>,
): AuthenticationUserRecord => {
  const email = normalizeEmail(authentication.email);
  const fallbackName = email.split('@')[0] || uid;
  const names = normalizeNames(authentication.fullName, authentication.displayName, fallbackName);
  const role = normalizeSharedRole(authentication.role);

  const common: CommonAuthenticationData = {
    uid,
    email,
    fullName: names.fullName,
    displayName: names.displayName,
    empID: normalizeNullableText(authentication.empID),
    role,
    department: normalizeNullableText(authentication.department) || getDepartmentFromRole(role),
    teamId: normalizeNullableText(authentication.teamId),
    active: authentication.active === true,
    photoURL: normalizeNullableText(authentication.photoURL),
  };

  return {
    uid,
    common,
    apps: {
      dashboard: normalizeAppAuthorization('dashboard', appDocuments.dashboard || null),
      workload: normalizeAppAuthorization('workload', appDocuments.workload || null),
    },
  };
};

interface AuthenticationAdminProfilePayload {
  uid: string;
  authentication: DocumentData;
  apps: Partial<Record<AppId, DocumentData | null>>;
}

interface AuthenticationAdminSnapshotPayload {
  profiles: AuthenticationAdminProfilePayload[];
  accounts: Array<{ id: string } & DocumentData>;
  roleConfigurations: Array<{
    role: SharedRole;
    apps?: Partial<Record<AppId, DocumentData | null>>;
  }>;
}

let pendingAdminSnapshot: Promise<AuthenticationAdminSnapshotPayload> | null = null;

const loadAdminSnapshot = async (): Promise<AuthenticationAdminSnapshotPayload> => {
  if (pendingAdminSnapshot) return pendingAdminSnapshot;
  pendingAdminSnapshot = (async () => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Phiên đăng nhập đã hết hạn.');
    const response = await fetch('/api/users', {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
      cache: 'no-store',
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || 'Không thể tải dữ liệu authentication.');
    return {
      profiles: Array.isArray(result?.profiles) ? result.profiles : [],
      accounts: Array.isArray(result?.accounts) ? result.accounts : [],
      roleConfigurations: Array.isArray(result?.roleConfigurations) ? result.roleConfigurations : [],
    };
  })();

  try {
    return await pendingAdminSnapshot;
  } finally {
    pendingAdminSnapshot = null;
  }
};

export const loadAuthenticationUsers = async (): Promise<AuthenticationUserRecord[]> => {
  const { profiles } = await loadAdminSnapshot();
  return profiles
    .filter(profile => profile.authentication && profile.uid)
    .map(profile => buildRecord(profile.uid, profile.authentication, profile.apps || {}))
    .sort((left, right) =>
      left.common.fullName.localeCompare(right.common.fullName, 'vi')
      || left.common.email.localeCompare(right.common.email),
    );
};

export const loadAuthenticationAccounts = async (): Promise<AuthenticationAccountOption[]> => {
  const { accounts } = await loadAdminSnapshot();
  const normalizedAccounts = accounts
    .map(data => {
      const email = normalizeEmail(data.email);
      const storedLabel = normalizeText(data.label);
      const shopNames = [storedLabel, data.shopName, data.etsyShopName, data.name]
        .map(normalizeText)
        .filter(name => name && normalizeEmail(name) !== email);
      const label = storedLabel || shopNames[0] || 'Chưa đặt tên shop';
      const provider = normalizeNullableText(data.provider);
      const searchText = [
        data.id,
        email,
        ...shopNames,
        data.etsy_shop_id,
        data.etsyShopId,
        data.shopId,
        provider,
        ...(Array.isArray(data.platforms) ? data.platforms : []),
      ].map(value => String(value || '').trim()).filter(Boolean).join(' ').toLocaleLowerCase('vi');
      return {
        id: data.id,
        email,
        label,
        hasShopName: shopNames.length > 0,
        provider,
        searchText,
      };
    })
    .filter(account => account.email);

  return Array.from(new Map(normalizedAccounts.map(account => [account.email, account])).values())
    .sort((left, right) => Number(right.hasShopName) - Number(left.hasShopName)
      || left.label.localeCompare(right.label, 'vi')
      || left.email.localeCompare(right.email));
};

export const loadRolePermissionConfigurations = async (): Promise<RolePermissionConfiguration[]> => {
  const { roleConfigurations } = await loadAdminSnapshot();
  const byRole = new Map(roleConfigurations.map(configuration => [configuration.role, configuration]));

  return SHARED_ROLES.map(role => {
    const configuration = byRole.get(role);
    return {
      role,
      apps: Object.fromEntries(APP_IDS.map(appId => {
        const app = configuration?.apps?.[appId];
        return [appId, {
          appId,
          configured: app != null,
          permissions: normalizePermissions(app?.permissions),
        }];
      })) as RolePermissionConfiguration['apps'],
    };
  });
};

const getIdToken = async (): Promise<string> => {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Phiên đăng nhập đã hết hạn.');
  return idToken;
};

export const saveRolePermissionConfiguration = async (
  role: SharedRole,
  appId: AppId,
  permissions: Record<string, boolean>,
): Promise<void> => {
  const response = await fetch('/api/users', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getIdToken()}`,
    },
    body: JSON.stringify({
      roleConfiguration: { role, appId, permissions: normalizePermissions(permissions) },
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || 'Không thể lưu cấu hình quyền theo role.');
};

const serializeAppAuthorization = (app: AppAuthorization) => ({
  appId: app.appId,
  enabled: app.enabled === true,
  allowedAccounts: normalizeAllowedAccounts(app.allowedAccounts),
  permissions: normalizePermissions(app.permissions),
});

export const saveAuthenticationUser = async (
  record: AuthenticationUserRecord,
  options: { syncFirebaseAuthName?: boolean } = {},
): Promise<AuthenticationUserRecord> => {
  const email = normalizeEmail(record.common.email);
  const names = normalizeNames(record.common.fullName, record.common.displayName, email.split('@')[0] || record.uid);
  const isAuthenticationAdmin = isAuthenticationAdminEmail(email);
  const role = isAuthenticationAdmin ? 'ADMIN' : normalizeSharedRole(record.common.role);
  if (!role) throw new Error('Role nhân sự là bắt buộc.');

  const apps = {
    ...record.apps,
    dashboard: {
      ...record.apps.dashboard,
      enabled: isAuthenticationAdmin ? true : record.apps.dashboard.enabled === true,
    },
  };
  const common: CommonAuthenticationData = {
    uid: record.uid,
    email,
    fullName: names.fullName,
    displayName: names.displayName,
    empID: normalizeNullableText(record.common.empID),
    role,
    department: getDepartmentFromRole(role),
    teamId: SHARED_TEAM_ID,
    active: isAuthenticationAdmin ? true : record.common.active === true,
    photoURL: normalizeNullableText(record.common.photoURL),
  };
  const normalizedApps = Object.fromEntries(APP_IDS.map(appId => {
    const app = apps[appId];
    return [appId, {
      appId,
      configured: true,
      enabled: app.enabled === true,
      allowedAccounts: normalizeAllowedAccounts(app.allowedAccounts),
      permissions: normalizePermissions(app.permissions),
    }];
  })) as AuthenticationUserRecord['apps'];
  const savedRecord: AuthenticationUserRecord = {
    uid: record.uid,
    common,
    apps: normalizedApps,
  };

  const response = await fetch('/api/users', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getIdToken()}`,
    },
    body: JSON.stringify({
      userId: record.uid,
      authenticationRecord: {
        uid: record.uid,
        common,
        apps: Object.fromEntries(APP_IDS.map(appId => [appId, serializeAppAuthorization(normalizedApps[appId])])),
        syncFirebaseAuthName: options.syncFirebaseAuthName !== false,
      },
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || 'Không thể lưu hồ sơ authentication.');
  return savedRecord;
};

export interface CreateAuthenticationUserInput {
  email: string;
  password: string;
  fullName: string;
  displayName: string;
  empID: string;
  role: SharedRole | null;
  enabledApps: AppId[];
}

export const createAuthenticationUser = async (input: CreateAuthenticationUserInput): Promise<string> => {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getIdToken()}`,
    },
    body: JSON.stringify({
      email: normalizeEmail(input.email),
      password: input.password,
      fullName: normalizeText(input.fullName),
      displayName: normalizeText(input.displayName),
      empID: normalizeText(input.empID),
      teamId: SHARED_TEAM_ID,
      role: input.role,
      enabledApps: input.enabledApps.filter(appId => APP_IDS.includes(appId)),
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || 'Không thể tạo tài khoản.');
  return result.uid as string;
};

export const resetAuthenticationUserPassword = async (uid: string, password: string): Promise<void> => {
  const response = await fetch('/api/users', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getIdToken()}`,
    },
    body: JSON.stringify({ userId: uid, password }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || 'Không thể đổi mật khẩu.');
};

export const syncLegacyAuthenticationUsers = async (): Promise<{ synced: number; skipped: number; warnings: number }> => {
  const response = await fetch('/api/users', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getIdToken()}`,
    },
    body: JSON.stringify({ syncLegacyAuthentication: true }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || 'Không thể sync dữ liệu legacy.');
  return {
    synced: Number(result?.synced || 0),
    skipped: Number(result?.skipped || 0),
    warnings: Number(result?.warnings || 0),
  };
};

export const deleteAuthenticationUser = async (uid: string): Promise<void> => {
  const response = await fetch('/api/users', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getIdToken()}`,
    },
    body: JSON.stringify({ userId: uid }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || 'Không thể xóa tài khoản.');
};
