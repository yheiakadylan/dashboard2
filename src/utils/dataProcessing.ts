import { Record, ProcessedData, KpiData, KpiValue, TableData, Account, OverviewChartData, SummaryChartData, FulfillChartData, TopProduct } from '../types';
import { decodeHTMLEntities } from './htmlDecode';

const isDev = import.meta.env.DEV;

// --- Pure Utility Functions (Hoisted) ---
function formatCurrency(value: number): string {
    return '$' + new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

function formatDate(dateStr: string, timeZone: string): string {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(date);
    } catch (e) { return 'Invalid Date'; }
}

function formatHour(dateStr: string, timeZone: string): string {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Hour';
        const hour = new Intl.DateTimeFormat('en-US', {
            timeZone, hour: '2-digit', hour12: false
        }).format(date);
        return `${hour === '24' ? '00' : hour}:00`;
    } catch (e) { return 'Invalid Hour'; }
}

function formatDateTime(dateStr: string, timeZone: string): string {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: '2-digit', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).format(date).replace(',', '');
    } catch (e) { return 'Invalid Date'; }
}

function formatSource(source: string): string {
    if (!source) return '';
    if (source === 'Etsy_Sales') return 'Etsy';
    if (source === 'Ebay_Sales') return 'eBay';
    if (source === 'Etsy_Case') return 'Etsy Case';
    if (source === 'Etsy_Help') return 'Etsy Help';
    return source.replace(/_/g, ' ');
}

function slimImage(src: string | undefined): string | undefined {
    if (!src) return src;
    if (src.length > 50000 && src.startsWith('data:')) return src.substring(0, 500);
    return src;
}

function cleanVariantForAggregation(v: string): string {
    if (!v) return 'Standard';
    const lowerV = v.toLowerCase();
    const markers = ['personalization:', 'personalization', 'personalised:', 'personalised', 'custom:', 'customization:', 'note to seller', 'text:'];
    let firstIndex = -1;
    markers.forEach(marker => {
        const idx = lowerV.indexOf(marker);
        if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) firstIndex = idx;
    });
    if (firstIndex !== -1) {
        let cleaned = v.substring(0, firstIndex).trim();
        return cleaned.replace(/[,|\-|\||:|/|\\]\s*$/, '').trim() || 'Standard';
    }
    return v.trim() || 'Standard';
}

function isRefundedStatus(r: Record): boolean {
    if (!r) return false;
    return r.source === 'Etsy_Refunded' || r.status === 'Refunded';
}

