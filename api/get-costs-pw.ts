// File: api/get-costs-pw.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { printwayConfig } from './_lib/fulfillmentConfig.js';
import type { CostData, Record } from './_lib/types.js';

// --- START: Printway Functions ---
const formatPrintwayDate = (date: Date): string => date.toISOString().replace('T', ' ').substring(0, 19);

// Helper: Normalize Order ID via Regex (Extract first numeric sequence)
const normalizeOrderId = (rawId: string): string => {
    const match = rawId.match(/^(\d+)/);
    return match ? match[1] : rawId;
};

const sliceTimeRange = (startDt: Date, endDt: Date, hoursPerSlice: number): { from: string, to: string }[] => {
    const slices: { from: string, to: string }[] = [];
    let current = new Date(startDt);
    const step = hoursPerSlice * 60 * 60 * 1000;
    while (current < endDt) {
        const next = new Date(Math.min(endDt.getTime(), current.getTime() + step));
        slices.push({ from: formatPrintwayDate(current), to: formatPrintwayDate(next) });
        current = next;
    }
    return slices;
};

async function fetchPrintwayCostsForSlice(dateRange: { from: string, to: string }): Promise<CostData[]> {
    const allCosts: CostData[] = [];
    let page = 1;
    const limit = printwayConfig.limit;

    while (true) {
        const params = new URLSearchParams({
            created_at_min: dateRange.from,
            created_at_max: dateRange.to,
            limit: limit.toString(),
            page: page.toString(),
        });
        const url = `${printwayConfig.base_url}/order/list?${params.toString()}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'pw-access-token': printwayConfig.access_token,
                    'Authorization': `Bearer ${printwayConfig.access_token}`,
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                console.error(`Printway API error for slice ${dateRange.from}-${dateRange.to}: ${response.statusText}`);
                break;
            }
            const data = await response.json();
            console.log(`>>> [DEBUG] Printway Raw Data (${dateRange.from} TO ${dateRange.to}):`, JSON.stringify(data, null, 2));
            const orders = data.orders || data.data || [];
            if (orders.length === 0) break;

            for (const order of orders) {
                const orderName = order.order_name?.trim();
                if (orderName) {

                    // --- BẮT ĐẦU THAY ĐỔI: Lấy product_name & Fuzzy Match ID ---
                    let product_name = 'N/A';
                    if (Array.isArray(order.orderitems) && order.orderitems.length > 0) {
                        product_name = order.orderitems
                            .map((item: any) => item.product_name || 'Unknown')
                            .join(', ');
                    }

                    const normalizedId = normalizeOrderId(orderName);

                    allCosts.push({
                        order_id: normalizedId, // Use normalized ID
                        cost_total: parseFloat(order.total_price || 0),
                        ff_code: String(order.pw_order_id).trim() || '',
                        currency: order.currency || 'USD',
                        product_name: product_name,
                    });
                }
            }
            if (orders.length < limit) break;
            page++;
        } catch (error) {
            console.error(`Failed to fetch Printway slice ${dateRange.from}-${dateRange.to}.`, error);
            break;
        }
    }
    return allCosts;
}

async function fetchPrintwayCosts(dateRange: { from: string, to: string }): Promise<CostData[]> {
    if (!printwayConfig.base_url || !printwayConfig.access_token) {
        return [];
    }
    const slices = sliceTimeRange(new Date(dateRange.from), new Date(dateRange.to), 24);
    const slicePromises = slices.map(fetchPrintwayCostsForSlice);
    const results = await Promise.all(slicePromises);
    return results.flat();
}
// --- END: Printway Functions ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: 'Only POST requests are allowed.' });
    }

    try {
        const { records } = req.body as { records: Record[] };
        if (!records || !Array.isArray(records)) {
            return res.status(400).json({ message: 'Missing "records" array in request body.' });
        }

        const orderRecords = records.filter(r => r.kind === 'order' && r.order_id);
        if (orderRecords.length === 0) {
            return res.status(200).json({});
        }

        const dates = orderRecords.map(r => new Date(r.dt_local).getTime()).filter(t => !isNaN(t));
        if (dates.length === 0) {
            return res.status(200).json({}); // No valid dates to query
        }

        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        minDate.setDate(minDate.getDate() - 1);
        maxDate.setDate(maxDate.getDate() + 1);
        const printwayDateRange = { from: minDate.toISOString(), to: maxDate.toISOString() };

        const printwayData = await fetchPrintwayCosts(printwayDateRange);

        // --- CẬP NHẬT LOGIC MERGE ---
        const costMap: { [key: string]: CostData } = {};
        for (const item of printwayData) {
            if (costMap[item.order_id]) {
                costMap[item.order_id].cost_total += item.cost_total;
                if (!costMap[item.order_id].ff_code && item.ff_code) {
                    costMap[item.order_id].ff_code = item.ff_code;
                }
                // Thêm merge product_name
                if (!costMap[item.order_id].product_name && item.product_name) {
                    costMap[item.order_id].product_name = item.product_name;
                }
            } else {
                costMap[item.order_id] = { ...item };
            }
        }
        // --- KẾT THÚC CẬP NHẬT ---

        return res.status(200).json(costMap);
    } catch (error) {
        console.error('[API /get-costs-pw Error]', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}