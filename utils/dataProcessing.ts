import { Record, ProcessedData, KpiData, KpiValue, TableData, Account, OverviewChartData, SummaryChartData, FulfillChartData, TopProduct } from '../api/_lib/types';

const formatCurrency = (value: number, currency: string = 'USD'): string => {
  // Per user request to simplify KPI card display, always use a '$' symbol
  // as the currency code (e.g., AUD) is displayed separately.
  return '$' + new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatDate = (dateStr: string, timeZone: string): string => {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return new Intl.DateTimeFormat('en-CA', { // 'en-CA' gives YYYY-MM-DD
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch (e) {
    return 'Invalid Date';
  }
};

const formatHour = (dateStr: string, timeZone: string): string => {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Invalid Hour';
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false
    }).format(date);
    // Handle midnight case which might be formatted as "24"
    return `${hour === '24' ? '00' : hour}:00`;
  } catch (e) {
    return 'Invalid Hour';
  }
};

const formatDateTime = (dateStr: string, timeZone: string): string => {
    try {
        const date = new Date(dateStr);
        if(isNaN(date.getTime())) return 'Invalid Date';
        return new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).format(date).replace(',', '');
    } catch (e) {
        return 'Invalid Date';
    }
}

export const processData = (
  records: Record[], 
  previousRecords: Record[] | null, 
  accounts: Account[],
  filterDateRange: { from: string, to: string },
  timeZone: string,
  role: string,
  permissions: { [key: string]: boolean },
  manualCosts: any[]
): ProcessedData => {
  const accountLabelMap = new Map(accounts.map(acc => [acc.email, acc.label || acc.email]));

  // --- DEDUPLICATION LOGIC ---
  // Filter out duplicates based on order_id and dt_local
  const uniqueRecordsMap = new Map<string, Record>();
  records.forEach(r => {
    // If it's an order with an ID
    if (r.kind === 'order' && r.order_id) {
        const key = `${r.order_id}_${r.dt_local}`;
        
        if (!uniqueRecordsMap.has(key)) {
            uniqueRecordsMap.set(key, r);
        } else {
            // Duplicate found. Keep the one with more info (e.g. details) if possible
            const existing = uniqueRecordsMap.get(key)!;
            // Prefer the one with details if the existing one doesn't have them
            if (!existing.details && r.details) {
                uniqueRecordsMap.set(key, r);
            }
            // If both have details or neither, the first one (existing) stays.
        }
    } else {
        // For non-orders (Funds, Help, Case) or orders without ID (N/A), keep them.
        // Use record ID as key to ensure uniqueness in map, or a random string if ID missing
        uniqueRecordsMap.set(r.id || Math.random().toString(36), r);
    }
  });
  
  const uniqueRecords = Array.from(uniqueRecordsMap.values());
  // ---------------------------

  const overviewData = calculateOverview(uniqueRecords, filterDateRange, timeZone, role, permissions);
  const orders = getOrderList(uniqueRecords, accountLabelMap, timeZone);
  const ebay = getPlatformRecords(uniqueRecords, 'Ebay_Sales', accountLabelMap, timeZone);
  const etsy = getPlatformRecords(uniqueRecords, 'Etsy_Sales', accountLabelMap, timeZone);
  const cases = getSupportRecords(uniqueRecords, 'case', accountLabelMap, timeZone);
  const help = getSupportRecords(uniqueRecords, 'help', accountLabelMap, timeZone);
  const fulfill = (role === 'owner' || permissions.viewFulfill)
    ? getFulfillRecords(uniqueRecords, accountLabelMap, timeZone, manualCosts, filterDateRange)
    : { table: { headers: ['Fulfill'], rows: [["Permission Denied"]] }, merchizeChartData: [], printwayChartData: [] };

  const { kpis, table: summaryTable, chartData: summaryChartData, topProductsByShop } = (role === 'owner' || permissions.viewSummary)
    ? calculateSummary(uniqueRecords, previousRecords, accountLabelMap, role, permissions, manualCosts, filterDateRange)
    : { kpis: {}, table: { headers: ['Summary'], rows: [["Permission Denied"]] }, chartData: [], topProductsByShop: {} };

  return { 
      overview: overviewData, 
      orders, 
      ebay, 
      etsy, 
      cases, 
      help, 
      fulfill, 
      summary: { kpis, table: summaryTable, chartData: summaryChartData, topProductsByShop }
  };
};

