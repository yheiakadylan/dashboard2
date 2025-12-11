import React, { useState, useEffect } from 'react';
import { Tab } from '../api/_lib/types';
import { useDashboard } from '../contexts/DashboardContext';

const TabSettings: React.FC = () => {
    const {
        tabOrder,
        hiddenTabs,
        role,
        permissions,
        setIsTabSettingsOpen,
        setTabOrder,
        toggleTabVisibility,
        resetTabPreferences
    } = useDashboard();

    const [localTabOrder, setLocalTabOrder] = useState<Tab[]>([...tabOrder]);
    const [localHiddenTabs, setLocalHiddenTabs] = useState<Set<Tab>>(new Set(hiddenTabs));
    const [draggedTab, setDraggedTab] = useState<Tab | null>(null);

    // Filter tabs based on permissions
    const getAvailableTabs = (): Tab[] => {
        return localTabOrder.filter(tab => {
            if (role === 'owner') return true;

            switch (tab) {
                case 'Overview':
                case 'Order List':
                case 'eBay':
                case 'Etsy':
                case 'Case':
                case 'Help':
                    return permissions.viewSales;
                case 'Fulfill':
                    return permissions.viewFulfill;
                case 'Summary':
                    return permissions.viewSummary;
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

        const newOrder = [...localTabOrder];
        const draggedIndex = newOrder.indexOf(draggedTab);
        const targetIndex = newOrder.indexOf(targetTab);

        // Remove dragged tab and insert at target position
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedTab);

        setLocalTabOrder(newOrder);
    };

    const handleDragEnd = () => {
        setDraggedTab(null);
    };

    const handleToggleVisibility = (tab: Tab) => {
        const newHidden = new Set(localHiddenTabs);
        if (newHidden.has(tab)) {
            newHidden.delete(tab);
        } else {
            newHidden.add(tab);
        }
        setLocalHiddenTabs(newHidden);
    };

    const handleSave = () => {
        // Directly set the new tab order
        setTabOrder(localTabOrder);

        // Apply visibility changes
        localHiddenTabs.forEach(tab => {
            if (!hiddenTabs.has(tab)) {
                toggleTabVisibility(tab);
            }
        });

        hiddenTabs.forEach(tab => {
            if (!localHiddenTabs.has(tab)) {
                toggleTabVisibility(tab);
            }
        });

        setIsTabSettingsOpen(false);
    };

    const handleReset = () => {
        const defaultOrder: Tab[] = ['Overview', 'Order List', 'eBay', 'Etsy', 'Case', 'Help', 'Fulfill', 'Summary'];
        setLocalTabOrder(defaultOrder);
        setLocalHiddenTabs(new Set());
        resetTabPreferences();
    };

    const handleCancel = () => {
        setIsTabSettingsOpen(false);
    };

    const visibleCount = availableTabs.filter(tab => !localHiddenTabs.has(tab)).length;
    const canSave = visibleCount >= 1;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col animate-slide-in">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        Tab Settings
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Customize tab order and visibility
                    </p>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    <div className="space-y-2">
                        {availableTabs.map((tab) => {
                            const isHidden = localHiddenTabs.has(tab);
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
                    {!canSave && (
                        <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                            <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                ⚠️ At least one tab must be visible
                            </p>
                        </div>
                    )}

                    {/* Instructions */}
                    <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                            💡 <strong>Tip:</strong> Drag tabs to reorder them. Toggle the switch to show/hide tabs.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                        Reset to Default
                    </button>
                    <div className="flex-1" />
                    <button
                        onClick={handleCancel}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${canSave
                            ? 'bg-blue-600 hover:bg-blue-700'
                            : 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed'
                            }`}
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TabSettings;
