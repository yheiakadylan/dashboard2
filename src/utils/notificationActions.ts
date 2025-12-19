/**
 * Notification Action Handlers
 * Uses Strategy Pattern to map notification types to their respective actions
 */

import { Notification, NotificationActionRegistry } from '../types/notification';

/**
 * Handler for NEW_ORDER notifications
 * Opens the OrderDetailModal with the specific order
 */
const handleNewOrderAction = (
    notification: Notification,
    onViewOrderDetails?: (orderId: string) => void
) => {
    const orderId = notification.metadata.order_id;
    if (orderId && onViewOrderDetails) {
        onViewOrderDetails(orderId);
    } else {
        console.warn('No order_id found or handler not provided');
    }
};

/**
 * Handler for FUND notifications
 * Opens the Fund detail modal/page
 */
const handleFundAction = (
    notification: Notification,
    onViewFundDetails?: (fundId: string) => void
) => {
    const fundId = notification.metadata.fund_id;
    if (fundId && onViewFundDetails) {
        onViewFundDetails(fundId);
    } else {
        console.warn('No fund_id found or handler not provided');
    }
};

/**
 * Handler for CASE_HELP notifications
 * Opens the support case detail
 */
const handleCaseHelpAction = (
    notification: Notification,
    onViewCaseDetails?: (caseId: string) => void
) => {
    const caseId = notification.metadata.case_id;
    if (caseId && onViewCaseDetails) {
        onViewCaseDetails(caseId);
    } else {
        console.warn('No case_id found or handler not provided');
    }
};

/**
 * Handler for SUMMARY notifications
 * Opens a rich detailed view (similar to Lark notifications)
 */
const handleSummaryAction = (
    notification: Notification,
    onViewSummaryDetails?: (notification: Notification) => void
) => {
    if (onViewSummaryDetails) {
        onViewSummaryDetails(notification);
    } else {
        console.warn('Summary details handler not provided');
    }
};

/**
 * Handler for LOGIN notifications
 * Shows login history details
 */
const handleLoginAction = (
    notification: Notification,
    onViewLoginDetails?: (notification: Notification) => void
) => {
    if (onViewLoginDetails) {
        onViewLoginDetails(notification);
    } else {
        console.warn('Login details handler not provided');
    }
};

/**
 * Action Handlers Configuration Object
 * This is the Strategy Pattern registry
 */
export interface NotificationActionHandlers {
    onViewOrderDetails?: (orderId: string) => void;
    onViewFundDetails?: (fundId: string) => void;
    onViewCaseDetails?: (caseId: string) => void;
    onViewSummaryDetails?: (notification: Notification) => void;
    onViewLoginDetails?: (notification: Notification) => void;
}

/**
 * Execute the appropriate action based on notification type
 * @param notification - The notification to handle
 * @param handlers - Object containing all action handlers
 */
export function executeNotificationAction(
    notification: Notification,
    handlers: NotificationActionHandlers
): void {
    const actionMap: Record<string, () => void> = {
        NEW_ORDER: () => handleNewOrderAction(notification, handlers.onViewOrderDetails),
        FUND: () => handleFundAction(notification, handlers.onViewFundDetails),
        CASE_HELP: () => handleCaseHelpAction(notification, handlers.onViewCaseDetails),
        SUMMARY: () => handleSummaryAction(notification, handlers.onViewSummaryDetails),
        LOGIN: () => handleLoginAction(notification, handlers.onViewLoginDetails),
    };

    const handler = actionMap[notification.type];
    if (handler) {
        handler();
    } else {
        console.warn(`No handler found for notification type: ${notification.type}`);
    }
}

/**
 * Get icon component name for notification type
 */
export function getNotificationIcon(type: string): string {
    const iconMap: Record<string, string> = {
        NEW_ORDER: 'ShoppingCart',
        FUND: 'DollarSign',
        CASE_HELP: 'HelpCircle',
        SUMMARY: 'BarChart3',
        LOGIN: 'LogIn',
    };

    return iconMap[type] || 'Bell';
}

/**
 * Get color scheme for notification type
 */
export function getNotificationColor(type: string): string {
    const colorMap: Record<string, string> = {
        NEW_ORDER: 'blue',
        FUND: 'green',
        CASE_HELP: 'orange',
        SUMMARY: 'purple',
        LOGIN: 'gray',
    };

    return colorMap[type] || 'gray';
}
