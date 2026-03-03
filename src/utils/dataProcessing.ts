import { Record, ProcessedData, KpiData, KpiValue, TableData, Account, OverviewChartData, SummaryChartData, FulfillChartData, TopProduct } from '../types';
import { getHighResImageUrl } from './imageUtils';
import { decodeHTMLEntities } from './htmlDecode';

const formatCurrency = (value: number): string => {
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
        if (isNaN(date.getTime())) return 'Invalid Date';
        // Short format: mm/dd/yy hh:mm
        return new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: '2-digit', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).format(date).replace(',', '');
    } catch (e) {
        return 'Invalid Date';
    }
}

// Helper function to convert eBay image URLs to higher resolution
// MOVED TO utils/imageUtils.ts

const formatSource = (source: string): string => {
    if (!source) return '';
    if (source === 'Etsy_Sales') return 'Etsy';
    if (source === 'Ebay_Sales') return 'eBay';
    if (source === 'Etsy_Case') return 'Etsy Case';
    if (source === 'Etsy_Help') return 'Etsy Help';
    return source.replace(/_/g, ' ');
};

export const processData = (
    records: Record[],
    previousRecords: Record[] | null,
    accounts: Account[],
    filterDateRange: { from: string, to: string },
    timeZone: string,
    role: string,
    permissions: { [key: string]: boolean },
    manualCosts: any[],
    exchangeRates: { [currency: string]: number } | null
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
    const fulfill = (role === 'owner' || permissions.viewFulfillTab)
        ? getFulfillRecords(uniqueRecords, accountLabelMap, timeZone, manualCosts, filterDateRange, exchangeRates)
        : { table: { headers: ['Fulfill'], rows: [["Permission Denied"]] }, merchizeChartData: [], printwayChartData: [], totalCost: 0 };

    const { kpis: summaryKpis, table: summaryTable, chartData: summaryChartData, topProductsByShop } = (role === 'owner' || permissions.viewOverviewTab)
        ? calculateSummary(uniqueRecords, previousRecords, accountLabelMap, role, permissions, manualCosts, filterDateRange, exchangeRates)
        : { kpis: {}, table: { headers: ['Summary'], rows: [["Permission Denied"]] }, chartData: [], topProductsByShop: {} };

    return {
        overview: overviewData,
        orders,
        ebay,
        etsy,
        cases,
        help,
        fulfill,
        summary: { kpis: summaryKpis, table: summaryTable, chartData: summaryChartData, topProductsByShop },
        products: {
            headers: ['Image', 'Product Name', 'Shop', 'Quantity', 'Revenue'],
            rows: (() => {
                const productStats = new Map<string, { image: any, name: string, shop: string, quantity: number, revenue: number, currency: string }>();

                uniqueRecords.forEach(r => {
                    if (r.kind !== 'order') return;

                    const shopName = accountLabelMap.get(r.account) || r.account;
                    const financials = r.details?.financials;
                    // Product Revenue = Item Total minus Discounts (Excludes Shipping and Tax)
                    const netRevenue = (financials?.itemTotal || 0) - (financials?.discount || 0);

                    if (r.details && r.details.items && r.details.items.length > 0) {
                        // Calculate total list value to determine weights
                        const totalListValue = r.details.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                        r.details.items.forEach(item => {
                            const name = decodeHTMLEntities(item.name.trim()); // Decode HTML entities and ensure no leading/trailing spaces
                            const key = `${name}_${shopName}`;

                            // Calculate weight ensuring no division by zero
                            const weight = totalListValue > 0 ? (item.price * item.quantity) / totalListValue : (1 / r.details!.items.length);
                            const itemRevenue = netRevenue * weight;

                            // Image Logic (High Res) -> Refactored to use util
                            const image = getHighResImageUrl(item.image) || item.image;

                            const current = productStats.get(key) || {
                                image: image,
                                name: name,
                                shop: shopName,
                                quantity: 0,
                                revenue: 0,
                                currency: r.currency || 'USD'
                            };

                            // Update stats
                            // Use first available image if current is missing
                            if (!current.image && image) current.image = image;

                            current.quantity += item.quantity;
                            current.revenue += itemRevenue;

                            productStats.set(key, current);
                        });
                    }
                });

                return Array.from(productStats.values())
                    .sort((a, b) => b.revenue - a.revenue)
                    .map(p => [
                        { type: 'image', src: p.image, fullSrc: p.image, alt: p.name },
                        p.name,
                        p.shop,
                        p.quantity,
                        {
                            type: 'value_with_unit',
                            value: p.revenue,
                            display: `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.revenue)} ${p.currency}`
                        },
                        p.currency,   // [5] hidden: currency code for USD conversion
                        p.revenue,    // [6] hidden: raw revenue number for USD conversion
                    ]);
            })()
        }
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
            if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) {
                dailyDataForTable[dailyGroupKey].cost['USD'] = (dailyDataForTable[dailyGroupKey].cost['USD'] || 0) + r.cost_total;
                allCurrenciesForTable.cost.add('USD');
            }
        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewKpiFunds)) {
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
    const fundsHeaders = (role === 'owner' || permissions.viewKpiFunds) ? sortedFundsCurrencies.map(c => `Funds (${c})`) : [];
    const costHeaders = (role === 'owner' || permissions.viewKpiCost) ? sortedCostCurrencies.map(c => `Cost (${c})`) : [];

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
            const fundsValues = (role === 'owner' || permissions.viewKpiFunds) ? sortedFundsCurrencies.map(c => data.funds[c] || 0) : [];
            const costValues = (role === 'owner' || permissions.viewKpiCost) ? sortedCostCurrencies.map(c => data.cost[c] || 0) : [];

            return [
                date,
                data.orders.size,
                ...revenueValues,
                ...fundsValues,
                ...costValues,
                { type: 'button' as const, label: 'Click for details', id: date } // Details button - id is the date
            ] as any; // Type assertion to resolve complex type inference
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
    const headers = ["Image", "Product Name", "Variants", "Order ID", "Revenue", "Curren", "Cost", "FF Code", "Case", "Help", "Account", "Date", "Source"];

    // ✅ Filter out refund records - they are status updates, not separate orders
    // Only show regular orders (Sales, etc.) with their updated status
    const orders = records.filter(r =>
        r.kind === 'order' &&
        r.source !== 'Etsy_Refunded'
    );

    const cases = records.filter(r => r.kind === 'case');
    const helps = records.filter(r => r.kind === 'help');

    const caseMap = new Map(cases.map(c => [c.order_id, c.case_msg || 'Yes']));
    const helpMap = new Map(helps.map(h => [h.order_id, h.help_kind || 'Yes']));

    // ✅ Get refund records to join (like case/help)
    const refunded = records.filter(r => r.source === 'Etsy_Refunded');

    // Create status map from refund records
    const statusMap = new Map<string, { status: string, refund_details?: any }>();


    // Refund takes priority
    refunded.forEach(r => {
        if (r.order_id) {
            statusMap.set(r.order_id, {
                status: 'Refunded',
                refund_details: r.refund_details
            });
        }
    });

    const sortedOrders = [...orders].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());

    const rows = sortedOrders.map(o => {


        // --- New logic to get product name and image ---
        let productName = o.product_name || 'N/A';
        let variants = '-';
        let productImage = null;
        let fullProductImage = null;

        if (o.details && o.details.items && o.details.items.length > 0) {
            const itemNames = o.details.items.map(i => decodeHTMLEntities(i.name)).join(', ');
            if (itemNames) {
                productName = itemNames;
            }
            // Join variants
            const itemVariants = o.details.items.map(i => decodeHTMLEntities(i.variant)).filter(v => v).join('; ');
            if (itemVariants) {
                variants = itemVariants;
            }

            // Get image of the first item
            const rawImage = o.details.items[0].image || null;

            // Convert to high-res for BOTH thumbnail and preview -> instant loading
            productImage = getHighResImageUrl(rawImage);
            fullProductImage = productImage;
        }
        // --- End of new logic ---

        // Map Source
        const displaySource = formatSource(o.source);

        // ✅ Get status from statusMap (joined from refund records, like case/help)
        const statusInfo = o.order_id ? statusMap.get(o.order_id) : null;
        const status = statusInfo?.status || o.status || 'New';

        return [
            { type: 'image' as const, src: productImage, fullSrc: fullProductImage, alt: productName }, // Image
            productName,
            variants,
            o.order_id || 'N/A',
            o.amount,
            o.currency || 'USD',
            o.cost_total ?? null,
            o.ff_code || '-',
            o.order_id && caseMap.has(o.order_id) ? caseMap.get(o.order_id) : 'No',
            o.order_id && helpMap.has(o.order_id) ? helpMap.get(o.order_id) : 'No',
            accountLabelMap.get(o.account) || o.account,
            formatDateTime(o.dt_local, timeZone),
            displaySource,
            o.id,        // Hidden [13]: record ID for row click
            o.dt_local,  // Hidden [14]: raw ISO for date filter
            o.source,    // Hidden [15]: source for source filter
            status === 'Refunded', // Hidden [16]: isRefunded flag for row highlight
        ] as any[];
    });

    return { headers, rows };
}

