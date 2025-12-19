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

interface Props {
    actionHandlers?: NotificationActionHandlers;
    teamId?: string; // For Firestore sync
    onDetailModalChange?: (isOpen: boolean) => void; // Callback when detail modal opens/closes
}

const NotificationCenter: React.FC<Props> = ({ actionHandlers = {}, teamId, onDetailModalChange }) => {
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
    } = useNotificationCenter({ teamId, enableFirestoreSync: true });

    const [detailModal, setDetailModal] = useState<Notification | null>(null);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

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
            // For NEW_ORDER: execute the action via Strategy Pattern (opens OrderDetailModal)
            executeNotificationAction(notification, actionHandlers);
            closePanel();
        }
    };

    // Handle clear all with confirmation
    const handleClearAll = () => {
        setShowClearConfirm(false);
        clearAll();
    };

    return (
        <>
            {/* Bell Icon Button */}
            <div className="relative">
                <button
                    onClick={toggleOpen}
                    className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Notifications"
                >
                    <Bell className="w-5 h-5" />

                    {/* Unread Badge */}
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-white dark:border-gray-800">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </button>

                {/* Notification Panel */}
                {isOpen && (
                    <div
                        ref={panelRef}
                        className="fixed sm:absolute right-4 sm:right-0 top-[60px] sm:top-full mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-[480px] bg-white dark:bg-gray-800 rounded-lg sm:rounded-md shadow-2xl sm:shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden z-[9998]"
                    >
                        {/* Header */}
                        <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <Bell className="w-4 h-4" />
                                    Notifications
                                    {unreadCount > 0 && (
                                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-medium">
                                            {unreadCount} new
                                        </span>
                                    )}
                                </h3>
                                <button
                                    onClick={closePanel}
                                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                                    title="Close"
                                >
                                    <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                </button>
                            </div>

                            {/* Action Buttons */}
                            {notifications.length > 0 && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            markAllAsRead();
                                        }}
                                        className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        <Check className="w-3.5 h-3.5" />
                                        Mark All Read
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowClearConfirm(true);
                                        }}
                                        className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Clear All
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Notification List */}
                        <div className="max-h-[calc(100vh-200px)] sm:max-h-[60vh] overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-400 dark:text-gray-500">
                                    <Inbox className="w-12 h-12 mb-3 opacity-50" />
                                    <p className="text-sm font-medium">No notifications</p>
                                    <p className="text-xs mt-1">You're all caught up!</p>
                                </div>
                            ) : (
                                <div className="p-3 space-y-2">
                                    {notifications.map((notification) => (
                                        <NotificationItem
                                            key={notification.id}
                                            notification={notification}
                                            onClick={() => handleNotificationClick(notification)}
                                            onDelete={() => deleteNotification(notification.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        {notifications.length > 0 && (
                            <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-2 border-t border-gray-200 dark:border-gray-700">
                                <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                                    Notifications auto-delete after 3 days
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Detail Modal for SUMMARY and LOGIN */}
            {detailModal && (
                <NotificationDetailModal
                    notification={detailModal}
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
                        className="bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 max-w-md w-full p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3 mb-4">
                            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded">
                                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                                    Clear All Notifications?
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    This will permanently delete all {notifications.length} notification{notifications.length !== 1 ? 's' : ''}. This action cannot be undone.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowClearConfirm(false)}
                                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleClearAll}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                Clear All
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default NotificationCenter;
