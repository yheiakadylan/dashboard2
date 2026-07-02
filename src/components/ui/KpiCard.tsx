import React, { useState, useCallback } from 'react';
import { getCountryCode } from '../../utils/currencyUtils';

import { KpiValue } from '../../types';
import { ConversionModal } from '../modals/ConversionModal';
import { useUIFilters, useUISettings, useUITabs } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNotification } from '../../contexts/NotificationContext';
import { hasPermission } from '../../utils/permissionHelper';

interface KpiCardProps {
  title: string;
  value: KpiValue | { [currency: string]: KpiValue };
  refundInfo?: string | { [currency: string]: string };
  onRateUpdate?: (currency: string, newRate: number) => void;
  onRefresh?: () => void;
  onReset?: () => void;
}

import {
  ShoppingCart,
  Store,
  Banknote,
  Wallet,
  CreditCard,
  PiggyBank,
  LayoutDashboard
} from 'lucide-react';

// Icons mapping based on title
const getIcon = (title: string) => {
  const t = title.toLowerCase();
  const iconClass = "h-6 w-6";

  if (t.includes('order')) {
    return {
      icon: <ShoppingCart className={iconClass} />,
      bg: "bg-blue-100 dark:bg-blue-900/40",
      text: "text-blue-600 dark:text-blue-400"
    };
  }
  if (t.includes('revenue') || t.includes('money')) {
    return {
      icon: <Banknote className={iconClass} />,
      bg: "bg-green-100 dark:bg-green-900/40",
      text: "text-green-600 dark:text-green-400"
    };
  }
  if (t.includes('fund')) {
    return {
      icon: <Wallet className={iconClass} />,
      bg: "bg-purple-100 dark:bg-purple-900/40",
      text: "text-purple-600 dark:text-purple-400"
    };
  }
  if (t.includes('cost')) {
    return {
      icon: <CreditCard className={iconClass} />,
      bg: "bg-red-100 dark:bg-red-900/40",
      text: "text-red-600 dark:text-red-400"
    };
  }
  if (t.includes('shop')) {
    return {
      icon: <Store className={iconClass} />,
      bg: "bg-orange-100 dark:bg-orange-900/40",
      text: "text-orange-600 dark:text-orange-400"
    };
  }
  if (t.includes('earn') || t.includes('profit')) {
    return {
      icon: <PiggyBank className={iconClass} />,
      bg: "bg-teal-100 dark:bg-teal-900/40",
      text: "text-teal-600 dark:text-teal-400"
    };
  }

  // Default
  return {
    icon: <LayoutDashboard className={iconClass} />,
    bg: "bg-gray-100 dark:bg-gray-700",
    text: "text-gray-600 dark:text-gray-400"
  };
}

// Helper to format currency values
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

