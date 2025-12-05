import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TopProduct } from '../api/_lib/types';

interface TopProductsChartProps {
  data: { [shopName: string]: TopProduct[] };
}

// 1. Custom Tick: Xử lý sự kiện chuột phải (onContextMenu)
const CustomYAxisTick = ({ x, y, payload, data, onContextMenu }: any) => {
  // Tìm thông tin sản phẩm để lấy ảnh
  const product = data?.find((p: TopProduct) => p.name === payload.value);
  const image = product?.image;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Ngăn menu chuột phải của trình duyệt hiện ra
    e.stopPropagation();
    if (image) {
        onContextMenu(image);
    } else {
        alert("No image available for this product.");
    }
  };

  return (
    <g transform={`translate(${x},${y})`}>
      <foreignObject x={-260} y={-14} width={255} height={28}>
        <div 
          className="flex items-center justify-end h-full pr-2 cursor-context-menu group"
          onContextMenu={handleContextMenu}
          title="Right-click to view Image"
        >
          {/* Tên sản phẩm */}
          <div className="min-w-0 flex-1 text-right">
            <p 
              className="text-xs truncate leading-tight text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
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
  
  // State để quản lý hiển thị ảnh phóng to
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    if (shopNames.length > 0 && (!selectedShop || !data[selectedShop])) {
        setSelectedShop(shopNames[0]);
    }
  }, [data, shopNames, selectedShop]);

  // Hàm xử lý Export CSV riêng cho Top Products (XUẤT HẾT, KHÔNG CẮT BỞI LIMIT)
  const handleExportCSV = () => {
    if (!selectedShop || !data[selectedShop]) return;

    // Lấy TOÀN BỘ dữ liệu của shop đó (không .slice theo limit)
    const exportData = data[selectedShop]; 

    const csvHeaders = ["Product Name", "Quantity", "Revenue", "Image Link"];
    
    const csvRows = exportData.map(item => {
        // Escape dấu phẩy hoặc ngoặc kép trong tên
        const safeName = `"${(item.name || '').replace(/"/g, '""')}"`;
        const imageLink = item.image || '';
        
        return [
            safeName,
            item.quantity,
            item.revenue.toFixed(2),
            imageLink
        ].join(',');
    });

    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `All_Products_${selectedShop.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (shopNames.length === 0) {
    return null;
  }

  const fullChartData = data[selectedShop] || [];
  // Slice data chỉ để hiển thị trên Chart, không ảnh hưởng Export
  const chartData = fullChartData.slice(0, limit);

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 h-[600px] flex flex-col relative">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            Top Products
            <span className="text-xs font-normal text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                Showing {chartData.length} of {fullChartData.length}
            </span>
        </h3>
        
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            {/* Export Button */}
            <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                title="Export FULL list to CSV"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
            </button>

            {/* Limit Selector - Thêm tùy chọn cao hơn */}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2" >
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
              <option value={200}>Top 200</option>
              <option value={500}>Top 500</option>
            </select>

            {/* Shop Selector */}
            <select
              value={selectedShop}
              onChange={(e) => setSelectedShop(e.target.value)}
              className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 min-w-[120px]"
            >
              {shopNames.map((shop) => (
                <option key={shop} value={shop}>
                  {shop}
                </option>
              ))}
            </select>
        </div>
      </div>

      {/* --- CHART BODY --- */}
      <div className="flex-grow min-h-0">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
              barCategoryGap={limit > 20 ? 2 : 4}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--recharts-grid-stroke)" />
              <XAxis type="number" stroke="var(--recharts-text-color)" />
              <YAxis 
                type="category" 
                dataKey="name" 
                width={260} 
                tick={<CustomYAxisTick data={chartData} onContextMenu={setPreviewImage} />} 
                interval={0}
                stroke="var(--recharts-text-color)"
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                contentStyle={{ 
                  backgroundColor: 'var(--recharts-tooltip-bg)', 
                  border: '1px solid var(--recharts-tooltip-border)',
                  color: 'var(--recharts-text-color)'
                }}
              />
              <Bar 
                dataKey="quantity" 
                name="Quantity Sold" 
                fill="#8884d8" 
                radius={[0, 4, 4, 0]} 
                barSize={limit > 20 ? undefined : 24} 
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            No product data available for this shop.
          </div>
        )}
      </div>

      {/* --- IMAGE PREVIEW MODAL (OVERLAY) --- */}
      {previewImage && (
        <div 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 cursor-pointer"
            onClick={() => setPreviewImage(null)}
            title="Click anywhere to close"
        >
            <div className="relative max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 p-2 rounded-lg shadow-2xl">
                <img 
                    src={previewImage} 
                    alt="Product Mockup" 
                    className="max-w-full max-h-[85vh] object-contain rounded"
                />
                <div className="absolute top-0 right-0 -mt-3 -mr-3">
                    <button className="bg-red-500 text-white rounded-full p-1 hover:bg-red-600 shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="text-center mt-2 text-white font-medium text-sm drop-shadow-md">
                    High Quality Mockup Preview
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default TopProductsChart;