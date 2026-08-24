import { Tab } from '../types';
import { hasPermission, type UserPermissions } from './permissionHelper';

export const getPermittedTabs = (
    tabs: Tab[],
    role: 'owner' | 'user',
    permissions: UserPermissions,
    userEmail?: string | null,
    kpiAccess?: { isKpi?: boolean; canViewLeaderboard?: boolean }
): Tab[] => {
    return tabs.filter(tab => {
        // Special logic for Shop Evaluation
        if (tab === 'Shop Evaluation') {
            const allowedEmails = ['buonngu@gmail.com', 'haitrinh@gmail.com'];
            if (!userEmail || !allowedEmails.includes(userEmail.toLowerCase())) {
                return false;
            }
        }

        if (role === 'owner') return true;

        // Use granular tab permissions
        switch (tab) {
            case 'Overview':
                return hasPermission(role, permissions, 'viewOverviewTab');
            case 'Order List':
                return hasPermission(role, permissions, 'viewOrderListTab');
            case 'Products':
                return hasPermission(role, permissions, 'viewProductsTab');
            case 'Support':
                return hasPermission(role, permissions, 'viewSupportTab');
            case 'Fulfill':
                return hasPermission(role, permissions, 'viewFulfillTab');
            case 'Reviews':
                return hasPermission(role, permissions, 'viewReviewsTab');
            case 'KPI':
                return kpiAccess?.isKpi === true || kpiAccess?.canViewLeaderboard === true;
            case 'Shop Evaluation':
                return hasPermission(role, permissions, 'viewShopEvaluationTab') || hasPermission(role, permissions, 'viewSales');
            case 'Design':
                return hasPermission(role, permissions, 'viewDesignTab');
            case 'Templete':
                return hasPermission(role, permissions, 'viewTemplatesTab');
            case 'Workload':
                return hasPermission(role, permissions, 'viewWorkloadTab');
            default:
                return false;
        }
    });
};
