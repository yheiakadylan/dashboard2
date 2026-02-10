import { Tab } from '../types';
import { hasPermission, type UserPermissions } from './permissionHelper';

export const getPermittedTabs = (
    tabs: Tab[],
    role: 'owner' | 'user',
    permissions: UserPermissions
): Tab[] => {
    return tabs.filter(tab => {
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
            case 'Listing':
                return true; // All users can view Listing tab
            default:
                return false;
        }
    });
};
