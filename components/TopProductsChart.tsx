
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TopProduct } from '../api/_lib/types';

interface TopProductsChartProps {
  data: { [shopName: string]: TopProduct[] };
}

// Custom Tick Component for Y-Axis
const CustomYAxisTick = ({ x, y, payload }: any) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent chart click events
    navigator.clipboard.writeText(payload.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <foreignObject x={x - 260} y={y - 14} width={255} height={28}>
      <div 
        className="flex items-center justify-end h-full pr-2 cursor-pointer group"
        onClick={handleCopy}
        title="Click to copy full name"
      >
        {/* Product Name with Truncation */}
        <div className="min-w-0 flex-1 text-right">
          <p 
            className={`text-xs truncate leading-tight transition-colors ${
              copied 
                ? 'text-green-600 dark:text-green-400 font-medium' 
                : 'text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'
            }`}
          >
            {payload.value}
          </p>
        </div>
      </div>
    </foreignObject>
  );
};

const TopProductsChart: React.FC<TopProductsChartProps> = ({ data }) => {
  const shopNames = Object.keys(data).sort();
  // Default to the first shop or empty string
  const [selectedShop, setSelectedShop] = useState<string>(shopNames.length > 0 ? shopNames[0] : '');

  // Update selected shop if data changes and current selection is invalid
  useEffect(() => {
    if (shopNames.length > 0 && (!selectedShop || !data[selectedShop])) {
        setSelectedShop(shopNames[0]);
    }
  }, [data, shopNames, selectedShop]);

  if (shopNames.length === 0) {
    return null; // Or a placeholder message
  }

  const chartData = data[selectedShop] || [];

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 h-[500px] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Top 10 Best Selling Products</h3>
        <select
          value={selectedShop}
          onChange={(e) => setSelectedShop(e.target.value)}
          className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
        >
          {shopNames.map((shop) => (
            <option key={shop} value={shop}>
              {shop}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-grow">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--recharts-grid-stroke)" />
              <XAxis type="number" stroke="var(--recharts-text-color)" />
              <YAxis 
                type="category" 
                dataKey="name" 
                width={260} // Increased width for better readability
                tick={<CustomYAxisTick />} // Use custom tick
                interval={0}
                stroke="var(--recharts-text-color)"
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                contentStyle={{ 
                  backgroundColor: 'var(--recharts-tooltip-bg)', 
                  border: '1px solid var(--recharts-tooltip-border)',
                  width: 'fit-content',
                  maxWidth: 'none'
                }}
                labelStyle={{ color: 'var(--recharts-tooltip-label-color)', fontWeight: 'bold' }}
              />
              <Bar dataKey="quantity" name="Quantity Sold" fill="#8884d8" radius={[0, 4, 4, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            No product data available for this shop.
          </div>
        )}
      </div>
    </div>
  );
};

export default TopProductsChart;
