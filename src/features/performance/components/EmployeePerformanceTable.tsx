import React, { useMemo, useState } from 'react';
import { List, UserRoundSearch } from 'lucide-react';
import type { EmployeePerformanceRow, KpiPaceStatus, PerformanceSectionId } from '../types';
import PerformanceBreakdownModal from './PerformanceBreakdownModal';

interface Props {
  employees: EmployeePerformanceRow[];
  isLoading: boolean;
  sectionId: PerformanceSectionId;
  title?: string;
}

type ActivityMetricProps = {
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'blue' | 'cyan' | 'emerald' | 'amber';
  onClick?: () => void;
};

const activityToneClasses: Record<NonNullable<ActivityMetricProps['tone']>, string> = {
  neutral: 'bg-gray-50 text-gray-950 dark:bg-gray-900/40 dark:text-white',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
  cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
};

const paceConfig: Record<KpiPaceStatus, { label: string; className: string; barClassName: string }> = {
  not_started: { label: 'Chưa bắt đầu', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', barClassName: 'bg-gray-400' },
  at_risk: { label: 'Chậm tiến độ', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300', barClassName: 'bg-rose-500' },
  on_track: { label: 'Đúng tiến độ', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', barClassName: 'bg-blue-500' },
  ahead: { label: 'Vượt tiến độ', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300', barClassName: 'bg-cyan-500' },
  achieved: { label: 'Đạt target', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', barClassName: 'bg-emerald-500' },
};

const formatCycleTime = (hours: number | null) => {
  if (hours === null) return '—';
  if (hours < 24) return `${hours.toFixed(1)} giờ`;
  return `${(hours / 24).toFixed(1)} ngày`;
};

const formatRate = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

const formatUsd = (value: number) => `$${new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value)}`;

const formatKpiValue = (value: number, unit: string) => {
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
  return `${formatted}${unit ? ` ${unit}` : ''}`;
};

const ActivityMetric: React.FC<ActivityMetricProps> = ({ label, value, tone = 'neutral', onClick }) => {
  const content = <>
    <p className="text-[9px] font-bold uppercase tracking-wide opacity-65">{label}</p>
    <div className="mt-1 flex items-center gap-1.5 text-base font-black">{value}{onClick && <List className="h-3.5 w-3.5" />}</div>
  </>;

  return onClick
    ? <button type="button" onClick={onClick} className={`rounded-lg p-2.5 text-left transition hover:brightness-95 ${activityToneClasses[tone]}`}>{content}</button>
    : <div className={`rounded-lg p-2.5 ${activityToneClasses[tone]}`}>{content}</div>;
};

const ListingCohortSummary: React.FC<{ person: EmployeePerformanceRow }> = ({ person }) => {
  const milestones = [
    { days: 7, converted: person.firstSaleD7Converted, eligible: person.firstSaleD7Eligible, rate: person.firstSaleD7Rate },
    { days: 14, converted: person.firstSaleD14Converted, eligible: person.firstSaleD14Eligible, rate: person.firstSaleD14Rate },
    { days: 30, converted: person.firstSaleD30Converted, eligible: person.firstSaleD30Eligible, rate: person.firstSaleD30Rate },
  ];

  return <div className="space-y-1 text-[11px] leading-5 text-gray-500">
    <p className="font-bold text-gray-700 dark:text-gray-200">Các mốc sale đầu tiên</p>
    {milestones.map(({ days, converted, eligible, rate }) => <p key={days}>
      <strong className="text-gray-700 dark:text-gray-200">{days} ngày — {converted}/{eligible} · {formatRate(rate)}</strong>:{' '}
      {eligible > 0
        ? `có ${eligible} listing đã lên đủ ${days} ngày; ${converted} listing có sale đầu tiên trong vòng ${days} ngày.`
        : `chưa có listing nào đã lên đủ ${days} ngày để đánh giá.`}
    </p>)}
  </div>;
};

const ActivityPanel: React.FC<{
  person: EmployeePerformanceRow;
  sectionId: PerformanceSectionId;
  onOpenBreakdown: () => void;
}> = ({ person, sectionId, onOpenBreakdown }) => {
  const isDesigner = sectionId === 'designer-idea' || sectionId === 'designer-fulfillment';
  const isDesignerIdea = sectionId === 'designer-idea';
  const isListingTeam = sectionId === 'research-development' || sectionId === 'scale';
  const isCustomerService = sectionId === 'customer-service';

  if (isDesigner) {
    return <div className="min-w-[360px]">
      <div className="grid grid-cols-3 gap-2">
        <ActivityMetric label="Received" value={person.received} />
        <ActivityMetric label="Completed" value={person.completed} tone="emerald" />
        <ActivityMetric label="Completed points" value={person.creditedPoints} tone="amber" />
      </div>
      <p className="mt-2 text-[11px] font-semibold text-gray-500">
        {person.points} điểm board chính + {person.supportPoints} điểm support · {person.completed} file chính + {person.supportCompleted} file support
      </p>
      {isDesignerIdea && (person.ideasWithSales > 0 || person.ideaSales > 0) && <button type="button" onClick={onOpenBreakdown} className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">
        {person.ideasWithSales} SKU có sale · {person.ideaSales} lượt sale <List className="h-3.5 w-3.5" />
      </button>}
    </div>;
  }

  if (isListingTeam) {
    return <div className="min-w-[460px]">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <ActivityMetric label="Active listings" value={person.listings} tone="cyan" />
        <ActivityMetric label="SKU có sale" value={person.soldSkus} tone="emerald" />
        <ActivityMetric label="Qty sold" value={person.saleQuantity} tone="emerald" onClick={onOpenBreakdown} />
        <ActivityMetric label="Revenue" value={formatUsd(person.saleRevenueUsd)} tone="blue" />
      </div>
      <div className="mt-2 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-900/40">
        <p className="mb-1.5 text-xs">Thời gian trung bình có sale đầu tiên: <strong>{formatCycleTime(person.averageFirstSaleHours)}</strong></p>
        <ListingCohortSummary person={person} />
      </div>
    </div>;
  }

  if (isCustomerService) {
    return <div className="min-w-[390px]">
      <div className="grid grid-cols-3 gap-2">
        <ActivityMetric label="Đã chuyển cho Designer" value={person.completed} tone="emerald" />
        <ActivityMetric label="Custom đã xử lý" value={person.customOrdersCompleted} tone="blue" />
        <ActivityMetric label="Non-custom đã xử lý" value={person.nonCustomOrdersCompleted} tone="cyan" />
      </div>
      <div className="mt-2 grid gap-1 text-[11px] font-semibold text-gray-500 sm:grid-cols-2">
        <p>Custom TB: <strong>{formatCycleTime(person.averageCustomCycleHours)}</strong></p>
        <p>Non-custom TB: <strong>{formatCycleTime(person.averageNonCustomCycleHours)}</strong></p>
      </div>
    </div>;
  }

  return <div className="min-w-[280px]">
    <div className="grid grid-cols-2 gap-2">
      <ActivityMetric label="Completed orders" value={person.completed} tone="emerald" />
      <ActivityMetric label="Avg fulfill time" value={formatCycleTime(person.averageCycleHours)} tone="amber" />
    </div>
  </div>;
};

const KpiProgressPanel: React.FC<{ person: EmployeePerformanceRow }> = ({ person }) => {
  const progress = person.kpiProgress;
  if (!progress) {
    return <div className="min-w-[260px] rounded-xl border border-dashed border-gray-200 p-3 dark:border-gray-700">
      <p className="text-xs font-bold text-gray-400">Chưa giao KPI</p>
      <p className="mt-1 text-lg font-black">{formatKpiValue(person.kpiActual, person.kpiUnit)}</p>
      <p className="mt-1 text-[10px] font-semibold text-gray-400">Output thực tế trong phạm vi đang xem</p>
    </div>;
  }

  const pace = paceConfig[progress.status];
  return <div className="min-w-[290px] rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">{progress.periodLabel}</p>
        <p className="mt-1 text-xl font-black text-gray-950 dark:text-white">{formatKpiValue(progress.actual, person.kpiUnit)} <span className="text-sm text-gray-400">/ {formatKpiValue(progress.fullTarget, person.kpiUnit)}</span></p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${pace.className}`}>{pace.label}</span>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className={`h-full rounded-full ${pace.barClassName}`} style={{ width: `${Math.min(progress.completion, 100)}%` }} /></div>
    <div className="mt-2 flex items-center justify-between text-xs"><strong>{progress.completion}% hoàn thành</strong><span className="text-gray-500">Kỳ vọng {progress.expectedTarget}</span></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-center">
      <div className="rounded-lg bg-white p-2 dark:bg-gray-800"><p className="text-[9px] font-bold uppercase text-gray-400">Còn thiếu</p><p className="mt-1 text-xs font-black text-rose-600">{progress.remaining}</p></div>
      <div className="rounded-lg bg-white p-2 dark:bg-gray-800"><p className="text-[9px] font-bold uppercase text-gray-400">Dự báo</p><p className="mt-1 text-xs font-black text-blue-600">{progress.forecast}</p></div>
    </div>
    <p className="mt-3 text-[11px] font-semibold text-gray-500">{progress.countdownLabel} · cần {progress.requiredPerWorkday} {person.kpiUnit || 'đơn vị'}/ngày làm việc</p>
  </div>;
};

const EmployeePerformanceTable: React.FC<Props> = ({ employees, isLoading, sectionId, title = 'Hiệu suất từng nhân sự' }) => {
  const [breakdownEmployee, setBreakdownEmployee] = useState<EmployeePerformanceRow | null>(null);
  const isListingTeam = sectionId === 'research-development' || sectionId === 'scale';
  const summary = useMemo(() => ({
    assigned: employees.filter(person => person.kpiTarget !== null).length,
    achieved: employees.filter(person => person.kpiProgress?.status === 'achieved').length,
  }), [employees]);

  return <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-700 md:flex-row md:items-center md:justify-between md:px-5">
      <div>
        <h3 className="text-lg font-black text-gray-900 dark:text-white">{title}</h3>
        <p className="mt-0.5 text-xs text-gray-500">Hiển thị dữ liệu thực tế trong phạm vi và tiến độ KPI đã duyệt.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">{employees.length} nhân sự</span>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{summary.assigned} đã giao KPI</span>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{summary.achieved} đạt target</span>
      </div>
    </div>

    <div className="space-y-3 p-3 md:hidden">
      {employees.map(person => <div key={person.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <div><p className="font-black text-gray-900 dark:text-white">{person.name}</p><p className="text-xs text-gray-500">{person.role}</p></div>
        <div className="mt-4"><ActivityPanel person={person} sectionId={sectionId} onOpenBreakdown={() => setBreakdownEmployee(person)} /></div>
        <div className="mt-3"><KpiProgressPanel person={person} /></div>
      </div>)}
    </div>

    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400 dark:bg-gray-900/40">
          <tr><th className="px-5 py-3">Nhân sự</th><th className="px-4 py-3">Dữ liệu trong phạm vi</th><th className="px-4 py-3">Tiến độ KPI</th></tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {employees.map(person => <tr key={person.id} className="align-top transition hover:bg-gray-50 dark:hover:bg-gray-900/30">
            <td className="px-5 py-4"><p className="font-black text-gray-900 dark:text-white">{person.name}</p><p className="mt-0.5 text-xs text-gray-500">{person.role}</p><p className="mt-3 text-[10px] font-bold uppercase text-gray-400">{person.kpiTargetSource ? `Target ${person.kpiTargetSource}` : 'Chưa giao target'}</p></td>
            <td className="px-4 py-4"><ActivityPanel person={person} sectionId={sectionId} onOpenBreakdown={() => setBreakdownEmployee(person)} /></td>
            <td className="px-4 py-4"><KpiProgressPanel person={person} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>

    {!isLoading && employees.length === 0 && <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="rounded-full bg-gray-100 p-3 text-gray-400 dark:bg-gray-700"><UserRoundSearch className="h-6 w-6" /></div>
      <p className="mt-3 text-sm font-bold text-gray-700 dark:text-gray-200">Chưa có dữ liệu hoạt động trong phạm vi đã chọn</p>
      <p className="mt-1 text-xs text-gray-500">Hãy kiểm tra khoảng ngày, role nhân sự hoặc nguồn dữ liệu.</p>
    </div>}

    {breakdownEmployee && <PerformanceBreakdownModal
      title={`${breakdownEmployee.name} - ${isListingTeam ? 'Sale theo SKU nhân sự' : 'Sale theo SKU Idea'}`}
      subtitle={isListingTeam
        ? `${breakdownEmployee.soldSkus} SKU có sale · ${breakdownEmployee.saleQuantity} qty · ${breakdownEmployee.saleOrders} orders · ${formatUsd(breakdownEmployee.saleRevenueUsd)}`
        : `${breakdownEmployee.ideasWithSales} SKU có sale · ${breakdownEmployee.ideaSales} lượt sale trong phạm vi đã chọn`}
      items={isListingTeam ? breakdownEmployee.saleBreakdown : breakdownEmployee.ideaSaleBreakdown}
      onClose={() => setBreakdownEmployee(null)}
    />}
  </article>;
};

export default EmployeePerformanceTable;
