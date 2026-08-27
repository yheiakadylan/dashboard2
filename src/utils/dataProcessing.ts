import { Record, ProcessedData, KpiData, KpiValue, Account } from '../types';
import { decodeHTMLEntities } from './htmlDecode';
import { 
    formatVariantForDisplay, 
    cleanVariantForAggregation,
    removeAccents 
} from './variantHelpers';
import { calculateItemNetRevenue, getItemQuantity, getOrderItemRevenueContext } from './revenueUtils';
import { getPreviousPeriodLabel } from './periodComparison';

export type ProcessingScope = 'all' | 'overview' | 'orders' | 'products' | 'fulfill' | 'support';

const moneyFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const dateFormatterCache = new Map<string, {
    date: Intl.DateTimeFormat;
    hour: Intl.DateTimeFormat;
    dateTime: Intl.DateTimeFormat;
}>();

const getDateFormatters = (timeZone: string) => {
    const cached = dateFormatterCache.get(timeZone);
    if (cached) return cached;

    const formatters = {
        date: new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit'
        }),
        hour: new Intl.DateTimeFormat('en-US', {
            timeZone, hour: '2-digit', hour12: false
        }),
        dateTime: new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: '2-digit', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }),
    };

    dateFormatterCache.set(timeZone, formatters);
    return formatters;
};

// --- Pure Utility Functions (Hoisted) ---
function formatCurrency(value: number): string {
    return '$' + moneyFormatter.format(value);
}

function formatNumber(value: number): string {
    return moneyFormatter.format(value);
}

function formatDate(dateStr: string, timeZone: string): string {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return getDateFormatters(timeZone).date.format(date);
    } catch (e) { return 'Invalid Date'; }
}

function formatHour(dateStr: string, timeZone: string): string {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Hour';
        const hour = getDateFormatters(timeZone).hour.format(date);
        return `${hour === '24' ? '00' : hour}:00`;
    } catch (e) { return 'Invalid Hour'; }
}

