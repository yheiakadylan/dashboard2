export interface UserRole {
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