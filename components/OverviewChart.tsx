import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { OverviewChartData } from '../api/_lib/types';

interface OverviewChartProps {
  data: OverviewChartData[];
}

// Predefined colors for the chart lines
const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00C49F', '#FFBB28'];

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
    <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700" style={{ height: '350px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 30, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--recharts-grid-stroke)" />
          <XAxis dataKey="date" stroke="var(--recharts-text-color)" />
          <YAxis yAxisId="left" stroke="var(--recharts-text-color)" label={{ value: 'Orders', angle: -90, position: 'insideLeft', fill: 'var(--recharts-text-color)' }} />
          <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" label={{ value: 'Revenue', angle: -90, position: 'insideRight', fill: '#82ca9d' }}/>
          <Tooltip
            contentStyle={{ 
              backgroundColor: 'var(--recharts-tooltip-bg)', 
              border: '1px solid var(--recharts-tooltip-border)' 
            }}
            labelStyle={{ color: 'var(--recharts-tooltip-label-color)' }}
          />
          <Legend />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="orderCount"
            stroke="#4299e1"
            strokeWidth={2}
            name="Order Count"
            dot={false}
          />
          {revenueKeys.map((key, index) => (
            <Line
              key={key}
              yAxisId="right"
              type="monotone"
              dataKey={key}
              stroke={COLORS[index % COLORS.length]}
              name={key.replace('revenue', 'Revenue ')}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OverviewChart;