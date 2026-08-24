export const AUTHENTICATION_ADMIN_EMAIL = 'haitrinh@gmail.com';
export const AUTHENTICATION_ADMIN_EMAILS = [AUTHENTICATION_ADMIN_EMAIL, 'buonngu@gmail.com'] as const;
const authenticationAdminEmailSet = new Set<string>(AUTHENTICATION_ADMIN_EMAILS);
export const isAuthenticationAdminEmail = (email: unknown): boolean =>
  authenticationAdminEmailSet.has(String(email || '').trim().toLowerCase());
export const SHARED_TEAM_ID = 'jwnm5emo8mdG3gjIlh7CctiVvQO2';

export const APP_IDS = ['dashboard', 'workload'] as const;

export type AppId = typeof APP_IDS[number];

export const APP_LABELS: Record<AppId, string> = {
  dashboard: 'Dashboard',
  workload: 'Workload',
};

export const SHARED_ROLES = [
  'ADMIN', 'MANAGER',
  'CS_SUPPORT', 'CS_FULFILL',
  'LEADCS_SUPPORT', 'LEADCS_FULFILL',
  'DS_FULFILL', 'DS_IDEA', 'LEADDS_FULFILL', 'LEADDS_IDEA',
  'IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE',
] as const;

export type SharedRole = typeof SHARED_ROLES[number];

const sharedRoleSet = new Set<string>(SHARED_ROLES);

export const normalizeSharedRole = (value: unknown): SharedRole | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return sharedRoleSet.has(normalized) ? normalized as SharedRole : null;
};

export interface CommonAuthenticationData {
  uid: string;
  email: string;
  fullName: string;
  displayName: string;
  empID: string | null;
  role: SharedRole | null;
  department: string | null;
  teamId: string | null;
  active: boolean;
  photoURL: string | null;
}

export const getDepartmentFromRole = (role: SharedRole | null): string | null => {
  if (!role) return null;
  if (['DS_IDEA', 'DS_FULFILL', 'LEADDS_IDEA', 'LEADDS_FULFILL'].includes(role)) {
    return 'Designer';
  }
  if (['IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE'].includes(role)) {
    return 'IDEA';
  }
  if (['CS_SUPPORT', 'CS_FULFILL', 'LEADCS_SUPPORT', 'LEADCS_FULFILL'].includes(role)) {
    return 'Customer Service';
  }
  if (['ADMIN', 'MANAGER'].includes(role)) return 'Management';
  return null;
};

export interface AppAuthorization {
  appId: AppId;
  configured: boolean;
  enabled: boolean | null;
  allowedAccounts: string[];
  permissions: Record<string, boolean>;
  isKpi: boolean;
  canViewLeaderboard: boolean;
  kpiTeam: string | null;
  viewableKpiTeams: string[];
}

export interface AuthenticationUserRecord {
  uid: string;
  common: CommonAuthenticationData;
  apps: Record<AppId, AppAuthorization>;
}

export interface RoleAppPermissionConfiguration {
  appId: AppId;
  configured: boolean;
  permissions: Record<string, boolean>;
}

export interface RolePermissionConfiguration {
  role: SharedRole;
  apps: Record<AppId, RoleAppPermissionConfiguration>;
}
