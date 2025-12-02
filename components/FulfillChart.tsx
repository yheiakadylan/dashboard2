// components/FulfillChart.tsx
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { FulfillChartData } from '../api/_lib/types';

interface FulfillChartProps {
  data: FulfillChartData[];
  title: string;
}

const FulfillChart: React.FC<FulfillChartProps> = ({ data, title }) => {
  if (!data || data.length === 0) {
    return (
        <div className="flex-1 p-4 text-center text-gray-500 flex flex-col items-center justify-center min-h-[400px]">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">{title}</h3>
            <div>No product fulfillment data to display.</div>
        </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ height: 400 }}>
      <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white text-center">{title}</h3>
      <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--recharts-grid-stroke)" />
            <XAxis type="number" stroke="var(--recharts-text-color)" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              stroke="var(--recharts-text-color)"
              tick={{ fontSize: 12, fill: 'var(--recharts-text-color)' }}
              interval={0}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--recharts-tooltip-bg)',
                border: '1px solid var(--recharts-tooltip-border)'
              }}
              labelStyle={{ color: 'var(--recharts-tooltip-label-color)' }}
            />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Bar dataKey="count" name="Fulfillment Count" fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default FulfillChart;
