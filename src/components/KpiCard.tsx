import React from 'react';

import { KpiValue } from '../types';

interface KpiCardProps {
  title: string;
  value: KpiValue | { [currency: string]: KpiValue };
}

// Icons mapping based on title
const getIcon = (title: string) => {
  const t = title.toLowerCase();
  const iconClass = "h-6 w-6";

  if (t.includes('order')) {
    return {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      bg: "bg-blue-100 dark:bg-blue-900/40",
      text: "text-blue-600 dark:text-blue-400"
    };
  }
  if (t.includes('revenue') || t.includes('money')) {
    return {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      bg: "bg-green-100 dark:bg-green-900/40",
      text: "text-green-600 dark:text-green-400"
    };
  }
  if (t.includes('fund')) {
    return {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
        </svg>
      ),
      bg: "bg-purple-100 dark:bg-purple-900/40",
      text: "text-purple-600 dark:text-purple-400"
    };
  }
  if (t.includes('cost')) {
    return {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
      bg: "bg-red-100 dark:bg-red-900/40",
      text: "text-red-600 dark:text-red-400"
    };
  }
  if (t.includes('shop')) {
    return {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
      bg: "bg-orange-100 dark:bg-orange-900/40",
      text: "text-orange-600 dark:text-orange-400"
    };
  }
  // Default
  return {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    bg: "bg-gray-100 dark:bg-gray-700",
    text: "text-gray-600 dark:text-gray-400"
  };
}

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


const KpiCard: React.FC<KpiCardProps> = ({ title, value }) => {
  const { icon, bg, text } = getIcon(title);

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

          {'value' in value && typeof value.value === 'string' ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-black text-gray-900 dark:text-white truncate tracking-tight">{value.value}</p>
                {renderComparison(value as KpiValue)}
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2.5">
              {Object.entries(value as { [currency: string]: KpiValue }).map(([currency, kpiVal]) => (
                <div key={currency} className="flex justify-between items-center border-b border-gray-50 dark:border-gray-700/50 pb-1 last:border-0 last:pb-0">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{currency}</span>
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent re-renders when parent updates
export default React.memo(KpiCard);
