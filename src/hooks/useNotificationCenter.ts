/**
 * Custom hook for managing notification center state
 * Handles CRUD operations, auto-cleanup, and persistence
 * Supports both localStorage (offline) and Firestore (realtime sync)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Notification } from '../types/notification';
import { cleanupOldNotifications } from '../utils/notificationCleanup';
import { collection, query, onSnapshot, orderBy, limit, updateDoc, doc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../services/firebaseService';
import { UserProfile } from './useAuthLogic';
import { filterNotificationsByPermissions } from '../utils/notificationPermissions';

const STORAGE_KEY = 'dashboard_notifications';
const AUTO_CLEANUP_DAYS = 3;
const MAX_NOTIFICATIONS = 50; // Limit to prevent memory issues

interface UseNotificationCenterOptions {
    teamId?: string; // If provided, sync with Firestore
    enableFirestoreSync?: boolean; // Enable/disable Firestore sync
    userProfile?: UserProfile | null; // For permission-based filtering
}

export function useNotificationCenter(options: UseNotificationCenterOptions = {}) {
    const { teamId, enableFirestoreSync = true, userProfile } = options;
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [processedFirestoreIds, setProcessedFirestoreIds] = useState<Set<string>>(new Set());

    const [limitCount, setLimitCount] = useState(20);
    const [hasMore, setHasMore] = useState(true);

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

        console.log('[NotificationCenter] Setting up Firestore listener for teamId:', teamId, 'limit:', limitCount);

        const notificationsRef = collection(db, 'user', teamId, 'notifications');
        const q = query(
            notificationsRef,
            orderBy('createdAt', 'desc'),
            limit(limitCount)
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

                        // Add to state and ensuring sorting
                        setNotifications((prev) => {
                            // Check if already exists (by ID)
                            const existingIndex = prev.findIndex((n) => n.id === firestoreId);

                            if (existingIndex >= 0) {
                                // EXISTING: Check if Firestore data is different/newer than local
                                // We prioritize Firestore as the source of truth
                                const existing = prev[existingIndex];
                                const isDifferent =
                                    existing.isRead !== firestoreNotification.isRead ||
                                    existing.title !== firestoreNotification.title ||
                                    JSON.stringify(existing.metadata) !== JSON.stringify(firestoreNotification.metadata);

                                if (!isDifferent) return prev;

                                // Update the existing notification
                                const newPrev = [...prev];
                                newPrev[existingIndex] = firestoreNotification;
                                return newPrev;
                            }

                            // DEDUPLICATION LOGIC
                            // 1. Strict deduplication: Same content within short timeframe (prevent double-sends)
                            const isDuplicateContent = prev.some(n =>
                                n.type === firestoreNotification.type &&
                                n.title === firestoreNotification.title &&
                                n.content === firestoreNotification.content &&
                                Math.abs(new Date(n.createdAt).getTime() - new Date(firestoreNotification.createdAt).getTime()) < 60000 // 1 minute
                            );

                            if (isDuplicateContent) {
                                console.log('[NotificationCenter] Skipped duplicate content (1m window):', firestoreNotification.id);
                                return prev;
                            }

                            // 2. Business logic deduplication: SUMMARY type - Only 1 per date
                            if (firestoreNotification.type === 'SUMMARY' && firestoreNotification.metadata?.summary_data?.date) {
                                const targetDate = firestoreNotification.metadata.summary_data.date;
                                const existingSummaryIndex = prev.findIndex(n =>
                                    n.type === 'SUMMARY' &&
                                    n.metadata?.summary_data?.date === targetDate
                                );

                                if (existingSummaryIndex >= 0) {
                                    // Found existing summary for this date. Replace it with the new one (latest version).
                                    // This prevents seeing 2 summaries for the same day.
                                    console.log('[NotificationCenter] Replaced existing summary for date:', targetDate);

                                    const newList = [...prev];
                                    newList[existingSummaryIndex] = firestoreNotification;

                                    // Re-sort to ensure correct order if timestamp changed
                                    newList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                                    return newList;
                                }
                            }

                            // NEW: Add new notification and sort entire list by date desc
                            const newList = [firestoreNotification, ...prev];

                            // Sort by createdAt desc (newest first)
                            newList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

                            return newList.slice(0, limitCount);
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
    }, [teamId, enableFirestoreSync, limitCount]);

    // Auto-cleanup on interval (every hour)
    useEffect(() => {
        const interval = setInterval(() => {
            setNotifications((prev) => cleanupOldNotifications(prev, AUTO_CLEANUP_DAYS));
        }, 60 * 60 * 1000); // 1 hour

        return () => clearInterval(interval);
    }, []);

    /**
     * Increase limit to load more notifications
     */
    const loadMore = useCallback(() => {
        setLimitCount(prev => prev + 20);
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
    const deleteNotification = useCallback(async (id: string, hardDelete = false) => {
        // Optimistic local update
        setNotifications((prev) => prev.filter((n) => n.id !== id));

        if (!teamId || !enableFirestoreSync || id.startsWith('notif_')) {
            return;
        }

        try {
            const docRef = doc(db, 'user', teamId, 'notifications', id);

            if (hardDelete) {
                await deleteDoc(docRef);
                console.log('[NotificationCenter] Hard deleted from Firestore:', id);
            } else if (userProfile?.email) {
                // Soft delete: Add user email to deletedBy array
                await updateDoc(docRef, {
                    deletedBy: arrayUnion(userProfile.email)
                });
                console.log('[NotificationCenter] Soft deleted (hidden) for user:', userProfile.email);
            } else {
                console.warn('[NotificationCenter] No user email found for soft delete, skipping Firestore update');
            }
        } catch (error) {
            console.error('Failed to delete notification:', error);
            // Revert local change on error if critical, but for UI responsiveness we typically leave it
        }
    }, [teamId, enableFirestoreSync, userProfile]);

    // Apply permission-based filtering
    const filteredNotifications = useMemo(() => {
        return filterNotificationsByPermissions(notifications, userProfile);
    }, [notifications, userProfile]);

    /**
     * Get unread count (from filtered notifications)
     */
    const unreadCount = filteredNotifications.filter((n) => !n.isRead).length;

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
        notifications: filteredNotifications, // Return filtered notifications
        unreadCount,
        isOpen,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearAll,
        deleteNotification,
        toggleOpen,
        closePanel,
        loadMore,
        hasMore: filteredNotifications.length >= limitCount, // Simple check if we probably have more
    };
}
