import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TopProduct } from '../types';
import useMediaQuery from '../hooks/useMediaQuery';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import ImagePreviewModal from './ImagePreviewModal';

interface TopProductsChartProps {
  data: { [shopName: string]: TopProduct[] };
  hideTitle?: boolean;
}

// 1. Custom Tick: Xử lý sự kiện chuột trái (onClick)
const CustomYAxisTick = ({ x, y, payload, data, onClick }: any) => {
  // Tìm thông tin sản phẩm để lấy ảnh
  const product = data?.find((p: TopProduct) => p.name === payload.value);

  const handleClick = () => {
    if (product?.image) {
      onClick(product); // Pass the whole product object
    } else {
      alert("No image available for this product.");
    }
  };

  return (
    <g transform={`translate(${x},${y})`}>
      <foreignObject x={-260} y={-14} width={255} height={28}>
        <div
          className="flex items-center justify-end h-full pr-2 cursor-pointer group"
          onClick={handleClick}
          title="Click to view Image"
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

const TopProductsChart: React.FC<TopProductsChartProps> = ({ data, hideTitle = false }) => {
  // Add null safety check for data
  if (!data || typeof data !== 'object') {
    return null;
  }

  const shopNames = Object.keys(data).sort();
  const [selectedShop, setSelectedShop] = useState<string>(shopNames.length > 0 ? shopNames[0] : '');
  const [limit, setLimit] = useState<number>(10);
  const isMobile = useMediaQuery('(max-width: 768px)');

  // State để quản lý hiển thị ảnh phóng to - now stores the whole product
  const [previewProduct, setPreviewProduct] = useState<TopProduct | null>(null);

  useEffect(() => {
    if (shopNames.length > 0 && (!selectedShop || !data[selectedShop])) {
      setSelectedShop(shopNames[0]);
    }
  }, [data, shopNames, selectedShop]);

  const handleExportXLSX = () => {
    if (!data) {
      alert("No data available to export.");
      return;
    }

    const wb = XLSX.utils.book_new(); // Create a new workbook

    Object.entries(data).forEach(([shopName, products]) => {
      if (!Array.isArray(products) || products.length === 0) return; // Skip empty sheets

      const headers = ["Product Name", "Quantity", "Revenue", "Image Link"];
      // Prepare data for json_to_sheet
      const sheetData = products.map(item => ({
        "Product Name": item.name || '',
        "Quantity": item.quantity,
        "Revenue": item.revenue,
        "Image Link": item.image || ''
      }));

      const ws = XLSX.utils.json_to_sheet(sheetData, { header: headers });

      // Sanitize shop name for sheet name (max 31 chars, no special chars)
      const safeShopName = shopName.replace(/[\\/*?\[\]:]/g, "").substring(0, 31);

      XLSX.utils.book_append_sheet(wb, ws, safeShopName);
    });

    if (wb.SheetNames.length === 0) {
      alert("No products found in any shop to export.");
      return;
    }

    // Write the workbook and trigger download
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8',
    });
    saveAs(blob, `All_Products_By_Shop_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (shopNames.length === 0) {
    return null;
  }

  const fullChartData = data[selectedShop] || [];
  // Slice data chỉ để hiển thị trên Chart, không ảnh hưởng Export
  const chartData = fullChartData.slice(0, limit);

  // Check if ANY shop has data
  const hasAnyData = Object.values(data).some(shopData => shopData.length > 0);

  // Return null only if NO shop has any data
  if (!hasAnyData) {
    return null;
  }

  const handleBarClick = (data: TopProduct) => {
    if (data.image) {
      setPreviewProduct(data);
    }
  };

  // Calculate dynamic height based on number of items
  // Min 300px, 50px per item + 150px buffer for header/axis
  const dynamicHeight = chartData.length === 0 ? 200 : Math.max(300, chartData.length * 50 + 150);

  return (
    <div className="bg-white dark:bg-gray-800 p-2 md:p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex flex-col relative animate-fade-in-up" style={{ height: `${dynamicHeight}px` }}>

      {/* --- HEADER --- */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 md:mb-4 gap-2 md:gap-3">
        {!hideTitle && (
          <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            Top Products
            <span className="text-xs font-normal text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
              Showing {chartData.length} of {fullChartData.length}
            </span>
          </h3>
        )}

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {/* Export Button */}
          <button
            onClick={handleExportXLSX}
            className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            title="Export all shops to Excel (.xlsx)"
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
              margin={{ top: 5, right: 5, left: 10, bottom: 5 }}
              barCategoryGap={limit > 20 ? 2 : 4}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--recharts-grid-stroke)" />
              <XAxis type="number" stroke="var(--recharts-text-color)" />
              <YAxis
                type="category"
                dataKey="name"
                width={isMobile ? 0 : 260}
                tick={isMobile ? false : <CustomYAxisTick data={chartData} onClick={setPreviewProduct} />}
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
                onClick={handleBarClick}
                style={{ cursor: 'pointer' }}
                animationDuration={800}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-sm font-medium">No products for {selectedShop}</p>
              <p className="text-xs mt-1">Try selecting another shop from the dropdown above</p>
            </div>
          </div>
        )}
      </div>

      {/* --- IMAGE PREVIEW MODAL (OVERLAY) --- */}
      <ImagePreviewModal
        imageUrl={previewProduct?.image || null}
        productName={previewProduct?.name}
        onClose={() => setPreviewProduct(null)}
      />
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(TopProductsChart);
