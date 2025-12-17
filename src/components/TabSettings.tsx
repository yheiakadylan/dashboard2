import React, { useState } from 'react';
import { Tab } from '../types';
import { useDashboard } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';
import ThemeToggle from './ThemeToggle';


const TabSettings: React.FC = () => {
    const { role, permissions } = useDashboard();
    const {
        tabOrder,
        hiddenTabs,
        setIsTabSettingsOpen,
        setTabOrder,
        toggleTabVisibility,
        resetTabPreferences
    } = useUI();


    const [draggedTab, setDraggedTab] = useState<Tab | null>(null);

    // Filter tabs based on permissions
    const getAvailableTabs = (): Tab[] => {
        return tabOrder.filter(tab => {
            // Hardcoded exclusions to match Sidebar


            if (role === 'owner') return true;

            switch (tab) {
                case 'Overview':
                case 'Order List':
                case 'Support':
                case 'Products':
                    return permissions.viewSales;
                case 'Fulfill':
                    return permissions.viewFulfill;

                default:
                    return false;
            }
        });
    };

    const availableTabs = getAvailableTabs();

    const handleDragStart = (e: React.DragEvent, tab: Tab) => {
        setDraggedTab(tab);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, targetTab: Tab) => {
        e.preventDefault();

        if (!draggedTab || draggedTab === targetTab) return;

        const newOrder = [...tabOrder];
        const draggedIndex = newOrder.indexOf(draggedTab);
        const targetIndex = newOrder.indexOf(targetTab);

        // Remove dragged tab and insert at target position
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedTab);

        setTabOrder(newOrder);
    };

    const handleDragEnd = () => {
        setDraggedTab(null);
    };

    const handleToggleVisibility = (tab: Tab) => {
        toggleTabVisibility(tab);
    };

    const handleReset = () => {
        resetTabPreferences();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            setIsTabSettingsOpen(false);
        }
    };

    const visibleCount = availableTabs.filter(tab => !hiddenTabs.has(tab)).length;

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={handleBackdropClick}
        >
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col animate-slide-in">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                            Tab Settings
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Current changes apply immediately
                        </p>
                    </div>
                    <button
                        onClick={() => setIsTabSettingsOpen(false)}
                        className="text-gray-400 hover:text-gray-500 focus:outline-none"
                    >
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">

                    {/* Visual Settings */}
                    <div className="mb-6">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                            Appearance
                        </h3>
                        <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900 dark:text-white">Dark Mode</span>
                            </div>
                            <ThemeToggle />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Tabs Order & Visibility
                        </h3>
                        {availableTabs.map((tab) => {
                            const isHidden = hiddenTabs.has(tab);
                            const isDragging = draggedTab === tab;

                            return (
                                <div
                                    key={tab}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, tab)}
                                    onDragOver={(e) => handleDragOver(e, tab)}
                                    onDragEnd={handleDragEnd}
                                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-move ${isDragging
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-lg scale-105'
                                        : isHidden
                                            ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 opacity-60'
                                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                                        }`}
                                >
                                    {/* Drag Handle */}
                                    <div className="text-gray-400 dark:text-gray-500">
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"></path>
                                        </svg>
                                    </div>

                                    {/* Tab Name */}
                                    <div className="flex-1 font-medium text-gray-900 dark:text-white">
                                        {tab}
                                    </div>

                                    {/* Visibility Toggle */}
                                    <button
                                        onClick={() => handleToggleVisibility(tab)}
                                        disabled={!isHidden && visibleCount <= 1}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${!isHidden && visibleCount <= 1
                                            ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed'
                                            : isHidden
                                                ? 'bg-gray-300 dark:bg-gray-600'
                                                : 'bg-blue-600'
                                            }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isHidden ? 'translate-x-1' : 'translate-x-6'
                                                }`}
                                        />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* Warning if trying to hide all tabs */}
                    {/* canSave was removed, we can check visibleCount directly or just remove since we disable the button anyway */}

                    {/* Instructions */}
                    <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                            💡 <strong>Tip:</strong> Drag tabs to reorder them. Toggle the switch to show/hide tabs.
                        </p>
                    </div>
                    <div className="mt-4 flex justify-center">
                        <button
                            onClick={handleReset}
                            className="text-xs font-medium text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
                        >
                            Reset to Default
                        </button>
                    </div>
                </div>


            </div>
        </div>

    );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(TabSettings);