const calculateOverview = (
  records: Record[], 
  filterDateRange: { from: string, to: string },
  timeZone: string,
  role: string,
  permissions: { [key: string]: boolean }
): { table: TableData, chartData: OverviewChartData[] } => {

    const fromDate = new Date(filterDateRange.from);
    const toDate = new Date(filterDateRange.to);
    const diffTime = Math.abs(toDate.getTime() - fromDate.getTime()) + 1000;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isHourlyViewForChart = diffDays <= 2;
    const getChartGroupingKey = (dateStr: string): string => {
        return isHourlyViewForChart ? formatHour(dateStr, timeZone) : formatDate(dateStr, timeZone);
    };

    const dailyDataForTable: { 
        [date: string]: { 
            orders: Set<string>, 
            revenue: { [currency: string]: number }, 
            funds: { [currency: string]: number }, 
            cost: { [currency: string]: number } 
        } 
    } = {};

    const groupedDataForChart: {
        [key: string]: {
            orders: Set<string>,
            revenue: { [currency: string]: number }, 
        }
    } = {};

    const allCurrenciesForTable = { revenue: new Set<string>(), funds: new Set<string>(), cost: new Set<string>() };
    const allCurrenciesForChart = new Set<string>();

    records.forEach(r => {
        const currency = r.currency || 'USD';
        const dailyGroupKey = formatDate(r.dt_local, timeZone);
        if (!dailyDataForTable[dailyGroupKey]) {
            dailyDataForTable[dailyGroupKey] = { orders: new Set(), revenue: {}, funds: {}, cost: {} };
        }
        if (r.kind === 'order' && r.order_id) {
            dailyDataForTable[dailyGroupKey].orders.add(r.order_id);
            if (r.amount > 0) {
                dailyDataForTable[dailyGroupKey].revenue[currency] = (dailyDataForTable[dailyGroupKey].revenue[currency] || 0) + r.amount;
                allCurrenciesForTable.revenue.add(currency);
            }
            if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewFulfill)) {
                dailyDataForTable[dailyGroupKey].cost['USD'] = (dailyDataForTable[dailyGroupKey].cost['USD'] || 0) + r.cost_total;
                allCurrenciesForTable.cost.add('USD');
            }
        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewFunds)) {
            dailyDataForTable[dailyGroupKey].funds[currency] = (dailyDataForTable[dailyGroupKey].funds[currency] || 0) + r.amount;
            allCurrenciesForTable.funds.add(currency);
        }

        const chartGroupKey = getChartGroupingKey(r.dt_local);
        if (!groupedDataForChart[chartGroupKey]) {
            groupedDataForChart[chartGroupKey] = { orders: new Set(), revenue: {} };
        }
        if (r.kind === 'order' && r.order_id && r.amount > 0) {
            groupedDataForChart[chartGroupKey].orders.add(r.order_id);
            groupedDataForChart[chartGroupKey].revenue[currency] = (groupedDataForChart[chartGroupKey].revenue[currency] || 0) + r.amount;
            allCurrenciesForChart.add(currency);
        }
    });
    
    const sortedRevenueCurrencies = Array.from(allCurrenciesForTable.revenue).sort();
    const sortedFundsCurrencies = Array.from(allCurrenciesForTable.funds).sort();
    const sortedCostCurrencies = Array.from(allCurrenciesForTable.cost).sort();

    const revenueHeaders = sortedRevenueCurrencies.map(c => `Revenue (${c})`);
    const fundsHeaders = (role === 'owner' || permissions.viewFunds) ? sortedFundsCurrencies.map(c => `Funds (${c})`) : [];
    const costHeaders = (role === 'owner' || permissions.viewFulfill) ? sortedCostCurrencies.map(c => `Cost (${c})`) : [];

    const headers = [
        "Date", 
        "Order Count", 
        ...revenueHeaders,
        ...fundsHeaders,
        ...costHeaders,
        "Details"
    ];

    const tableRows = Object.entries(dailyDataForTable)
        .map(([date, data]) => {
            const revenueValues = sortedRevenueCurrencies.map(c => data.revenue[c] || 0);
            const fundsValues = (role === 'owner' || permissions.viewFunds) ? sortedFundsCurrencies.map(c => data.funds[c] || 0) : [];
            const costValues = (role === 'owner' || permissions.viewFulfill) ? sortedCostCurrencies.map(c => data.cost[c] || 0) : [];

            return [
                date,
                data.orders.size,
                ...revenueValues,
                ...fundsValues,
                ...costValues,
                data.orders.size > 0 ? 'Click for detail' : ''
            ];
        })
        .sort((a, b) => new Date(b[0] as string).getTime() - new Date(a[0] as string).getTime());

    const sortedChartRevenueCurrencies = Array.from(allCurrenciesForChart).sort();
    const chartData = Object.entries(groupedDataForChart)
        .map(([groupKey, data]) => {
            const revenueData: { [key: string]: number } = {};
            for (const currency of sortedChartRevenueCurrencies) {
                revenueData[`revenue${currency}`] = data.revenue[currency] || 0;
            }
            return {
                date: groupKey,
                orderCount: data.orders.size,
                ...revenueData,
            };
        })
        .sort((a, b) => {
            if (isHourlyViewForChart) {
                return (a.date as string).localeCompare(b.date as string);
            }
            return new Date(a.date as string).getTime() - new Date(b.date as string).getTime();
        });

    return { table: { headers, rows: tableRows }, chartData };
}

