import { Tab } from '../types';

export const getPermittedTabs = (
    tabs: Tab[],
    role: 'owner' | 'user',
    permissions: { [key: string]: boolean }
): Tab[] => {
    return tabs.filter(tab => {
        if (role === 'owner') return true;
        switch (tab) {
            case 'Overview':
            case 'Order List':
            case 'Products':
            case 'Support':
                return permissions.viewSales;
            case 'Fulfill':
                return permissions.viewFulfill;
            default:
                return false;
        }
    });
};
