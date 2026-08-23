import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompanyOverviewChartData } from '../types';

interface Props {
  data: CompanyOverviewChartData;
}

const ChartCard: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-5">
    <h3 className="text-base font-black text-gray-900 dark:text-white">{title}</h3>
    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
    <div className="mt-4 h-[280px] min-w-0">{children}</div>
  </article>
);

const EmptyChart: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex h-full items-center justify-center rounded-xl bg-gray-50 px-6 text-center text-sm font-semibold text-gray-400 dark:bg-gray-900/40">
    {message}
  </div>
);

const tooltipStyle = {
  backgroundColor: '#111827',
  border: '1px solid #374151',
  borderRadius: '10px',
  color: '#f9fafb',
};

const aggregateTrendRows = (rows: CompanyOverviewChartData['activityTrend']) => {
  if (rows.length <= 31) return rows;
  const aggregated: CompanyOverviewChartData['activityTrend'] = [];
  for (let index = 0; index < rows.length; index += 7) {
    const chunk = rows.slice(index, index + 7);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    aggregated.push(chunk.reduce((summary, row) => ({
      ...summary,
      listings: summary.listings + row.listings,
      designerIdea: summary.designerIdea + row.designerIdea,
      designerFulfillment: summary.designerFulfillment + row.designerFulfillment,
      csCompleted: summary.csCompleted + row.csCompleted,
      fulfilled: summary.fulfilled + row.fulfilled,
    }), {
      date: first.date,
      label: first.label === last.label ? first.label : `${first.label}–${last.label}`,
      listings: 0,
      designerIdea: 0,
      designerFulfillment: 0,
      csCompleted: 0,
      fulfilled: 0,
    }));
  }
  return aggregated;
};

const CompanyOverviewCharts: React.FC<Props> = ({ data }) => {
  const displayTrend = React.useMemo(() => aggregateTrendRows(data.activityTrend), [data.activityTrend]);
  const isSingleDay = data.activityTrend.length === 1;
  const isWeeklyView = data.activityTrend.length > 31;
  const hasOutput = displayTrend.some(row => row.listings || row.designerIdea || row.designerFulfillment);
  const hasOperations = displayTrend.some(row => row.csCompleted || row.fulfilled);
  const ratingRows = data.ratingComparison.slice(0, 8);
  const supplierCoverageLabel = data.supplierCoverage === null ? '—' : `${data.supplierCoverage.toFixed(1)}%`;

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title={isSingleDay ? 'Output trong ngày' : isWeeklyView ? 'Output theo nhóm 7 ngày' : 'Output theo ngày'}
        description={`Listing mới và task Designer submit trong phạm vi đang chọn${isWeeklyView ? '; range dài được gộp theo từng 7 ngày.' : '.'}`}
      >
        {!hasOutput ? <EmptyChart message="Chưa có output trong phạm vi đã chọn." /> : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={displayTrend} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
              <Bar dataKey="listings" name="Listing mới" fill="#0f766e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="designerIdea" name="Designer Idea submit" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="designerFulfillment" name="Designer Fulfill submit" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title={isSingleDay ? 'Luồng xử lý trong ngày' : isWeeklyView ? 'Luồng xử lý theo nhóm 7 ngày' : 'Luồng xử lý theo ngày'}
        description={isSingleDay
          ? 'So sánh trực tiếp số order CS đã xử lý và số order Fulfillment hoàn tất trong ngày.'
          : `Theo dõi số order CS đã xử lý và số order Fulfillment hoàn tất${isWeeklyView ? '; range dài được gộp theo từng 7 ngày.' : ' theo ngày.'}`}
      >
        {!hasOperations ? <EmptyChart message="Chưa có dữ liệu xử lý trong phạm vi đã chọn." /> : isSingleDay ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={displayTrend} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
              <Bar dataKey="csCompleted" name="CS đã xử lý" fill="#2563eb" radius={[5, 5, 0, 0]} />
              <Bar dataKey="fulfilled" name="Đã Fulfill" fill="#059669" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={displayTrend} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
              <Line type="monotone" dataKey="csCompleted" name="CS đã xử lý" stroke="#2563eb" strokeWidth={2.5} dot={displayTrend.length <= 14} />
              <Line type="monotone" dataKey="fulfilled" name="Đã Fulfill" stroke="#059669" strokeWidth={2.5} dot={displayTrend.length <= 14} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="Đơn đã Fulfill theo supplier"
        description={`Ưu tiên SKU mapping, fallback supplier trên task; coverage hiện tại ${supplierCoverageLabel}.`}
      >
        {data.supplierBreakdown.length === 0 ? <EmptyChart message="Chưa có đơn đã Fulfill để phân loại supplier." /> : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.supplierBreakdown} layout="vertical" margin={{ top: 4, right: 28, left: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" name="Orders" fill="#0f766e" radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="Rating theo shop"
        description="So sánh rating trong phạm vi với rating toàn thời gian của từng shop."
      >
        {ratingRows.length === 0 ? <EmptyChart message="Chưa có review trong phạm vi đã chọn." /> : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ratingRows} layout="vertical" margin={{ top: 8, right: 12, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
              <XAxis type="number" domain={[0, 5]} tickCount={6} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} tickFormatter={value => String(value).length > 18 ? `${String(value).slice(0, 17)}…` : String(value)} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
              <Bar dataKey="rangeAverage" name="Trong phạm vi" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="lifetimeAverage" name="Toàn thời gian" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </section>
  );
};

export default CompanyOverviewCharts;
