import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import type { MetricHelpContent } from '../types';

type Props = {
  title: string;
  content: MetricHelpContent;
  className?: string;
};

const DetailSection = ({ label, items }: { label: string; items?: string[] }) => {
  if (!items?.length) return null;
  return <div>
    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
    <ul className="mt-1.5 space-y-1.5 text-xs leading-5 text-slate-100">
      {items.map(item => <li key={item} className="flex items-start gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blue-300" /><span>{item}</span></li>)}
    </ul>
  </div>;
};

const stopCardClick = (event: MouseEvent<HTMLElement>) => event.stopPropagation();

export default function MetricHelpTooltip({ title, content, className = '' }: Props) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();

  const open = () => {
    clearTimeout(closeTimer.current);
    setIsOpen(true);
  };
  const close = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 80);
  };

  useLayoutEffect(function positionTooltip() {
    if (!isOpen) return;

    const updatePosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const gap = 8;
      const padding = 12;
      const width = Math.min(420, window.innerWidth - padding * 2);
      const spaceAbove = trigger.top - padding - gap;
      const spaceBelow = window.innerHeight - trigger.bottom - padding - gap;
      const opensAbove = spaceAbove > spaceBelow;
      const maxHeight = Math.min(window.innerHeight * 0.7, Math.max(80, opensAbove ? spaceAbove : spaceBelow));
      const height = Math.min(tooltip.scrollHeight, maxHeight);

      setStyle({
        left: Math.min(Math.max(padding, trigger.right - width), window.innerWidth - width - padding),
        top: opensAbove ? Math.max(padding, trigger.top - height - gap) : trigger.bottom + gap,
        width,
        maxHeight,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      clearTimeout(closeTimer.current);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  return <span
    className={`inline-flex ${className}`}
    onClick={stopCardClick}
    onMouseDown={stopCardClick}
    onMouseEnter={open}
    onMouseLeave={close}
  >
    <button
      ref={triggerRef}
      type="button"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400/40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
      aria-label={`Xem cách tính ${title}`}
      aria-describedby={isOpen ? tooltipId : undefined}
      aria-expanded={isOpen}
      onClick={open}
      onFocus={open}
      onBlur={close}
      onKeyDown={event => { if (event.key === 'Escape') setIsOpen(false); }}
    >
      <CircleHelp className="h-4 w-4" />
    </button>
    {isOpen && createPortal(
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        style={style}
        onMouseEnter={open}
        onMouseLeave={close}
        className={`fixed z-[10000] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-xl bg-slate-900 p-4 text-left shadow-2xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600 ${style ? '' : 'invisible'}`}
      >
        <p className="text-sm font-black text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-300">{content.summary}</p>
        {content.currentSummary && <div className="mt-3 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs leading-5 text-blue-100"><span className="font-black text-blue-300">Kết quả đang hiển thị:</span> {content.currentSummary}</div>}
        <div className="mt-4 space-y-4">
          <DetailSection label="Cách tính" items={content.calculation} />
          <DetailSection label="Nguồn dữ liệu" items={content.sources} />
          <DetailSection label="Điều kiện và loại trừ" items={content.rules} />
          <DetailSection label="Phạm vi áp dụng" items={content.scope} />
        </div>
      </div>,
      document.body,
    )}
  </span>;
}
