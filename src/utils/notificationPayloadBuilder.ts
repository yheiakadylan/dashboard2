/**
 * Notification Payload Builder
 * Helper functions to build FCM notification payloads with deep links
 */

import { Notification } from '../types/notification';

/**
 * Generate deep link URL for a notification
 * This matches the URL structure expected by DeepLinkHandler
 */
export const buildNotificationDeepLink = (notification: Notification): string => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

    switch (notification.type) {
        case 'NEW_ORDER':
            // Link to order detail
            if (notification.metadata.order_id) {
                return `${baseUrl}/?tab=Order+List&order=${encodeURIComponent(notification.metadata.order_id)}`;
            }
            return `${baseUrl}/?tab=Order+List`;

        case 'SUMMARY':
            // Link to overview tab
            return `${baseUrl}/?tab=Overview`;

        case 'FUND':
            // Link to overview tab
            return `${baseUrl}/?tab=Overview`;

        case 'CASE_HELP':
            // Link to support tab
            return `${baseUrl}/?tab=Support`;

        case 'LOGIN':
            // Link to notification detail modal
            return `${baseUrl}/?notification=${encodeURIComponent(notification.id)}`;

        default:
            return baseUrl;
    }
};

/**
 * Build FCM data payload with deep link
 */
export const buildFCMDataPayload = (notification: Notification) => {
    return {
        url: buildNotificationDeepLink(notification),
        type: notification.type,
        notificationId: notification.id,
        ...notification.metadata
    };
};

/**
 * Example: How backend should send notifications
 * 
 * For NEW_ORDER:
 * {
 *   notification: {
 *     title: "New Order #12345",
 *     body: "Order from John Doe - $150.00"
 *   },
 *   data: {
 *     url: "https://yourdomain.com/?tab=Order+List&order=12345",
 *     type: "NEW_ORDER",
 *     order_id: "12345"
 *   }
 * }
 * 
 * For FUND:
 * {
 *   notification: {
 *     title: "Fund Received",
 *     body: "$500 received from Etsy Store"
 *   },
 *   data: {
 *     url: "https://yourdomain.com/?tab=Overview",
 *     type: "FUND",
 *     shop_name: "Etsy Store",
 *     fund_amount: "500"
 *   }
 * }
 */
