import { Gauge } from 'lucide-react';
import type { MetricHelpContent } from '../types';
import MetricHelpTooltip from './MetricHelpTooltip';

export interface KpiCohortPreview {
  d7Rate: number | null;
  d14Rate: number | null;
  d30Rate: number | null;
}

interface Props {
  actual: number;
  target: number;
  unit: string;
  actualDescription: string;
  cohort?: KpiCohortPreview;
  isSample?: boolean;
}

const formatRate = (value: number | null) => value === null ? 'Chưa đủ mẫu' : `${value.toFixed(1)}%`;

const MeasurementCard = ({ label, value, help }: { label: string; value: string; help: MetricHelpContent }) => (
  <div className="relative min-h-28 rounded-xl bg-gray-50 p-3 pb-11 dark:bg-gray-900/40">
    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
    <p className="mt-1 text-xl font-black">{value}</p>
    <MetricHelpTooltip title={label} content={help} className="absolute bottom-3 right-3" />
  </div>
);

export default function KpiMeasurementPreview({ actual, target, unit, actualDescription, cohort, isSample = false }: Props) {
  const completion = target > 0 ? Math.round(actual / target * 1000) / 10 : 0;

  return <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"><Gauge className="h-5 w-5" /></div>
        <div><h3 className="font-black text-gray-950 dark:text-white">Xem trước KPI target</h3><p className="mt-1 text-xs leading-5 text-gray-500">Chỉ theo dõi Actual/Target. Hệ thống không chấm điểm, xếp hạng hoặc tự đánh giá nhân sự.</p></div>
      </div>
      {isSample && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-300">Dữ liệu minh họa</span>}
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <MeasurementCard label="Actual" value={`${actual.toLocaleString()} ${unit}`} help={{ summary: actualDescription, currentSummary: `Actual hiện tại: ${actual.toLocaleString()} ${unit}.`, calculation: ['Lấy dữ liệu thực tế trong đúng kỳ KPI.', 'Nguồn và timestamp phụ thuộc phòng ban đang chọn.'], sources: ['Dữ liệu Operations đã map vào nhân sự.'], rules: ['Không chuyển Actual thành điểm đánh giá.'] }} />
      <MeasurementCard label="Target" value={`${target.toLocaleString()} ${unit}`} help={{ summary: 'Target output được Leader đề xuất và Head duyệt.', currentSummary: `Target đang nhập: ${target.toLocaleString()} ${unit}.`, calculation: ['Ưu tiên target cá nhân.', 'Nếu không có target cá nhân, dùng mặc định phòng ban.'], sources: ['KPI target snapshot đã duyệt.'], rules: ['Snapshot mới không sửa ngược lịch sử.'] }} />
      <MeasurementCard label="Tiến độ" value={`${completion}%`} help={{ summary: 'Tỷ lệ Actual/Target, không phải điểm KPI.', currentSummary: `${actual.toLocaleString()} / ${target.toLocaleString()} × 100 = ${completion}%.`, calculation: ['Tiến độ = Actual / Target × 100.', 'Có thể vượt 100% nếu output vượt target.'], sources: ['Actual từ Operations và Target từ snapshot KPI.'], rules: ['Không dùng tỷ lệ này để gán Tốt/Cần hỗ trợ.'] }} />
    </div>

    {cohort && <div className="mt-4 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-xs font-black text-gray-700 dark:text-gray-200">Tỷ lệ listing có sale theo thời gian</p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div><p className="text-[10px] font-bold uppercase text-gray-400">Có sale trong 7 ngày</p><p className="mt-1 font-black">{formatRate(cohort.d7Rate)}</p></div>
        <div><p className="text-[10px] font-bold uppercase text-gray-400">Có sale trong 14 ngày</p><p className="mt-1 font-black">{formatRate(cohort.d14Rate)}</p></div>
        <div><p className="text-[10px] font-bold uppercase text-gray-400">Có sale trong 30 ngày</p><p className="mt-1 font-black">{formatRate(cohort.d30Rate)}</p></div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-gray-400">Ví dụ: chỉ listing đã lên đủ 7 ngày mới được tính vào tỷ lệ 7 ngày. Listing mới hơn không bị xem là chưa đạt.</p>
    </div>}
  </section>;
}