const getOrderList = (records: Record[], accountLabelMap: Map<string, string>, timeZone: string): TableData => {
    const headers = ["Image", "Product Name", "Order Number", "Revenue", "Currency", "Cost", "FF Code", "Case", "Help", "Account", "DateTime", "Actions"];
    const orders = records.filter(r => r.kind === 'order');
    const cases = records.filter(r => r.kind === 'case');
    const helps = records.filter(r => r.kind === 'help');

    const caseMap = new Map(cases.map(c => [c.order_id, c.case_msg || 'Yes']));
    const helpMap = new Map(helps.map(h => [h.order_id, h.help_kind || 'Yes']));

    const sortedOrders = [...orders].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());

    const rows = sortedOrders.map(o => {
        const actions = [];
        if (o.details) {
            actions.push({ type: 'view', label: 'View', id: o.id! });
        }
        if (o.email_id) {
            actions.push({ type: 'resync', label: 'Resync', id: o.id! });
        }

        // --- New logic to get product name and image ---
        let productName = o.product_name || 'N/A';
        let productImage = null;
        let fullProductImage = null;

        if (o.details && o.details.items && o.details.items.length > 0) {
            const itemNames = o.details.items.map(i => i.name).join(', ');
            if (itemNames) {
                productName = itemNames;
            }
            // Get image of the first item
            productImage = o.details.items[0].image || null;
            
            if (productImage && productImage.includes('il_') && productImage.includes('x')) {
                fullProductImage = productImage.replace(/il_\d+x\w+/, 'il_fullxfull');
            } else {
                fullProductImage = productImage;
            }
        }
        // --- End of new logic ---

        return [
            { type: 'image', src: productImage, fullSrc: fullProductImage, alt: productName }, // New cell for image
            productName, // New cell for product name
            o.order_id || 'N/A',
            o.amount,
            o.currency || 'USD',
            o.cost_total ?? null,
            o.ff_code || '-',
            o.order_id && caseMap.has(o.order_id) ? caseMap.get(o.order_id) : 'No',
            o.order_id && helpMap.has(o.order_id) ? helpMap.get(o.order_id) : 'No',
            accountLabelMap.get(o.account) || o.account,
            formatDateTime(o.dt_local, timeZone),
            { type: 'action_group', actions } as any,
            o.dt_local, // Add raw ISO string for filtering, will not be displayed
        ];
    });

    return { headers, rows };
}

