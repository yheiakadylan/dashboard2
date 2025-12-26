/**
 * NotificationDetailModal Component
 * Rich modal view for SUMMARY and LOGIN notification types
 */

import React from 'react';
import { Notification } from '../types/notification';
import { UserProfile } from '../hooks/useAuthLogic';
import { Account } from '../types';
import { X, BarChart3, LogIn, TrendingUp, ShoppingBag, DollarSign, Calendar, MapPin, Monitor, HelpCircle, FileText } from 'lucide-react';

interface Props {
    notification: Notification;
    onClose: () => void;
    userProfile?: UserProfile | null; // Full UserProfile with role and permissions
    accounts?: Account[]; // For mapping allowed emails to shop names
}

const NotificationDetailModal: React.FC<Props> = ({ notification, onClose, userProfile, accounts = [] }) => {
    // Check if user has permission to view funds
    const canViewFunds = userProfile?.role === 'owner' || userProfile?.permissions.viewFunds === true;

    // Helper to format currency object {AUD: 100, USD: 200} => "AUD $100.00, USD $200.00"
    const formatCurrencies = (currencyObj: any): string => {
        if (!currencyObj || typeof currencyObj !== 'object') return '$0.00';
        return Object.entries(currencyObj)
            .filter(([_, amount]) => amount && (amount as number) > 0)
            .map(([currency, amount]) => `${currency} $${(amount as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
            .join(', ') || '$0.00';
    };

    const renderSummaryContent = () => {
        const data = notification.metadata.summary_data;
        if (!data) return null;

        // Filter shops based on user permissions
        let filteredShops = data.shops || [];
        if (userProfile?.allowedAccounts && userProfile.allowedAccounts.length > 0) {
            // Create a set of allowed identifiers (emails and shop names)
            const allowedIdentifiers = new Set<string>();

            userProfile.allowedAccounts.forEach(email => {
                const emailLower = email.toLowerCase();
                allowedIdentifiers.add(emailLower);

                // Find matching account to get label/shop name
                const account = accounts.find(acc => acc.email.toLowerCase() === emailLower);
                if (account?.label) {
                    allowedIdentifiers.add(account.label.toLowerCase());
                }
            });

            filteredShops = filteredShops.filter((shop: any) => {
                const shopNameLower = shop.name.toLowerCase();
                // Check against both email and mapped shop name
                return allowedIdentifiers.has(shopNameLower);
            });
        }

        // Calculate totals by currency from filtered shops
        const filteredRevenueByCurrency: Record<string, number> = {};
        const filteredFundsByCurrency: Record<string, number> = {};

        filteredShops.forEach((shop: any) => {
            // Aggregate revenues by currency
            if (shop.revenue && typeof shop.revenue === 'object') {
                Object.entries(shop.revenue).forEach(([currency, amount]) => {
                    filteredRevenueByCurrency[currency] = (filteredRevenueByCurrency[currency] || 0) + (amount as number);
                });
            }
            // Aggregate funds by currency
            if (shop.funds && typeof shop.funds === 'object') {
                Object.entries(shop.funds).forEach(([currency, amount]) => {
                    filteredFundsByCurrency[currency] = (filteredFundsByCurrency[currency] || 0) + (amount as number);
                });
            }
        });

        // Use filtered values if user has permissions, otherwise use totals from data
        const displayOrders = userProfile?.allowedAccounts && userProfile.allowedAccounts.length > 0
            ? filteredShops.reduce((sum: number, shop: any) => sum + (shop.orders || 0), 0)
            : data.totalOrders;
        const displayRevenue = userProfile?.allowedAccounts && userProfile.allowedAccounts.length > 0
            ? filteredRevenueByCurrency
            : data.totalRevenue;
        const displayFunds = userProfile?.allowedAccounts && userProfile.allowedAccounts.length > 0
            ? filteredFundsByCurrency
            : (data.totalFunds || {});

        return (
            <div className="space-y-6">
                {/* Header Stats */}
                <div className={`grid gap-4 ${canViewFunds ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-2">
                            <ShoppingBag className="w-5 h-5" />
                            <span className="text-sm font-medium">Total Orders</span>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                            {displayOrders}
                        </p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-3">
                            <DollarSign className="w-5 h-5" />
                            <span className="text-sm font-medium">Total Revenue</span>
                        </div>
                        <div className="space-y-1.5">
                            {Object.entries(displayRevenue as Record<string, number>)
                                .filter(([_, amount]) => amount > 0)
                                .map(([currency, amount]) => (
                                    <div key={currency} className="flex justify-between items-baseline">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{currency}</span>
                                        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                                            ${(amount as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                ))
                            }
                        </div>
                    </div>

                    {canViewFunds && (
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-3">
                                <TrendingUp className="w-5 h-5" />
                                <span className="text-sm font-medium">Total Funds</span>
                            </div>
                            <div className="space-y-1.5">
                                {Object.entries(displayFunds as Record<string, number>)
                                    .filter(([_, amount]) => amount > 0)
                                    .map(([currency, amount]) => (
                                        <div key={currency} className="flex justify-between items-baseline">
                                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{currency}</span>
                                            <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                                                ${(amount as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    )}
                </div>

                {/* Date */}
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">{new Date(data.date).toLocaleDateString()}</span>
                </div>

                {/* Shop Breakdown Table */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden shadow-sm">
                    <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                            <TrendingUp className="w-4 h-4" />
                            Shop Performance
                        </h4>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Shop
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Orders
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Revenue
                                    </th>
                                    {canViewFunds && (
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Funds
                                        </th>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filteredShops.map((shop: any, idx: number) => {
                                    // Extract revenue value (handle object format {USD: amount})
                                    const shopRevenue = typeof shop.revenue === 'object'
                                        ? (shop.revenue.USD || 0)
                                        : (shop.revenue || 0);

                                    // Extract funds value
                                    const shopFunds = shop.funds
                                        ? (typeof shop.funds === 'object' ? (shop.funds.USD || 0) : shop.funds)
                                        : 0;

                                    return (
                                        <tr
                                            key={idx}
                                            className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                                        >
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                                                {shop.name}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                                                {shop.orders}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right">
                                                {shop.revenue && typeof shop.revenue === 'object' ? (
                                                    Object.entries(shop.revenue)
                                                        .filter(([_, amount]) => (amount as number) > 0)
                                                        .map(([currency, amount]) => (
                                                            <div key={currency} className="flex justify-between gap-2">
                                                                <span className="text-xs text-gray-500">{currency}</span>
                                                                <span className="font-semibold text-green-600 dark:text-green-400">
                                                                    ${(amount as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                </span>
                                                            </div>
                                                        ))
                                                ) : '$0.00'}
                                            </td>
                                            {canViewFunds && (
                                                <td className="px-4 py-3 text-sm text-right">
                                                    {shop.funds && typeof shop.funds === 'object' ? (
                                                        Object.entries(shop.funds)
                                                            .filter(([_, amount]) => (amount as number) > 0)
                                                            .map(([currency, amount]) => (
                                                                <div key={currency} className="flex justify-between gap-2">
                                                                    <span className="text-xs text-gray-500">{currency}</span>
                                                                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                                                                        ${(amount as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                    </span>
                                                                </div>
                                                            ))
                                                    ) : '$0.00'}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    const renderLoginContent = () => {
        const data = notification.metadata.login_info;
        if (!data) return null;

        return (
            <div className="space-y-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg">
                                <LogIn className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">
                                    {data.user_name}
                                </h4>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{data.user_email}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                            {data.device && (
                                <div className="flex items-center gap-3">
                                    <Monitor className="w-4 h-4 text-gray-400" />
                                    <div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Device</p>
                                        <p className="text-sm text-gray-900 dark:text-gray-100">{data.device}</p>
                                    </div>
                                </div>
                            )}

                            {data.location && (
                                <div className="flex items-center gap-3">
                                    <MapPin className="w-4 h-4 text-gray-400" />
                                    <div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Location</p>
                                        <p className="text-sm text-gray-900 dark:text-gray-100">{data.location}</p>
                                    </div>
                                </div>
                            )}

                            {data.ip_address && (
                                <div className="flex items-center gap-3">
                                    <div className="w-4 h-4 flex items-center justify-center">
                                        <div className="w-2 h-2 bg-gray-400 rounded-full" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">IP Address</p>
                                        <p className="text-sm text-gray-900 dark:text-gray-100 font-mono">
                                            {data.ip_address}
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <Calendar className="w-4 h-4 text-gray-400" />
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Timestamp</p>
                                    <p className="text-sm text-gray-900 dark:text-gray-100">
                                        {new Date(data.timestamp).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderFundContent = () => {
        const fundId = notification.metadata.fund_id;
        const fundAmount = notification.metadata.fund_amount;
        const currency = notification.metadata.currency || 'USD';
        const shopName = notification.metadata.shop_name;
        const paymentMethod = notification.metadata.payment_method;

        return (
            <div className="space-y-4">
                {/* Amount Card */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 text-slate-600 dark:text-slate-400 mb-2">
                            <DollarSign className="w-6 h-6" />
                            <span className="text-sm font-medium">Amount Received</span>
                        </div>
                        <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">
                            ${fundAmount?.toLocaleString()} {currency}
                        </p>
                    </div>
                </div>

                {/* Details */}
                <div className="bg-white dark:bg-slate-900/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700 space-y-3">
                    {fundId && (
                        <div className="flex items-start gap-3">
                            <FileText className="w-4 h-4 text-gray-400 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Fund ID</p>
                                <p className="text-sm text-gray-900 dark:text-gray-100 font-mono">
                                    {fundId}
                                </p>
                            </div>
                        </div>
                    )}

                    {shopName && (
                        <div className="flex items-start gap-3">
                            <ShoppingBag className="w-4 h-4 text-gray-400 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Shop</p>
                                <p className="text-sm text-gray-900 dark:text-gray-100">
                                    {shopName}
                                </p>
                            </div>
                        </div>
                    )}

                    {paymentMethod && (
                        <div className="flex items-start gap-3">
                            <DollarSign className="w-4 h-4 text-gray-400 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Payment Method</p>
                                <p className="text-sm text-gray-900 dark:text-gray-100">
                                    {paymentMethod}
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="flex items-start gap-3">
                        <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Received At</p>
                            <p className="text-sm text-gray-900 dark:text-gray-100">
                                {new Date(notification.createdAt).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderCaseHelpContent = () => {
        const caseId = notification.metadata.case_id;
        const caseType = notification.metadata.case_type || 'Support Request';
        const customerName = notification.metadata.customer_name;
        const customerEmail = notification.metadata.customer_email;
        const priority = notification.metadata.priority || 'Normal';
        const subject = notification.metadata.subject;
        const message = notification.metadata.message;

        const priorityColors = {
            High: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-700',
            Normal: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-700',
            Low: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700',
        };

        return (
            <div className="space-y-4">
                {/* Header with Priority */}
                <div className="flex items-center justify-between">
                    <div className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${priorityColors[priority as keyof typeof priorityColors] || priorityColors.Normal}`}>
                        {priority} Priority
                    </div>
                    {caseId && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                            #{caseId}
                        </span>
                    )}
                </div>

                {/* Customer Info */}
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                    <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">
                        Customer Information
                    </h4>

                    {customerName && (
                        <div className="flex items-start gap-3">
                            <div className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded">
                                <LogIn className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                            </div>
                            <div className="flex-1">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Name</p>
                                <p className="text-sm text-gray-900 dark:text-gray-100">
                                    {customerName}
                                </p>
                            </div>
                        </div>
                    )}

                    {customerEmail && (
                        <div className="flex items-start gap-3">
                            <div className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded">
                                <Monitor className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                            </div>
                            <div className="flex-1">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Email</p>
                                <p className="text-sm text-gray-900 dark:text-gray-100">
                                    {customerEmail}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Case Details */}
                {(subject || message) && (
                    <div className="bg-white dark:bg-slate-900/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                        {subject && (
                            <div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Subject</p>
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    {subject}
                                </p>
                            </div>
                        )}

                        {message && (
                            <div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Message</p>
                                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                    {message}
                                </p>
                            </div>
                        )}

                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{new Date(notification.createdAt).toLocaleString()}</span>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // Get icon based on notification type
    const getIcon = () => {
        switch (notification.type) {
            case 'SUMMARY': return <BarChart3 className="w-6 h-6 text-white" />;
            case 'LOGIN': return <LogIn className="w-6 h-6 text-white" />;
            case 'FUND': return <DollarSign className="w-6 h-6 text-white" />;
            case 'CASE_HELP': return <HelpCircle className="w-6 h-6 text-white" />;
            default: return <BarChart3 className="w-6 h-6 text-white" />;
        }
    };

    // Get header color based on type
    const getHeaderColor = () => {
        switch (notification.type) {
            case 'SUMMARY': return 'bg-gradient-to-r from-slate-700 to-slate-800 dark:from-slate-800 dark:to-slate-900';
            case 'LOGIN': return 'bg-gradient-to-r from-slate-600 to-slate-700 dark:from-slate-700 dark:to-slate-800';
            case 'FUND': return 'bg-gradient-to-r from-emerald-600 to-emerald-700 dark:from-emerald-700 dark:to-emerald-800';
            case 'CASE_HELP': return 'bg-gradient-to-r from-orange-600 to-orange-700 dark:from-orange-700 dark:to-orange-800';
            default: return 'bg-gradient-to-r from-slate-700 to-slate-800 dark:from-slate-800 dark:to-slate-900';
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-10" />

            {/* Modal */}
            <div
                className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden border border-slate-200 dark:border-slate-700 z-20"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`sticky top-0 ${getHeaderColor()} px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between z-10`}>
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        {getIcon()}
                        <h3 className="text-base sm:text-xl font-bold text-white truncate">{notification.title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 sm:p-2 hover:bg-white/20 rounded transition-colors flex-shrink-0"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 text-white" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
                    {notification.type === 'SUMMARY' && renderSummaryContent()}
                    {notification.type === 'LOGIN' && renderLoginContent()}
                    {notification.type === 'FUND' && renderFundContent()}
                    {notification.type === 'CASE_HELP' && renderCaseHelpContent()}
                </div>
            </div>
        </div>
    );
};

export default NotificationDetailModal;
