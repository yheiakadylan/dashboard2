import React, { useState, useEffect, useMemo } from 'react';
import { useDashboardAccess } from '../../contexts/DashboardContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { TopProduct } from '../../types';
import useMediaQuery from '../../hooks/useMediaQuery';
import ImagePreviewModal from '../modals/ImagePreviewModal';
import { useUISettings } from '../../contexts/UIContext';

interface TopProductsChartProps {
  data: { [shopName: string]: TopProduct[] };
  title?: string;
  hideTitle?: boolean;
  onItemClick?: (item: TopProduct) => void;
  detailedData?: { [name: string]: TopProduct[] };
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

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 shadow-xl rounded-lg z-50 min-w-[200px]">
        <p className="font-bold text-gray-900 dark:text-white mb-1 border-b pb-1 border-gray-100 dark:border-gray-700">{data.name}</p>
        


        <div className="space-y-1">
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs text-gray-500 dark:text-gray-400">Sold:</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">{data.quantity} units</span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs text-gray-500 dark:text-gray-400">Revenue:</span>
            <span className="text-sm font-bold text-green-600 dark:text-green-400">{data.formattedRevenue}</span>
          </div>
          {data.percentage && (
            <div className="flex justify-between items-center gap-4">
              <span className="text-xs text-gray-500 dark:text-gray-400">Rate:</span>
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{data.percentage}%</span>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
};

const normalizeProductNameGroup = (name?: string) => (
  name || ''
).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const sortTopProductsByNameGroup = (products: TopProduct[]) => {
  const groupQuantity = new Map<string, number>();

  products.forEach(product => {
    const nameKey = normalizeProductNameGroup(product.name);
    groupQuantity.set(nameKey, (groupQuantity.get(nameKey) || 0) + product.quantity);
  });

  return products.sort((a, b) => {
    const aNameKey = normalizeProductNameGroup(a.name);
    const bNameKey = normalizeProductNameGroup(b.name);
    const groupDiff = (groupQuantity.get(bNameKey) || 0) - (groupQuantity.get(aNameKey) || 0);
    if (groupDiff !== 0) return groupDiff;

    const nameDiff = aNameKey.localeCompare(bNameKey);
    if (nameDiff !== 0) return nameDiff;

    const quantityDiff = b.quantity - a.quantity;
    if (quantityDiff !== 0) return quantityDiff;

    const revenueDiff = (b.revenue || 0) - (a.revenue || 0);
    if (revenueDiff !== 0) return revenueDiff;

    return (a.sku || '').localeCompare(b.sku || '');
  });
};

const sortTopProductsForRanking = (products: TopProduct[]) => {
  return [...products].sort((a, b) => {
    const quantityDiff = b.quantity - a.quantity;
    if (quantityDiff !== 0) return quantityDiff;

    const revenueDiff = (b.revenue || 0) - (a.revenue || 0);
    if (revenueDiff !== 0) return revenueDiff;

    return normalizeProductNameGroup(a.name).localeCompare(normalizeProductNameGroup(b.name));
  });
};

const TopProductsChart: React.FC<TopProductsChartProps> = ({ data, title = "Top Products", hideTitle = false, onItemClick, detailedData }) => {
  const { role, permissions } = useDashboardAccess();
  const { globalUsdMode } = useUISettings();
  const validData = data && typeof data === 'object' ? data : {};
  const isCategoryChart = title.toLowerCase().includes('category');
  const isVariantChart = title.toLowerCase().includes('variant') || title.toLowerCase().includes('size');
  const allShopsData = useMemo(() => {
    const combined: { [productKey: string]: TopProduct } = {};
    Object.values(validData).flat().forEach(product => {
      const productKey = isCategoryChart ? normalizeProductNameGroup(product.name) : (product.sku || product.name);
      if (!combined[productKey]) {
        combined[productKey] = { ...product };
      } else {
        combined[productKey].quantity += product.quantity;
        combined[productKey].revenue += (product.revenue || 0);
        combined[productKey].revenueUSD += (product.revenueUSD || 0);
        if (product.shop && !String(combined[productKey].shop || '').split(', ').includes(product.shop)) {
          combined[productKey].shop = combined[productKey].shop ? `${combined[productKey].shop}, ${product.shop}` : product.shop;
        }
      }
    });
    return sortTopProductsByNameGroup(Object.values(combined));
  }, [validData, isCategoryChart]);

  const allLabel = isCategoryChart ? 'All Categories' : (isVariantChart ? 'All Variants' : 'All Shops');
  const shopNames = [allLabel, ...Object.keys(validData).sort()];

  const [selectedShop, setSelectedShop] = useState<string>(allLabel);
  const [limit, setLimit] = useState<number>(10);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [previewProduct, setPreviewProduct] = useState<TopProduct | null>(null);
  const [viewMode, setViewMode] = useState<'chart' | 'grid'>('chart');

  useEffect(() => {
    if (shopNames.length > 0 && (!selectedShop || (!validData[selectedShop] && selectedShop !== allLabel))) {
      setSelectedShop(allLabel);
    }
  }, [validData, shopNames, selectedShop, allLabel]);

  // Helper to format currency based on current mode
  const displayRevenue = (item: TopProduct) => {
    const value = globalUsdMode ? (item.revenueUSD || 0) : (item.revenue || 0);
    const currency = globalUsdMode ? 'USD' : (item.currency || 'USD');
    
    return `${new Intl.NumberFormat('en-US', { 
        style: 'currency', 
        currency: 'USD',
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    }).format(value).replace('$', '$ ')} ${currency}`;
  };

  const handleExportXLSX = async () => {
    if (!data) {
      alert("No data available to export.");
      return;
    }

    const { exportTopProductsToExcel } = await import('../../utils/excelExport');
    const filename = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    
    // If detailedData is provided (like for Categories), use it for the sheets
    // but keep allShopsData (summary of current view) as the first sheet
    const summaryTitle = isCategoryChart ? 'Category Summary' : (isVariantChart ? 'Variant Summary' : 'Product Summary');
    
    // Map data to include currency/conversion for export
    const convertData = (items: TopProduct[]) => items.map(p => ({
        ...p,
        revenue: globalUsdMode ? (p.revenueUSD || p.revenue) : p.revenue,
        currency: globalUsdMode ? 'USD' : (p.currency || 'USD')
    }));

    const finalSummaryData = convertData(allShopsData);
    const sourceData = detailedData || validData;
    const finalSheetData: { [key: string]: any[] } = {};
    
    Object.entries(sourceData).forEach(([key, items]) => {
        finalSheetData[key] = convertData(items);
    });
    
    await exportTopProductsToExcel(finalSummaryData, finalSheetData, filename, summaryTitle);
  };

  // Determine current dataset
  const fullChartData = useMemo(
    () => sortTopProductsForRanking(selectedShop === allLabel ? allShopsData : (validData[selectedShop] || [])),
    [selectedShop, allLabel, allShopsData, validData]
  );
  
  // Calculate total quantity for percentage
  const totalQuantity = useMemo(() => fullChartData.reduce((sum, item) => sum + item.quantity, 0), [fullChartData]);

  // Prepare chart data with percentages
  const chartData = useMemo(() => {
    return fullChartData.slice(0, limit).map(item => ({
      ...item,
      percentage: totalQuantity > 0 ? ((item.quantity / totalQuantity) * 100).toFixed(1) : '0',
      formattedRevenue: displayRevenue(item)
    }));
  }, [fullChartData, limit, totalQuantity, globalUsdMode]);

  // Check if ANY shop/item has data
  const hasAnyData = Object.values(validData).some(items => items.length > 0) || allShopsData.length > 0;

  // Return null only if NO data
  if (!hasAnyData) {
    return null;
  }

  const handleBarClick = (data: TopProduct) => {
    if (onItemClick) {
      onItemClick(data);
      return;
    }
    if (data.image) {
      setPreviewProduct(data);
    }
  };

  // Calculate dynamic height based on number of items (Chart Mode)
  const chartHeight = chartData.length === 0 ? 200 : Math.max(300, chartData.length * 50 + 150);

  // Podium Component Helper
  const PodiumItem = ({ item, rank, className }: { item: TopProduct, rank: number, className?: string }) => (
    <div
      className={`flex flex-col items-center cursor-pointer group relative ${className}`}
      onClick={() => handleBarClick(item)}
    >
      {/* Crown/Rank Indicator */}
      <div className="mb-2 flex flex-col items-center z-10">
        {rank === 1 && <span className="text-3xl animate-bounce">👑</span>}
        {rank === 2 && <span className="text-2xl text-gray-400 font-bold">#2</span>}
        {rank === 3 && <span className="text-2xl text-amber-700 font-bold">#3</span>}
      </div>

      {/* Image Container with Glow */}
      <div className={`
                relative rounded-xl overflow-hidden shadow-lg border-4 transition-transform duration-300 group-hover:scale-105
                ${rank === 1 ? 'w-32 h-32 md:w-56 md:h-56 border-yellow-400 ring-4 ring-yellow-400/30' : ''}
                ${rank === 2 ? 'w-24 h-24 md:w-40 md:h-40 border-gray-300' : ''}
                ${rank === 3 ? 'w-24 h-24 md:w-40 md:h-40 border-amber-600' : ''}
          `}>
        {item.image ? (
          <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400">No Img</div>
        )}
        {/* Shine Effect */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
      </div>

      {/* Podium Base (Decorative) */}
      <div className={`
               mt-[-10px] w-full flex flex-col items-center justify-start pt-4 rounded-t-lg
               ${rank === 1 ? 'h-40 bg-gradient-to-b from-yellow-100 to-yellow-50 dark:from-yellow-900/40 dark:to-transparent' : ''}
               ${rank === 2 ? 'h-32 bg-gradient-to-b from-gray-100 to-gray-50 dark:from-gray-800 dark:to-transparent' : ''}
               ${rank === 3 ? 'h-28 bg-gradient-to-b from-amber-100 to-amber-50 dark:from-amber-900/40 dark:to-transparent' : ''}
          `}>
        <h4 className="text-xs md:text-sm font-bold text-center px-2 line-clamp-2 text-gray-800 dark:text-gray-100 max-w-[120px]">
          {item.name}
        </h4>
        <div className="flex flex-col items-center mt-1">
            <span className="text-sm md:text-base font-black text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                {item.quantity} sold
                {(item as any).percentage && <span className="text-[10px] opacity-60 font-bold">({(item as any).percentage}%)</span>}
            </span>
            <span className="text-[10px] md:text-xs font-semibold text-green-600 dark:text-green-400">
                {displayRevenue(item)}
            </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-800 p-2 md:p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex flex-col relative animate-fade-in-up transition-all duration-300 hover:z-50">

      {/* --- HEADER --- */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 gap-4">
        {!hideTitle && (
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              {title}
              <span className="text-xs font-normal text-gray-500 bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 rounded-full border border-gray-200 dark:border-gray-600">
                {allShopsData.length} {isCategoryChart ? (allShopsData.length === 1 ? 'category' : 'categories') : (isVariantChart ? (allShopsData.length === 1 ? 'variant' : 'variants') : (allShopsData.length === 1 ? 'product' : 'products'))}
              </span>
            </h3>

            <div className="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
              <button onClick={() => setViewMode('chart')} className={`p-1.5 rounded-md transition-all ${viewMode === 'chart' ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`} title="Chart View">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              </button>
              <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`} title="Grid View">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 w-full xl:w-auto items-center">
          {shopNames.length > 2 && (
            <select
              value={selectedShop}
              onChange={(e) => setSelectedShop(e.target.value)}
              className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 min-w-[140px]"
            >
              {shopNames.map(shop => <option key={shop} value={shop}>{shop}</option>)}
            </select>
          )}
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2" >
            {[10, 20, 50, 100, 200, 500].map(v => <option key={v} value={v}>Top {v}</option>)}
          </select>
          {(role === 'owner' || permissions.canExportData) && (
            <button
              onClick={handleExportXLSX}
              className="flex items-center justify-center p-2 bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40 dark:text-green-400 rounded-lg transition-colors border border-green-200 dark:border-green-800"
              title="Export Excel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* --- BODY --- */}
      <div className="flex-grow min-h-0 relative">
        {chartData.length > 0 ? (
          viewMode === 'chart' ? (
            <div style={{ height: `${chartHeight}px` }}> {/* Fixed height container for chart */}
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={chartData}
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                  barCategoryGap={limit > 20 ? 2 : 4}
                >
                  <defs>
                    <linearGradient id="colorGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--recharts-grid-stroke)" opacity={0.5} />
                  <XAxis type="number" stroke="var(--recharts-text-color)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={isMobile ? 0 : 220}
                    tick={isMobile ? false : <CustomYAxisTick data={chartData} onClick={handleBarClick} />}
                    interval={0}
                    stroke="var(--recharts-text-color)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                    content={<CustomTooltip isCategoryChart={isCategoryChart} isVariantChart={isVariantChart} />}
                  />
                    <Bar
                      dataKey="quantity"
                      name="Quantity Sold"
                      fill="url(#colorGradient)"
                      radius={[0, 4, 4, 0]}
                      barSize={limit > 20 ? undefined : 20}
                      onClick={handleBarClick}
                      style={{ cursor: 'pointer' }}
                      animationDuration={1000}
                    >
                      <LabelList 
                        dataKey="percentage" 
                        position="right" 
                        formatter={(v: string) => `${v}%`} 
                        style={{ fontSize: '10px', fill: 'var(--recharts-text-color)', fontWeight: '600' }}
                      />
                    </Bar>
                    {/* Ghost bar for tooltip to handle revenue */}
                    <Bar dataKey="revenue" name="Revenue" hide />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col gap-8 pb-4">
              {/* PODIUM VIEW (Top 3) */}
              {chartData.length >= 3 && (
                <div className="flex justify-center items-end gap-2 md:gap-8 pb-4 border-b border-dashed border-gray-200 dark:border-gray-700 min-h-[380px]">
                  {/* Rank 2 */}
                  <PodiumItem item={chartData[1]} rank={2} className="order-1" />
                  {/* Rank 1 (Bigger now) */}
                  <PodiumItem item={chartData[0]} rank={1} className="order-2 mb-8" />
                  {/* Rank 3 */}
                  <PodiumItem item={chartData[2]} rank={3} className="order-3" />
                </div>
              )}
              {chartData.length < 3 && chartData.length > 0 && ( /* Fallback if fewer than 3 items */
                <div className="flex justify-center gap-4">
                  {chartData.map((item, idx) => <PodiumItem key={idx} item={item} rank={idx + 1} />)}
                </div>
              )}

              {/* REST OF THE GRID (Rank 4+) */}
              {chartData.length > 3 && (
                <div className="flex flex-wrap justify-center gap-4">
                  {chartData.slice(3).map((item, idx) => {
                    const actualRank = idx + 4;
                    return (
                      <div
                        key={actualRank}
                        className="w-[160px] md:w-[180px] bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700 flex flex-col items-center group hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer relative overflow-hidden"
                        onClick={() => handleBarClick(item)}
                      >
                        {/* Rank Badge - Floating */}
                        <div className="absolute top-2 left-2 z-10">
                          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] font-bold text-gray-500 dark:text-gray-300 shadow-sm border border-gray-200 dark:border-gray-600">
                            #{actualRank}
                          </span>
                        </div>

                        {/* Image Container */}
                        <div className="w-full aspect-square rounded-lg bg-gray-50 dark:bg-gray-900 mb-3 overflow-hidden relative border border-gray-100 dark:border-gray-700">
                           {item.image ? (
                            <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300"><svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>
                          )}
                          {/* Hover Overlay */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300"></div>
                        </div>

                        {/* Info */}
                        <div className="text-center w-full mt-auto">
                          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200 line-clamp-2 leading-tight mb-1 min-h-[2.5em] group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" title={item.name}>
                            {item.name}
                          </h4>
                          <div className="flex flex-col items-center gap-1 mt-1">
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] md:text-xs font-bold w-fit">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                                </svg>
                                {item.quantity} sold {(item as any).percentage && <span className="opacity-70">({(item as any).percentage}%)</span>}
                            </div>
                            <span className="text-[10px] md:text-[11px] font-bold text-green-600 dark:text-green-400">
                                {displayRevenue(item)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="h-64 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-sm font-medium">No products for this period</p>
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
