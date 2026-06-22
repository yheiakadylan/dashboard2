import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

interface SummaryChartProps {
  data: any[];
  hideTitle?: boolean;
  hideFunds?: boolean;
  exchangeRates?: { [currency: string]: number } | null;
}

const REVENUE_COLORS = ['#EAB308', '#F59E0B', '#F97316', '#10B981', '#14B8A6'];
const FUNDS_COLORS = ['#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#06B6D4'];
const ITEMS_PER_PAGE = 10;

const USD_REVENUE_COLOR = '#10B981'; // single green bar for revenue USD
const USD_FUNDS_COLOR = '#3B82F6'; // single blue bar for funds USD

// Custom Tooltip — multi-currency mode
const CustomTooltipMulti = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const revenues: React.ReactElement[] = [];
  const funds: React.ReactElement[] = [];
  Object.keys(d).forEach(key => {
    const value = d[key];
    if (typeof value === 'number' && value > 0 && key !== 'totalRev') {
      if (key.startsWith('revenue')) {
        const cur = key.replace('revenue', '');
        revenues.push(<div key={key} className="text-sm"><span className="font-semibold">{cur}: </span>{value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>);
      } else if (key.startsWith('funds')) {
        const cur = key.replace('funds', '');
        funds.push(<div key={key} className="text-sm"><span className="font-semibold">{cur}: </span>{value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>);
      }
    }
  });
  return (
    <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 shadow-lg rounded z-50">
      <p className="font-bold mb-1 text-gray-900 dark:text-white border-b pb-1 dark:border-gray-700">{d.shop}</p>
      <p className="text-xs text-gray-500 mb-2">Total: ${d.totalRev?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      {revenues.length > 0 && <div className="mb-1"><p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 uppercase mb-0.5">Revenue</p>{revenues}</div>}
      {funds.length > 0 && <div><p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase mb-0.5">Funds</p>{funds}</div>}
    </div>
  );
};

// Custom Tooltip — USD mode
const CustomTooltipUSD = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 shadow-lg rounded z-50">
      <p className="font-bold mb-1 text-gray-900 dark:text-white border-b pb-1 dark:border-gray-700">{d.shop}</p>
      {d.revenueUSD != null && <p className="text-sm"><span className="font-semibold text-green-600">Revenue: </span>${d.revenueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
      {d.fundsUSD != null && d.fundsUSD > 0 && <p className="text-sm"><span className="font-semibold text-blue-600">Funds: </span>${d.fundsUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
    </div>
  );
};

const renderLegendMulti = (props: any) => {
  const { payload } = props;
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
        );
      })}
    </div>
  );
};

import EmptyState from '../ui/EmptyState';

const SummaryChart: React.FC<SummaryChartProps> = ({ data, hideTitle = false, hideFunds = false, exchangeRates }) => {
  const [page, setPage] = useState(0);
  const { globalUsdMode: usdMode } = useUI();

  const { revenueKeys, fundsKeys } = React.useMemo(() => {
    const keys = new Set<string>();
    data.forEach(item => Object.keys(item).forEach(k => keys.add(k)));
    const all = Array.from(keys);
    return {
      revenueKeys: all.filter(key => key.startsWith('revenue')),
      fundsKeys: hideFunds ? [] : all.filter(key => key.startsWith('funds'))
    };
  }, [data, hideFunds]);

  // Compute USD-normalised data
  const usdData = React.useMemo(() => {
    if (!exchangeRates) return null;
    return data.map(item => {
      let revenueUSD = 0;
      let fundsUSD = 0;
      revenueKeys.forEach(key => {
        const currency = key.replace('revenue', '');
        const rate = exchangeRates[currency] ?? (currency === 'USD' ? 1 : 0);
        revenueUSD += (item[key] || 0) * rate;
      });
      fundsKeys.forEach(key => {
        const currency = key.replace('funds', '');
        const rate = exchangeRates[currency] ?? (currency === 'USD' ? 1 : 0);
        fundsUSD += (item[key] || 0) * rate;
      });
      return { shop: item.shop, revenueUSD, fundsUSD };
    });
  }, [data, revenueKeys, fundsKeys, exchangeRates]);

  // Sort & filter
  const sortedData = React.useMemo(() => {
    if (usdMode && usdData) {
      return [...usdData]
        .filter(item => item.revenueUSD > 0)
        .sort((a, b) => b.revenueUSD - a.revenueUSD);
    }
    return [...data]
      .map(item => {
        const totalRev = revenueKeys.reduce((sum, key) => sum + (typeof item[key] === 'number' ? item[key] : 0), 0);
        return { ...item, totalRev };
      })
      .filter(item => item.totalRev > 0)
      .sort((a, b) => b.totalRev - a.totalRev);
  }, [data, usdData, usdMode, revenueKeys]);

  const canToggleUSD = !!exchangeRates && revenueKeys.length > 1;

  if (!data || data.length === 0 || sortedData.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 p-2 md:p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 h-[300px] md:h-[450px] flex flex-col items-center justify-center animate-fade-in-up">
        {!hideTitle && <h3 className="w-full text-base md:text-lg font-semibold mb-2 md:mb-4 text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">Shop Performance</h3>}
        <div className="flex-grow flex items-center justify-center">
          <EmptyState variant="no-data" title="No Shop Data" description="Performance metrics will appear here." className="p-0" />
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(sortedData.length / ITEMS_PER_PAGE);
  const paginatedData = sortedData.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  return (
    <div className="bg-white dark:bg-gray-800 p-2 md:p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 h-[300px] md:h-[450px] flex flex-col animate-fade-in-up">
      {/* Header row: pagination (left) | spacer | title (optional) | USD toggle (right) */}
      <div className="flex items-center gap-2 mb-2 md:mb-3 flex-shrink-0">
        {/* Pagination — left side */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className={`p-1 rounded-full transition-colors ${page === 0 ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'}`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className={`p-1 rounded-full transition-colors ${page >= totalPages - 1 ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'}`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Title or spacer — pushes toggle to the right */}
        {!hideTitle
          ? <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white flex-1 text-center">Shop Performance</h3>
          : <div className="flex-1" />
        }
      </div>

      {/* Chart Area */}
      <div className="flex-grow min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={paginatedData}
            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            barSize={usdMode ? 18 : 24}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.15} horizontal={true} vertical={true} />
            <XAxis
              type="number"
              stroke="#6B7280"
              tickFormatter={(val) => `$${Number(val).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`}
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
            <Tooltip
              content={usdMode ? <CustomTooltipUSD /> : <CustomTooltipMulti />}
              cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
            />
            <Legend
              content={usdMode ? undefined : renderLegendMulti}
              wrapperStyle={usdMode ? { paddingTop: '8px', fontSize: '12px' } : undefined}
              iconSize={10}
            />

            {/* Bars — built as flat array to avoid Fragment issue with Recharts */}
            {usdMode
              ? [
                <Bar key="revenueUSD" dataKey="revenueUSD" stackId="usd" fill={USD_REVENUE_COLOR} name="Revenue (USD)" animationDuration={400} radius={[0, 4, 4, 0]} />,
                ...(!hideFunds ? [<Bar key="fundsUSD" dataKey="fundsUSD" stackId="usd2" fill={USD_FUNDS_COLOR} name="Funds (USD)" animationDuration={400} radius={[0, 4, 4, 0]} />] : [])
              ]
              : [
                ...revenueKeys.map((key, index) => (
                  <Bar key={key} dataKey={key} stackId="a" fill={REVENUE_COLORS[index % REVENUE_COLORS.length]} name={key.replace('revenue', 'Rev ')} animationDuration={500} radius={[0, 4, 4, 0]} />
                )),
                ...fundsKeys.map((key, index) => (
                  <Bar key={key} dataKey={key} stackId="a" fill={FUNDS_COLORS[index % FUNDS_COLORS.length]} name={key.replace('funds', 'Fund ')} radius={[0, 4, 4, 0]} />
                ))
              ]
            }
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default React.memo(SummaryChart);
