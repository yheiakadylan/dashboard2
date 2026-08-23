/**
 * Permission Helper Utilities
 * 
 * Provides centralized permission checking for granular access control.
 * New permission system with explicit permissions (tabs, KPI cards, actions).
 */

export interface UserPermissions {
    // === TAB PERMISSIONS ===
    viewOverviewTab?: boolean;      // Tab: Overview (KPIs + Charts)
    viewOrderListTab?: boolean;     // Tab: Order List
    viewProductsTab?: boolean;      // Tab: Products
    viewSupportTab?: boolean;       // Tab: Support (Messages/Cases)
    viewFulfillTab?: boolean;       // Tab: Fulfill
    viewReviewsTab?: boolean;       // Tab: Reviews

    // === KPI PERMISSIONS ===
    viewKpiOrders?: boolean;        // KPI Card: Total Orders
    viewKpiShops?: boolean;         // KPI Card: Shops
    viewKpiRevenue?: boolean;       // KPI Card: Revenue
    viewKpiFunds?: boolean;         // KPI Card: Funds
    viewKpiCost?: boolean;          // KPI Card: Cost
    viewKpiEarn?: boolean;          // KPI Card: Earn (Funds - Cost)

    // === PROVIDER/PLATFORM PERMISSIONS ===
    viewMerchizeData?: boolean;     // Data: Merchize provider info/charts
    viewPrintwayData?: boolean;     // Data: Printway provider info/charts
    viewEbayData?: boolean;         // Data: Ebay sales data
    viewEtsyData?: boolean;         // Data: Etsy sales data

    // === ACTION PERMISSIONS ===
    canEditCost?: boolean;          // Edit manual costs
    canExportData?: boolean;        // Export Excel/CSV
    canManageUsers?: boolean;       // Admin: User management
    canManageMailSettings?: boolean; // Admin: Mail account management / Resync all
    canManageSettings?: boolean;    // Admin: General settings (USD mode, etc)
    canManageMappings?: boolean;    // Admin: Category/Product mappings
    canResyncOrder?: boolean;       // Action: Resync single order
    canSyncData?: boolean;          // Action: Manual sync from email/API
    canManageTemplatePoints?: boolean; // Lead: configure Designer template points

    // Allow any other custom permissions
    [key: string]: boolean | undefined;
}

const READ_ONLY_PERMISSIONS: Array<keyof UserPermissions> = [
    'viewOverviewTab', 'viewOrderListTab', 'viewProductsTab',
    'viewSupportTab', 'viewFulfillTab', 'viewReviewsTab',
    'viewKpiOrders', 'viewKpiShops', 'viewKpiRevenue', 'viewKpiFunds',
    'viewKpiCost', 'viewKpiEarn', 'viewMerchizeData', 'viewPrintwayData',
    'viewEbayData', 'viewEtsyData',
];

const MANAGEMENT_PERMISSIONS: Array<keyof UserPermissions> = [
    'canEditCost', 'canExportData', 'canManageUsers', 'canManageMailSettings',
    'canManageSettings', 'canManageMappings', 'canResyncOrder', 'canSyncData',
    'canManageTemplatePoints',
];

const LEADER_ROLES = new Set<SharedRole>([
    'LEADCS_SUPPORT', 'LEADCS_FULFILL',
    'LEADDS_FULFILL', 'LEADDS_IDEA',
    'LEADIDEA_RD', 'LEADIDEA_SCALE',
]);

const setPermissions = (
    permissions: UserPermissions,
    keys: Array<keyof UserPermissions>,
) => {
    keys.forEach(key => { permissions[key] = true; });
};

export const getDashboardPermissionsForRole = (role: SharedRole | null): UserPermissions => {
    if (!role) return {};

    const permissions: UserPermissions = {};
    setPermissions(permissions, READ_ONLY_PERMISSIONS);

    if (role === 'ADMIN' || role === 'MANAGER') {
        setPermissions(permissions, MANAGEMENT_PERMISSIONS);
        return permissions;
    }

    permissions.canExportData = LEADER_ROLES.has(role);
    permissions.canManageTemplatePoints = LEADER_ROLES.has(role);

    return permissions;
};

/**
 * Check if user has a specific permission
 * 
 * @param role - User role ('owner' or 'user')
 * @param permissions - User permissions object
 * @param key - Permission key to check
 * @returns true if user has permission, false otherwise
 * 
 * @example
 * const canView = hasPermission('user', permissions, 'viewKpiEarn');
 */
export const hasPermission = (
    role: 'owner' | 'user',
    permissions: UserPermissions,
    key: keyof UserPermissions
): boolean => {
    // Owner always has all permissions
    if (role === 'owner') return true;

    // Check explicit permission (new system only)
    return permissions[key] === true;
};


import type { SharedRole } from '../features/admin/authenticationTypes';