const renderComparison = (kpiValue: KpiValue) => {
  if (typeof kpiValue.change !== 'number' || !kpiValue.direction || kpiValue.direction === 'neutral') {
    return null;
  }

  const isUp = kpiValue.direction === 'up';
  const color = isUp ? 'text-green-500' : 'text-red-500';
  // Use Lucide or Heroicons for indicators
  const Arrow = () => isUp
    ? <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
    : <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>;

  const changeText = isFinite(kpiValue.change) ? `${Math.abs(kpiValue.change).toFixed(1)}%` : 'New';

  return (
    <div className={`mt-1 text-xs font-bold ${color} flex items-center gap-0.5 bg-opacity-10 rounded-full px-2 py-0.5 ${isUp ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
      <Arrow />
      <span>{changeText}</span>
    </div>
  );
};


const KpiCard: React.FC<KpiCardProps> = ({ title, value, refundInfo, onRateUpdate, onRefresh, onReset }) => {
  const { icon, bg, text } = getIcon(title);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setActiveTab } = useUITabs();
  const { setStatusFilter } = useUIFilters();
  const { globalUsdMode } = useUISettings();
  const { role, permissions } = useDashboard(); // Check role/permissions
  const { addNotification } = useNotification();

  // If globalUsdMode is true, we want to pluck only USD_TOTAL
  let displayValue = value;
  let displayRefundInfo = refundInfo;

  if (globalUsdMode && !('value' in value)) {
    const usdTotal = value['USD_TOTAL'];
    if (usdTotal) {
      displayValue = usdTotal;
      displayRefundInfo = usdTotal.refundInfo;
    }
  }

  const handleRefundClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Check permission View Order List
    if (hasPermission(role, permissions, 'viewOrderListTab')) {
      setStatusFilter('Refunded');
      setActiveTab('Order List');
    } else {
      addNotification('You do not have permission to view order list.', 'error');
    }
  };

  const handleValueClick = useCallback((e: React.MouseEvent) => {
    if ('conversionDetails' in displayValue && displayValue.conversionDetails) {
      e.stopPropagation();
      setIsModalOpen(true);
    }
  }, [displayValue]);

  return (
    <div
      className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden relative group animate-fade-in-up card-hover"
    >
      {/* Decorative background blob */}
      <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-10 ${bg} group-hover:scale-150 transition-transform duration-500`}></div>

      <div className="flex items-start gap-4 relative z-10">
        <div className={`flex-shrink-0 p-3 rounded-xl ${bg} ${text} shadow-sm group-hover:rotate-6 transition-transform duration-300`}>
          {icon}
        </div>

        <div className="flex-grow min-w-0">
          <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">{title}</h3>

          {'value' in displayValue && typeof displayValue.value === 'string' ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <p
                  className={`text-2xl font-black text-gray-900 dark:text-white tracking-tight ${(displayValue as KpiValue).conversionDetails ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors border-b-2 border-dotted border-gray-300 dark:border-gray-600' : ''}`}
                  onClick={handleValueClick}
                  title={(displayValue as KpiValue).conversionDetails ? "Click to view conversion details" : ""}
                >
                  {displayValue.value}
                </p>

                {(displayValue as KpiValue).conversionDetails && (
                  <ConversionModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    conversionDetails={(displayValue as KpiValue).conversionDetails!}
                    onRateUpdate={onRateUpdate}
                    onRefresh={onRefresh}
                    onReset={onReset}
                  />
                )}
              </div>

              {/* Exchange Rate List - Funds Card Style */}
              {(displayValue as KpiValue).conversionDetails && (() => {
                const details = (displayValue as KpiValue).conversionDetails!;
                const activeRates = Object.entries(details.rates).filter(([curr]) =>
                  curr !== 'USD' && (details.originalAmounts[curr] || 0) > 0
                );

                if (activeRates.length === 0) return null;

                return (
                  <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-700/50 pt-2">
                    {activeRates.map(([curr, rate]) => (
                      <div key={curr} className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-gray-50 dark:bg-gray-700/50 rounded font-semibold text-gray-600 dark:text-gray-300">
                          {(() => {
                            const code = getCountryCode(curr);
                            return code ? (
                              <img
                                src={`https://flagcdn.com/20x15/${code}.png`}
                                width="16" height="12"
                                className="object-contain rounded-[1px]"
                                alt={curr}
                              />
                            ) : null;
                          })()}
                          <span>{curr}</span>
                        </div>
                        <span className="font-mono text-gray-500 dark:text-gray-400">
                          {Number(rate).toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Refund info for simple value */}
              {displayRefundInfo && typeof displayRefundInfo === 'string' && (
                <p
                  className="text-xs text-red-600 dark:text-red-400 font-medium mt-0.5 cursor-pointer hover:underline decoration-dotted"
                  onClick={handleRefundClick}
                  title="Click to view refunded orders"
                >
                  Refund: {displayRefundInfo}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2.5">
              {Object.entries(displayValue as { [currency: string]: KpiValue })
                .filter(([currency]) => currency !== 'USD_TOTAL')
                .filter(([_, kpiVal]) => kpiVal.value !== '$0.00')
                .map(([currency, kpiVal]) => {
                  const formatUSD = (amount: number) => new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  }).format(amount);

                  return (
                    <div key={currency} className="flex flex-col gap-1">
                      <div className="flex justify-between items-center border-b border-gray-50 dark:border-gray-700/50 pb-1">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded flex items-center gap-1.5">
                          {(() => {
                            const code = getCountryCode(currency);
                            return code ? (
                              <img
                                src={`https://flagcdn.com/24x18/${code}.png`}
                                srcSet={`https://flagcdn.com/w40/${code}.png 2x`}
                                width="14"
                                height="10"
                                alt={currency}
                                className="object-contain rounded-[1px]"
                              />
                            ) : null;
                          })()}
                          {currency}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-gray-900 dark:text-white">{kpiVal.value}</span>
                          {/* Simplified trend for multi-currency to save space */}
                          {kpiVal.direction && kpiVal.direction !== 'neutral' && (
                            <span className={`text-[10px] ${kpiVal.direction === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                              {kpiVal.direction === 'up' ? '▲' : '▼'}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Refund info for multi-currency with conversion */}
                      {(kpiVal.refundOriginal || (displayRefundInfo && typeof displayRefundInfo === 'object' && displayRefundInfo[currency])) && (
                        <div 
                          className="pl-1 text-[11px] text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5 cursor-pointer hover:underline decoration-dotted"
                          onClick={handleRefundClick}
                          title="Click to view refunded orders"
                        >
                          <span>Refund:</span>
                          {kpiVal.refundOriginal && kpiVal.refundUSD !== undefined ? (
                            <span>{currency} {formatCurrency(kpiVal.refundOriginal)}</span>
                          ) : (
                            <span>{displayRefundInfo && typeof displayRefundInfo === 'object' ? displayRefundInfo[currency] : ''}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

              {/* USD_TOTAL section - Clickable */}
              {(() => {
                const usdTotal = (displayValue as { [currency: string]: KpiValue })['USD_TOTAL'];
                if (!usdTotal) return null;

                const handleUSDTotalClick = (e: React.MouseEvent) => {
                  if (usdTotal.conversionDetails) {
                    e.stopPropagation();
                    setIsModalOpen(true);
                  }
                };

                return (
                  <>
                    <div className="border-t-2 border-gray-200 dark:border-gray-600 my-2"></div>
                    <div
                      className={`flex justify-end items-center py-1 px-2 rounded-lg group ${usdTotal.conversionDetails
                        ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all'
                        : ''
                        }`}
                      onClick={handleUSDTotalClick}
                      title={usdTotal.conversionDetails ? "Click to view conversion details" : ""}
                    >

                      <span className="text-2xl font-black text-blue-600 dark:text-blue-400 tracking-tight">
                        {usdTotal.value}
                      </span>
                    </div>
                    {usdTotal.refundInfo && (
                      <p
                        className="text-xs text-red-600 dark:text-red-400 font-medium text-right pr-2 -mt-1 cursor-pointer hover:underline decoration-dotted"
                        onClick={handleRefundClick}
                        title="Click to view refunded orders"
                      >
                        Refund: {usdTotal.refundInfo}
                      </p>
                    )}

                    {/* Conversion Modal */}
                    {usdTotal.conversionDetails && (
                      <ConversionModal
                        isOpen={isModalOpen}
                        onClose={() => setIsModalOpen(false)}
                        conversionDetails={usdTotal.conversionDetails}
                        onRateUpdate={onRateUpdate}
                        onRefresh={onRefresh}
                        onReset={onReset}
                      />
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent re-renders when parent updates
export default React.memo(KpiCard);