const getPlatformRecords = (records: Record[], source: 'Ebay_Sales' | 'Etsy_Sales', accountLabelMap: Map<string, string>, timeZone: string): TableData => {
    const headers = ["Image", "Product Name", "Order Number", "Revenue", "Currency", "Account", "DateTime", "Actions"];
    const platformRecords = records.filter(r => r.source === source && r.kind === 'order');

    const sortedRecords = [...platformRecords].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());
    
    const rows = sortedRecords.map(r => {
        // Create a list of actions for the Action column
        const actions = [];
        if (r.details) {
            actions.push({ type: 'view', label: 'View', id: r.id! });
        }
        
        // Show Resync if email_id exists
        if (r.email_id) {
            actions.push({ type: 'resync', label: 'Resync', id: r.id! });
        }

        // --- Logic from getOrderList ---
        let productName = r.product_name || 'N/A';
        let productImage = null;
        let fullProductImage = null;

        if (r.details && r.details.items && r.details.items.length > 0) {
            const itemNames = r.details.items.map(i => i.name).join(', ');
            if (itemNames) {
                productName = itemNames;
            }
            productImage = r.details.items[0].image || null;
            
            if (productImage && productImage.includes('il_') && productImage.includes('x')) {
                fullProductImage = productImage.replace(/il_\d+x\w+/, 'il_fullxfull');
            } else {
                fullProductImage = productImage;
            }
        }
        // --- End of logic ---

        return [
            { type: 'image', src: productImage, fullSrc: fullProductImage, alt: productName },
            productName,
            r.order_id || 'N/A',
            r.amount,
            r.currency || 'USD',
            accountLabelMap.get(r.account) || r.account,
            formatDateTime(r.dt_local, timeZone),
            { type: 'action_group', actions } as any
        ];
    });

    return { headers, rows };
}

const getSupportRecords = (records: Record[], kind: 'case' | 'help', accountLabelMap: Map<string, string>, timeZone: string): TableData => {
    const headers = kind === 'case' 
        ? ["Order Number", "Message", "Source", "Account", "DateTime"]
        : ["Order Number", "Help Kind", "Source", "Account", "DateTime"];

    const supportRecords = records.filter(r => r.kind === kind);
    const sortedRecords = [...supportRecords].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());

    const rows = sortedRecords.map(r => [
        r.order_id || 'N/A',
        kind === 'case' ? (r.case_msg || 'N/A') : (r.help_kind || 'N/A'),
        r.source,
        accountLabelMap.get(r.account) || r.account,
        formatDateTime(r.dt_local, timeZone)
    ]);
    
    return { headers, rows };
}

const getFulfillRecords = (
  records: Record[], 
  accountLabelMap: Map<string, string>, 
  timeZone: string,
  manualCosts: any[],
  filterDateRange: { from: string, to: string }
): { table: TableData; merchizeChartData: FulfillChartData[]; printwayChartData: FulfillChartData[] } => {

    const headers = ["Date", "Order Number", "Product Name", "Provider", "Fulfillment Code", "Cost (USD)", "Shop Account"];

    // 1. Xử lý Manual Costs (Chi phí nhập tay)
    const filteredManualCosts = manualCosts.filter(cost => 
        cost.date >= filterDateRange.from && cost.date <= filterDateRange.to
    );

    const manualRows = filteredManualCosts.map(cost => [
        cost.date,
        "N/A (Manual)",
        "N/A (Manual)",
        cost.providerName,
        "owner",
        cost.cost,
        "Manual Entry",
    ]);

    // 2. Xử lý Email Records (Chi phí từ API/Email)
    const fulfillRecords = records.filter(r => r.kind === 'order' && (r.ff_code || r.cost_total || r.product_name));
    
    const emailRows = fulfillRecords.map(r => {
        const ffCode = r.ff_code || '-';
        let provider = '-';

        if (ffCode.startsWith('PWN')) {
            provider = 'Printway';
        } else if (ffCode !== '-' && ffCode !== 'owner') {
            provider = 'Merchize';
        }

        return [
            formatDate(r.dt_local, timeZone),
            r.order_id || 'N/A',
            r.product_name || '-',
            provider,
            ffCode,
            r.cost_total ?? null,
            accountLabelMap.get(r.account) || r.account,
        ];
    });
    
    // 3. Calculate Chart Data
    const merchizeProductCounts = new Map<string, number>();
    const printwayProductCounts = new Map<string, number>();

    emailRows.forEach(row => {
        const productNameCell = row[2] as string; // Product Name is at index 2
        const provider = row[3] as string; // Provider is at index 3

        if (productNameCell && productNameCell !== '-' && productNameCell !== 'N/A (Manual)') {
            const products = productNameCell.split(',').map(p => p.trim());
            products.forEach(product => {
                if (product) {
                    if (provider === 'Merchize') {
                        merchizeProductCounts.set(product, (merchizeProductCounts.get(product) || 0) + 1);
                    } else if (provider === 'Printway') {
                        printwayProductCounts.set(product, (printwayProductCounts.get(product) || 0) + 1);
                    }
                }
            });
        }
    });

    const processCounts = (counts: Map<string, number>): FulfillChartData[] => {
        const sorted = Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
        // Take top 10 and reverse for chart display (highest on top)
        return sorted.slice(0, 10).reverse();
    };

    const merchizeChartData = processCounts(merchizeProductCounts);
    const printwayChartData = processCounts(printwayProductCounts);
    
    // 4. Kết hợp và Sắp xếp
    emailRows.sort((a, b) => new Date(b[0] as string).getTime() - new Date(a[0] as string).getTime());
    
    const rows = [...manualRows, ...emailRows];

    return { table: { headers, rows }, merchizeChartData, printwayChartData };
}

