
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { SummaryChartData } from '../api/_lib/types';

interface SummaryChartProps {
  data: SummaryChartData[];
}

// Predefined colors for the chart bars
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const revenues: React.ReactElement[] = [];
    const funds: React.ReactElement[] = [];

    Object.keys(data).forEach(key => {
      const value = data[key];
      if (typeof value === 'number' && value > 0) {
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
      <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 shadow-lg rounded">
        <p className="font-bold mb-2 text-gray-900 dark:text-white border-b pb-1 dark:border-gray-700">{data.shop}</p>
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

const SummaryChart: React.FC<SummaryChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return null;
  }

  // Find all unique keys for Revenue and Funds
  const allKeys = Object.keys(data.reduce((acc, cur) => ({ ...acc, ...cur }), {}));
  const revenueKeys = allKeys.filter(key => key.startsWith('revenue'));
  const fundsKeys = allKeys.filter(key => key.startsWith('funds'));

  // Combine keys for rendering bars. We can give them different colors.
  // We'll map colors cyclically but maybe reserve some logic.
  // For simplicity, we continue to cycle through COLORS for all series.

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 h-[400px] flex flex-col animate-fade-in-up">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Revenue & Funds by Shop</h3>
      <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 5, right: 30, left: 20, bottom: 5, }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--recharts-grid-stroke)" />
            {/* Hide X-Axis labels (tick={false}) as per request */}
            <XAxis dataKey="shop" stroke="var(--recharts-text-color)" tick={false} />
            <YAxis stroke="var(--recharts-text-color)" />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
            <Legend />
            {revenueKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="a"
                fill={COLORS[index % COLORS.length]}
                name={key.replace('revenue', 'Rev ')}
                animationDuration={800}
              />
            ))}
            {fundsKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="a"
                // Offset colors or use specific logic. Here we just continue the cycle
                fill={COLORS[(revenueKeys.length + index) % COLORS.length]}
                name={key.replace('funds', 'Fund ')}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SummaryChart;
