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
            case 'eBay':
            case 'Etsy':
            case 'Case':
            case 'Help':
            case 'Products':
                return permissions.viewSales;
            case 'Fulfill':
                return permissions.viewFulfill;
            default:
                return false;
        }
    });
};