export function resolveListingId(item: any, listingsMapping: any): string | undefined {
    if (!listingsMapping) {
        if (isDev) console.warn('[resolveListingId] listingsMapping is NULL - check DashboardContext');
        return undefined;
    }

    if (item.listing_id && item.listing_id !== 'None') return String(item.listing_id);

    const orderImg = (item.image || '').trim();
    if (orderImg && listingsMapping.imageMap[orderImg]) {
        return listingsMapping.imageMap[orderImg];
    }

    const rawName = item.name || '';
    const name = decodeHTMLEntities(rawName).trim().toLowerCase();
    const baseName = name.split(/[\-\u2013\u2014\(\[,\/]/)[0].trim();
    
    if (listingsMapping.nameMap[name]) {
        return listingsMapping.nameMap[name];
    }

    if (baseName && listingsMapping.nameMap[baseName]) {
        return listingsMapping.nameMap[baseName];
    }

    if (rawName && isDev) {
        console.log(`[Debug Listing Map] Fail: "${rawName}" | Base: "${baseName}" | Img: ${orderImg.substring(0, 50)}...`);
        console.log(`[Debug Listing Map] Map sizes - ImageMap: ${Object.keys(listingsMapping.imageMap).length}, NameMap: ${Object.keys(listingsMapping.nameMap).length}`);
    }

    return undefined;
}

function extractSize(variant: string | undefined): string {
    const v = (variant || '').toLowerCase();
    const match = v.match(/\b(xs|s|m|l|xl|2xl|3xl|4xl|5xl)\b/i) || v.match(/\b(\d+oz)\b/i) || v.match(/\b(\d+x\d+)\b/i);
    return match ? match[0].toUpperCase() : 'Standard';
}

function calculatePercentageChange(current: number, previous: number) {
    if (previous === 0) return { change: current > 0 ? Infinity : 0, direction: (current > 0 ? 'up' : 'neutral') as 'up' | 'down' | 'neutral' };
    const change = ((current - previous) / previous) * 100;
    return { change: Math.abs(change), direction: (change > 0 ? 'up' : (change < 0 ? 'down' : 'neutral')) as 'up' | 'down' | 'neutral' };
}

// --- Main Process Function ---
export function processData(
    records: Record[],
    previousRecords: Record[] | null,
    accounts: Account[],
    filterDateRange: { from: string, to: string },
    timeZone: string,
    role: string,
    permissions: { [key: string]: boolean },
    manualCosts: any[],
    exchangeRates: { [currency: string]: number } | null,
    productMappings: any[] = [],
    categories: any[] = [],
    listingsMapping: any = null
): ProcessedData {
    if (isDev) {
        console.log('[Worker] ProcessData called with', records.length, 'records.', 
          listingsMapping ? `Mapping data: ${Object.keys(listingsMapping.imageMap).length} images, ${Object.keys(listingsMapping.nameMap).length} names` : 'NO mapping data');
    }

    const accountLabelMap = new Map(accounts.map(acc => [acc.email, acc.label || acc.email]));
    const categoryNameMap = new Map(categories.map(c => [c.code, c.name]));

    const mappingsLookup = new Map<string, string>();
    if (productMappings && Array.isArray(productMappings)) {
        productMappings.forEach(m => {
            const key = `${m.name.trim().toLowerCase()}|${(m.variant || '').trim().toLowerCase()}`;
            mappingsLookup.set(key, m.category_code);
        });
    }

    // --- 1. Deduplication pass ---
    const deduplicate = (recs: Record[]) => {
        const uniqueMap = new Map<string, Record>();
        recs.forEach(r => {
            if (r.kind === 'order' && r.order_id) {
                const key = `${r.order_id}_${r.dt_local}`;
                const existing = uniqueMap.get(key);
                if (!existing || (!existing.details && r.details)) uniqueMap.set(key, r);
            } else {
                uniqueMap.set(r.id || Math.random().toString(36), r);
            }
        });
        return Array.from(uniqueMap.values());
    };

    const uniqueRecords = deduplicate(records);
    const uniquePrevRecords = previousRecords ? deduplicate(previousRecords) : [];

    // --- 2. Preparatory Maps (Status, Cases, Helps) ---
    // These are fast one-pass maps for correlation later
    const statusMap = new Map<string, { status: string, refund_details?: any, refund_dt?: string }>();
    const caseMap = new Map<string, string>();
    const helpMap = new Map<string, string>();
    const validOrderIds = new Set<string>();

    uniqueRecords.forEach(r => {
        if (r.kind === 'order' && r.order_id) {
            if (r.source === 'Etsy_Refunded') {
                statusMap.set(r.order_id, { status: 'Refunded', refund_details: r.refund_details, refund_dt: r.dt_local });
            } else {
                validOrderIds.add(r.order_id);
            }
        } else if (r.kind === 'case' && r.order_id) {
            caseMap.set(r.order_id, r.case_msg || 'Yes');
        } else if (r.kind === 'help' && r.order_id) {
            helpMap.set(r.order_id, r.help_kind || 'Yes');
        }
    });

    // --- 3. Single-Pass Execution for ALL Current Data ---
    const diffDays = Math.ceil(Math.abs(new Date(filterDateRange.to).getTime() - new Date(filterDateRange.from).getTime() + 1000) / (1000 * 60 * 60 * 24));
    const isHourly = diffDays <= 2;

    // Accumulators
    const overviewDaily = new Map<string, { orders: Set<string>, rev: Map<string, number>, funds: Map<string, number>, cost: Map<string, number> }>();
    const overviewChart = new Map<string, { orders: Set<string>, rev: Map<string, number> }>();
    const overviewAllCurrs = { rev: new Set<string>(), funds: new Set<string>(), cost: new Set<string>(), chart: new Set<string>() };

    const kpiRaw = { orderIds: new Set<string>(), shops: new Set<string>(), revenue: new Map<string, number>(), funds: new Map<string, number>(), cost: new Map<string, number>(), refOrderIds: new Set<string>(), refund: new Map<string, number>() };
    const shopSummaryData = new Map<string, { revenue: Map<string, number>, orders: Set<string>, funds: Map<string, number>, cost: Map<string, number>, refund: Map<string, number>, refOrderIds: Set<string> }>();
    
    const pByShop = new Map<string, Map<string, any>>();
    const pByCat = new Map<string, Map<string, any>>();
    const productStatsTableMap = new Map<string, any>();
    
    const ordersTabRows: any[][] = [];
    const ebayRows: any[][] = [];
    const etsyRows: any[][] = [];
    const caseRows: any[][] = [];
    const helpRows: any[][] = [];
    
    const fulfillRows: any[][] = [];
    const fulfillCounts = { all: new Map<string, number>(), refunded: new Map<string, number>() };
    let fulfillTotalCost = 0;
    const fulfillStats = { totalCount: 0, refCount: 0 };
    
    const unmappedKwCounts = new Map<string, number>();

    const kwStopSet = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for', 'with', 'about', 'in', 'on', 'to', 'of', 'personalized', 'custom', 'gift', 'gift for', 'design', 't-shirt', 'mug', 'shirt', 'hoodie', 'personalization', 'mockup', 'bundle', 'svg', 'png', 'jpg', 'digital', 'download']);

    uniqueRecords.forEach(r => {
        const currency = r.currency || 'USD';
        const dKey = formatDate(r.dt_local, timeZone);
        const cKey = isHourly ? formatHour(r.dt_local, timeZone) : dKey;
        const shopEmail = r.account;
        const shopLabel = accountLabelMap.get(shopEmail) || shopEmail;
        
        // -- Overview Accumulation --
        if (!overviewDaily.has(dKey)) overviewDaily.set(dKey, { orders: new Set(), rev: new Map(), funds: new Map(), cost: new Map() });
        const od = overviewDaily.get(dKey)!;
        if (!overviewChart.has(cKey)) overviewChart.set(cKey, { orders: new Set(), rev: new Map() });
        const oc = overviewChart.get(cKey)!;

        // -- Record Kind Router --
        if (r.kind === 'order') {
            const sInfo = statusMap.get(r.order_id || '');
            const isRef = isRefundedStatus(r) || sInfo?.status === 'Refunded';
            const isEtsyRefundedSource = r.source === 'Etsy_Refunded';

            if (!isEtsyRefundedSource) {
                // KPIs & Summary
                if (r.order_id) {
                    kpiRaw.orderIds.add(r.order_id);
                    kpiRaw.shops.add(shopEmail);
                    od.orders.add(r.order_id);
                    oc.orders.add(r.order_id);
                }
                if (r.amount > 0) {
                    od.rev.set(currency, (od.rev.get(currency) || 0) + r.amount);
                    oc.rev.set(currency, (oc.rev.get(currency) || 0) + r.amount);
                    kpiRaw.revenue.set(currency, (kpiRaw.revenue.get(currency) || 0) + r.amount);
                    overviewAllCurrs.rev.add(currency);
                    overviewAllCurrs.chart.add(currency);
                }
                if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) {
                    od.cost.set('USD', (od.cost.get('USD') || 0) + r.cost_total);
                    kpiRaw.cost.set('USD', (kpiRaw.cost.get('USD') || 0) + r.cost_total);
                    overviewAllCurrs.cost.add('USD');
                }

                // Shop Summary Meta data
                if (!shopSummaryData.has(shopEmail)) shopSummaryData.set(shopEmail, { revenue: new Map(), orders: new Set(), funds: new Map(), cost: new Map(), refund: new Map(), refOrderIds: new Set() });
                const sd = shopSummaryData.get(shopEmail)!;
                if (r.order_id) sd.orders.add(r.order_id);
                if (r.amount > 0) sd.revenue.set(currency, (sd.revenue.get(currency) || 0) + r.amount);
                if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) sd.cost.set('USD', (sd.cost.get('USD') || 0) + r.cost_total);

                // Product Statistics (Summary & Products Tab)
                if (r.details?.items?.length) {
                    const financials = r.details.financials;
                    const netRevenue = (financials?.itemTotal || 0) - (financials?.discount || 0);
                    const totalListValue = r.details.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                    r.details.items.forEach(item => {
                        const name = decodeHTMLEntities(item.name.trim());
                        const variant = decodeHTMLEntities(item.variant?.trim() || 'Standard');
                        const cleaned = cleanVariantForAggregation(variant);
                        const catCode = mappingsLookup.get(`${name.toLowerCase()}|${cleaned.toLowerCase()}`) || mappingsLookup.get(`${name.toLowerCase()}|`) || item.category_code || r.category_code || 'Unmapped';
                        const catName = categoryNameMap.get(catCode) || catCode;
                        const listingId = resolveListingId(item, listingsMapping) || 'None';
                        const weight = totalListValue > 0 ? (item.price * item.quantity) / totalListValue : (1 / r.details!.items.length);
                        const itemRevenue = netRevenue * weight;
                        const itemRevenueUSD = (currency === 'USD' ? itemRevenue : (exchangeRates?.[currency] ? itemRevenue * exchangeRates[currency] : itemRevenue));
                        const size = extractSize(variant);

                        // Summary Stats
                        if (!pByShop.has(shopLabel)) pByShop.set(shopLabel, new Map());
                        const ps = pByShop.get(shopLabel)!;
                        if (!ps.has(name)) ps.set(name, { qty: 0, rev: 0, revUSD: 0, image: item.image, cat: catCode, classification: variant, size, listingId, currency });
                        const s = ps.get(name); s.qty += item.quantity; s.rev += item.quantity * item.price; s.revUSD += itemRevenueUSD;

                        if (!pByCat.has(catCode)) pByCat.set(catCode, new Map());
                        const pc = pByCat.get(catCode)!;
                        if (!pc.has(name)) pc.set(name, { qty: 0, rev: 0, revUSD: 0, image: item.image, shop: shopLabel, classification: variant, size, listingId, currency });
                        const c = pc.get(name); c.qty += item.quantity; c.rev += item.quantity * item.price; c.revUSD += itemRevenueUSD;

                        // Detailed Products Tab Map
                        const prodKey = `${name.toLowerCase()}|${cleaned.toLowerCase()}|${shopEmail.toLowerCase()}`;
                        if (!productStatsTableMap.has(prodKey)) {
                            productStatsTableMap.set(prodKey, { image: item.image, name, listingId, variant: cleaned, category: catName, categoryCode: catCode, shop: shopLabel, quantity: 0, revenue: 0, revenueUSD: 0, currency });
                        }
                        const pt = productStatsTableMap.get(prodKey);
                        pt.quantity += item.quantity; pt.revenue += itemRevenue; pt.revenueUSD += itemRevenueUSD;

                        // Keywords for unmapped
                        if (catCode === 'Unmapped') {
                            const words = name.toLowerCase().split(/[^a-z0-9]+/);
                            for (const w of words) {
                                if (w.length > 2 && !kwStopSet.has(w)) {
                                    unmappedKwCounts.set(w, (unmappedKwCounts.get(w) || 0) + item.quantity);
                                }
                            }
                        }

                    });
                }

                // Tab Specific Rows (Orders, Etsy, eBay)
                const shopPName = (r.details?.items?.length ? r.details.items.map(i => decodeHTMLEntities(i.name)).join(', ') : '') || r.product_name || 'N/A';
                const pImg = r.details?.items?.[0]?.image || null;
                const pVars = r.details?.items?.length ? r.details.items.map(i => decodeHTMLEntities(i.variant)).filter(v => v).join('; ') : '-';
                const finalStatus = sInfo?.status || r.status || (isRef ? 'Refunded' : 'New'); // Đảm bảo trạng thái refund đồng nhất
                const refundDtStr = sInfo?.refund_dt ? formatDateTime(sInfo.refund_dt, timeZone) : '';
                const dateDisplay = formatDateTime(r.dt_local, timeZone);
                const finalDateCell = (isRef && refundDtStr) ? { type: 'text_with_subtitle' as const, main: dateDisplay, subtitle: `↩ ${refundDtStr}`, subtitleClass: 'text-red-600 font-bold bg-red-100 rounded px-1' } : dateDisplay;

                const commonOrderRow = [
                    { type: 'image' as const, src: pImg, alt: shopPName }, shopPName, pVars, r.order_id || 'N/A', r.amount, currency,
                    r.cost_total ?? null, r.ff_code || '-', r.order_id && caseMap.has(r.order_id) ? caseMap.get(r.order_id) : 'No',
                    r.order_id && helpMap.has(r.order_id) ? helpMap.get(r.order_id) : 'No', shopLabel,
                    finalDateCell, formatSource(r.source), r.id, r.dt_local, r.source, finalStatus === 'Refunded'
                ];
                ordersTabRows.push(commonOrderRow);

                if (r.source === 'Etsy_Sales') {
                    etsyRows.push([{ type: 'image' as const, src: pImg, alt: shopPName }, shopPName, r.order_id || 'N/A', r.amount, currency, shopLabel, finalDateCell, { type: 'action_group', actions: r.id ? [{ type: 'view', label: 'View', id: r.id }] : [] }, finalStatus === 'Refunded']);
                } else if (r.source === 'Ebay_Sales') {
                    ebayRows.push([{ type: 'image' as const, src: pImg, alt: shopPName }, shopPName, r.order_id || 'N/A', r.amount, currency, shopLabel, finalDateCell, { type: 'action_group', actions: r.id ? [{ type: 'view', label: 'View', id: r.id }] : [] }, finalStatus === 'Refunded']);
                }

                // Fulfillment logic
                if (r.ff_code || r.cost_total || r.product_name) {
                    fulfillStats.totalCount++;
                    if (isRef) fulfillStats.refCount++; // Chỉ đếm refund cho các record có dữ liệu fulfillment

                    const ffCode = r.ff_code || '-';
                    if (r.cost_total) fulfillTotalCost += r.cost_total;
                    let provider = r.fulfill_provider;
                    if (!provider || provider === '-') provider = ffCode.startsWith('PWN') ? 'Printway' : (ffCode !== '-' && ffCode !== 'owner' ? 'Merchize' : '-');
                    
                    const ffDateVal = formatDate(r.fulfill_date || r.dt_local, timeZone);
                    const refDateOnlyStr = sInfo?.refund_dt ? formatDate(sInfo.refund_dt, timeZone) : '';
                    const finalFfDateCell = (isRef && refDateOnlyStr) ? { type: 'text_with_subtitle' as const, main: ffDateVal, subtitle: `↩ ${refDateOnlyStr}`, subtitleClass: 'text-red-600 font-bold bg-red-100 rounded px-1' } : ffDateVal;

                    fulfillRows.push([
                        finalFfDateCell, r.order_id || 'N/A',
                        isRef ? { type: 'text_with_subtitle' as const, main: r.product_name || '-', subtitle: `↩ ${r.refund_details?.reason || sInfo?.refund_details?.reason || 'Refunded'}`, subtitleClass: 'text-red-500 font-medium' } : (r.product_name || '-'),
                        provider, ffCode, r.cost_total ?? null, shopLabel, isRef
                    ]);

                    if (r.product_name) {
                        const items = r.product_name.split(',').map(p => p.trim());
                        items.forEach(p => {
                            if (!p) return;
                            fulfillCounts.all.set(p, (fulfillCounts.all.get(p) || 0) + 1);
                            if (isRef) fulfillCounts.refunded.set(p, (fulfillCounts.refunded.get(p) || 0) + 1);
                        });
                    }

                }
            } else if (r.order_id && validOrderIds.has(r.order_id)) {
                // Etsy Refunded Record
                const refundCurr = r.refund_details?.refundCurrency || currency;
                const refundAmt = r.refund_details?.refundAmount || Math.abs(r.amount);
                kpiRaw.refOrderIds.add(r.order_id);
                kpiRaw.refund.set(refundCurr, (kpiRaw.refund.get(refundCurr) || 0) + refundAmt);
                
                if (!shopSummaryData.has(shopEmail)) shopSummaryData.set(shopEmail, { revenue: new Map(), orders: new Set(), funds: new Map(), cost: new Map(), refund: new Map(), refOrderIds: new Set() });
                const sd = shopSummaryData.get(shopEmail)!;
                sd.refOrderIds.add(r.order_id);
                sd.refund.set(refundCurr, (sd.refund.get(refundCurr) || 0) + refundAmt);
            }

        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewKpiFunds)) {
            od.funds.set(currency, (od.funds.get(currency) || 0) + r.amount);
            overviewAllCurrs.funds.add(currency);
            kpiRaw.funds.set(currency, (kpiRaw.funds.get(currency) || 0) + r.amount);
            
            if (!shopSummaryData.has(shopEmail)) shopSummaryData.set(shopEmail, { revenue: new Map(), orders: new Set(), funds: new Map(), cost: new Map(), refund: new Map(), refOrderIds: new Set() });
            const sd = shopSummaryData.get(shopEmail)!;
            sd.funds.set(currency, (sd.funds.get(currency) || 0) + r.amount);

        } else if (r.kind === 'case') {
            caseRows.push([r.order_id || 'N/A', decodeHTMLEntities(r.case_msg || 'N/A'), formatSource(r.source), shopLabel, formatDateTime(r.dt_local, timeZone), r.dt_local]);
        } else if (r.kind === 'help') {
            helpRows.push([r.order_id || 'N/A', decodeHTMLEntities(r.help_kind || 'N/A'), formatSource(r.source), shopLabel, formatDateTime(r.dt_local, timeZone), r.dt_local]);
        }
    });

    // -- Add Manual Costs to KPI & Daily --
    if (role === 'owner' || permissions.viewKpiCost) {
        manualCosts.filter(c => c.date >= filterDateRange.from && c.date <= filterDateRange.to).forEach(c => {
            const cur = c.currency || 'USD';
            const costUSD = (cur === 'USD' ? c.cost : (exchangeRates?.[cur] ? c.cost * exchangeRates[cur] : c.cost));
            kpiRaw.cost.set('USD', (kpiRaw.cost.get('USD') || 0) + costUSD);
            
            const dKey = c.date;
            if (!overviewDaily.has(dKey)) overviewDaily.set(dKey, { orders: new Set(), rev: new Map(), funds: new Map(), cost: new Map() });
            overviewDaily.get(dKey)!.cost.set('USD', (overviewDaily.get(dKey)!.cost.get('USD') || 0) + costUSD);
            overviewAllCurrs.cost.add('USD');

            // Add manual fulfill rows
            fulfillRows.push([c.date, "N/A (Manual)", "N/A (Manual)", c.providerName, "owner", costUSD, "Manual Entry", false]);
            fulfillTotalCost += costUSD;
            fulfillStats.totalCount++; // Tăng count để refund rate chính xác
        });
    }

    // --- 4. Previous Period KPIs Loop ---
    const pKpiRaw = { orderIds: new Set<string>(), revenue: new Map<string, number>(), funds: new Map<string, number>(), cost: new Map<string, number>() };
    uniquePrevRecords.forEach(r => {
        const cur = r.currency || 'USD';
        if (r.kind === 'order' && r.source !== 'Etsy_Refunded') {
            if (r.order_id) pKpiRaw.orderIds.add(r.order_id);
            if (r.amount > 0) pKpiRaw.revenue.set(cur, (pKpiRaw.revenue.get(cur) || 0) + r.amount);
            if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) pKpiRaw.cost.set('USD', (pKpiRaw.cost.get('USD') || 0) + r.cost_total);
        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewKpiFunds)) {
            pKpiRaw.funds.set(cur, (pKpiRaw.funds.get(cur) || 0) + r.amount);
        }
    });

    // --- 5. Final Transformations ---
    const getMapVal = (m: Map<string, number>, k: string) => m.get(k) || 0;
    
    // -- Overview Table & Chart --
    const sortedDaily = Array.from(overviewDaily.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    const sortedRevCurrs = Array.from(overviewAllCurrs.rev).sort();
    const sortedFundsCurrs = Array.from(overviewAllCurrs.funds).sort();
    const sortedCostCurrs = Array.from(overviewAllCurrs.cost).sort();
    
    const overviewHeaders = ["Date", "Order Count", ...sortedRevCurrs.map(c => `Revenue (${c})`), ...((role === 'owner' || permissions.viewKpiFunds) ? sortedFundsCurrs.map(c => `Funds (${c})`) : []), ...((role === 'owner' || permissions.viewKpiCost) ? sortedCostCurrs.map(c => `Cost (${c})`) : []), "Details"];
    const overviewRows = sortedDaily.map(([date, data]) => [
        date, data.orders.size, ...sortedRevCurrs.map(c => getMapVal(data.rev, c)),
        ...((role === 'owner' || permissions.viewKpiFunds) ? sortedFundsCurrs.map(c => getMapVal(data.funds, c)) : []),
        ...((role === 'owner' || permissions.viewKpiCost) ? sortedCostCurrs.map(c => getMapVal(data.cost, c)) : []),
        { type: 'button' as const, label: 'Click for details', id: date }
    ]);
    
    const overviewChartData = Array.from(overviewChart.entries()).sort((a, b) => isHourly ? a[0].localeCompare(b[0]) : a[0].localeCompare(b[0])).map(([key, data]) => {
        const item: any = { date: key, orderCount: data.orders.size };
        Array.from(overviewAllCurrs.chart).forEach(c => item[`revenue${c}`] = getMapVal(data.rev, c));
        return item;
    });

    // -- Summary KPIs --
    const transformKpiMap = (curr: Map<string, number>, prev: Map<string, number>) => {
        const res: any = {};
        const all = new Set([...Array.from(curr.keys()), ...Array.from(prev.keys())]);
        all.forEach(c => {
            const v = curr.get(c) || 0;
            if (v < 0.01 && (prev.get(c) || 0) < 0.01) return;
            res[c] = { value: formatCurrency(v), ...calculatePercentageChange(v, prev.get(c) || 0) };
        });
        return res;
    };

    const addUSDToKpi = (kpiMap: any, rawMap: Map<string, number>) => {
        if (!exchangeRates) return kpiMap;
        let totalUSD = 0;
        Object.entries(kpiMap).forEach(([c, val]: [any, any]) => {
            const rate = exchangeRates[c] || (c === 'USD' ? 1 : 0);
            const usd = (rawMap.get(c) || 0) * rate;
            totalUSD += usd;
            kpiMap[c] = { ...val, usdValue: usd, conversionRate: rate };
        });
        kpiMap['USD_TOTAL'] = { value: formatCurrency(totalUSD), conversionDetails: { originalAmounts: Object.fromEntries(rawMap), rates: exchangeRates } };
        return kpiMap;
    };

    const kpis: KpiData = {
        'Total Orders': { 
            value: kpiRaw.orderIds.size.toString(), 
            ...calculatePercentageChange(kpiRaw.orderIds.size, pKpiRaw.orderIds.size), 
            refundInfo: kpiRaw.refOrderIds.size > 0 ? `${kpiRaw.refOrderIds.size} refunded` : undefined 
        },
        'Shops': { value: kpiRaw.shops.size.toString() },
        'Revenue': addUSDToKpi(transformKpiMap(kpiRaw.revenue, pKpiRaw.revenue), kpiRaw.revenue)
    };
    if (role === 'owner' || permissions.viewKpiFunds) kpis['Funds'] = addUSDToKpi(transformKpiMap(kpiRaw.funds, pKpiRaw.funds), kpiRaw.funds);
    if (role === 'owner' || permissions.viewKpiCost) kpis['Cost'] = transformKpiMap(kpiRaw.cost, pKpiRaw.cost);

    // -- Earn KPI (Funds - Cost) --
    if (role === 'owner' || permissions.viewKpiEarn) {
        const getMapTotalUSD = (m: Map<string, number>) => {
            let total = 0;
            m.forEach((v, c) => {
                const rate = c === 'USD' ? 1 : (exchangeRates?.[c] || 1);
                total += v * rate;
            });
            return total;
        };

        const earnUSD = getMapTotalUSD(kpiRaw.funds) - getMapTotalUSD(kpiRaw.cost);
        const pEarnUSD = pKpiRaw ? (getMapTotalUSD(pKpiRaw.funds) - getMapTotalUSD(pKpiRaw.cost)) : 0;
        
        // Calculate original amounts for Earn by currency: Funds - Cost
        const earnOriginalAmounts: { [curr: string]: number } = {};
        const allCurrs = new Set([...Array.from(kpiRaw.funds.keys()), ...Array.from(kpiRaw.cost.keys())]);
        allCurrs.forEach(c => {
            const val = (kpiRaw.funds.get(c) || 0) - (kpiRaw.cost.get(c) || 0);
            if (val !== 0) earnOriginalAmounts[c] = val;
        });

        kpis['Earn'] = {
            value: formatCurrency(earnUSD),
            ...calculatePercentageChange(earnUSD, pEarnUSD),
            usdValue: earnUSD,
            conversionDetails: exchangeRates ? {
                originalAmounts: earnOriginalAmounts,
                rates: exchangeRates
            } : undefined
        };
    }

    // -- Summary Table --
    const formatMix = (m: Map<string, number>) => {
        const cs = Array.from(m.keys()).sort();
        if (!cs.length) return { value: 0, display: '--', map: {} };
        let t = 0;
        const disp = cs.map(c => {
            const v = m.get(c) || 0;
            t += (c === 'USD' ? v : (exchangeRates?.[c] ? v * exchangeRates[c] : v));
            return formatCurrency(v) + ' ' + c;
        }).join(' + ');
        return { value: t, display: disp, map: Object.fromEntries(m) };
    };

    const summaryRows = Array.from(shopSummaryData.entries()).map(([acc, data]) => {
        const rev = formatMix(data.revenue), ref = formatMix(data.refund), funds = formatMix(data.funds);
        return [
            accountLabelMap.get(acc) || acc,
            data.refOrderIds.size > 0 ? { type: 'text_with_subtitle' as const, main: data.orders.size.toString(), subtitle: `↩ ${data.refOrderIds.size}`, subtitleClass: 'text-red-500 font-medium' } : data.orders.size,
            ref.value > 0 ? { type: 'text_with_subtitle' as const, main: rev.display, subtitle: `↩ ${ref.display}`, subtitleClass: 'text-red-500 font-medium', mainAmountMap: rev.map, subtitleAmountMap: ref.map } : { type: 'value_with_unit' as const, value: rev.value, display: rev.display, amountMap: rev.map },
            ...((role === 'owner' || permissions.viewKpiFunds) ? [{ type: 'value_with_unit' as const, value: funds.value, display: funds.display, amountMap: funds.map }] : []),
            ...((role === 'owner' || permissions.viewKpiCost) ? [Object.values(Object.fromEntries(data.cost)).reduce((a: any, b: any) => a + b, 0)] : []),
            ...((role === 'owner' || permissions.viewKpiEarn) ? [{ 
                type: 'value_with_unit' as const, 
                value: (funds.value || 0) - (Object.values(Object.fromEntries(data.cost)).reduce((a: any, b: any) => a + b, 0)), 
                display: formatCurrency((funds.value || 0) - (Object.values(Object.fromEntries(data.cost)).reduce((a: any, b: any) => a + b, 0))), 
                amountMap: { 'USD': (funds.value || 0) - (Object.values(Object.fromEntries(data.cost)).reduce((a: any, b: any) => a + b, 0)) } 
            }] : [])
        ];
    }).sort((a: any, b: any) => {
        const getV = (v: any) => (typeof v === 'object' && v !== null ? (v.main ? parseInt(v.main) : (v.value || 0)) : v);
        return getV(b[1]) - getV(a[1]);
    });

    const summaryChartData = Array.from(shopSummaryData.entries()).map(([acc, data]) => {
        const res: any = { shop: accountLabelMap.get(acc) || acc };
        sortedRevCurrs.forEach(c => res[`revenue${c}`] = data.revenue.get(c) || 0);
        sortedFundsCurrs.forEach(c => res[`funds${c}`] = data.funds.get(c) || 0);
        return res;
    });

    // -- Top Products Transformers --
    const transformStats = (stats: Map<string, Map<string, any>>) => {
        const res: any = {};
        stats.forEach((map, key) => {
            res[key] = Array.from(map.entries()).map(([n, s]: [any, any]) => ({
                name: n, quantity: s.qty, revenue: s.rev, revenueUSD: s.revUSD, image: s.image,
                category: s.cat || key, shop: s.shop || key, classification: s.classification, size: s.size, listing_id: s.listingId, currency: s.currency
            })).sort((a: any, b: any) => b.quantity - a.quantity).slice(0, 500);
        });
        return res;
    };

    const catComp = Array.from(pByCat.entries()).map(([cat, stats]) => {
        let tQ = 0, tR = 0, tRUSD = 0, tImg = undefined, mQ = -1, tCurr = 'USD';
        stats.forEach((s: any) => { 
            tQ += s.qty; tR += s.rev; tRUSD += s.revUSD; tCurr = s.currency;
            if (s.qty > mQ) { mQ = s.qty; tImg = s.image; } 
        });
        return { name: categoryNameMap.get(cat) || cat, code: cat, quantity: tQ, revenue: tR, revenueUSD: tRUSD, image: tImg, currency: tCurr };
    }).sort((a, b) => b.quantity - a.quantity);

    // -- Fulfill Logic --
    const processCounts = (counts: Map<string, number>) => Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10).reverse();

    // -- Products Tab Rows --
    const finalProductRows = Array.from(productStatsTableMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 3000).map(p => [
        { type: 'image', src: slimImage(p.image), alt: p.name }, p.name, p.listingId, p.category, p.variant, p.shop, p.quantity,
        { type: 'value_with_unit', value: p.revenue, display: `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.revenue)} ${p.currency}` },
        p.currency, p.revenue, p.categoryCode
    ]);

    return {
        overview: { table: { headers: overviewHeaders, rows: overviewRows as any }, chartData: overviewChartData },
        orders: { headers: ["Image", "Product Name", "Variants", "Order ID", "Revenue", "Curren", "Cost", "FF Code", "Case", "Help", "Account", "Date", "Source"], rows: ordersTabRows.sort((a, b) => new Date(b[14]).getTime() - new Date(a[14]).getTime()) },
        ebay: { headers: ["Image", "Product Name", "Order Number", "Revenue", "Currency", "Account", "Date", "Actions"], rows: ebayRows.sort((a, b) => new Date(b[6]).getTime() - new Date(a[6]).getTime()) },
        etsy: { headers: ["Image", "Product Name", "Order Number", "Revenue", "Currency", "Account", "Date", "Actions"], rows: etsyRows.sort((a, b) => new Date(b[6]).getTime() - new Date(a[6]).getTime()) },
        cases: { headers: ["Order Number", "Message", "Source", "Account", "Date"], rows: caseRows.sort((a, b) => new Date(b[5]).getTime() - new Date(a[5]).getTime()) },
        help: { headers: ["Order Number", "Help Kind", "Source", "Account", "Date"], rows: helpRows.sort((a, b) => new Date(b[5]).getTime() - new Date(a[5]).getTime()) },
        fulfill: {
            table: { headers: ["Date", "Order Number", "Product Name", "Provider", "Fulfillment Code", "Cost (USD)", "Shop Account"], rows: fulfillRows.sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()) as any },
            merchizeChartData: [], printwayChartData: [], // Opt: Removed redundant provider-specific chart calculations
            allProductChartData: processCounts(fulfillCounts.all), refundedChartData: processCounts(fulfillCounts.refunded),
            totalCost: fulfillTotalCost, refundRate: fulfillStats.totalCount > 0 ? (fulfillStats.refCount / fulfillStats.totalCount) * 100 : 0
        },

        summary: {
            kpis, table: { headers: ["Shop", "Orders", "Revenue", ...((role === 'owner' || permissions.viewKpiFunds) ? ["Funds"] : []), ...((role === 'owner' || permissions.viewKpiCost) ? ["Cost (USD)"] : []), ...((role === 'owner' || permissions.viewKpiEarn) ? ["Earn"] : [])], rows: summaryRows as any },
            chartData: summaryChartData, topProductsByShop: transformStats(pByShop), topProductsByCategory: transformStats(pByCat), topProductsBySize: {}, categoryComparison: catComp, 
            unmappedKeywords: Array.from(unmappedKwCounts.entries()).map(([keyword, count]) => ({ keyword, count })).sort((a, b) => b.count - a.count).slice(0, 50)
        },
        products: { headers: ['Image', 'Product Name', 'Listing ID', 'Category', 'Variant/Size', 'Shop', 'Quantity', 'Revenue'], rows: finalProductRows }
    };
}