const getPlatformRecords = (records: Record[], source: 'Ebay_Sales' | 'Etsy_Sales', accountLabelMap: Map<string, string>, timeZone: string): TableData => {
    const headers = ["Image", "Product Name", "Order Number", "Revenue", "Currency", "Account", "Date", "Actions"];

    // Source filter is enough - Etsy_Sales won't match Etsy_Refunded
    const platformRecords = records.filter(r =>
        r.source === source &&
        r.kind === 'order'
    );

    const sortedRecords = [...platformRecords].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());

    const rows = sortedRecords.map(r => {
        // Create a list of actions for the Action column
        const actions = [];
        if (r.id) {
            actions.push({ type: 'view', label: 'View', id: r.id! });
        }



        // --- Logic from getOrderList ---
        let productName = r.product_name || 'N/A';
        let productImage = null;
        let fullProductImage = null;

        if (r.details && r.details.items && r.details.items.length > 0) {
            const itemNames = r.details.items.map(i => decodeHTMLEntities(i.name)).join(', ');
            if (itemNames) {
                productName = itemNames;
            }
            const rawImage = r.details.items[0].image || null;

            // Convert to high-res for BOTH thumbnail and preview -> instant loading
            productImage = getHighResImageUrl(rawImage);
            fullProductImage = productImage;
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
        ? ["Order Number", "Message", "Source", "Account", "Date"]
        : ["Order Number", "Help Kind", "Source", "Account", "Date"];

    const supportRecords = records.filter(r => r.kind === kind);
    const sortedRecords = [...supportRecords].sort((a, b) => new Date(b.dt_local).getTime() - new Date(a.dt_local).getTime());

    const rows = sortedRecords.map(r => [
        r.order_id || 'N/A',
        kind === 'case' ? decodeHTMLEntities(r.case_msg || 'N/A') : decodeHTMLEntities(r.help_kind || 'N/A'),
        formatSource(r.source),
        accountLabelMap.get(r.account) || r.account,
        formatDateTime(r.dt_local, timeZone),
        r.dt_local // Hidden column for sorting
    ]);

    return { headers, rows };
}

const getFulfillRecords = (
    records: Record[],
    accountLabelMap: Map<string, string>,
    timeZone: string,
    manualCosts: any[],
    filterDateRange: { from: string, to: string },
    exchangeRates: { [currency: string]: number } | null
): { table: TableData; merchizeChartData: FulfillChartData[]; printwayChartData: FulfillChartData[]; totalCost: number } => {

    const headers = ["Date", "Order Number", "Product Name", "Provider", "Fulfillment Code", "Cost (USD)", "Shop Account"];
    let totalCost = 0;

    // 1. Xử lý Manual Costs (Chi phí nhập tay)
    const filteredManualCosts = manualCosts.filter(cost =>
        cost.date >= filterDateRange.from && cost.date <= filterDateRange.to
    );

    const manualRows = filteredManualCosts.map(cost => {
        // Calculate Cost in USD
        let costUSD = cost.cost;
        if (cost.currency && cost.currency !== 'USD' && exchangeRates && exchangeRates[cost.currency]) {
            costUSD = cost.cost * exchangeRates[cost.currency];
        } else if (cost.currency && cost.currency !== 'USD' && (!exchangeRates || !exchangeRates[cost.currency])) {
            // Fallback or ignore? Keeping original if rate missing might be wrong but better than 0? 
            // Requirement says "chuan hoa ve USD". If rate missing, maybe strictly 0 or original?
            // Let's keep original but strictly it should be converted.
        }
        totalCost += costUSD;

        return [
            cost.date,
            "N/A (Manual)",
            "N/A (Manual)",
            cost.providerName,
            "owner",
            cost.cost, // Display original cost
            "Manual Entry",
        ];
    });

    // 2. Xử lý Email Records (Chi phí từ API/Email)
    const fulfillRecords = records.filter(r => r.kind === 'order' && (r.ff_code || r.cost_total || r.product_name));

    const emailRows = fulfillRecords.map(r => {
        const ffCode = r.ff_code || '-';

        // Update total Cost (Usually USD for automated records)
        if (r.cost_total) {
            totalCost += r.cost_total;
        }

        // Logic: Use explicit provider if set (from manual import), else guess based on code
        let provider = r.fulfill_provider;
        if (!provider || provider === '-') {
            if (ffCode.startsWith('PWN')) {
                provider = 'Printway';
            } else if (ffCode !== '-' && ffCode !== 'owner') {
                provider = 'Merchize';
            } else {
                provider = '-';
            }
        }

        // Logic: Use fulfillment date if set, else order date
        const dateToUse = r.fulfill_date || r.dt_local;
        const displayDate = formatDate(dateToUse, timeZone);

        return [
            displayDate,
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

    return { table: { headers, rows }, merchizeChartData, printwayChartData, totalCost };
}

const calculateSummary = (
    records: Record[],
    previousRecords: Record[] | null,
    accountLabelMap: Map<string, string>,
    role: string,
    permissions: { [key: string]: boolean },
    manualCosts: any[],
    filterDateRange: { from: string; to: string },
    exchangeRates: { [currency: string]: number } | null
): { kpis: KpiData, table: TableData, chartData: SummaryChartData[], topProductsByShop: { [shopName: string]: TopProduct[] } } => {

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

    // 1. Collect Valid Order IDs first (Sales orders in the current view)
    const validOrderIds = new Set<string>();
    records.forEach(r => {
        const isStatusUpdate = r.source === 'Etsy_Refunded';
        if (r.kind === 'order' && r.order_id && !isStatusUpdate) {
            validOrderIds.add(r.order_id);
        }
    });

    // Also collect for previous records if they exist, to ensure consistent comparison logic
    const validPreviousOrderIds = new Set<string>();
    if (previousRecords) {
        previousRecords.forEach(r => {
            const isStatusUpdate = r.source === 'Etsy_Refunded';
            if (r.kind === 'order' && r.order_id && !isStatusUpdate) {
                validPreviousOrderIds.add(r.order_id);
            }
        });
    }

    type RawKpis = {
        orderIds: Set<string>;
        shops: Set<string>;
        revenueByCurrency: { [c: string]: number };
        fundsByCurrency: { [c: string]: number };
        costByCurrency: { [c: string]: number };
        refundedOrderIds: Set<string>;
        refundByCurrency: { [c: string]: number };
    };

    const getRawKpis = (recordsToProcess: Record[], validIds: Set<string>): RawKpis => {
        const raw: RawKpis = {
            orderIds: new Set(),
            shops: new Set(),
            revenueByCurrency: {},
            fundsByCurrency: {},
            costByCurrency: {},
            refundedOrderIds: new Set(),
            refundByCurrency: {},
        };
        recordsToProcess.forEach(r => {
            const currency = r.currency || 'USD';
            if (r.kind === 'order') {
                const isStatusUpdate = r.source === 'Etsy_Refunded';

                if (r.order_id && !isStatusUpdate) {
                    raw.orderIds.add(r.order_id);
                    raw.shops.add(r.account); // Active shop (Sale only)
                }

                if (r.amount > 0 && !isStatusUpdate) {
                    raw.revenueByCurrency[currency] = (raw.revenueByCurrency[currency] || 0) + r.amount;
                }
                if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) {
                    raw.costByCurrency['USD'] = (raw.costByCurrency['USD'] || 0) + r.cost_total;
                }
                // Track refunds - ONLY if the order belongs to this period
                if (r.source === 'Etsy_Refunded' && r.order_id && validIds.has(r.order_id)) {
                    raw.refundedOrderIds.add(r.order_id);
                    const refundAmount = r.refund_details?.refundAmount || Math.abs(r.amount || 0);
                    const refundCurr = r.refund_details?.refundCurrency || currency;
                    raw.refundByCurrency[refundCurr] = (raw.refundByCurrency[refundCurr] || 0) + refundAmount;
                }
            } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewKpiFunds)) {
                raw.fundsByCurrency[currency] = (raw.fundsByCurrency[currency] || 0) + r.amount;
            }
        });
        return raw;
    };

    const currentRawKpis = getRawKpis(records, validOrderIds);
    const previousRawKpis = previousRecords ? getRawKpis(previousRecords, validPreviousOrderIds) : null;

    const filteredManualCosts = manualCosts.filter(cost =>
        cost.date >= filterDateRange.from && cost.date <= filterDateRange.to
    );

    if (role === 'owner' || permissions.viewKpiCost) {
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
        refundInfo: currentRawKpis.refundedOrderIds.size > 0 ? `${currentRawKpis.refundedOrderIds.size} refunded` : undefined,
    } as any;

    kpis['Shops'] = { value: currentRawKpis.shops.size.toString() };

    const processFinancialKpi = (
        currentData: { [c: string]: number },
        previousData: { [c: string]: number } | null,
        refundData?: { [c: string]: number }
    ): { [currency: string]: KpiValue } | null => {
        const allCurrencies = new Set([
            ...Object.keys(currentData),
            ...(previousData ? Object.keys(previousData) : []),
            ...(refundData ? Object.keys(refundData) : [])
        ]);
        if (allCurrencies.size === 0) return null;

        const financialKpis: { [currency: string]: KpiValue } = {};
        Array.from(allCurrencies).sort().forEach(c => {
            const current = currentData[c] || 0;
            const previous = previousData?.[c] || 0;

            // Skip if both current and previous are effectively zero
            if (Math.abs(current) < 0.01 && Math.abs(previous) < 0.01) return;

            const comparison = previousRawKpis ? calculatePercentageChange(current, previous) : {};
            financialKpis[c] = {
                value: formatCurrency(current),
                ...comparison,
                refundInfo: refundData && refundData[c] ? `${c} ${formatCurrency(refundData[c])} refunded` : undefined,
            } as any;
        });
        return financialKpis;
    }

    /**
     * Add USD total to multi-currency KPI with conversionDetails
     * Also inject rates and refund data into each currency for inline display
     */
    const addUSDTotalToKpi = (
        multiCurrencyKpi: { [currency: string]: KpiValue },
        currencyData: { [c: string]: number },
        exchangeRates: { [c: string]: number } | null,
        refundData?: { [c: string]: number }
    ): { [currency: string]: KpiValue } => {
        if (!exchangeRates || Object.keys(currencyData).length === 0) {
            return multiCurrencyKpi;
        }

        // Inject exchange rates and refund data into each currency KpiValue
        const enhancedKpis: { [currency: string]: KpiValue } = {};
        Object.entries(multiCurrencyKpi).forEach(([currency, kpiVal]) => {
            const rate = exchangeRates[currency] || (currency === 'USD' ? 1 : 0);
            const originalAmount = currencyData[currency] || 0;
            const usdValue = originalAmount * rate;

            // Get refund for this currency
            const refundAmount = refundData?.[currency] || 0;
            const refundUSD = refundAmount * rate;

            enhancedKpis[currency] = {
                ...kpiVal,
                // Store conversion info for inline display
                conversionRate: rate,
                usdValue: usdValue,
                // Store refund with conversion
                refundOriginal: refundAmount > 0 ? refundAmount : undefined,
                refundUSD: refundUSD > 0 ? refundUSD : undefined,
            };
        });

        // Calculate USD total
        let totalUSD = 0;
        Object.entries(currencyData).forEach(([currency, amount]) => {
            const rate = exchangeRates[currency] || (currency === 'USD' ? 1 : 0);
            totalUSD += amount * rate;
        });

        // Calculate total refund in USD if refund data exists
        let refundInfo: string | undefined;
        if (refundData && Object.keys(refundData).length > 0) {
            let totalRefundUSD = 0;
            Object.entries(refundData).forEach(([currency, amount]) => {
                const rate = exchangeRates[currency] || (currency === 'USD' ? 1 : 0);
                totalRefundUSD += amount * rate;
            });
            if (totalRefundUSD > 0) {
                refundInfo = `${formatCurrency(totalRefundUSD)} refunded`;
            }
        }

        // Add USD_TOTAL as a special currency key
        return {
            ...enhancedKpis,
            'USD_TOTAL': {
                value: formatCurrency(totalUSD),
                conversionDetails: {
                    originalAmounts: { ...currencyData },
                    rates: exchangeRates
                },
                refundInfo
            }
        };
    };

    // Calculate Revenue KPI with multi-currency + USD total
    const revenueKpis = processFinancialKpi(currentRawKpis.revenueByCurrency, previousRawKpis?.revenueByCurrency || null, currentRawKpis.refundByCurrency);
    if (revenueKpis && exchangeRates) {
        kpis['Revenue'] = addUSDTotalToKpi(revenueKpis, currentRawKpis.revenueByCurrency, exchangeRates, currentRawKpis.refundByCurrency);
    } else {
        kpis['Revenue'] = revenueKpis || { value: '---' };
    }

    // Calculate Funds KPI with multi-currency + USD total
    if (role === 'owner' || permissions.viewKpiFunds) {
        const fundsKpis = processFinancialKpi(currentRawKpis.fundsByCurrency, previousRawKpis?.fundsByCurrency || null);
        if (fundsKpis && exchangeRates) {
            kpis['Funds'] = addUSDTotalToKpi(fundsKpis, currentRawKpis.fundsByCurrency, exchangeRates);
        } else {
            kpis['Funds'] = fundsKpis || { value: '---' };
        }
    } else {
        kpis['Funds'] = { value: '---' };
    }

    if (role === 'owner' || permissions.viewKpiCost) {
        const costKpis = processFinancialKpi(currentRawKpis.costByCurrency, previousRawKpis?.costByCurrency || null);
        kpis['Cost'] = costKpis || { value: '---' };
    } else {
        kpis['Cost'] = { value: '---' };
    }

    // --- CALCULATE EARN (Net Profit) ---
    if ((role === 'owner' || permissions.viewKpiFunds) && (role === 'owner' || permissions.viewKpiCost) && exchangeRates) {
        let totalFundsUSD = 0;
        let totalCostUSD = 0;

        // Convert Funds -> USD
        Object.entries(currentRawKpis.fundsByCurrency).forEach(([currency, amount]) => {
            const rate = exchangeRates[currency] || (currency === 'USD' ? 1 : 0);
            totalFundsUSD += amount * rate;
        });

        // Convert Cost -> USD
        Object.entries(currentRawKpis.costByCurrency).forEach(([currency, amount]) => {
            const rate = exchangeRates[currency] || (currency === 'USD' ? 1 : 0);
            totalCostUSD += amount * rate;
        });

        const earnUSD = totalFundsUSD - totalCostUSD;

        kpis['Earn'] = {
            value: formatCurrency(earnUSD),
            // We could compare with previous period if we calculated previous EARN, but let's skip comparison for now for simplicity
            conversionDetails: {
                originalAmounts: { ...currentRawKpis.fundsByCurrency },
                rates: exchangeRates
            }
        };
    } else {
        // If no rights or no rates, cannot calc
        kpis['Earn'] = { value: '---' };
    }


    const shopData: {
        [account: string]: {
            orders: Set<string>,
            revenue: { [currency: string]: number },
            funds: { [currency: string]: number },
            cost: { [currency: string]: number },
            refund: { [currency: string]: number },
            refundedOrderIds: Set<string>
        }
    } = {};

    // Initialize shopData for ALL accounts to ensure 0-order shops are listed
    accountLabelMap.forEach((_label, email) => {
        shopData[email] = { revenue: {}, orders: new Set(), funds: {}, cost: {}, refund: {}, refundedOrderIds: new Set() };
    });

    const allTableCurrencies = { revenue: new Set<string>(), funds: new Set<string>(), cost: new Set<string>() };

    // --- LOGIC TÍNH TOÁN TOP PRODUCTS ---
    const productStatsByShop: { [key: string]: Map<string, { qty: number, rev: number, image?: string }> } = {};

    records.forEach(r => {
        const shopLabel = accountLabelMap.get(r.account) || r.account;

        if (!shopData[r.account]) {
            shopData[r.account] = { revenue: {}, orders: new Set(), funds: {}, cost: {}, refund: {}, refundedOrderIds: new Set() };
        }

        // Init Product Stats Map for Shop
        if (!productStatsByShop[shopLabel]) {
            productStatsByShop[shopLabel] = new Map();
        }

        const currency = r.currency || 'USD';
        if (r.kind === 'order') {
            const isStatusUpdate = r.source === 'Etsy_Refunded';

            if (!isStatusUpdate) {
                if (r.order_id) shopData[r.account].orders.add(r.order_id);
                if (r.amount > 0) {
                    shopData[r.account].revenue[currency] = (shopData[r.account].revenue[currency] || 0) + r.amount;
                    allTableCurrencies.revenue.add(currency);
                }
                if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) {
                    shopData[r.account].cost['USD'] = (shopData[r.account].cost['USD'] || 0) + r.cost_total;
                    allTableCurrencies.cost.add('USD');
                }
            }

            // Track refunds per shop - ONLY if validity check passes
            if (r.source === 'Etsy_Refunded' && r.order_id && validOrderIds.has(r.order_id)) {
                if (r.order_id) shopData[r.account].refundedOrderIds.add(r.order_id);
                const refundAmount = r.refund_details?.refundAmount || Math.abs(r.amount || 0);
                const refundCurr = r.refund_details?.refundCurrency || currency;
                shopData[r.account].refund[refundCurr] = (shopData[r.account].refund[refundCurr] || 0) + refundAmount;
            }

            // --- Aggregate Product Stats ---
            if (!isStatusUpdate) {
                // Priority 1: Use parsed item details
                if (r.details && r.details.items && r.details.items.length > 0) {
                    r.details.items.forEach(item => {
                        const name = decodeHTMLEntities(item.name.trim());
                        const current = productStatsByShop[shopLabel].get(name) || { qty: 0, rev: 0 };

                        // --- High Res Image Logic --- -> Refactored
                        const image = getHighResImageUrl(item.image || current.image);

                        productStatsByShop[shopLabel].set(name, {
                            qty: current.qty + item.quantity,
                            rev: current.rev + (item.quantity * item.price),
                            image: image
                        });
                    });
                }
            }
        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewKpiFunds)) {
            shopData[r.account].funds[currency] = (shopData[r.account].funds[currency] || 0) + r.amount;
            allTableCurrencies.funds.add(currency);
        }
    });

    const manualCostData: { cost: { [currency: string]: number } } = { cost: {} };
    if ((role === 'owner' || permissions.viewKpiCost) && filteredManualCosts.length > 0) {
        filteredManualCosts.forEach(cost => {
            const currency = cost.currency || 'USD';
            manualCostData.cost[currency] = (manualCostData.cost[currency] || 0) + cost.cost;
            allTableCurrencies.cost.add(currency);
        });
    }

    const sortedRevenueCurrencies = Array.from(allTableCurrencies.revenue).sort();
    const sortedFundsCurrencies = Array.from(allTableCurrencies.funds).sort();
    // sortedCostCurrencies removed as it was unused

    // --- Consolidated Column Logic ---
    const formatMixedCurrency = (amountMap: { [c: string]: number }): { value: number, display: string, amountMap: { [c: string]: number } } => {
        const currencies = Object.keys(amountMap).sort();
        if (currencies.length === 0) return { value: 0, display: '--', amountMap: {} };

        let totalVal = 0;
        const parts = currencies.map(c => {
            const val = amountMap[c];
            totalVal += val;
            return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + ' ' + c;
        });

        return { value: totalVal, display: parts.join(' + '), amountMap };
    };

    const tableHeaders = ["Shop", "Orders", "Revenue"];
    if (role === 'owner' || permissions.viewKpiFunds) tableHeaders.push("Funds");
    if (role === 'owner' || permissions.viewKpiCost) tableHeaders.push("Cost (USD)");

    const sortedShopEntries = Object.entries(shopData).sort((a, b) => b[1].orders.size - a[1].orders.size);

    const tableRows = sortedShopEntries.map(([account, data]) => {
        const revenue = formatMixedCurrency(data.revenue);
        const refund = formatMixedCurrency(data.refund);

        // Count unique refunded orders for this shop (Optimized: using pre-calculated set)
        const refundedOrdersCount = data.refundedOrderIds.size;

        const shopName = accountLabelMap.get(account) || account;

        // Orders Cell with subtitle if refunds exist
        const ordersCell = refundedOrdersCount > 0
            ? {
                type: 'text_with_subtitle' as const,
                main: data.orders.size.toString(),
                subtitle: `↩ ${refundedOrdersCount}`,
                subtitleClass: 'text-red-500 font-medium'
            }
            : data.orders.size;

        // Revenue Cell with subtitle if refunds exist
        const revenueCell = refund.value > 0
            ? {
                type: 'text_with_subtitle' as const,
                main: revenue.display,
                subtitle: `↩ ${refund.display}`,
                subtitleClass: 'text-red-500 font-medium',
                mainAmountMap: revenue.amountMap,
                subtitleAmountMap: refund.amountMap
            }
            : { type: 'value_with_unit' as const, value: revenue.value, display: revenue.display, amountMap: revenue.amountMap };

        const row = [
            shopName,
            ordersCell,
            revenueCell
        ];

        if (role === 'owner' || permissions.viewKpiFunds) {
            const funds = formatMixedCurrency(data.funds);
            row.push({ type: 'value_with_unit' as const, value: funds.value, display: funds.display, amountMap: funds.amountMap });
        }

        if (role === 'owner' || permissions.viewKpiCost) {
            // Cost is default USD per user request, but we handle the map sum for valid display number
            let totalCost = 0;
            Object.values(data.cost).forEach(v => totalCost += v);
            row.push(totalCost);
        }

        return row;
    });

    if ((role === 'owner' || permissions.viewKpiCost) && Object.keys(manualCostData.cost).length > 0) {
        let totalManualCost = 0;
        Object.values(manualCostData.cost).forEach(v => totalManualCost += v);

        const manualRow = [
            "Manual Entry",
            0,
            { type: 'value_with_unit' as const, value: 0, display: '--', amountMap: {} } // Revenue
        ];

        if (role === 'owner' || permissions.viewKpiFunds) {
            manualRow.push({ type: 'value_with_unit' as const, value: 0, display: '--', amountMap: {} }); // Funds
        }

        // Manual Cost is typically strictly Cost, so we push it if the column exists
        // Since we are inside the 'if (viewFulfill)', the Cost column exists.
        manualRow.push(totalManualCost);

        tableRows.push(manualRow);
    }

    const summaryChartData = Object.entries(shopData).map(([account, data]) => {
        const chartEntry: any = {
            shop: accountLabelMap.get(account) || account,
        };
        // Revenue
        for (const currency of sortedRevenueCurrencies) {
            chartEntry[`revenue${currency}`] = data.revenue[currency] || 0;
        }
        // Funds (Update: Include Funds in Chart Data)
        for (const currency of sortedFundsCurrencies) {
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

    return { kpis, table: { headers: tableHeaders, rows: tableRows }, chartData: summaryChartData, topProductsByShop };
}
