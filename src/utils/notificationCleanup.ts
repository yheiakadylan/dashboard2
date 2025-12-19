/**
 * Auto-cleanup utility for notifications
 * Removes notifications older than a specified number of days
 */

import { Notification } from '../types/notification';

/**
 * Filter out notifications older than the specified days
 * @param notifications - Array of notifications
 * @param daysOld - Number of days (default: 3)
 * @returns Filtered array of notifications
 */
export function cleanupOldNotifications(
    notifications: Notification[],
    daysOld: number = 3
): Notification[] {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - daysOld * 24 * 60 * 60 * 1000);

    return notifications.filter(notification => {
        const notificationDate = new Date(notification.createdAt);
        return notificationDate >= cutoffDate;
    });
}

/**
 * Get count of notifications that would be removed
 * @param notifications - Array of notifications
 * @param daysOld - Number of days (default: 3)
 * @returns Count of old notifications
 */
export function getOldNotificationsCount(
    notifications: Notification[],
    daysOld: number = 3
): number {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - daysOld * 24 * 60 * 60 * 1000);

    return notifications.filter(notification => {
        const notificationDate = new Date(notification.createdAt);
        return notificationDate < cutoffDate;
    }).length;
}

/**
 * Format time difference for display (e.g., "2 hours ago", "3 days ago")
 * @param isoString - ISO date string
 * @returns Formatted time string
 */
export function formatTimeAgo(isoString: string): string {
    const now = new Date();
    const date = new Date(isoString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    // For older dates, show the actual date
    return date.toLocaleDateString();
}
