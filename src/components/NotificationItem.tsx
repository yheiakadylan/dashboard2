/**
 * NotificationItem Component
 * Single notification item in the list
 */

import React from 'react';
import { Notification } from '../types/notification';
import { ShoppingCart, DollarSign, HelpCircle, BarChart3, LogIn, X, Circle } from 'lucide-react';
import { formatTimeAgo } from '../utils/notificationCleanup';
import { getNotificationColor } from '../utils/notificationActions';

interface Props {
    notification: Notification;
    onClick: () => void;
    onDelete: () => void;
}

const NotificationItem: React.FC<Props> = ({ notification, onClick, onDelete }) => {
    const IconComponent = {
        NEW_ORDER: ShoppingCart,
        FUND: DollarSign,
        CASE_HELP: HelpCircle,
        SUMMARY: BarChart3,
        LOGIN: LogIn,
    }[notification.type] || Circle;

    const colorScheme = getNotificationColor(notification.type);

    const colorClasses = {
        blue: {
            bg: 'bg-blue-100 dark:bg-blue-900/30',
            icon: 'text-blue-600 dark:text-blue-400',
            border: 'border-blue-200 dark:border-blue-700',
            hover: 'hover:border-blue-300 dark:hover:border-blue-600',
        },
        green: {
            bg: 'bg-green-100 dark:bg-green-900/30',
            icon: 'text-green-600 dark:text-green-400',
            border: 'border-green-200 dark:border-green-700',
            hover: 'hover:border-green-300 dark:hover:border-green-600',
        },
        orange: {
            bg: 'bg-orange-100 dark:bg-orange-900/30',
            icon: 'text-orange-600 dark:text-orange-400',
            border: 'border-orange-200 dark:border-orange-700',
            hover: 'hover:border-orange-300 dark:hover:border-orange-600',
        },
        purple: {
            bg: 'bg-purple-100 dark:bg-purple-900/30',
            icon: 'text-purple-600 dark:text-purple-400',
            border: 'border-purple-200 dark:border-purple-700',
            hover: 'hover:border-purple-300 dark:hover:border-purple-600',
        },
        gray: {
            bg: 'bg-gray-100 dark:bg-gray-700/30',
            icon: 'text-gray-600 dark:text-gray-400',
            border: 'border-gray-200 dark:border-gray-600',
            hover: 'hover:border-gray-300 dark:hover:border-gray-500',
        },
    }[colorScheme] || {
        bg: 'bg-gray-100 dark:bg-gray-700/30',
        icon: 'text-gray-600 dark:text-gray-400',
        border: 'border-gray-200 dark:border-gray-600',
        hover: 'hover:border-gray-300 dark:hover:border-gray-500',
    };

    return (
        <div
            className={`
        relative group p-3 rounded border transition-colors cursor-pointer
        ${!notification.isRead ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' : 'bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'}
        hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600
      `}
            onClick={onClick}
        >
            {/* Delete button - absolute positioned at top-right */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-all z-10"
                title="Delete notification"
            >
                <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            </button>

            <div className="flex items-start gap-3 pr-6">
                {/* Icon */}
                <div className={`flex-shrink-0 p-2 rounded ${colorClasses.bg}`}>
                    <IconComponent className={`w-4 h-4 ${colorClasses.icon}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="font-medium text-gray-900 dark:text-white text-sm line-clamp-1">
                            {notification.title}
                        </h4>
                        {!notification.isRead && (
                            <div className="flex-shrink-0 w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full mt-1" />
                        )}
                    </div>

                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-2">
                        {notification.content}
                    </p>

                    <span className="text-xs text-gray-500 dark:text-gray-500">
                        {formatTimeAgo(notification.createdAt)}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default NotificationItem;