const calculateSummary = (
  records: Record[], 
  previousRecords: Record[] | null, 
  accountLabelMap: Map<string, string>,
  role: string,
  permissions: { [key: string]: boolean },
  manualCosts: any[],
  filterDateRange: { from: string; to: string }
): {kpis: KpiData, table: TableData, chartData: SummaryChartData[], topProductsByShop: { [shopName: string]: TopProduct[] }} => {

    const calculatePercentageChange = (current: number, previous: number): { change: number; direction: 'up' | 'down' | 'neutral' } => {
        if (previous === 0) {
            return {
                change: current > 0 ? Infinity : 0,
                direction: current > 0 ? 'up' : 'neutral',
            };
        }
        const change = ((current - previous) / previous) * 100;
        return {
            change: Math.abs(change),
            direction: change > 0 ? 'up' : (change < 0 ? 'down' : 'neutral'),
        };
    };

    type RawKpis = {
        orderIds: Set<string>;
        shops: Set<string>;
        revenueByCurrency: { [c: string]: number };
        fundsByCurrency: { [c: string]: number };
        costByCurrency: { [c: string]: number };
    };

    const getRawKpis = (recordsToProcess: Record[]): RawKpis => {
        const raw: RawKpis = {
            orderIds: new Set(),
            shops: new Set(),
            revenueByCurrency: {},
            fundsByCurrency: {},
            costByCurrency: {},
        };
        recordsToProcess.forEach(r => {
            raw.shops.add(r.account);
            const currency = r.currency || 'USD';
            if (r.kind === 'order') {
                if(r.order_id) raw.orderIds.add(r.order_id);
                if (r.amount > 0) {
                    raw.revenueByCurrency[currency] = (raw.revenueByCurrency[currency] || 0) + r.amount;
                }
                if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewFulfill)) {
                    raw.costByCurrency['USD'] = (raw.costByCurrency['USD'] || 0) + r.cost_total;
                }
            } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewFunds)) {
                raw.fundsByCurrency[currency] = (raw.fundsByCurrency[currency] || 0) + r.amount;
            }
        });
        return raw;
    };
    
    const currentRawKpis = getRawKpis(records);
    const previousRawKpis = previousRecords ? getRawKpis(previousRecords) : null;
    
    const filteredManualCosts = manualCosts.filter(cost => 
        cost.date >= filterDateRange.from && cost.date <= filterDateRange.to
    );

    if (role === 'owner' || permissions.viewFulfill) {
      filteredManualCosts.forEach(cost => {
          const currency = cost.currency || 'USD';
          currentRawKpis.costByCurrency[currency] = (currentRawKpis.costByCurrency[currency] || 0) + cost.cost;
      });
    }
    
    const kpis: KpiData = {};

    const ordersComparison = previousRawKpis ? calculatePercentageChange(currentRawKpis.orderIds.size, previousRawKpis.orderIds.size) : {};
    kpis['Total Orders'] = {
        value: currentRawKpis.orderIds.size.toString(),
        ...ordersComparison,
    };

    kpis['Shops'] = { value: currentRawKpis.shops.size.toString() };
    
    const processFinancialKpi = (
      currentData: { [c: string]: number }, 
      previousData: { [c: string]: number } | null
    ): { [currency: string]: KpiValue } | null => {
      const allCurrencies = new Set([...Object.keys(currentData), ...(previousData ? Object.keys(previousData) : [])]);
      if (allCurrencies.size === 0) return null;
      
      const financialKpis: { [currency: string]: KpiValue } = {};
      Array.from(allCurrencies).sort().forEach(c => {
          const current = currentData[c] || 0;
          const previous = previousData?.[c] || 0;
          const comparison = previousRawKpis ? calculatePercentageChange(current, previous) : {};
          financialKpis[c] = {
              value: formatCurrency(current, c),
              ...comparison,
          };
      });
      return financialKpis;
    }

    const revenueKpis = processFinancialKpi(currentRawKpis.revenueByCurrency, previousRawKpis?.revenueByCurrency || null);
    if(revenueKpis) kpis['Revenue'] = revenueKpis;

    if(role === 'owner' || permissions.viewFunds) {
        const fundsKpis = processFinancialKpi(currentRawKpis.fundsByCurrency, previousRawKpis?.fundsByCurrency || null);
        if(fundsKpis) kpis['Funds'] = fundsKpis;
    }

    if(role === 'owner' || permissions.viewFulfill) {
        const costKpis = processFinancialKpi(currentRawKpis.costByCurrency, previousRawKpis?.costByCurrency || null);
        if(costKpis) kpis['Cost'] = costKpis;
    }

    const shopData: {
        [account: string]: {
            orders: Set<string>,
            revenue: { [currency: string]: number },
            funds: { [currency: string]: number },
            cost: { [currency: string]: number }
        }
    } = {};

    const allTableCurrencies = { revenue: new Set<string>(), funds: new Set<string>(), cost: new Set<string>() };

    // --- LOGIC TÍNH TOÁN TOP PRODUCTS ---
    const productStatsByShop: { [key: string]: Map<string, { qty: number, rev: number, image?: string }> } = {};

    records.forEach(r => {
        const shopLabel = accountLabelMap.get(r.account) || r.account;
        
        if (!shopData[r.account]) {
            shopData[r.account] = { revenue: {}, orders: new Set(), funds: {}, cost: {}};
        }
        
        // Init Product Stats Map for Shop
        if (!productStatsByShop[shopLabel]) {
            productStatsByShop[shopLabel] = new Map();
        }

        const currency = r.currency || 'USD';
        if (r.kind === 'order') {
            if (r.order_id) shopData[r.account].orders.add(r.order_id);
            if (r.amount > 0) {
                shopData[r.account].revenue[currency] = (shopData[r.account].revenue[currency] || 0) + r.amount;
                allTableCurrencies.revenue.add(currency);
            }
            if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewFulfill)) {
                 shopData[r.account].cost['USD'] = (shopData[r.account].cost['USD'] || 0) + r.cost_total;
                 allTableCurrencies.cost.add('USD');
            }

            // --- Aggregate Product Stats ---
            // Priority 1: Use parsed item details
            if (r.details && r.details.items && r.details.items.length > 0) {
                r.details.items.forEach(item => {
                    const name = item.name.trim();
                    const current = productStatsByShop[shopLabel].get(name) || { qty: 0, rev: 0 };
                    
                    // --- High Res Image Logic ---
                    let image = item.image || current.image;
                    if (image && image.includes('il_') && image.includes('x')) {
                        // Replace common small sizes (75x75, 170x135, 340x270, 570xN) with fullxfull
                        image = image.replace(/il_\d+x\w+/, 'il_fullxfull');
                    }

                    productStatsByShop[shopLabel].set(name, {
                        qty: current.qty + item.quantity,
                        rev: current.rev + (item.quantity * item.price),
                        image: image
                    });
                });
            } 
            // Priority 2: Use product_name from record (likely from Cost APIs)
            else if (r.product_name && r.product_name !== '-' && r.product_name !== 'N/A') {
                const names = r.product_name.split(',').map(n => n.trim()).filter(n => n);
                names.forEach(name => {
                     const current = productStatsByShop[shopLabel].get(name) || { qty: 0, rev: 0 };
                     // Assume quantity 1 and split amount if multiple names, or just assign amount to each for simplicity approx
                     // For 'Best Selling' by quantity, just incrementing qty is safer
                     productStatsByShop[shopLabel].set(name, {
                        qty: current.qty + 1,
                        rev: current.rev + r.amount, // Rough estimate
                        image: current.image 
                     });
                });
            }
        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewFunds)) {
            shopData[r.account].funds[currency] = (shopData[r.account].funds[currency] || 0) + r.amount;
            allTableCurrencies.funds.add(currency);
        }
    });

    const manualCostData: { cost: { [currency: string]: number } } = { cost: {} };
    if ((role === 'owner' || permissions.viewFulfill) && filteredManualCosts.length > 0) {
        filteredManualCosts.forEach(cost => {
            const currency = cost.currency || 'USD';
            manualCostData.cost[currency] = (manualCostData.cost[currency] || 0) + cost.cost;
            allTableCurrencies.cost.add(currency);
        });
    }

    const sortedRevenueCurrencies = Array.from(allTableCurrencies.revenue).sort();
    const sortedFundsCurrencies = Array.from(allTableCurrencies.funds).sort();
    const sortedCostCurrencies = Array.from(allTableCurrencies.cost).sort();

    const revenueHeaders = sortedRevenueCurrencies.map(c => `Revenue (${c})`);
    const fundsHeaders = (role === 'owner' || permissions.viewFunds) ? sortedFundsCurrencies.map(c => `Funds (${c})`) : [];
    const costHeaders = (role === 'owner' || permissions.viewFulfill) ? sortedCostCurrencies.map(c => `Cost (${c})`) : [];

    const tableHeaders = ["Shop", "Orders", 
        ...revenueHeaders,
        ...fundsHeaders,
        ...costHeaders
    ];
    const tableRows = Object.entries(shopData).map(([account, data]) => {
        const revenueValues = sortedRevenueCurrencies.map(c => data.revenue[c] || 0);
        const fundsValues = (role === 'owner' || permissions.viewFunds) ? sortedFundsCurrencies.map(c => data.funds[c] || 0) : [];
        const costValues = (role === 'owner' || permissions.viewFulfill) ? sortedCostCurrencies.map(c => data.cost[c] || 0) : [];

        return [
            accountLabelMap.get(account) || account,
            data.orders.size,
            ...revenueValues,
            ...fundsValues,
            ...costValues,
        ];
    }).sort((a, b) => (b[1] as number) - (a[1] as number));

    if ((role === 'owner' || permissions.viewFulfill) && Object.keys(manualCostData.cost).length > 0) {
        const revenueValues = sortedRevenueCurrencies.map(() => 0);
        const fundsValues = (role === 'owner' || permissions.viewFunds) ? sortedFundsCurrencies.map(() => 0) : [];
        const costValues = (role === 'owner' || permissions.viewFulfill) ? sortedCostCurrencies.map(c => manualCostData.cost[c] || 0) : [];
        
        const manualRow = [
            "Manual Entry",
            0,
            ...revenueValues,
            ...fundsValues,
            ...costValues
        ];
        tableRows.push(manualRow);
    }

    const summaryChartData = Object.entries(shopData).map(([account, data]) => {
      const chartEntry: any = {
        shop: accountLabelMap.get(account) || account,
      };
      // Revenue
      for(const currency of sortedRevenueCurrencies) {
        chartEntry[`revenue${currency}`] = data.revenue[currency] || 0;
      }
      // Funds (Update: Include Funds in Chart Data)
      for(const currency of sortedFundsCurrencies) {
        chartEntry[`funds${currency}`] = data.funds[currency] || 0;
      }
      return chartEntry;
    });

    // --- TRANSFORM PRODUCT STATS TO SORTED ARRAY ---
    const topProductsByShop: { [shopName: string]: TopProduct[] } = {};
    Object.keys(productStatsByShop).forEach(shop => {
        const stats = productStatsByShop[shop];
        const sortedProducts = Array.from(stats.entries())
            .map(([name, stat]) => ({ 
                name, 
                quantity: stat.qty, 
                revenue: stat.rev,
                image: stat.image 
            }))
            .sort((a, b) => b.quantity - a.quantity) // Sort by Quantity DESC
           // .slice(0, 100); // Increased limit to Top 100
        topProductsByShop[shop] = sortedProducts;
    });

    return { kpis, table: {headers: tableHeaders, rows: tableRows}, chartData: summaryChartData, topProductsByShop };
}