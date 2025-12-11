import React from 'react';
import { Tab } from '../api/_lib/types';
import { useDashboard } from '../contexts/DashboardContext';

interface BottomNavProps {
    tabs: Tab[];
}

const BottomNav: React.FC<BottomNavProps> = ({ tabs }) => {
    const { activeTab, handleTabClick } = useDashboard();

    // Show only these 3 specific tabs for bottom navigation
    const specificTabs: Tab[] = ['Overview', 'Order List', 'Summary'];
    const bottomTabs = specificTabs.filter(tab => tabs.includes(tab));

    // Icon mapping for each tab
    const getTabIcon = (tab: Tab) => {
        switch (tab) {
            case 'Overview':
                return (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                );
            case 'Order List':
                return (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                );
            case 'Summary':
                return (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                );
            case 'Fulfill':
                return (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                );
            case 'eBay':
                return (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                );
            case 'Etsy':
                return (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                );
            default:
                return (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                );
        }
    };

    return (
        <nav
            className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-50"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0px)' }}
        >
            <div className="flex justify-around items-center h-16 px-2">
                {bottomTabs.map((tab) => {
                    const isActive = activeTab === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => handleTabClick(tab)}
                            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${isActive
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-gray-500 dark:text-gray-400'
                                }`}
                        >
                            <div className={`transition-transform ${isActive ? 'scale-110' : 'scale-100'}`}>
                                {getTabIcon(tab)}
                            </div>
                            <span className="text-xs mt-1 font-medium">{tab}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};

export default BottomNav;
