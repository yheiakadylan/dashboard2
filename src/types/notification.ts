/**
 * Notification System Types
 * Defines the schema and types for the central notification system
 */

export type NotificationType = 'NEW_ORDER' | 'FUND' | 'CASE_HELP' | 'SUMMARY' | 'LOGIN';

/**
 * Base notification metadata that varies by type
 */
export interface NotificationMetadata {
    // For NEW_ORDER
    // NEW_ORDER metadata
    order_id?: string;
    order_total?: number;
    currency?: string;

    // FUND metadata
    fund_id?: string;
    fund_amount?: number;
    shop_name?: string;
    payment_method?: string;

    // CASE_HELP metadata
    case_id?: string;
    case_type?: string;
    customer_name?: string;
    customer_email?: string;
    priority?: 'High' | 'Normal' | 'Low';
    subject?: string;
    message?: string;

    // SUMMARY metadata
    summary_data?: {
        date: string;
        totalOrders: number;
        totalRevenue: number;
        shops: Array<{
            name: string;
            orders: number;
            revenue: number;
        }>;
    };

    // LOGIN metadata
    login_info?: {
        user_name: string;
        user_email: string;
        ip_address?: string;
        device?: string;
        location?: string;
        timestamp: string;
    };
}

/**
 * Main Notification interface
 */
export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    content: string;
    metadata: NotificationMetadata;
    isRead: boolean;
    createdAt: string; // ISO string
}

/**
 * Notification action handler function type
 */
export type NotificationActionHandler = (notification: Notification) => void;

/**
 * Notification action registry mapping types to handlers
 */
export type NotificationActionRegistry = {
    [K in NotificationType]: NotificationActionHandler;
};
