import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CloudDownload, RotateCcw } from 'lucide-react';
import { getCountryCode } from '../utils/currencyUtils';

interface ConversionModalProps {
    isOpen: boolean;
    onClose: () => void;
    conversionDetails: {
        originalAmounts: { [currency: string]: number };
        rates: { [currency: string]: number };
    };
    onRateUpdate?: (currency: string, newRate: number) => void;
    onRefresh?: () => void;
    onReset?: () => void;
}

/**
 * ConversionModal - Modal để xem và edit exchange rates
 * Features:
 * - Countdown timer đến lần API update tiếp theo (00:00 hàng ngày)
 * - Table hiển thị tất cả rates
 * - Double-click để edit rate
 * - Apply button để save changes
 * - Click outside hoặc ESC để đóng
 */
export const ConversionModal: React.FC<ConversionModalProps> = ({
    isOpen,
    onClose,
    conversionDetails,
    onRateUpdate,
    onRefresh,
    onReset,
}) => {
    const [editingRates, setEditingRates] = useState<{ [key: string]: number }>({});
    const [editingCurrency, setEditingCurrency] = useState<string | null>(null);
    const [tempValue, setTempValue] = useState('');
    const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set());
    const [timeUntilUpdate, setTimeUntilUpdate] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    // Countdown timer
    useEffect(() => {
        const updateTimer = () => {
            const now = new Date();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);

            const diff = tomorrow.getTime() - now.getTime();
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            setTimeUntilUpdate(`${hours}h ${minutes}m ${seconds}s`);
        };

        if (isOpen) {
            updateTimer();
            const interval = setInterval(updateTimer, 1000);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    // Click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [isOpen, onClose]);

    const handleDoubleClick = (currency: string, rate: number) => {
        if (currency === 'USD') return; // USD always 1.0000
        setEditingCurrency(currency);
        setTempValue(rate.toFixed(4));
    };

    const handleApplyEdit = (currency: string) => {
        const newRate = parseFloat(tempValue);
        if (!isNaN(newRate) && newRate > 0) {
            setEditingRates(prev => ({ ...prev, [currency]: newRate }));
            setPendingChanges(prev => new Set([...prev, currency]));
        }
        setEditingCurrency(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent, currency: string) => {
        if (e.key === 'Enter') {
            handleApplyEdit(currency);
        } else if (e.key === 'Escape') {
            setEditingCurrency(null);
        }
    };

    const handleApplyAll = () => {
        if (!onRateUpdate) return;

        pendingChanges.forEach(currency => {
            const newRate = editingRates[currency];
            if (newRate !== undefined) {
                onRateUpdate(currency, newRate);
            }
        });

        setPendingChanges(new Set());
        setEditingRates({});
        onClose();
    };

    if (!isOpen) return null;

    const currencies = Object.keys(conversionDetails.originalAmounts).sort();
    const hasPendingChanges = pendingChanges.size > 0;

    // Use Portal to render outside of parent container (avoids overflow/z-index/transform issues)
    if (typeof document === 'undefined') return null;

    const handleRefreshClick = async () => {
        if (!onRefresh) return;
        setIsRefreshing(true);
        try {
            await onRefresh();
            // Clear local edits to show fresh data
            setEditingRates({});
            setPendingChanges(new Set());
        } finally {
            setTimeout(() => setIsRefreshing(false), 500); // Small delay for visual feedback
        }
    };

    const handleResetClick = () => {
        if (!onReset) return;
        setIsResetting(true);
        // Clear local edits immediately
        setEditingRates({});
        setPendingChanges(new Set());
        onReset();
        setTimeout(() => setIsResetting(false), 500);
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
            <div
                ref={modalRef}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            >
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            Exchange Rate Conversion Details
                        </h2>
                        {/* Countdown */}
                        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500 dark:text-gray-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>
                                Next API update in: <strong className="text-blue-600 dark:text-blue-400 font-mono">{timeUntilUpdate}</strong>
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto px-6 py-4">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/50 z-10">
                            <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                <th className="px-4 py-3 text-left font-semibold">Currency</th>
                                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                                <th className="px-4 py-3 text-right font-semibold w-32">Rate (to USD)</th>
                                <th className="px-4 py-3 text-right font-semibold">USD Value</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {currencies.map(currency => {
                                const amount = conversionDetails.originalAmounts[currency];
                                const originalRate = conversionDetails.rates[currency] || (currency === 'USD' ? 1 : 0);
                                const currentRate = editingRates[currency] ?? originalRate;
                                const usdValue = amount * currentRate;
                                const isEditing = editingCurrency === currency;
                                const isPending = pendingChanges.has(currency);
                                const code = getCountryCode(currency);

                                return (
                                    <tr
                                        key={currency}
                                        className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${isPending ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''
                                            }`}
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                                                {code && (
                                                    <img
                                                        src={`https://flagcdn.com/16x12/${code}.png`}
                                                        width="16"
                                                        height="12"
                                                        alt={currency}
                                                        className="rounded-[1px]"
                                                    />
                                                )}
                                                {currency}
                                                {isPending && (
                                                    <span className="text-[10px] bg-yellow-500 text-white px-1.5 py-0.5 rounded-full">
                                                        PENDING
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                                            {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}
                                        </td>
                                        <td
                                            className="px-4 py-3 text-right cursor-pointer h-[50px] align-middle"
                                            onDoubleClick={() => handleDoubleClick(currency, currentRate)}
                                            title={currency !== 'USD' ? 'Double-click to edit' : ''}
                                        >
                                            <div className="flex justify-end items-center h-full">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={tempValue}
                                                        onChange={e => setTempValue(e.target.value)}
                                                        onBlur={() => handleApplyEdit(currency)}
                                                        onKeyDown={e => handleKeyDown(e, currency)}
                                                        autoFocus
                                                        className="w-full px-2 py-1 text-right text-sm border border-blue-500 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm"
                                                    />
                                                ) : (
                                                    <span className={`block w-full py-1 ${currency !== 'USD' ? 'hover:underline decoration-dotted underline-offset-2' : ''}`}>
                                                        {currentRate.toFixed(4)}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">
                                            ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usdValue)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleRefreshClick}
                                    title="Fetch latest rates from API immediately"
                                    disabled={isRefreshing}
                                    className={`p-1.5 rounded-lg transition-all shadow-sm border border-transparent 
                                        ${isRefreshing
                                            ? 'bg-blue-50 text-blue-500 cursor-not-allowed'
                                            : 'text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-gray-700 hover:border-gray-200 dark:hover:border-gray-600'
                                        }`}
                                >
                                    <CloudDownload className={`w-4 h-4 ${isRefreshing ? 'animate-bounce' : ''}`} />
                                </button>
                                <button
                                    onClick={handleResetClick}
                                    title="Reset all rates to default API values"
                                    disabled={isResetting}
                                    className={`p-1.5 rounded-lg transition-all shadow-sm border border-transparent 
                                        ${isResetting
                                            ? 'bg-red-50 text-red-500 cursor-not-allowed'
                                            : 'text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-white dark:hover:bg-gray-700 hover:border-gray-200 dark:hover:border-gray-600'
                                        }`}
                                >
                                    <RotateCcw className={`w-4 h-4 ${isResetting ? 'animate-spin-reverse' : ''}`} />
                                </button>
                            </div>
                            <div className="h-4 w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                💡 Double-click rate to edit
                            </p>
                        </div>
                        {hasPendingChanges && (
                            <button
                                onClick={handleApplyAll}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Apply {pendingChanges.size} Change{pendingChanges.size > 1 ? 's' : ''}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
