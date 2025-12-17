import React from 'react';
import { KpiValue } from '../types';

interface KpiCardProps {
  title: string;
  value: KpiValue | { [currency: string]: KpiValue };
}

// Icons mapping based on title
const getIcon = (title: string) => {
  const t = title.toLowerCase();
  if (t.includes('order')) {
    return (
      <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
    );
  }
  if (t.includes('revenue') || t.includes('money')) {
    return (
      <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
    );
  }
  if (t.includes('fund')) {
    return (
      <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
        </svg>
      </div>
    );
  }
  if (t.includes('cost')) {
    return (
      <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
    );
  }
  if (t.includes('shop')) {
    return (
      <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      </div>
    );
  }
  // Default
  return (
    <div className="p-3 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    </div>
  );
}

const renderComparison = (kpiValue: KpiValue) => {
  if (typeof kpiValue.change !== 'number' || !kpiValue.direction || kpiValue.direction === 'neutral') {
    return null;
  }

  const color = kpiValue.direction === 'up' ? 'text-green-500' : 'text-red-500';
  const arrow = kpiValue.direction === 'up' ? '▲' : '▼';
  const changeText = isFinite(kpiValue.change) ? `${kpiValue.change.toFixed(1)}%` : 'New';

  return (
    <div className={`mt-1 text-sm ${color} flex items-center`}>
      <span>{arrow}</span>
      <span className="ml-1 font-semibold">{changeText}</span>
    </div>
  );
};


const KpiCard: React.FC<KpiCardProps> = ({ title, value }) => {
  const icon = getIcon(title);

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex items-start gap-4 card-hover transition-shadow duration-200">
      <div className="flex-shrink-0">
        {icon}
      </div>
      <div className="flex-grow min-w-0">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">{title}</h3>
        {'value' in value && typeof value.value === 'string' ? (
          <div>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white truncate" title={value.value}>{value.value}</p>
            {renderComparison(value as KpiValue)}
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            {Object.entries(value as { [currency: string]: KpiValue }).map(([currency, kpiVal]) => (
              <div key={currency} className="border-b border-gray-100 dark:border-gray-700 last:border-0 pb-1 last:pb-0">
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{currency}</span>
                  <span className="text-lg font-bold text-gray-900 dark:text-white">{kpiVal.value}</span>
                </div>
                {renderComparison(kpiVal)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Memoize to prevent re-renders when parent updates
export default React.memo(KpiCard);
