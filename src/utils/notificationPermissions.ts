/**
 * Notification Permission Filtering Utilities
 * Determines if a user should receive/see a notification based on their permissions and role
 */

import { Notification, NotificationType } from '../types/notification';
import { UserProfile } from '../hooks/useAuthLogic';

/**
 * Check if user has permission to view a specific notification type
 */
export const canViewNotificationType = (
    type: NotificationType,
    role: 'owner' | 'user',
    permissions: { [key: string]: boolean }
): boolean => {
    // Owner can see all notifications
    if (role === 'owner') return true;

    switch (type) {
        case 'NEW_ORDER':
        case 'SUMMARY':
        case 'CASE_HELP':
            // Requires view sales permission
            return permissions.viewSales === true;

        case 'FUND':
            // Requires view funds permission
            return permissions.viewFunds === true;

        case 'LOGIN':
            // Only owners can see login notifications (security)
            return false;

        default:
            return false;
    }
};

/**
 * Check if user has permission to view a specific shop's notification
 */
export const canViewShopNotification = (
    shopName: string | undefined,
    allowedAccounts: string[] | undefined
): boolean => {
    // If no shop name in notification, allow it (system-level notification)
    if (!shopName) return true;

    // If no allowedAccounts restriction, allow all shops
    if (!allowedAccounts || allowedAccounts.length === 0) return true;

    // Check if shop is in allowed list
    return allowedAccounts.includes(shopName);
};

/**
 * Filter a single notification based on user permissions
 */
export const shouldShowNotification = (
    notification: Notification,
    userProfile: UserProfile | null
): boolean => {
    if (!userProfile) return false;

    const { role, permissions, allowedAccounts } = userProfile;

    // Check type permission
    if (!canViewNotificationType(notification.type, role, permissions)) {
        return false;
    }

    // Extract shop name from metadata based on notification type
    let shopName: string | undefined;

    switch (notification.type) {
        case 'FUND':
            shopName = notification.metadata.shop_name;
            break;
        case 'SUMMARY':
            // For summary, we need to filter shops in the data, not hide entire notification
            // We'll handle this separately
            shopName = undefined;
            break;
        case 'NEW_ORDER':
        case 'CASE_HELP':
        case 'LOGIN':
        default:
            shopName = undefined;
            break;
    }

    // Check shop permission
    if (!canViewShopNotification(shopName, allowedAccounts)) {
        return false;
    }

    return true;
};

// Extend UserProfile locally if needed, but ideally it should match the one in useAuthLogic
// We assume UserProfile passed here has the email field we added
interface ExtendedUserProfile extends UserProfile {
    email?: string;
}

/**
 * Filter an array of notifications based on user permissions
 */
export const filterNotificationsByPermissions = (
    notifications: Notification[],
    userProfile: UserProfile | null
): Notification[] => {
    if (!userProfile) return [];

    return notifications
        .filter(notification => {
            // Check if user has soft-deleted this notification
            if (notification.deletedBy && userProfile.email) {
                if (notification.deletedBy.includes(userProfile.email)) {
                    return false;
                }
            }

            return shouldShowNotification(notification, userProfile);
        })
        .map(notification => {
            // For SUMMARY notifications, we DON'T filter shops here
            // because NotificationDetailModal will handle the filtering
            // Otherwise we'd be filtering twice and losing data!

            // Just return the notification as-is
            // The modal will filter shops based on userProfile.allowedAccounts
            return notification;
        });
};

/**
 * Generate deep link URL for a notification
 */
export const getNotificationDeepLink = (notification: Notification): string => {
    const baseUrl = window.location.origin;

    switch (notification.type) {
        case 'NEW_ORDER':
            // Link to order detail if we have order_id
            if (notification.metadata.order_id) {
                return `${baseUrl}/?tab=Order+List&order=${encodeURIComponent(notification.metadata.order_id)}`;
            }
            return `${baseUrl}/?tab=Order+List`;

        case 'SUMMARY':
            // Link to overview tab
            return `${baseUrl}/?tab=Overview`;

        case 'FUND':
            // Link to overview with fund filter or specific date
            return `${baseUrl}/?tab=Overview`;

        case 'CASE_HELP':
            // Link to support tab
            return `${baseUrl}/?tab=Support`;

        case 'LOGIN':
            // Link to notification center to view login details
            return `${baseUrl}/?notification=${encodeURIComponent(notification.id)}`;

        default:
            return baseUrl;
    }
};
