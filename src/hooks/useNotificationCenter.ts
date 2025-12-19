/**
 * Custom hook for managing notification center state
 * Handles CRUD operations, auto-cleanup, and persistence
 * Supports both localStorage (offline) and Firestore (realtime sync)
 */

import { useState, useEffect, useCallback } from 'react';
import { Notification } from '../types/notification';
import { cleanupOldNotifications } from '../utils/notificationCleanup';
import { collection, query, onSnapshot, orderBy, limit, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../services/firebaseService';

const STORAGE_KEY = 'dashboard_notifications';
const AUTO_CLEANUP_DAYS = 3;
const MAX_NOTIFICATIONS = 50; // Limit to prevent memory issues

interface UseNotificationCenterOptions {
    teamId?: string; // If provided, sync with Firestore
    enableFirestoreSync?: boolean; // Enable/disable Firestore sync
}

export function useNotificationCenter(options: UseNotificationCenterOptions = {}) {
    const { teamId, enableFirestoreSync = true } = options;
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [processedFirestoreIds, setProcessedFirestoreIds] = useState<Set<string>>(new Set());

    // Load notifications from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed: Notification[] = JSON.parse(stored);
                // Apply auto-cleanup on load
                const cleaned = cleanupOldNotifications(parsed, AUTO_CLEANUP_DAYS);
                setNotifications(cleaned);
            }
        } catch (error) {
            console.error('Failed to load notifications:', error);
        }
    }, []);

    // Save to localStorage whenever notifications change
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
        } catch (error) {
            console.error('Failed to save notifications:', error);
        }
    }, [notifications]);

    // Firestore realtime listener (if teamId provided)
    useEffect(() => {
        if (!teamId || !enableFirestoreSync) {
            console.log('[NotificationCenter] Firestore sync disabled or no teamId');
            return;
        }

        console.log('[NotificationCenter] Setting up Firestore listener for teamId:', teamId);

        const notificationsRef = collection(db, 'user', teamId, 'notifications');
        const q = query(
            notificationsRef,
            orderBy('createdAt', 'desc'),
            limit(MAX_NOTIFICATIONS)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const firestoreId = change.doc.id;
                    const data = change.doc.data();

                    if (change.type === 'added') {
                        // Check if we've already processed this Firestore notification
                        if (processedFirestoreIds.has(firestoreId)) {
                            return;
                        }

                        // Convert Firestore doc to Notification
                        const firestoreNotification: Notification = {
                            id: firestoreId,
                            type: data.type,
                            title: data.title,
                            content: data.content,
                            metadata: data.metadata || {},
                            isRead: data.isRead || false,
                            createdAt: data.createdAt,
                        };

                        console.log('[NotificationCenter] New notification from Firestore:', firestoreNotification);

                        // Add to state
                        setNotifications((prev) => {
                            // Check if already exists (by ID)
                            const exists = prev.some((n) => n.id === firestoreId);
                            if (exists) return prev;

                            // Add to front of list
                            return [firestoreNotification, ...prev].slice(0, MAX_NOTIFICATIONS);
                        });

                        // Mark as processed
                        setProcessedFirestoreIds((prev) => new Set([...prev, firestoreId]));
                    }

                    if (change.type === 'modified') {
                        // Update existing notification
                        setNotifications((prev) =>
                            prev.map((n) =>
                                n.id === firestoreId
                                    ? { ...n, isRead: data.isRead, ...data }
                                    : n
                            )
                        );
                    }

                    if (change.type === 'removed') {
                        // Remove from state
                        setNotifications((prev) => prev.filter((n) => n.id !== firestoreId));
                        setProcessedFirestoreIds((prev) => {
                            const newSet = new Set(prev);
                            newSet.delete(firestoreId);
                            return newSet;
                        });
                    }
                });
            },
            (error) => {
                console.error('[NotificationCenter] Firestore listener error:', error);
            }
        );

        return () => {
            console.log('[NotificationCenter] Cleaning up Firestore listener');
            unsubscribe();
        };
    }, [teamId, enableFirestoreSync]);

    // Auto-cleanup on interval (every hour)
    useEffect(() => {
        const interval = setInterval(() => {
            setNotifications((prev) => cleanupOldNotifications(prev, AUTO_CLEANUP_DAYS));
        }, 60 * 60 * 1000); // 1 hour

        return () => clearInterval(interval);
    }, []);

    /**
     * Add a new notification (local only)
     */
    const addNotification = useCallback(
        (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
            const newNotification: Notification = {
                ...notification,
                id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                createdAt: new Date().toISOString(),
                isRead: false,
            };

            setNotifications((prev) => [newNotification, ...prev]);
        },
        []
    );

    /**
     * Mark a notification as read (sync to Firestore if applicable)
     */
    const markAsRead = useCallback(
        async (id: string) => {
            // Update local state immediately
            setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
            );

            // Sync to Firestore if it's a Firestore notification
            if (teamId && enableFirestoreSync && !id.startsWith('notif_')) {
                try {
                    const notifRef = doc(db, 'user', teamId, 'notifications', id);
                    await updateDoc(notifRef, { isRead: true });
                } catch (error) {
                    console.error('[NotificationCenter] Failed to mark as read in Firestore:', error);
                }
            }
        },
        [teamId, enableFirestoreSync]
    );

    /**
   * Mark all notifications as read
   */
    const markAllAsRead = useCallback(() => {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    }, []);

    /**
     * Clear all notifications (deletes from both localStorage and Firestore)
     */
    const clearAll = useCallback(async () => {
        console.log('[NotificationCenter] Clearing all notifications');

        // Delete from Firestore if enabled
        if (teamId && enableFirestoreSync) {
            try {
                const notificationsToDelete = notifications.filter(n => !n.id.startsWith('notif_'));
                console.log(`[NotificationCenter] Deleting ${notificationsToDelete.length} notifications from Firestore`);

                // Delete all Firestore notifications in parallel
                const deletePromises = notificationsToDelete.map(n => {
                    const notifRef = doc(db, 'user', teamId, 'notifications', n.id);
                    return deleteDoc(notifRef);
                });

                await Promise.all(deletePromises);
                console.log('[NotificationCenter] Successfully cleared all from Firestore');
            } catch (error) {
                console.error('[NotificationCenter] Failed to clear from Firestore:', error);
            }
        }

        // Clear local state
        setNotifications([]);
    }, [teamId, enableFirestoreSync, notifications]);

    /**
     * Delete a specific notification (sync to Firestore if applicable)
     */
    const deleteNotification = useCallback(
        async (id: string) => {
            console.log('[NotificationCenter] Deleting notification:', { id, teamId, enableFirestoreSync, isLocalOnly: id.startsWith('notif_') });

            // Update local state immediately
            setNotifications((prev) => prev.filter((n) => n.id !== id));

            // Sync to Firestore if it's a Firestore notification
            if (teamId && enableFirestoreSync && !id.startsWith('notif_')) {
                try {
                    console.log('[NotificationCenter] Deleting from Firestore:', `user/${teamId}/notifications/${id}`);
                    const notifRef = doc(db, 'user', teamId, 'notifications', id);
                    await deleteDoc(notifRef);
                    console.log('[NotificationCenter] Successfully deleted from Firestore');
                } catch (error) {
                    console.error('[NotificationCenter] Failed to delete from Firestore:', error);
                }
            } else {
                console.log('[NotificationCenter] Skipping Firestore delete (local-only or sync disabled)');
            }
        },
        [teamId, enableFirestoreSync]
    );

    /**
     * Get unread count
     */
    const unreadCount = notifications.filter((n) => !n.isRead).length;

    /**
     * Toggle notification center
     */
    const toggleOpen = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    const closePanel = useCallback(() => {
        setIsOpen(false);
    }, []);

    return {
        notifications,
        unreadCount,
        isOpen,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearAll,
        deleteNotification,
        toggleOpen,
        closePanel,
    };
}
