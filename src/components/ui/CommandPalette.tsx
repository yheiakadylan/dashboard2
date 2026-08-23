import React, { useState, useEffect, useMemo } from 'react';

import { Search, Calendar, Box, Settings, LogOut, Sun, ArrowRight } from 'lucide-react';
import { useUIModals, useUITabs, useUITheme } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNotification } from '../../contexts/NotificationContext';

const CommandPalette: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const { handleTabClick } = useUITabs();
    const { setIsAccountManagerOpen } = useUIModals();
    const { toggleTheme } = useUITheme();
    const { handleLogout, records, setRecords, setSyncState, teamId } = useDashboard();
    const { addNotification } = useNotification();
    const quickFetchAbortControllerRef = React.useRef<AbortController | null>(null);

    // Commands configuration
    const commands = useMemo(() => [
        { id: 'overview', icon: <Box size={18} />, label: 'Go to Overview', action: () => handleTabClick('Overview'), group: 'Navigation' },
        { id: 'orders', icon: <Calendar size={18} />, label: 'Go to Order List', action: () => handleTabClick('Order List'), group: 'Navigation' },
        { id: 'products', icon: <Box size={18} />, label: 'Go to Products', action: () => handleTabClick('Products'), group: 'Navigation' },
        { id: 'settings', icon: <Settings size={18} />, label: 'Open Settings', action: () => setIsAccountManagerOpen(true), group: 'General' },
        { id: 'theme', icon: <Sun size={18} />, label: 'Toggle Theme', action: () => toggleTheme(), group: 'General' },
        { id: 'logout', icon: <LogOut size={18} />, label: 'Logout', action: () => handleLogout(), group: 'General' },
        {
            id: 'quick-fetch-fulfill',
            icon: <Box size={18} />,
            label: 'Quick Fetch Fulfillment Cost',
            action: async () => {
                if (quickFetchAbortControllerRef.current) {
                    quickFetchAbortControllerRef.current.abort();
                    quickFetchAbortControllerRef.current = null;
                    setSyncState(null);
                    addNotification('Canceled fulfillment cost fetch.', 'info');
                    return;
                }

                const controller = new AbortController();
                quickFetchAbortControllerRef.current = controller;
                addNotification('Fetching fulfillment costs...', 'info');
                setSyncState('Preparing fulfillment cost fetch...');
                try {
                    const { syncFulfillmentCosts } = await import('../../services/costSyncService');
                    const result = await syncFulfillmentCosts({
                        teamId,
                        recordsToScan: records,
                        recordsToUpdate: records,
                        signal: controller.signal,
                        productNameFallback: 'existing',
                        onProgress: progress => setSyncState(progress.message),
                        onRecordsUpdated: updatedRecordsById => {
                            setRecords(currentRecords => currentRecords.map(record => (
                                record.id && updatedRecordsById.has(record.id)
                                    ? updatedRecordsById.get(record.id)!
                                    : record
                            )));
                        },
                    });

                    if (result.eligibleOrders === 0) {
                        addNotification('No order gaps found to fetch.', 'info');
                        return;
                    }

                    const failedCostSuffix = result.failedChunks > 0 ? ` (${result.failedChunks} chunk${result.failedChunks > 1 ? 's' : ''} failed)` : '';
                    if (result.updatedRecords > 0) {
                        addNotification(`Updated ${result.updatedRecords} records with new costs.${failedCostSuffix}`, 'success');
                    } else if (result.costsFound === 0) {
                        addNotification(`No costs found from providers.${failedCostSuffix}`, 'info');
                    } else {
                        addNotification(`No new cost updates found for these orders.${failedCostSuffix}`, 'info');
                    }
                } catch (e) {
                    if (controller.signal.aborted) return;
                    console.error('Quick Fetch Error:', e);
                    addNotification('Failed to fetch costs.', 'error');
                } finally {
                    if (quickFetchAbortControllerRef.current === controller) {
                        quickFetchAbortControllerRef.current = null;
                        setSyncState(null);
                    }
                }
            },
            group: 'Development'
        },

    ], [addNotification, handleLogout, handleTabClick, records, setIsAccountManagerOpen, setRecords, setSyncState, teamId, toggleTheme]);

    const filteredCommands = useMemo(() => {
        const normalizedQuery = query.toLowerCase();
        return commands.filter(cmd => cmd.label.toLowerCase().includes(normalizedQuery));
    }, [commands, query]);

    // Keyboard shortcut listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setIsOpen(prev => !prev);
            }

            if (isOpen) {
                if (e.key === 'Escape') {
                    setIsOpen(false);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, 0));
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (filteredCommands[selectedIndex]) {
                        filteredCommands[selectedIndex].action();
                        setIsOpen(false);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, filteredCommands, selectedIndex]);

    return (
        <>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] px-4">
                    {/* Backdrop */}
                    <div
                        onClick={() => setIsOpen(false)}
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-modal-backdrop"
                    />

                    {/* Window */}
                    <div
                        className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden ring-1 ring-black/5 animate-modal-scale"
                    >
                        <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                            <Search className="w-5 h-5 text-gray-400" />
                            <input
                                autoFocus
                                type="text"
                                placeholder="Type a command or search..."
                                className="flex-1 ml-3 bg-transparent border-none outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400"
                                value={query}
                                onChange={event => {
                                    setQuery(event.target.value);
                                    setSelectedIndex(0);
                                }}
                            />
                            <div className="hidden sm:flex items-center gap-1">
                                <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">ESC</span>
                            </div>
                        </div>

                        <div className="max-h-[500px] overflow-y-auto py-2">
                            {filteredCommands.length === 0 ? (
                                <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                                    No commands found.
                                </div>
                            ) : (
                                <div className="space-y-1 px-2">
                                    {filteredCommands.map((cmd, idx) => (
                                        <button
                                            key={cmd.id}
                                            onClick={() => {
                                                cmd.action();
                                                setIsOpen(false);
                                            }}
                                            onMouseEnter={() => setSelectedIndex(idx)}
                                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${idx === selectedIndex
                                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                {cmd.icon}
                                                <span>{cmd.label}</span>
                                            </div>
                                            {idx === selectedIndex && (
                                                <ArrowRight className="w-4 h-4 opacity-50" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-400">
                            <div className="flex gap-2">
                                <span>Navigate with <kbd className="font-sans">↑↓</kbd></span>
                                <span>Select with <kbd className="font-sans">↵</kbd></span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default CommandPalette;
