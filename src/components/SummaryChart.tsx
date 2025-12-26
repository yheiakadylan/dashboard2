import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface SummaryChartProps {
  data: any[];
  hideTitle?: boolean;
  hideFunds?: boolean;
}

// Predefined colors for the chart bars - Thematic
const REVENUE_COLORS = ['#EAB308', '#F59E0B', '#F97316', '#10B981', '#14B8A6']; // Yellow, Orange, Green, Teal
const FUNDS_COLORS = ['#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#06B6D4'];   // Blue, Indigo, Violet, Pink, Cyan
const ITEMS_PER_PAGE = 10;

// Custom Tooltip Component
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const revenues: React.ReactElement[] = [];
    const funds: React.ReactElement[] = [];

    Object.keys(data).forEach(key => {
      const value = data[key];
      if (typeof value === 'number' && value > 0 && key !== 'totalRev') {
        if (key.startsWith('revenue')) {
          const currency = key.replace('revenue', '');
          revenues.push(
            <div key={key} className="text-sm">
              <span className="font-semibold">{currency}: </span>
              {value.toLocaleString('en-US', { style: 'currency', currency: 'USD' }).replace('$', '$ ')}
            </div>
          );
        } else if (key.startsWith('funds')) {
          const currency = key.replace('funds', '');
          funds.push(
            <div key={key} className="text-sm">
              <span className="font-semibold">{currency}: </span>
              {value.toLocaleString('en-US', { style: 'currency', currency: 'USD' }).replace('$', '$ ')}
            </div>
          );
        }
      }
    });

    return (
      <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 shadow-lg rounded z-50">
        <p className="font-bold mb-2 text-gray-900 dark:text-white border-b pb-1 dark:border-gray-700">{data.shop}</p>
        <p className="text-sm text-gray-500 mb-2">Total: {data.totalRev?.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
        {revenues.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase mb-1">Revenue</p>
            {revenues}
          </div>
        )}
        {funds.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase mb-1">Funds</p>
            {funds}
          </div>
        )}
      </div>
    );
  }
  return null;
};

const renderLegend = (props: any) => {
  const { payload } = props;
  // Group payloads by category
  const groups: Record<string, any[]> = { 'Revenue': [], 'Funds': [] };

  (payload || []).forEach((entry: any) => {
    if (entry.value.startsWith('Rev ')) groups['Revenue'].push(entry);
    else if (entry.value.startsWith('Fund ')) groups['Funds'].push(entry);
  });

  return (
    <div className="flex justify-center flex-wrap gap-6 pt-4 text-xs">
      {Object.entries(groups).map(([groupName, items]) => {
        if (items.length === 0) return null;
        return (
          <div key={groupName} className="flex items-center gap-2">
            <span className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{groupName}:</span>
            <div className="flex flex-wrap gap-3">
              {items.map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: item.color }}></div>
                  <span className="text-gray-600 dark:text-gray-400 font-medium">{item.value.replace(/^(Rev|Fund) /, '')}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  );
};

const SummaryChart: React.FC<SummaryChartProps> = ({ data, hideTitle = false, hideFunds = false }) => {
  const [page, setPage] = useState(0);

  if (!data || data.length === 0) {
    return null;
  }

  // Optimize: Use Set to find all unique keys efficiently
  const { revenueKeys, fundsKeys } = React.useMemo(() => {
    const keys = new Set<string>();
    data.forEach(item => Object.keys(item).forEach(k => keys.add(k)));
    const all = Array.from(keys);
    return {
      revenueKeys: all.filter(key => key.startsWith('revenue')),
      fundsKeys: hideFunds ? [] : all.filter(key => key.startsWith('funds'))
    };
  }, [data, hideFunds]);

  // Sort by Total Revenue (Desc) and Filter for Shops with Sales > 0
  const sortedData = [...data]
    .map(item => {
      const totalRev = revenueKeys.reduce((sum, key) => sum + (typeof item[key] === 'number' ? item[key] : 0), 0);
      return { ...item, totalRev };
    })
    .filter(item => item.totalRev > 0)
    .sort((a, b) => b.totalRev - a.totalRev);

  const totalPages = Math.ceil(sortedData.length / ITEMS_PER_PAGE);
  const paginatedData = sortedData.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const handlePrev = () => setPage(p => Math.max(0, p - 1));
  const handleNext = () => setPage(p => Math.min(totalPages - 1, p + 1));

  return (
    <div className="bg-white dark:bg-gray-800 p-2 md:p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 h-[300px] md:h-[450px] flex flex-col animate-fade-in-up">
      {!hideTitle && (
        <h3 className="text-base md:text-lg font-semibold mb-2 md:mb-4 text-gray-900 dark:text-white">Shop Performance</h3>
      )}

      {/* Chart Area */}
      <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={paginatedData}
            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            barSize={24}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.15} horizontal={true} vertical={true} />
            <XAxis
              type="number"
              stroke="#6B7280"
              tickFormatter={(val) => `$${val} `}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="shop"
              type="category"
              stroke="#4B5563"
              width={90}
              tick={{ fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }} />
            <Legend content={renderLegend} />
            {revenueKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="a"
                fill={REVENUE_COLORS[index % REVENUE_COLORS.length]}
                name={key.replace('revenue', 'Rev ')} // Kept as 'Rev ' for parser
                animationDuration={500}
                radius={[0, 4, 4, 0]}
              />
            ))}
            {fundsKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="a"
                fill={FUNDS_COLORS[index % FUNDS_COLORS.length]}
                name={key.replace('funds', 'Fund ')} // Kept as 'Fund ' for parser
                radius={[0, 4, 4, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-2 px-2 border-t border-gray-100 dark:border-gray-700 pt-2">
          <button
            onClick={handlePrev}
            disabled={page === 0}
            className={`p - 1.5 rounded - full transition - colors flex items - center justify - center ${page === 0
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed hidden'
              : 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-gray-700 dark:text-blue-400'
              } `}
            aria-label="Previous Page"
          >
            <ChevronLeftIcon className="w-5 h-5" />
          </button>

          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mx-auto">
            Page {page + 1} of {totalPages}
          </span>

          <button
            onClick={handleNext}
            disabled={page >= totalPages - 1}
            className={`p - 1.5 rounded - full transition - colors flex items - center justify - center ${page >= totalPages - 1
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed hidden'
              : 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-gray-700 dark:text-blue-400'
              } `}
            aria-label="Next Page"
          >
            <ChevronRightIcon className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};

// Memoize expensive chart component
export default React.memo(SummaryChart);
