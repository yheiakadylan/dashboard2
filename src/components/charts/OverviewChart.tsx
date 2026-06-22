import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { OverviewChartData } from '../../types';
import { useUI } from '../../contexts/UIContext';

interface OverviewChartProps {
  data: OverviewChartData[];
  exchangeRates?: { [currency: string]: number } | null;
}

const COLORS = ['#F59E0B', '#8B5CF6', '#10B981', '#EC4899'];
const USD_REVENUE_COLOR = '#10B981';

import EmptyState from '../ui/EmptyState';

const OverviewChart: React.FC<OverviewChartProps> = ({ data, exchangeRates }) => {
  const { globalUsdMode: usdMode } = useUI();

  if (!data || data.length === 0) {
    return (
      <div className="h-[200px] md:h-[450px] p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 flex items-center justify-center">
        <EmptyState variant="no-data" title="No Chart Data" description="No orders found for this period." className="p-0" />
      </div>
    );
  }

  // Find all unique revenue keys
  const revenueKeys = Object.keys(data[0] || {}).filter(key => key.startsWith('revenue'));
  const canToggleUSD = !!exchangeRates && revenueKeys.length > 1;

  // Compute USD-normalised data (sum all revenue currencies × rate → single revenueUSD)
  const usdData = React.useMemo(() => {
    if (!exchangeRates) return data;
    return data.map(item => {
      let revenueUSD = 0;
      revenueKeys.forEach(key => {
        const currency = key.replace('revenue', '');
        const rate = exchangeRates[currency] ?? (currency === 'USD' ? 1 : 0);
        revenueUSD += ((item as any)[key] || 0) * rate;
      });
      return { ...item, revenueUSD };
    });
  }, [data, revenueKeys, exchangeRates]);

  const chartData = usdMode ? usdData : data;

  const formatXAxis = (value: string) => {
    if (typeof value === 'string' && /^\d{2}:00$/.test(value)) {
      const hour = parseInt(value.substring(0, 2), 10);
      return `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`;
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [, m, d] = value.split('-');
      return `${d}/${m}`;
    }
    return value;
  };

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in-up h-[200px] md:h-[450px] flex flex-col">
      <div className="flex-grow min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#9CA3AF"
              tick={{ fontSize: 10 }}
              tickMargin={5}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
              tickFormatter={formatXAxis}
            />
            <YAxis
              yAxisId="left"
              stroke="#9CA3AF"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v}
              axisLine={false}
              tickLine={false}
              label={{ value: 'Orders', angle: -90, position: 'insideLeft', fill: '#9CA3AF', style: { textAnchor: 'middle' } }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#10B981"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${Number(v).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`}
              axisLine={false}
              tickLine={false}
              label={{ value: usdMode ? 'Rev (USD)' : 'Revenue', angle: -90, position: 'insideRight', fill: '#10B981', style: { textAnchor: 'middle' } }}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
                name
              ]}
              contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
              itemStyle={{ color: '#F3F4F6' }}
              labelStyle={{ color: '#9CA3AF', fontWeight: 'bold' }}
            />
            <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} iconSize={12} />

            {/* Orders line — always shown */}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="orderCount"
              stroke="#3B82F6"
              strokeWidth={3}
              name="Order Count"
              dot={false}
              activeDot={{ r: 6 }}
              animationDuration={1000}
            />

            {/* Revenue lines */}
            {usdMode ? (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="revenueUSD"
                stroke={USD_REVENUE_COLOR}
                strokeWidth={3}
                name="Revenue (USD)"
                dot={false}
                activeDot={{ r: 6 }}
                animationDuration={800}
              />
            ) : (
              revenueKeys.map((key, index) => (
                <Line
                  key={key}
                  yAxisId="right"
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={3}
                  name={key.replace('revenue', 'Rev ')}
                  dot={false}
                  activeDot={{ r: 6 }}
                  animationDuration={1000}
                />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default React.memo(OverviewChart);
