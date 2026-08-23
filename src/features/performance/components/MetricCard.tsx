import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, DatabaseZap } from 'lucide-react';
import type { PerformanceMetric } from '../types';
import PerformanceBreakdownModal from './PerformanceBreakdownModal';
import MetricHelpTooltip from './MetricHelpTooltip';

const barTone = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-slate-400',
};

const valueTone = {
  green: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
  gray: 'text-slate-500 dark:text-slate-400',
};

const accentTone = {
  green: 'from-emerald-500 to-teal-400',
  amber: 'from-amber-500 to-orange-400',
  red: 'from-rose-500 to-red-400',
  gray: 'from-slate-400 to-slate-300',
};

const MetricCard: React.FC<{ metric: PerformanceMetric }> = ({ metric }) => {
  const showsProgress = metric.source === 'real' && metric.comparisonAvailable !== false && metric.progress > 0;
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);
  const canDrillDown = Boolean(metric.breakdown);

  return (
    <article
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800 md:p-5 ${canDrillDown ? 'cursor-pointer' : ''}`}
      onClick={canDrillDown ? () => setIsBreakdownOpen(true) : undefined}
      onKeyDown={canDrillDown ? event => { if (event.key === 'Enter' || event.key === ' ') setIsBreakdownOpen(true); } : undefined}
      role={canDrillDown ? 'button' : undefined}
      tabIndex={canDrillDown ? 0 : undefined}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accentTone[metric.tone]}`} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-bold leading-5 text-gray-700 dark:text-gray-200">{metric.label}</p>
        {metric.source === 'real' ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Thực
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            <DatabaseZap className="h-3 w-3" /> Chờ dữ liệu
          </span>
        )}
      </div>

      <p className={`mt-4 text-3xl font-black tracking-tight ${valueTone[metric.tone]}`}>{metric.value}</p>
      {metric.secondaryValue && (
        <p className="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">{metric.secondaryValue}</p>
      )}

      {showsProgress && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div className={`h-full rounded-full ${barTone[metric.tone]}`} style={{ width: `${Math.min(metric.progress, 100)}%` }} />
        </div>
      )}
      <div className="mt-auto flex min-h-8 items-end justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-700">
        {canDrillDown ? (
          <div className="flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-emerald-300">
            {metric.drillDownLabel || 'View details'} <ChevronRight className="h-3.5 w-3.5" />
          </div>
        ) : <span />}
        {metric.help && <MetricHelpTooltip title={metric.label} content={metric.help} />}
      </div>
      {isBreakdownOpen && metric.breakdown && (
        <PerformanceBreakdownModal
          title={metric.label}
          subtitle={metric.target}
          items={metric.breakdown}
          onClose={() => setIsBreakdownOpen(false)}
        />
      )}
    </article>
  );
};

export default MetricCard;
