import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, X } from 'lucide-react';
import type { PerformanceBreakdownItem } from '../types';

interface Props {
  title: string;
  subtitle?: string;
  items: PerformanceBreakdownItem[];
  onClose: () => void;
}

export default function PerformanceBreakdownModal({ title, subtitle, items, onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose} onClick={event => event.stopPropagation()}>
      <section role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()} className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4 dark:border-gray-700 md:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"><BarChart3 className="h-5 w-5" /></div>
            <div className="min-w-0">
              <h3 className="font-black text-gray-900 dark:text-white">{title}</h3>
              {subtitle && <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto p-3 md:p-4">
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {items.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-black text-gray-900 dark:text-white">{item.label}</p>
                  {item.secondary && <p className="mt-0.5 truncate text-xs text-gray-500">{item.secondary}</p>}
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{item.value}</span>
              </div>
            ))}
          </div>
          {!items.length && <p className="py-10 text-center text-sm font-semibold text-gray-400">No SKU data in this period</p>}
        </div>
      </section>
    </div>,
    document.body
  );
}
