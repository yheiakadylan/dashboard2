// components/FulfillChart.tsx
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { FulfillChartData } from '../../types';

interface FulfillChartProps {
  data: FulfillChartData[];
  title: string;
  fill?: string;
}

const FulfillChart: React.FC<FulfillChartProps> = ({ data, title, fill = '#82ca9d' }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex-1 p-4 text-center text-gray-500 flex flex-col items-center justify-center min-h-[400px]">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">{title}</h3>
        <div>No product fulfillment data to display.</div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-2 sm:p-4  flex flex-col min-h-[300px] sm:min-h-[400px] flex-1 animate-fade-in-up">
      <h3 className="text-sm sm:text-base font-semibold mb-2 text-gray-900 dark:text-white">{title}</h3>
      <div className="flex-1 w-full min-h-0 relative">
        <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <XAxis type="number" stroke="var(--recharts-text-color)" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={180}
                stroke="var(--recharts-text-color)"
                fontSize={10}
                tick={{ fill: 'var(--recharts-text-color)' }}
                tickFormatter={(value) => (value.length > 40 ? `${value.substring(0, 40)}...` : value)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--recharts-tooltip-bg)',
                  border: '1px solid var(--recharts-tooltip-border)',
                  fontSize: '0.75rem'
                }}
                labelStyle={{
                  color: 'var(--recharts-tooltip-label-color)',
                  fontWeight: 'bold',
                  marginBottom: '4px'
                }}
              />
              <Bar
                dataKey="count"
                name="Count"
                fill={fill}
                radius={[0, 4, 4, 0]}
                animationDuration={800}
              >
                <LabelList dataKey="count" position="right" fill="var(--recharts-text-color)" fontSize={10} offset={10} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(FulfillChart);
