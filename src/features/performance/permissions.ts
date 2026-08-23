import type { UserPermissions } from '../../utils/permissionHelper';
import { PERFORMANCE_SECTIONS, type PerformanceSectionId } from './types';

const SECTION_PERMISSION_KEYS: Record<PerformanceSectionId, keyof UserPermissions> = {
  'company-overview': 'viewCompanyPerformance',
  'designer-idea': 'viewDesignerIdeaPerformance',
  'designer-fulfillment': 'viewDesignerFulfillmentPerformance',
  'research-development': 'viewResearchDevelopmentPerformance',
  scale: 'viewScalePerformance',
  'customer-service': 'viewCustomerServicePerformance',
  fulfillment: 'viewFulfillmentPerformance',
  'kpi-assignment': 'viewKpiConfiguration',
};

const hasOwnPermission = (permissions: UserPermissions, key: keyof UserPermissions) => (
  Object.prototype.hasOwnProperty.call(permissions, key)
);

export const getPermittedPerformanceSections = (
  role: 'owner' | 'user',
  permissions: UserPermissions,
) => {
  if (role === 'owner') return PERFORMANCE_SECTIONS;

  const hasSectionConfiguration = Object.values(SECTION_PERMISSION_KEYS)
    .some(key => hasOwnPermission(permissions, key));
  if (!hasSectionConfiguration) return PERFORMANCE_SECTIONS;

  return PERFORMANCE_SECTIONS.filter(section => permissions[SECTION_PERMISSION_KEYS[section.id]] === true);
};

export const isPermissionConfigured = (
  permissions: UserPermissions,
  key: keyof UserPermissions,
) => hasOwnPermission(permissions, key);

export const isPerformanceManagement = (
  dashboardRole: 'owner' | 'user',
  sharedRole?: string | null,
) => dashboardRole === 'owner' || ['ADMIN', 'MANAGER'].includes(String(sharedRole || '').toUpperCase());
