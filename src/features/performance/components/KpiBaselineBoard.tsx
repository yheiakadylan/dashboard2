import { useMemo } from 'react';
import { BarChart3, Info, Sparkles } from 'lucide-react';
import type { EmployeeKpiBaselineSeries } from '../baseline';
import { calculateQuarterlyKpiBaseline } from '../baseline';
import type { PerformanceBaselineRefreshStatus } from '../services/performanceBaselineService';
import type { PerformanceSectionId } from '../types';
import MetricHelpTooltip from './MetricHelpTooltip';

interface KpiBaselineBoardProps {
  sectionId: PerformanceSectionId;
  sectionLabel: string;
  unit: string;
  series?: EmployeeKpiBaselineSeries[];
  dataSource?: 'aggregate' | 'live' | 'unavailable';
  updatedAt?: string | null;
  refreshStatus?: PerformanceBaselineRefreshStatus;
  refreshError?: string | null;
  rangeFrom?: string;
  rangeTo?: string;
  quarterLabel?: string;
  isLoading?: boolean;
  canApplySuggestion: boolean;
  onApplySuggestion: (employeeId: string, value: number, period: 'quarterly') => void;
}

const formatValue = (value: number | null) => value === null
  ? '—'
  : value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

const formatDate = (value: string) => value
  ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
  : '—';

const confidenceLabels = {
  none: 'Chưa có dữ liệu',
  partial: 'Mới có một phần quý',
  complete: 'Đủ 3 tháng của quý',
} as const;

