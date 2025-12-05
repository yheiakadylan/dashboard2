import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TopProduct } from '../api/_lib/types';

interface TopProductsChartProps {
  data: { [shopName: string]: TopProduct[] };
}

// Custom Tick Component for Y-Axis
const CustomYAxisTick = ({ x, y, payload, data }: any) => {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Find product info for image
  const product = data?.find((p: TopProduct) => p.name === payload.value);
  const image = product?.image;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(payload.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <g 
      transform={`translate(${x},${y})`}
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      <foreignObject x={-260} y={-14} width={255} height={28}>
        <div 
          className="flex items-center justify-end h-full pr-2 cursor-pointer group relative"
          onClick={handleCopy}
        >
          {/* Image Preview Tooltip */}
          {showPreview && image && (
            <div  className="absolute right-0 bottom-full mb-1 z-50 p-1 bg-white dark:bg-gray-800 rounded shadow-lg border border-gray-200 dark:border-gray-600 animate-in fade-in zoom-in duration-200" style={{ width: '200px', height: '200px' }} >
                <img 
                    src={image} 
                    alt="Preview" 
                    className="w-full h-full object-contain rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
            </div>
          )}

          {/* Product Name with Truncation */}
          <div className="min-w-0 flex-1 text-right">
            <p 
              className={`text-xs truncate leading-tight transition-colors ${
                copied 
                  ? 'text-green-600 dark:text-green-400 font-medium' 
                  : 'text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'
              }`}
              title={payload.value} // Default tooltip
            >
              {payload.value}
            </p>
          </div>
        </div>
      </foreignObject>
    </g>
  );
};

const TopProductsChart: React.FC<TopProductsChartProps> = ({ data }) => {
  const shopNames = Object.keys(data).sort();
  const [selectedShop, setSelectedShop] = useState<string>(shopNames.length > 0 ? shopNames[0] : '');
  const [limit, setLimit] = useState<number>(10);

  // Update selected shop if data changes
  useEffect(() => {
    if (shopNames.length > 0 && (!selectedShop || !data[selectedShop])) {
        setSelectedShop(shopNames[0]);
    }
  }, [data, shopNames, selectedShop]);

  if (shopNames.length === 0) {
    return null;
  }

  const fullChartData = data[selectedShop] || [];
  // Slice data based on user limit
  const chartData = fullChartData.slice(0, limit);

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 h-[600px] flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            Top Products
            <span className="text-xs font-normal text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                {chartData.length} items
            </span>
        </h3>
        
        <div className="flex gap-2 w-full sm:w-auto">
            {/* Limit Selector */}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2" >
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
            </select>

            {/* Shop Selector */}
            <select
              value={selectedShop}
              onChange={(e) => setSelectedShop(e.target.value)}
              className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 flex-grow sm:flex-grow-0 min-w-[150px]"
            >
              {shopNames.map((shop) => (
                <option key={shop} value={shop}>
                  {shop}
                </option>
              ))}
            </select>
        </div>
      </div>

      <div className="flex-grow min-h-0">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
              barCategoryGap={limit > 20 ? 2 : 4} // Adjust gap for dense lists
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--recharts-grid-stroke)" />
              <XAxis type="number" stroke="var(--recharts-text-color)" />
              <YAxis 
                type="category" 
                dataKey="name" 
                width={260} 
                tick={<CustomYAxisTick data={chartData} />} // Pass data for image lookup
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
              <Bar 
                dataKey="quantity" 
                name="Quantity Sold" 
                fill="#8884d8" 
                radius={[0, 4, 4, 0]} 
                barSize={limit > 20 ? undefined : 24} // Auto-size bars if list is long
              />
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