function formatDateTime(dateStr: string, timeZone: string): string {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return getDateFormatters(timeZone).dateTime.format(date).replace(',', '');
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

const UNCATEGORIZED_CATEGORY_CODE = 'NO_SKU';
const UNCATEGORIZED_CATEGORY_LABEL = 'No SKU';
const INVALID_PRODUCT_SKUS = new Set(['', '-', 'NULL', 'NULL_RATE_LIMIT']);

function normalizeProductSku(sku: string | undefined | null): string {
    const cleanSku = decodeHTMLEntities(String(sku || '').trim()).toUpperCase();
    return INVALID_PRODUCT_SKUS.has(cleanSku) ? '' : cleanSku;
}

function normalizeCategoryCode(code: string | undefined | null): string {
    const cleanCode = decodeHTMLEntities(String(code || '').trim()).toUpperCase().replace(/[\s\u00A0]+/g, '');
    return cleanCode || UNCATEGORIZED_CATEGORY_CODE;
}

function getCategoryCodeFromSku(sku: string): string {
    if (!sku) return UNCATEGORIZED_CATEGORY_CODE;
    return normalizeCategoryCode(sku.split('-')[0]);
}

function normalizeProductNameKey(name: string): string {
    return removeAccents(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

function getProductIdentity(sku: string, name: string): { key: string; label: string } {
    if (sku) return { key: `sku:${sku}`, label: sku };

    const nameKey = normalizeProductNameKey(name);
    return {
        key: `name:${nameKey || 'unknown'}`,
        label: name || 'Unknown',
    };
}

function updateProductDisplayMeta(target: any, name: string, image: string | undefined | null, dtLocal: string): void {
    const updatedAt = Date.parse(dtLocal) || 0;

    if (!target.name || updatedAt >= (target.nameUpdatedAt || 0)) {
        target.name = name;
        target.nameUpdatedAt = updatedAt;
    }

    if (image && (!target.image || updatedAt >= (target.imageUpdatedAt || 0))) {
        target.image = image;
        target.imageUpdatedAt = updatedAt;
    }
}

function sortTopProductsByNameGroup<T extends { name: string; quantity: number; sku?: string; revenue?: number }>(products: T[]): T[] {
    const groupQuantity = new Map<string, number>();

    products.forEach(product => {
        const nameKey = normalizeProductNameKey(product.name);
        groupQuantity.set(nameKey, (groupQuantity.get(nameKey) || 0) + product.quantity);
    });

    return products.sort((a, b) => {
        const aNameKey = normalizeProductNameKey(a.name);
        const bNameKey = normalizeProductNameKey(b.name);
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
}

function getOptimizedImageProps(src: string | undefined | null): { src: string | null, fullSrc?: string } {
    if (!src) return { src: null };
    if (src.length > 50000 && src.startsWith('data:')) return { src: src.substring(0, 500) };
    
    // Etsy image optimization
    // Convert fullxfull to 75x75 for thumbnail, keep fullxfull for preview
    if (src.includes('etsystatic.com') && src.includes('il_fullxfull.')) {
        return {
            src: src.replace('il_fullxfull.', 'il_75x75.'),
            fullSrc: src
        };
    }
    
    return { src, fullSrc: src };
}


function isRefundedStatus(r: Record): boolean {
    if (!r) return false;
    return r.source === 'Etsy_Refunded' || r.status === 'Refunded';
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

type ShopSummaryAccumulator = {
    revenue: Map<string, number>;
    orders: Set<string>;
    funds: Map<string, number>;
    cost: Map<string, number>;
    refund: Map<string, number>;
    refOrderIds: Set<string>;
};

const createShopSummaryAccumulator = (): ShopSummaryAccumulator => ({
    revenue: new Map(),
    orders: new Set(),
    funds: new Map(),
    cost: new Map(),
    refund: new Map(),
    refOrderIds: new Set(),
});

const getShopSummaryAccumulator = (map: Map<string, ShopSummaryAccumulator>, shopEmail: string) => {
    if (!map.has(shopEmail)) map.set(shopEmail, createShopSummaryAccumulator());
    return map.get(shopEmail)!;
};

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
    categories: any[] = [],
    etsyReviews: any[] = [],
    scope: ProcessingScope = 'all'
): ProcessedData {
    const needsAll = scope === 'all';
    const needsOverview = needsAll || scope === 'overview';
    const needsKpiSummary = needsAll || scope === 'overview';
    const needsProductStats = needsAll || scope === 'products';
    const needsOrderRows = needsAll || scope === 'orders';
    const needsFulfill = needsAll || scope === 'fulfill';
    const needsSupport = needsAll || scope === 'support';
    const canEditFulfillmentData = role === 'owner' || permissions.canEditFulfillmentData === true;
    const accountLabelMap = new Map(accounts.map(acc => [acc.email, acc.label || acc.email]));
    const categoryNameMap = new Map(categories.map(c => [normalizeCategoryCode(c.code), c.name]));
    categoryNameMap.set(UNCATEGORIZED_CATEGORY_CODE, UNCATEGORIZED_CATEGORY_LABEL);



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
    const hasPreviousPeriod = previousRecords !== null;
    const uniquePrevRecords = previousRecords ? deduplicate(previousRecords) : [];

    // --- 2. Preparatory Maps (Status, Cases, Helps) ---
    // These are fast one-pass maps for correlation later
    const statusMap = new Map<string, { status: string, refund_details?: any, refund_dt?: string }>();
    const caseMap = new Map<string, string>();
    const helpMap = new Map<string, string>();
    const reviewMap = new Map<string, any>();
    const validOrderIds = new Set<string>();

    etsyReviews.forEach(rev => {
        if (rev.order_id) reviewMap.set(String(rev.order_id), rev);
    });

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

    // --- Pre-fill overviewDaily to ensure all dates in range are shown even if 0 ---
    if (needsOverview) try {
        let currentDate = new Date(filterDateRange.from + "T00:00:00Z");
        const endDate = new Date(filterDateRange.to + "T00:00:00Z");
        if (!isNaN(currentDate.getTime()) && !isNaN(endDate.getTime()) && currentDate <= endDate) {
            while (currentDate <= endDate) {
                const dKey = currentDate.toISOString().slice(0, 10);
                if (!overviewDaily.has(dKey)) {
                    overviewDaily.set(dKey, { orders: new Set(), rev: new Map(), funds: new Map(), cost: new Map() });
                }
                if (!isHourly && !overviewChart.has(dKey)) {
                    overviewChart.set(dKey, { orders: new Set(), rev: new Map() });
                }
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }
    } catch (e) {
        console.error("Error prefilling dates", e);
    }

    const kpiRaw = { orderIds: new Set<string>(), shops: new Set<string>(), revenue: new Map<string, number>(), funds: new Map<string, number>(), cost: new Map<string, number>(), refOrderIds: new Set<string>(), refund: new Map<string, number>() };
    const shopSummaryData = new Map<string, ShopSummaryAccumulator>();
    
    const pByShop = new Map<string, Map<string, any>>();
    const pByCat = new Map<string, Map<string, any>>();
    const productStatsTableMap = new Map<string, any>();
    const variantStatsTableMap = new Map<string, any>();
    
    const ordersTabRows: any[][] = [];
    const ebayRows: any[][] = [];
    const etsyRows: any[][] = [];
    const caseRows: any[][] = [];
    const helpRows: any[][] = [];
    
    const fulfillRows: any[][] = [];
    const fulfillCounts = { all: new Map<string, number>(), refunded: new Map<string, number>() };
    let fulfillTotalCost = 0;
    const fulfillStats = { totalCount: 0, refCount: 0 };

    uniqueRecords.forEach(r => {
        const currency = r.currency || 'USD';
        const dKey = needsOverview ? formatDate(r.dt_local, timeZone) : '';
        const cKey = needsOverview ? (isHourly ? formatHour(r.dt_local, timeZone) : dKey) : '';
        const shopEmail = r.account;
        const shopLabel = accountLabelMap.get(shopEmail) || shopEmail;
        
        // -- Overview Accumulation --
        if (needsOverview && !overviewDaily.has(dKey)) overviewDaily.set(dKey, { orders: new Set(), rev: new Map(), funds: new Map(), cost: new Map() });
        const od = needsOverview ? overviewDaily.get(dKey)! : null;
        if (needsOverview && !overviewChart.has(cKey)) overviewChart.set(cKey, { orders: new Set(), rev: new Map() });
        const oc = needsOverview ? overviewChart.get(cKey)! : null;

        // -- Record Kind Router --
        if (r.kind === 'order') {
            const sInfo = statusMap.get(r.order_id || '');
            const isRef = isRefundedStatus(r) || sInfo?.status === 'Refunded';
            const isEtsyRefundedSource = r.source === 'Etsy_Refunded';

            if (!isEtsyRefundedSource) {
                // KPIs & Summary
                if (r.order_id) {
                    if (needsKpiSummary) {
                        kpiRaw.orderIds.add(r.order_id);
                        kpiRaw.shops.add(shopEmail);
                    }
                    if (needsOverview) {
                        od!.orders.add(r.order_id);
                        oc!.orders.add(r.order_id);
                    }
                }
                if (r.amount > 0) {
                    if (needsOverview) {
                        od!.rev.set(currency, (od!.rev.get(currency) || 0) + r.amount);
                        oc!.rev.set(currency, (oc!.rev.get(currency) || 0) + r.amount);
                        overviewAllCurrs.rev.add(currency);
                        overviewAllCurrs.chart.add(currency);
                    }
                    if (needsKpiSummary) {
                        kpiRaw.revenue.set(currency, (kpiRaw.revenue.get(currency) || 0) + r.amount);
                    }
                }
                if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) {
                    if (needsOverview) {
                        od!.cost.set('USD', (od!.cost.get('USD') || 0) + r.cost_total);
                        overviewAllCurrs.cost.add('USD');
                    }
                    if (needsKpiSummary) {
                        kpiRaw.cost.set('USD', (kpiRaw.cost.get('USD') || 0) + r.cost_total);
                    }
                }

                // Shop Summary Meta data
                if (needsKpiSummary) {
                    const sd = getShopSummaryAccumulator(shopSummaryData, shopEmail);
                    if (r.order_id) sd.orders.add(r.order_id);
                    if (r.amount > 0) sd.revenue.set(currency, (sd.revenue.get(currency) || 0) + r.amount);
                    if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) sd.cost.set('USD', (sd.cost.get('USD') || 0) + r.cost_total);
                }

                // Product Statistics (Summary & Products Tab)
                if (needsProductStats && r.details?.items?.length) {
                    const financials = r.details.financials;
                    const revenueContext = getOrderItemRevenueContext(r.details.items, financials);

                    r.details.items.forEach(item => {
                        const name = decodeHTMLEntities(item.name.trim());
                        const variant = decodeHTMLEntities(item.variant?.trim() || '');
                        const cleaned = cleanVariantForAggregation(variant);
                        const displayedVariant = formatVariantForDisplay(cleaned);
                        // SKU is the canonical product identity. Product name is only the display label.
                        const sku = normalizeProductSku(item.sku);
                        const rawSku = decodeHTMLEntities(String(item.sku || '').trim()).toUpperCase();
                        const displayedSku = sku || (rawSku === 'NULL' || rawSku === 'NULL_RATE_LIMIT' ? rawSku : '');
                        const productIdentity = getProductIdentity(sku, name);
                        const groupingKey = productIdentity.key;
                        const groupingKeyLower = groupingKey.toLowerCase();
                        
                        const catCode = getCategoryCodeFromSku(sku);

                        const catName = categoryNameMap.get(catCode) || catCode;
                        
                        const itemQuantity = getItemQuantity(item);
                        // Tax is ignored since it's remitted by Etsy and doesn't affect seller's net revenue
                        const itemRevenue = calculateItemNetRevenue(item, revenueContext);
                        
                        const itemRevenueUSD = (currency === 'USD' ? itemRevenue : (exchangeRates?.[currency] ? itemRevenue * exchangeRates[currency] : itemRevenue));
                        const size = extractSize(variant);

                        // Summary Stats
                        if (!pByShop.has(shopLabel)) pByShop.set(shopLabel, new Map());
                        const ps = pByShop.get(shopLabel)!;
                        if (!ps.has(groupingKey)) ps.set(groupingKey, { name, sku, qty: 0, rev: 0, revUSD: 0, image: item.image, cat: catCode, classification: variant, size, currency });
                        const s = ps.get(groupingKey);
                        updateProductDisplayMeta(s, name, item.image, r.dt_local);
                        s.qty += itemQuantity; s.rev += itemRevenue; s.revUSD += itemRevenueUSD;

                        if (!pByCat.has(catCode)) pByCat.set(catCode, new Map());
                        const pc = pByCat.get(catCode)!;
                        if (!pc.has(groupingKey)) pc.set(groupingKey, { name, sku, qty: 0, rev: 0, revUSD: 0, image: item.image, shop: shopLabel, classification: variant, size, currency });
                        const c = pc.get(groupingKey);
                        updateProductDisplayMeta(c, name, item.image, r.dt_local);
                        c.qty += itemQuantity; c.rev += itemRevenue; c.revUSD += itemRevenueUSD;

                        // Detailed Products Tab Map
                        const prodKey = `${groupingKeyLower}|${displayedSku.toLowerCase()}|${displayedVariant}|${shopEmail.toLowerCase()}`;
                        
                        if (!productStatsTableMap.has(prodKey)) {
                            productStatsTableMap.set(prodKey, { 
                                image: item.image, 
                                name, 
                                sku: displayedSku,
                                groupingKey: productIdentity.label,
                                variant: displayedVariant, 
                                category: catName, 
                                categoryCode: catCode, 
                                shop: shopLabel, 
                                quantity: 0, 
                                revenue: 0, 
                                revenueUSD: 0, 
                                currency 
                            });
                        }
                        const pt = productStatsTableMap.get(prodKey);
                        updateProductDisplayMeta(pt, name, item.image, r.dt_local);
                        pt.quantity += itemQuantity; pt.revenue += itemRevenue; pt.revenueUSD += itemRevenueUSD;

                        // Variant aggregation - smarter grouping (no spaces)
                        const varKey = `${catName}|${displayedVariant}`;
                        
                        if (!variantStatsTableMap.has(varKey)) {
                            variantStatsTableMap.set(varKey, { 
                                category: catName, 
                                categoryCode: catCode, 
                                variant: displayedVariant, 
                                quantity: 0, 
                                revenue: 0, 
                                revenueUSD: 0, 
                                currency 
                            });
                        }
                        const vt = variantStatsTableMap.get(varKey);
                        vt.quantity += itemQuantity; vt.revenue += itemRevenue; vt.revenueUSD += itemRevenueUSD;



                    });
                }

                // Tab Specific Rows (Orders, Etsy, eBay)
                if (needsOrderRows) {
                const shopPName = (r.details?.items?.length ? r.details.items.map(i => decodeHTMLEntities(i.name)).join(', ') : '') || r.product_name || 'N/A';
                const pImg = r.details?.items?.[0]?.image || null;
                const pVars = r.details?.items?.length ? r.details.items.map(i => decodeHTMLEntities(i.variant)).filter(v => v).join('; ') : '-';
                const finalStatus = sInfo?.status || r.status || (isRef ? 'Refunded' : 'New'); // Đảm bảo trạng thái refund đồng nhất
                const refundDtStr = sInfo?.refund_dt ? formatDateTime(sInfo.refund_dt, timeZone) : '';
                const dateDisplay = formatDateTime(r.dt_local, timeZone);
                const finalDateCell = (isRef && refundDtStr) ? { type: 'text_with_subtitle' as const, main: dateDisplay, subtitle: `Refund: ${refundDtStr}`, subtitleClass: 'text-red-600 font-bold bg-red-100 rounded px-1' } : dateDisplay;

                const reviewData = r.order_id ? reviewMap.get(r.order_id) : null;
                const rating = reviewData?.rating || '-';
                let provider = r.fulfill_provider;
                if (!provider || provider === '-') {
                    const ffCode = r.ff_code || '-';
                    provider = ffCode.startsWith('PWN') ? 'Printway' : (ffCode !== '-' && ffCode !== 'owner' ? 'Merchize' : '-');
                }

                const commonOrderRow = [
                    { type: 'image' as const, ...getOptimizedImageProps(pImg), alt: shopPName }, shopPName, pVars, r.order_id || 'N/A', r.amount, currency,
                    canEditFulfillmentData ? { type: 'editable_cost' as const, value: r.cost_total ?? null, recordId: r.id!, isManual: !!r.is_manual_cost } : (r.cost_total ?? null),
                    canEditFulfillmentData ? { type: 'editable_provider' as const, value: provider, recordId: r.id! } : provider,
                    canEditFulfillmentData ? { type: 'editable_ffcode' as const, value: r.ff_code || null, recordId: r.id! } : (r.ff_code || '-'),
                    rating, r.order_id && caseMap.has(r.order_id) ? caseMap.get(r.order_id) : 'No',
                    r.order_id && helpMap.has(r.order_id) ? helpMap.get(r.order_id) : 'No', shopLabel,
                    finalDateCell, formatSource(r.source), r.id, r.dt_local, r.source, finalStatus === 'Refunded'
                ];
                ordersTabRows.push(commonOrderRow);

                if (r.source === 'Etsy_Sales') {
                    etsyRows.push([{ type: 'image' as const, ...getOptimizedImageProps(pImg), alt: shopPName }, shopPName, r.order_id || 'N/A', r.amount, currency, shopLabel, finalDateCell, { type: 'action_group', actions: r.id ? [{ type: 'view', label: 'View', id: r.id }] : [] }, finalStatus === 'Refunded', r.dt_local]);
                } else if (r.source === 'Ebay_Sales') {
                    ebayRows.push([{ type: 'image' as const, ...getOptimizedImageProps(pImg), alt: shopPName }, shopPName, r.order_id || 'N/A', r.amount, currency, shopLabel, finalDateCell, { type: 'action_group', actions: r.id ? [{ type: 'view', label: 'View', id: r.id }] : [] }, finalStatus === 'Refunded', r.dt_local]);
                }
                }

                // Fulfillment logic
                if (needsFulfill && (r.fulfill_provider || r.ff_code || r.cost_total || r.product_name)) {
                    fulfillStats.totalCount++;
                    if (isRef) fulfillStats.refCount++; // Chỉ đếm refund cho các record có dữ liệu fulfillment

                    const ffCode = r.ff_code || '-';
                    if (r.cost_total) fulfillTotalCost += r.cost_total;
                    let provider = r.fulfill_provider;
                    if (!provider || provider === '-') provider = ffCode.startsWith('PWN') ? 'Printway' : (ffCode !== '-' && ffCode !== 'owner' ? 'Merchize' : '-');
                    
                    const ffDateVal = formatDate(r.fulfill_date || r.dt_local, timeZone);
                    const refDateOnlyStr = sInfo?.refund_dt ? formatDate(sInfo.refund_dt, timeZone) : '';
                    const finalFfDateCell = (isRef && refDateOnlyStr) ? { type: 'text_with_subtitle' as const, main: ffDateVal, subtitle: `Refund: ${refDateOnlyStr}`, subtitleClass: 'text-red-600 font-bold bg-red-100 rounded px-1' } : ffDateVal;

                    fulfillRows.push([
                        finalFfDateCell, r.order_id || 'N/A',
                        isRef ? { type: 'text_with_subtitle' as const, main: r.product_name || '-', subtitle: `Refund: ${r.refund_details?.reason || sInfo?.refund_details?.reason || 'Refunded'}`, subtitleClass: 'text-red-500 font-medium' } : (r.product_name || '-'),
                        canEditFulfillmentData ? { type: 'editable_provider' as const, value: provider, recordId: r.id! } : provider,
                        canEditFulfillmentData ? { type: 'editable_ffcode' as const, value: r.ff_code || null, recordId: r.id! } : ffCode,
                        canEditFulfillmentData ? { type: 'editable_cost' as const, value: r.cost_total ?? null, recordId: r.id!, isManual: !!r.is_manual_cost } : (r.cost_total ?? null),
                        shopLabel, isRef, r.fulfill_date || r.dt_local
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
                if (needsKpiSummary) {
                const refundCurr = r.refund_details?.refundCurrency || currency;
                const refundAmt = r.refund_details?.refundAmount || Math.abs(r.amount);
                kpiRaw.refOrderIds.add(r.order_id);
                kpiRaw.refund.set(refundCurr, (kpiRaw.refund.get(refundCurr) || 0) + refundAmt);
                
                const sd = getShopSummaryAccumulator(shopSummaryData, shopEmail);
                sd.refOrderIds.add(r.order_id);
                sd.refund.set(refundCurr, (sd.refund.get(refundCurr) || 0) + refundAmt);
                }
            }

        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewKpiFunds)) {
            if (needsOverview) {
            od!.funds.set(currency, (od!.funds.get(currency) || 0) + r.amount);
            overviewAllCurrs.funds.add(currency);
            }
            if (needsKpiSummary) {
            kpiRaw.funds.set(currency, (kpiRaw.funds.get(currency) || 0) + r.amount);
            
            const sd = getShopSummaryAccumulator(shopSummaryData, shopEmail);
            sd.funds.set(currency, (sd.funds.get(currency) || 0) + r.amount);
            }

        } else if (needsSupport && r.kind === 'case') {
            caseRows.push([r.order_id || 'N/A', decodeHTMLEntities(r.case_msg || 'N/A'), formatSource(r.source), shopLabel, formatDateTime(r.dt_local, timeZone), r.dt_local]);
        } else if (needsSupport && r.kind === 'help') {
            helpRows.push([r.order_id || 'N/A', decodeHTMLEntities(r.help_kind || 'N/A'), formatSource(r.source), shopLabel, formatDateTime(r.dt_local, timeZone), r.dt_local]);
        }
    });

    // -- Add Manual Costs to KPI & Daily --
    if ((needsOverview || needsKpiSummary || needsFulfill) && (role === 'owner' || permissions.viewKpiCost)) {
        manualCosts.filter(c => c.date >= filterDateRange.from && c.date <= filterDateRange.to).forEach(c => {
            const cur = c.currency || 'USD';
            const costUSD = (cur === 'USD' ? c.cost : (exchangeRates?.[cur] ? c.cost * exchangeRates[cur] : c.cost));
            if (needsKpiSummary) kpiRaw.cost.set('USD', (kpiRaw.cost.get('USD') || 0) + costUSD);
            
            const dKey = c.date;
            if (needsOverview) {
                if (!overviewDaily.has(dKey)) overviewDaily.set(dKey, { orders: new Set(), rev: new Map(), funds: new Map(), cost: new Map() });
                overviewDaily.get(dKey)!.cost.set('USD', (overviewDaily.get(dKey)!.cost.get('USD') || 0) + costUSD);
                overviewAllCurrs.cost.add('USD');
            }

            // Add manual fulfill rows
            if (needsFulfill) {
            fulfillRows.push([c.date, "N/A (Manual)", "N/A (Manual)", c.providerName, "owner", costUSD, "Manual Entry", false, c.date]);
            fulfillTotalCost += costUSD;
            fulfillStats.totalCount++; // Tăng count để refund rate chính xác
            }
        });
    }

    // --- 4. Previous Period KPIs Loop ---
    const pKpiRaw = { orderIds: new Set<string>(), revenue: new Map<string, number>(), funds: new Map<string, number>(), cost: new Map<string, number>() };
    const previousShopSummaryData = new Map<string, ShopSummaryAccumulator>();
    if (needsKpiSummary) uniquePrevRecords.forEach(r => {
        const cur = r.currency || 'USD';
        if (r.kind === 'order' && r.source !== 'Etsy_Refunded') {
            const previousShop = getShopSummaryAccumulator(previousShopSummaryData, r.account);
            if (r.order_id) pKpiRaw.orderIds.add(r.order_id);
            if (r.amount > 0) pKpiRaw.revenue.set(cur, (pKpiRaw.revenue.get(cur) || 0) + r.amount);
            if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) pKpiRaw.cost.set('USD', (pKpiRaw.cost.get('USD') || 0) + r.cost_total);
            if (r.order_id) previousShop.orders.add(r.order_id);
            if (r.amount > 0) previousShop.revenue.set(cur, (previousShop.revenue.get(cur) || 0) + r.amount);
            if (r.cost_total && r.cost_total > 0 && (role === 'owner' || permissions.viewKpiCost)) previousShop.cost.set('USD', (previousShop.cost.get('USD') || 0) + r.cost_total);
        } else if (r.kind === 'Funds' && r.amount > 0 && (role === 'owner' || permissions.viewKpiFunds)) {
            const previousShop = getShopSummaryAccumulator(previousShopSummaryData, r.account);
            pKpiRaw.funds.set(cur, (pKpiRaw.funds.get(cur) || 0) + r.amount);
            previousShop.funds.set(cur, (previousShop.funds.get(cur) || 0) + r.amount);
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
    const previousPeriodLabel = getPreviousPeriodLabel(filterDateRange);

    const transformKpiMap = (curr: Map<string, number>, prev: Map<string, number>) => {
        const res: any = {};
        const all = hasPreviousPeriod
            ? new Set([...Array.from(curr.keys()), ...Array.from(prev.keys())])
            : new Set(Array.from(curr.keys()));
        all.forEach(c => {
            const v = curr.get(c) || 0;
            const p = prev.get(c) || 0;
            if (v < 0.01 && p < 0.01) return;
            res[c] = {
                value: formatCurrency(v),
                ...(hasPreviousPeriod
                    ? {
                        previousValue: formatCurrency(p),
                        previousLabel: previousPeriodLabel,
                        ...calculatePercentageChange(v, p)
                    }
                    : {})
            };
        });
        return res;
    };

    /**
     * Enhances a per-currency KPI map with USD totals and refund info.
     * Type-safe, immutable, and handles conversion for all currencies.
     */
    const addUSDToKpi = (
        kpiMap: { [currency: string]: KpiValue },
        rawMap: Map<string, number>,
        previousRawMap?: Map<string, number>,
        refundMap?: Map<string, number>
    ): { [currency: string]: KpiValue } => {
        if (!exchangeRates) return kpiMap;

        let totalUSD = 0;
        let previousTotalUSD = 0;
        let totalRefundUSD = 0;
        const result: { [currency: string]: KpiValue } = {};

        // 1. Process main currency entries
        Object.entries(kpiMap).forEach(([currency, val]) => {
            const rate = exchangeRates[currency] || (currency === 'USD' ? 1 : 0);
            const usd = (rawMap.get(currency) || 0) * rate;
            const previousUSD = (previousRawMap?.get(currency) || 0) * rate;
            totalUSD += usd;
            previousTotalUSD += previousUSD;

            const refundOriginal = refundMap?.get(currency) || 0;
            const refundUSD = refundOriginal * rate;

            result[currency] = {
                ...val,
                usdValue: usd,
                conversionRate: rate,
                ...(refundOriginal > 0 ? { refundOriginal, refundUSD } : {})
            };
        });

        // 2. Global refund calculation (includes currencies not in rawMap/kpiMap)
        if (refundMap) {
            refundMap.forEach((amt, curr) => {
                const rate = exchangeRates[curr] || (curr === 'USD' ? 1 : 0);
                totalRefundUSD += amt * rate;
            });
        }

        // 3. Add USD_TOTAL entry
        result['USD_TOTAL'] = {
            value: formatCurrency(totalUSD),
            ...(hasPreviousPeriod
                ? {
                    previousValue: formatCurrency(previousTotalUSD),
                    previousLabel: previousPeriodLabel,
                    ...calculatePercentageChange(totalUSD, previousTotalUSD)
                }
                : {}),
            conversionDetails: { 
                originalAmounts: Object.fromEntries(rawMap), 
                rates: exchangeRates 
            },
            ...(totalRefundUSD > 0 ? { 
                refundInfo: `${formatCurrency(totalRefundUSD)} refunded`,
                refundUSD: totalRefundUSD 
            } : {})
        };

        return result;
    };

    const kpis: KpiData = {
        'Total Orders': { 
            value: kpiRaw.orderIds.size.toString(), 
            ...(hasPreviousPeriod
                ? {
                    previousValue: pKpiRaw.orderIds.size.toString(),
                    previousLabel: previousPeriodLabel,
                    ...calculatePercentageChange(kpiRaw.orderIds.size, pKpiRaw.orderIds.size)
                }
                : {}),
            refundInfo: kpiRaw.refOrderIds.size > 0 ? `${kpiRaw.refOrderIds.size} refunded` : undefined 
        },
        'Shops': { value: kpiRaw.shops.size.toString() },
        'Revenue': addUSDToKpi(transformKpiMap(kpiRaw.revenue, pKpiRaw.revenue), kpiRaw.revenue, pKpiRaw.revenue, kpiRaw.refund)
    };
    if (role === 'owner' || permissions.viewKpiFunds) kpis['Funds'] = addUSDToKpi(transformKpiMap(kpiRaw.funds, pKpiRaw.funds), kpiRaw.funds, pKpiRaw.funds);
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
            ...(hasPreviousPeriod
                ? {
                    previousValue: formatCurrency(pEarnUSD),
                    previousLabel: previousPeriodLabel,
                    ...calculatePercentageChange(earnUSD, pEarnUSD)
                }
                : {}),
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

    const sumMap = (m: Map<string, number>) => Array.from(m.values()).reduce((sum, value) => sum + value, 0);
    const getDeltaDirection = (current: number, previous: number) => calculatePercentageChange(current, previous).direction;
    const getDeltaSuffix = (current: number, previous: number) => {
        const delta = calculatePercentageChange(current, previous);
        if (delta.direction === 'neutral') return '0.0%';
        if (delta.change === Infinity) return 'New';
        return `${delta.change.toFixed(1)}%`;
    };
    const makePreviousSubtitle = (previousDisplay: string, currentValue: number, previousValue: number) =>
        `${previousPeriodLabel}: ${previousDisplay} (${getDeltaSuffix(currentValue, previousValue)})`;
    const withPreviousSubtitle = (
        cell: any,
        currentValue: number,
        previousDisplay: string,
        previousValue: number,
        previousAmountMap?: { [c: string]: number }
    ) => {
        if (!hasPreviousPeriod) return cell;
        const subtitle = makePreviousSubtitle(previousDisplay, currentValue, previousValue);
        const trendDirection = getDeltaDirection(currentValue, previousValue);
        const currentClass = 'text-gray-900 dark:text-white';
        const previousClass = 'text-gray-400 dark:text-gray-500 font-medium';

        if (cell && typeof cell === 'object' && cell.type === 'text_with_subtitle') {
            return {
                ...cell,
                mainClass: currentClass,
                trendDirection,
                subtitle,
                subtitleClass: previousClass,
                subtitleLabel: previousPeriodLabel,
                subtitleValue: previousDisplay,
                subtitleAmountMap: previousAmountMap,
                subtitleDelta: getDeltaSuffix(currentValue, previousValue),
                subtitleDeltaDirection: trendDirection,
                extraSubtitle: cell.subtitle,
                extraSubtitleClass: cell.subtitleClass,
                extraSubtitleLabel: 'Refund',
                extraSubtitleAmountMap: cell.subtitleAmountMap
            };
        }

        if (cell && typeof cell === 'object' && cell.type === 'value_with_unit') {
            return {
                type: 'text_with_subtitle' as const,
                main: cell.display,
                mainClass: currentClass,
                trendDirection,
                subtitle,
                subtitleClass: previousClass,
                mainAmountMap: cell.amountMap,
                subtitleAmountMap: previousAmountMap,
                subtitleLabel: previousPeriodLabel,
                subtitleValue: previousDisplay,
                subtitleDelta: getDeltaSuffix(currentValue, previousValue),
                subtitleDeltaDirection: trendDirection,
                value: currentValue
            };
        }

        return {
            type: 'text_with_subtitle' as const,
            main: String(cell),
            mainClass: currentClass,
            trendDirection,
            subtitle,
            subtitleClass: previousClass,
            subtitleLabel: previousPeriodLabel,
            subtitleValue: previousDisplay,
            subtitleDelta: getDeltaSuffix(currentValue, previousValue),
            subtitleDeltaDirection: trendDirection,
            value: currentValue
        };
    };

    const summaryShopKeys = new Set([...Array.from(shopSummaryData.keys()), ...Array.from(previousShopSummaryData.keys())]);
    const summaryRows = Array.from(summaryShopKeys).map((acc) => {
        const data = shopSummaryData.get(acc) || createShopSummaryAccumulator();
        const previousData = previousShopSummaryData.get(acc) || createShopSummaryAccumulator();
        const rev = formatMix(data.revenue), ref = formatMix(data.refund), funds = formatMix(data.funds);
        const previousRev = formatMix(previousData.revenue);
        const previousFunds = formatMix(previousData.funds);
        const costValue = sumMap(data.cost);
        const previousCostValue = sumMap(previousData.cost);
        const earnValue = (funds.value || 0) - costValue;
        const previousEarnValue = (previousFunds.value || 0) - previousCostValue;
        const orderCell = data.refOrderIds.size > 0
            ? { type: 'text_with_subtitle' as const, main: data.orders.size.toString(), subtitle: `Refund: ${data.refOrderIds.size}`, subtitleClass: 'text-red-500 font-medium' }
            : data.orders.size;
        const revenueCell = ref.value > 0
            ? { type: 'text_with_subtitle' as const, main: rev.display, subtitle: `Refund: ${ref.display}`, subtitleClass: 'text-red-500 font-medium', mainAmountMap: rev.map, subtitleAmountMap: ref.map }
            : { type: 'value_with_unit' as const, value: rev.value, display: rev.display, amountMap: rev.map };
        return [
            accountLabelMap.get(acc) || acc,
            withPreviousSubtitle(orderCell, data.orders.size, previousData.orders.size.toString(), previousData.orders.size),
            withPreviousSubtitle(revenueCell, rev.value, previousRev.display, previousRev.value, previousRev.map),
            ...((role === 'owner' || permissions.viewKpiFunds) ? [withPreviousSubtitle({ type: 'value_with_unit' as const, value: funds.value, display: funds.display, amountMap: funds.map }, funds.value, previousFunds.display, previousFunds.value, previousFunds.map)] : []),
            ...((role === 'owner' || permissions.viewKpiCost) ? [withPreviousSubtitle({ type: 'value_with_unit' as const, value: costValue, display: formatCurrency(costValue), amountMap: { 'USD': costValue } }, costValue, formatCurrency(previousCostValue), previousCostValue, { 'USD': previousCostValue })] : []),
            ...((role === 'owner' || permissions.viewKpiEarn) ? [withPreviousSubtitle({ 
                type: 'value_with_unit' as const, 
                value: earnValue, 
                display: formatCurrency(earnValue), 
                amountMap: { 'USD': earnValue } 
            }, earnValue, formatCurrency(previousEarnValue), previousEarnValue, { 'USD': previousEarnValue })] : [])
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
            res[key] = sortTopProductsByNameGroup(Array.from(map.entries()).map(([n, s]: [any, any]) => ({
                sku: s.sku || '', name: s.name || (String(n).startsWith('name:') ? String(n).slice(5) : String(n)), quantity: s.qty, revenue: s.rev, revenueUSD: s.revUSD, image: s.image,
                category: s.cat || key, shop: s.shop || key, classification: s.classification, size: s.size, currency: s.currency
            })));
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
    const finalProductRows = Array.from(productStatsTableMap.values()).sort((a, b) => {
        const catCmp = a.categoryCode.localeCompare(b.categoryCode);
        if (catCmp !== 0) return catCmp;
        return b.revenue - a.revenue;
    }).map(p => [
        { type: 'image', ...getOptimizedImageProps(p.image), alt: p.name }, p.sku || '', p.name, p.category, p.variant, p.shop, p.quantity,
        { type: 'value_with_unit', value: p.revenue, display: `${formatNumber(p.revenue)} ${p.currency}` },
        p.currency, p.revenue, p.categoryCode, p.groupingKey
    ]);

    const finalVariantRows = Array.from(variantStatsTableMap.values()).sort((a, b) => b.revenue - a.revenue).map(v => [
        v.category, v.variant, v.quantity,
        { type: 'value_with_unit', value: v.revenue, display: `${formatNumber(v.revenue)} ${v.currency}` },
        v.currency, v.revenue, v.categoryCode
    ]);

    return {
        overview: { table: { headers: overviewHeaders, rows: overviewRows as any }, chartData: overviewChartData },
        orders: { headers: ["Image", "Product Name", "Variants", "Order ID", "Revenue", "Curren", "Cost", "Provider", "FF Code", "Rating", "Case", "Help", "Account", "Date", "Source"], rows: ordersTabRows.sort((a, b) => (b[16] || '').localeCompare(a[16] || '')) },
        ebay: { headers: ["Image", "Product Name", "Order Number", "Revenue", "Currency", "Account", "Date", "Actions"], rows: ebayRows.sort((a, b) => (b[9] || '').localeCompare(a[9] || '')) },
        etsy: { headers: ["Image", "Product Name", "Order Number", "Revenue", "Currency", "Account", "Date", "Actions"], rows: etsyRows.sort((a, b) => (b[9] || '').localeCompare(a[9] || '')) },
        cases: { headers: ["Order Number", "Message", "Source", "Account", "Date"], rows: caseRows.sort((a, b) => (b[5] || '').localeCompare(a[5] || '')) },
        help: { headers: ["Order Number", "Help Kind", "Source", "Account", "Date"], rows: helpRows.sort((a, b) => (b[5] || '').localeCompare(a[5] || '')) },
        fulfill: {
            table: { headers: ["Date", "Order Number", "Product Name", "Provider", "Fulfillment Code", "Cost (USD)", "Shop Account"], rows: fulfillRows.sort((a, b) => (b[8] || '').localeCompare(a[8] || '')) as any },
            merchizeChartData: [], printwayChartData: [], // Opt: Removed redundant provider-specific chart calculations
            allProductChartData: processCounts(fulfillCounts.all), refundedChartData: processCounts(fulfillCounts.refunded),
            totalCost: fulfillTotalCost, refundRate: fulfillStats.totalCount > 0 ? (fulfillStats.refCount / fulfillStats.totalCount) * 100 : 0
        },

        summary: {
            kpis, table: { headers: ["Shop", "Orders", "Revenue", ...((role === 'owner' || permissions.viewKpiFunds) ? ["Funds"] : []), ...((role === 'owner' || permissions.viewKpiCost) ? ["Cost (USD)"] : []), ...((role === 'owner' || permissions.viewKpiEarn) ? ["Earn"] : [])], rows: summaryRows as any },
            chartData: summaryChartData, topProductsByShop: transformStats(pByShop), topProductsByCategory: transformStats(pByCat), topProductsBySize: {}, categoryComparison: catComp
        },
        products: { headers: ['Image', 'SKU', 'Product Name', 'Category', 'Variant/Size', 'Shop', 'Quantity', 'Revenue'], rows: finalProductRows },
        variants: { headers: ['Category', 'Variant/Size', 'Quantity', 'Revenue'], rows: finalVariantRows }
    };
}
