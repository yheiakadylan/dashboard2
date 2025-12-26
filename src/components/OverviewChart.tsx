import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { OverviewChartData } from '../types';

interface OverviewChartProps {
  data: OverviewChartData[];
}

// Predefined colors matching the user's reference image
// Order Count (Blue), Rev AUD (Purple), Rev NZD (Green), Rev USD (Yellow)
// Note: Colors will be assigned cyclically. We'll try to map them nicely:
// - Orders: #3B82F6 (Independent)
// - Revenue loop: Yellow -> Purple -> Green
const COLORS = ['#F59E0B', '#8B5CF6', '#10B981', '#EC4899'];

const OverviewChart: React.FC<OverviewChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700" style={{ height: '300px' }}>
        No chart data available for this period.
      </div>
    );
  }

  // Find all unique revenue keys (e.g., 'revenueAUD', 'revenueUSD')
  const revenueKeys = Object.keys(data[0] || {})
    .filter(key => key.startsWith('revenue'));

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in-up h-[200px] md:h-[450px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#9CA3AF"
            tick={{ fontSize: 10 }}
            tickMargin={5}
            axisLine={false}
            tickLine={false}
            minTickGap={20} // Prevent overcrowding
            tickFormatter={(value) => {
              // Handle HH:00 format (Daily view) - Format to 12 AM, 1 PM
              if (typeof value === 'string' && /^\d{2}:00$/.test(value)) {
                const hour = parseInt(value.substring(0, 2), 10);
                const period = hour >= 12 ? 'PM' : 'AM';
                const displayHour = hour % 12 || 12;
                return `${displayHour} ${period}`;
              }
              // Handle YYYY-MM-DD format (Range view) - Format to DD/MM
              if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                const [, m, d] = value.split('-');
                return `${d}/${m}`;
              }
              return value;
            }}
          />
          <YAxis
            yAxisId="left"
            stroke="#9CA3AF"
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => value}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Orders', angle: -90, position: 'insideLeft', fill: '#9CA3AF', style: { textAnchor: 'middle' } }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#10B981"
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Revenue', angle: -90, position: 'insideRight', fill: '#10B981', style: { textAnchor: 'middle' } }}
          />
          <Tooltip
            formatter={(value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            contentStyle={{
              backgroundColor: '#1F2937',
              borderColor: '#374151',
              color: '#F3F4F6',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}
            itemStyle={{ color: '#F3F4F6' }}
            labelStyle={{ color: '#9CA3AF', fontWeight: 'bold' }}
          />
          <Legend
            wrapperStyle={{ paddingTop: '10px', fontSize: '10px' }}
            iconSize={10}
          />
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
          {revenueKeys.map((key, index) => (
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
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

// Memoize expensive chart component
export default React.memo(OverviewChart);
