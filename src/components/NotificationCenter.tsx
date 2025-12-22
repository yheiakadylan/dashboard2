/**
 * NotificationCenter Component
 * Main notification center with bell icon, badge, and notification list
 */

import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check, Trash2, X, Inbox } from 'lucide-react';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import NotificationItem from './NotificationItem';
import NotificationDetailModal from './NotificationDetailModal';
import { executeNotificationAction, NotificationActionHandlers } from '../utils/notificationActions';
import { Notification } from '../types/notification';
import { Account } from '../types';
import { UserProfile } from '../hooks/useAuthLogic';
import { useUI } from '../contexts/UIContext';

interface Props {
    actionHandlers?: NotificationActionHandlers;
    teamId?: string; // For Firestore sync
    onDetailModalChange?: (isOpen: boolean) => void; // Callback when detail modal opens/closes
    userProfile?: UserProfile | null; // For permission-based filtering
    accounts?: Account[]; // For mapping allowed emails to shop names
}

const NotificationCenter: React.FC<Props> = ({ actionHandlers = {}, teamId, onDetailModalChange, userProfile, accounts = [] }) => {
    const {
        notifications,
        unreadCount,
        isOpen,
        markAsRead,
        markAllAsRead,
        clearAll,
        deleteNotification,
        toggleOpen,
        closePanel,
        loadMore,
        hasMore
    } = useNotificationCenter({ teamId, enableFirestoreSync: true, userProfile });

    const { selectedNotificationId, setSelectedNotificationId } = useUI();
    const [detailModal, setDetailModal] = useState<Notification | null>(null);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'order' | 'system'>('all');
    const panelRef = useRef<HTMLDivElement>(null);

    // Auto-open notification detail modal from deep link
    useEffect(() => {
        if (selectedNotificationId && notifications.length > 0) {
            // Find notification by ID
            const notification = notifications.find(n => n.id === selectedNotificationId);
            if (notification) {
                console.log('[NotificationCenter] Auto-opening notification:', selectedNotificationId);
                setDetailModal(notification);
                markAsRead(selectedNotificationId);
                // Clear the selected ID
                setSelectedNotificationId(null);
            }
        }
    }, [selectedNotificationId, notifications, markAsRead, setSelectedNotificationId]);

    // Close panel when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                closePanel();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen, closePanel]);

    // Handle notification click
    const handleNotificationClick = (notification: Notification) => {
        // Mark as read
        markAsRead(notification.id);

        // For SUMMARY, LOGIN, FUND, and CASE_HELP: show detail modal
        if (['SUMMARY', 'LOGIN', 'FUND', 'CASE_HELP'].includes(notification.type)) {
            setDetailModal(notification);
            onDetailModalChange?.(true);
        } else {
            // For NEW_ORDER: execute the action via Strategy Pattern
            executeNotificationAction(notification, actionHandlers);
            closePanel();
        }
    };

    // --- PROCESSING LOGIC ---
    // 1. Filter notifications based on active tab
    const filteredList = notifications.filter(n => {
        if (activeFilter === 'unread') return !n.isRead;
        if (activeFilter === 'order') return n.type === 'NEW_ORDER';
        if (activeFilter === 'system') return ['SUMMARY', 'LOGIN', 'FUND', 'CASE_HELP'].includes(n.type);
        return true;
    });

    // 2. Group close-together LOGIN notifications
    // We create a new list where consecutive logins from same user < 1h are grouped
    const processLoginGrouping = (list: Notification[]) => {
        const result: Notification[] = [];
        const skipIds = new Set<string>();

        list.forEach((n, index) => {
            if (skipIds.has(n.id)) return;

            if (n.type === 'LOGIN' && n.metadata?.login_info?.user_email) {
                const userEmail = n.metadata.login_info.user_email;
                const time = new Date(n.createdAt).getTime();

                // Find subsequent logins from same user within 1 hour
                const groupedLogins = list.slice(index + 1).filter(sub =>
                    sub.type === 'LOGIN' &&
                    sub.metadata?.login_info?.user_email === userEmail &&
                    !skipIds.has(sub.id) &&
                    Math.abs(new Date(sub.createdAt).getTime() - time) < 60 * 60 * 1000 // 1 hour window
                );

                if (groupedLogins.length > 0) {
                    // Create a "Grouped" notification object (virtual)
                    const groupedNotif: Notification = {
                        ...n,
                        title: `${groupedLogins.length + 1} Logins from ${n.metadata.login_info.user_name}`,
                        content: `User ${userEmail} logged in ${groupedLogins.length + 1} times recently.`,
                        // Mark as read if all are read? Or if main one is read? 
                        // Let's say unread if ANY is unread
                        isRead: n.isRead && groupedLogins.every(g => g.isRead),
                    };
                    result.push(groupedNotif);

                    // Skip these in next iterations
                    groupedLogins.forEach(g => skipIds.add(g.id));
                } else {
                    result.push(n);
                }
            } else {
                result.push(n);
            }
        });
        return result;
    };

    const groupedLoginsList = processLoginGrouping(filteredList);

    // 3. Time Grouping (Today, Yesterday, etc.)
    const timeGroups = {
        'Latest': [] as Notification[],
        'Today': [] as Notification[],
        'Yesterday': [] as Notification[],
        'Older': [] as Notification[]
    };

    groupedLoginsList.forEach(n => {
        const date = new Date(n.createdAt);
        const now = new Date();
        const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
        const isToday = date.toDateString() === now.toDateString();

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();

        if (diffHours < 1) { // Less than 1 hour ago
            timeGroups['Latest'].push(n);
        } else if (isToday) {
            timeGroups['Today'].push(n);
        } else if (isYesterday) {
            timeGroups['Yesterday'].push(n);
        } else {
            timeGroups['Older'].push(n);
        }
    });

    const hasAnyNotification = groupedLoginsList.length > 0;

    return (
        <>
            {/* Bell Icon Button */}
            <div className="relative">
                <button
                    onClick={toggleOpen}
                    className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors relative"
                    title="Notifications"
                >
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white dark:border-gray-900 pointer-events-none" />
                    )}
                </button>

                {/* Notification Panel */}
                <div
                    ref={panelRef}
                    className={`
                        fixed sm:absolute right-4 sm:right-0 top-[60px] sm:top-full mt-2 
                        w-[calc(100vw-2rem)] sm:w-96 max-w-[480px] bg-white dark:bg-gray-800 
                        rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 
                        overflow-hidden z-[9998] origin-top-right transition-all duration-200 ease-out
                        ${isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'}
                    `}
                >
                    {/* Header */}
                    <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md px-4 py-3 border-b border-gray-100 dark:border-gray-700 sticky top-0 z-10">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                Notifications
                                {unreadCount > 0 && (
                                    <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full text-xs font-bold">
                                        {unreadCount}
                                    </span>
                                )}
                            </h3>
                            <div className="flex items-center gap-1">
                                {notifications.length > 0 && (
                                    <button
                                        onClick={markAllAsRead}
                                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                        title="Mark all read"
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    onClick={closePanel}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Quick Filters */}
                        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                            {[
                                { id: 'all', label: 'All' },
                                { id: 'unread', label: 'Unread' },
                                { id: 'order', label: 'Orders' },
                                { id: 'system', label: 'System' },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveFilter(tab.id as any)}
                                    className={`
                                        px-3 py-1 flex-shrink-0 text-xs font-medium rounded-full transition-colors border
                                        ${activeFilter === tab.id
                                            ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent shadow-sm'
                                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'}
                                    `}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="max-h-[calc(100vh-220px)] sm:max-h-[60vh] overflow-y-auto bg-gray-50/50 dark:bg-gray-900/50">
                        {!hasAnyNotification ? (
                            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                                    <Inbox className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                                </div>
                                <p className="text-gray-900 dark:text-white font-medium mb-1">No notifications</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[200px]">
                                    We'll notify you when something arrives.
                                </p>
                            </div>
                        ) : (
                            <div className="pb-4">
                                {(Object.keys(timeGroups) as Array<keyof typeof timeGroups>).map((group) => {
                                    const items = timeGroups[group];
                                    if (items.length === 0) return null;

                                    return (
                                        <div key={group}>
                                            <div className="sticky top-0 z-[5] px-4 py-2 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800">
                                                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                                                    {group}
                                                </h4>
                                            </div>
                                            <div className="px-2 pt-2 space-y-1">
                                                {items.map((notification) => (
                                                    <NotificationItem
                                                        key={notification.id}
                                                        notification={notification}
                                                        onClick={() => handleNotificationClick(notification)}
                                                        onDelete={() => deleteNotification(notification.id)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Load More Button */}
                                {hasMore && activeFilter === 'all' && (
                                    <div className="p-4 text-center">
                                        <button
                                            onClick={loadMore}
                                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                        >
                                            Load older notifications
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                Auto-delete after 3 days
                            </span>
                            <button
                                onClick={() => setShowClearConfirm(true)}
                                className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium"
                            >
                                Clear All
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Detail Modal */}
            {detailModal && (
                <NotificationDetailModal
                    notification={detailModal}
                    userProfile={userProfile}
                    accounts={accounts}
                    onClose={() => {
                        setDetailModal(null);
                        onDetailModalChange?.(false);
                    }}
                />
            )}

            {/* Clear All Confirmation Modal */}
            {showClearConfirm && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowClearConfirm(false)}>
                    <div
                        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-sm w-full p-6 animate-fade-in-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
                                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                                    Clear All Notifications?
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                                    This will permanently delete all {notifications.length} notifications. This action cannot be undone.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3 w-full mt-2">
                                <button
                                    onClick={() => setShowClearConfirm(false)}
                                    className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-semibold rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        setShowClearConfirm(false);
                                        clearAll();
                                    }}
                                    className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                                >
                                    Yes, Clear All
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default NotificationCenter;
