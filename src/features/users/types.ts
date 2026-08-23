export interface UserRole {
  id: string;
  email: string;
  role: 'owner' | 'user';
  permissions: {
    // Tab permissions
    viewOverviewTab?: boolean;
    viewOrderListTab?: boolean;
    viewProductsTab?: boolean;
    viewSupportTab?: boolean;
    viewFulfillTab?: boolean;
    viewReviewsTab?: boolean;

    // KPI permissions
    viewKpiOrders?: boolean;
    viewKpiShops?: boolean;
    viewKpiRevenue?: boolean;
    viewKpiFunds?: boolean;
    viewKpiCost?: boolean;
    viewKpiEarn?: boolean;

    // Provider/Platform permissions
    viewMerchizeData?: boolean;
    viewPrintwayData?: boolean;
    viewEbayData?: boolean;
    viewEtsyData?: boolean;

    // Action permissions
    canEditCost?: boolean;
    canExportData?: boolean;
    canManageUsers?: boolean;
    canManageMailSettings?: boolean;
    canManageSettings?: boolean;
    canManageMappings?: boolean;
    canResyncOrder?: boolean;
    canSyncData?: boolean;
  };
  allowedAccounts?: string[];
}