export default function KpiBaselineBoard({
  sectionId,
  sectionLabel,
  unit,
  series = [],
  dataSource = 'live',
  updatedAt = null,
  refreshStatus = 'unknown',
  refreshError = null,
  rangeFrom = '',
  rangeTo = '',
  quarterLabel = '',
  isLoading = false,
  canApplySuggestion,
  onApplySuggestion,
}: KpiBaselineBoardProps) {
  const isIdeaCohort = sectionId === 'research-development' || sectionId === 'scale';
  const safeSeries = Array.isArray(series) ? series : [];
  const summaries = useMemo(() => safeSeries.map(employee => ({
    employee,
    baseline: calculateQuarterlyKpiBaseline(Array.isArray(employee.monthlyValues) ? employee.monthlyValues : []),
  })).sort((left, right) => left.employee.name.localeCompare(right.employee.name)), [safeSeries]);
  const withOutput = summaries.filter(item => item.baseline.totalOutput > 0).length;
  const canSuggestTarget = canApplySuggestion && !isIdeaCohort;
  const totalOutput = summaries.reduce((sum, item) => sum + item.baseline.totalOutput, 0);
  const updatedLabel = updatedAt
    ? new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(updatedAt))
    : null;
  const dataSourceLabel = (() => {
    if (refreshStatus === 'running') return 'Đang tự động tổng hợp';
    if (refreshStatus === 'failed') return 'Lần tổng hợp gần nhất bị lỗi';
    if (refreshStatus === 'finalized') return 'Đã chốt dữ liệu quý';
    if (dataSource === 'aggregate') return 'Tự động tổng hợp mỗi đêm';
    return dataSource === 'live' ? 'Tạm tính trực tiếp' : 'Chưa tải được dữ liệu tổng hợp';
  })();
  const dataSourceClass = (() => {
    if (refreshStatus === 'failed') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
    if (refreshStatus === 'running') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    if (dataSource === 'aggregate') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    return dataSource === 'live'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  })();

  return <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20 md:p-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-white p-2.5 text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300"><BarChart3 className="h-5 w-5" /></div>
        <div>
          <h3 className="font-black text-gray-950 dark:text-white">{isIdeaCohort ? 'Dữ liệu quý trước để chuẩn bị KPI cá nhân' : 'Dữ liệu quý trước để đề xuất KPI cá nhân'}</h3>
          <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">{sectionLabel} · {quarterLabel || 'Quý trước'} ({formatDate(rangeFrom)} – {formatDate(rangeTo)}) · {isIdeaCohort ? 'chờ công thức sale + listing' : 'đề xuất luôn là target quý'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold">
            <span className={`rounded-full px-2 py-1 ${dataSourceClass}`}>{dataSourceLabel}</span>
            {updatedLabel && <span className="text-gray-400">Cập nhật {updatedLabel}</span>}
          </div>
          {refreshStatus === 'failed' && refreshError && <p className="mt-2 max-w-3xl text-xs font-semibold text-rose-600 dark:text-rose-300">Không thể cập nhật dữ liệu tổng hợp: {refreshError}</p>}
        </div>
      </div>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="relative rounded-xl bg-white p-3 pb-10 dark:bg-gray-800"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Nhân sự trong phạm vi</p><p className="mt-1 text-lg font-black text-gray-950 dark:text-white">{safeSeries.length}</p><MetricHelpTooltip title="Nhân sự trong phạm vi" content={{ summary: 'Số nhân sự active thuộc phòng ban và phạm vi quyền/POD hiện tại.', calculation: ['Lọc hồ sơ authentication theo role, trạng thái active và phạm vi quyền của tài khoản đang đăng nhập.'], sources: ['Firestore authentication: uid, role, active, empID.', 'Cấu hình POD Team nếu đang chọn một POD.'], rules: ['Không tính tài khoản inactive hoặc ngoài phạm vi được phép xem.'] }} className="absolute bottom-3 right-3" /></div>
      <div className="relative rounded-xl bg-white p-3 pb-10 dark:bg-gray-800"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{isIdeaCohort ? 'Active listing quý trước' : 'Tổng output quý trước'}</p><p className="mt-1 text-lg font-black text-gray-950 dark:text-white">{formatValue(totalOutput)} <span className="text-xs font-semibold text-gray-400">{unit}</span></p><MetricHelpTooltip title={isIdeaCohort ? 'Active listing quý trước' : 'Tổng output quý trước'} content={{ summary: isIdeaCohort ? 'Tổng active listing được tạo bởi nhân sự R&D/Scale trong quý tham khảo.' : 'Tổng output thực tế của toàn bộ nhân sự đang hiển thị trong quý tham khảo.', calculation: ['Cộng tổng output của 3 bucket tháng thuộc quý trước.', 'Designer: tổng điểm template của các file đã submit.', 'R&D/Scale: chỉ dùng active listing làm một đầu vào tham khảo.', 'Customer Service/Fulfillment: số order hoàn tất.'], sources: ['user/{teamId}/performance_baseline_buckets.'], rules: [isIdeaCohort ? 'Chưa phải target KPI; đề xuất chính thức còn cần công thức kết hợp sale + listing.' : 'Không phải điểm đánh giá và không cộng dữ liệu giữa các phòng ban.'] }} className="absolute bottom-3 right-3" /></div>
      <div className="relative rounded-xl bg-white p-3 pb-10 dark:bg-gray-800"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{isIdeaCohort ? 'Đã có dữ liệu listing' : 'Có dữ liệu quý trước'}</p><p className="mt-1 text-lg font-black text-blue-700 dark:text-blue-300">{withOutput}/{safeSeries.length}</p><MetricHelpTooltip title={isIdeaCohort ? 'Dữ liệu listing đã có' : 'Có dữ liệu quý trước'} content={{ summary: isIdeaCohort ? 'Số nhân sự có listing active được ghi nhận trong quý trước.' : 'Số nhân sự có ít nhất một tháng có output trong quý trước.', calculation: [isIdeaCohort ? 'Đếm tổng listing active theo từng tháng trong quý trước.' : 'Nếu tổng output của nhân sự lớn hơn 0 thì được tính là có dữ liệu.'], sources: ['Ba bucket tháng của quý trước trong performance_baseline_buckets.', ...(isIdeaCohort ? ['Dữ liệu sale được theo dõi tại board Performance R&D/Scale để chuẩn bị công thức sau.'] : [])], rules: [isIdeaCohort ? 'Chưa dùng listing đơn độc để đề xuất KPI khi công thức sale + listing chưa được duyệt.' : 'Mới có một hoặc hai tháng vẫn hiển thị, nhưng trạng thái sẽ ghi rõ thiếu tháng.'] }} className="absolute bottom-3 right-3" /></div>
    </div>

    <div className="mt-4 overflow-x-auto rounded-xl bg-white dark:bg-gray-800">
      <table className="w-full min-w-[920px] text-left text-xs">
        <thead className="border-b border-gray-100 text-[10px] uppercase tracking-wide text-gray-400 dark:border-gray-700"><tr><th className="px-4 py-3">Nhân sự</th><th className="px-3 py-3">{isIdeaCohort ? 'Active listing quý trước' : 'Output quý trước'}</th><th className="px-3 py-3">Số tháng có output</th><th className="px-3 py-3">Trung bình mỗi tháng</th><th className="px-3 py-3">{isIdeaCohort ? 'Đề xuất KPI' : 'Target quý đề xuất'}</th><th className="px-4 py-3 text-right">Thao tác</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {summaries.map(({ employee, baseline }) => <tr key={employee.id}>
            <td className="px-4 py-3"><p className="font-black text-gray-950 dark:text-white">{employee.name}</p><p className="mt-0.5 text-[10px] text-gray-400">{employee.role}</p></td>
            <td className="px-3 py-3 font-black text-gray-700 dark:text-gray-200">{formatValue(baseline.totalOutput)} <span className="font-normal text-gray-400">{unit}</span></td>
            <td className="px-3 py-3"><span className="font-black text-gray-700 dark:text-gray-200">{baseline.monthCount}/3</span><span className="ml-1 text-gray-400">· {confidenceLabels[baseline.confidence]}</span></td>
            <td className="px-3 py-3 font-black text-gray-700 dark:text-gray-200">{formatValue(baseline.averagePerMonth)} <span className="font-normal text-gray-400">{unit}/tháng</span></td>
            <td className="px-3 py-3 font-black text-blue-700 dark:text-blue-300">{isIdeaCohort ? <span className="font-semibold text-gray-400">Chờ công thức sale + listing</span> : <>{formatValue(baseline.suggestedQuarterlyTarget)} <span className="font-normal text-gray-400">{unit}/quý</span></>}</td>
            <td className="px-4 py-3 text-right">{isIdeaCohort ? <span className="text-gray-400">Chờ công thức sale + listing</span> : canSuggestTarget && baseline.suggestedQuarterlyTarget !== null ? <button type="button" onClick={() => onApplySuggestion(employee.id, baseline.suggestedQuarterlyTarget!, 'quarterly')} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-blue-700"><Sparkles className="h-3 w-3" /> Dùng {formatValue(baseline.suggestedQuarterlyTarget)} {unit}/quý</button> : <span className="text-gray-400">Chưa có output</span>}</td>
          </tr>)}
        </tbody>
      </table>
      {summaries.length === 0 && <p className="px-4 py-8 text-center text-xs font-semibold text-gray-400">{isLoading ? 'Đang tải dữ liệu quý trước...' : 'Chưa có nhân sự trong phạm vi hiện tại.'}</p>}
    </div>

    <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-white/70 p-3 text-xs leading-5 text-gray-600 dark:border-blue-900/40 dark:bg-gray-800/70 dark:text-gray-300"><Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" /><span>{isIdeaCohort ? 'R&D/Scale đã có dữ liệu listing active và sale ở Performance để chuẩn bị. Baseline này chưa đề xuất target và chưa tính điểm; chỉ bật sau khi công thức sale + listing được cấu hình.' : <><strong>Output quý trước = tổng output của 3 tháng trước</strong>; <strong>Trung bình tháng = Output quý trước / 3</strong>; <strong>Target quý đề xuất = Output quý trước</strong>. Đây chỉ là mốc tham khảo ban đầu, không tự cộng tăng trưởng. Leader có thể điều chỉnh theo năng lực hoặc thời gian onboard, sau đó gửi Head duyệt.</>}</span></div>
  </section>;
}
