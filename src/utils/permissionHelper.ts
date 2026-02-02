/**
 * Permission Helper Utilities
 * 
 * Provides centralized permission checking for granular access control.
 * New permission system with 15 explicit permissions (tabs, KPIs, actions).
 */

export interface UserPermissions {
    // === TAB PERMISSIONS ===
    viewOverviewTab?: boolean;      // Tab: Overview (KPIs + Charts)
    viewOrderListTab?: boolean;     // Tab: Order List
    viewProductsTab?: boolean;      // Tab: Products
    viewSupportTab?: boolean;       // Tab: Support (Messages/Cases)
    viewFulfillTab?: boolean;       // Tab: Fulfill

    // === KPI PERMISSIONS ===
    viewKpiOrders?: boolean;        // KPI Card: Total Orders
    viewKpiShops?: boolean;         // KPI Card: Shops
    viewKpiRevenue?: boolean;       // KPI Card: Revenue
    viewKpiFunds?: boolean;         // KPI Card: Funds
    viewKpiCost?: boolean;          // KPI Card: Cost
    viewKpiEarn?: boolean;          // KPI Card: Earn (Funds - Cost)

    // === ACTION PERMISSIONS ===
    canEditCost?: boolean;
    canExportData?: boolean;
    canManageUsers?: boolean;
    canManageSettings?: boolean;    // Mail Edit permission

    // Allow any other custom permissions
    [key: string]: boolean | undefined;
}

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


