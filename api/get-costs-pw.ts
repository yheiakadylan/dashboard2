// File: api/get-costs-pw.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { CostData, Record, FulfillmentAccount } from './_lib/types.js';

// --- START: Printway Functions ---
const formatPrintwayDate = (date: Date): string => date.toISOString().replace('T', ' ').substring(0, 19);

const normalizeOrderId = (rawId: string): string => {
    const match = rawId.match(/^#?(\d+)/);
    return match ? match[1] : rawId.replace(/^#/, '').trim();
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

async function fetchPrintwayCostsForSlice(dateRange: { from: string, to: string }, account: FulfillmentAccount): Promise<CostData[]> {
    const allCosts: CostData[] = [];
    let page = 1;
    const limit = 100;

    while (true) {
        const params = new URLSearchParams({
            created_at_min: dateRange.from,
            created_at_max: dateRange.to,
            limit: limit.toString(),
            page: page.toString(),
        });
        const url = `${account.base_url}/order/list?${params.toString()}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'pw-access-token': account.api_token,
                    'Authorization': `Bearer ${account.api_token}`,
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                console.error(`Printway API error for slice ${dateRange.from}-${dateRange.to}: ${response.statusText}`);
                break;
            }
            const data = await response.json();
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

async function fetchPrintwayCosts(dateRange: { from: string, to: string }, account: FulfillmentAccount): Promise<CostData[]> {
    if (!account.base_url || !account.api_token) {
        return [];
    }
    const slices = sliceTimeRange(new Date(dateRange.from), new Date(dateRange.to), 24);
    const slicePromises = slices.map(slice => fetchPrintwayCostsForSlice(slice, account));
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
        const { records, accounts } = req.body as { records: Record[], accounts: FulfillmentAccount[] };
        if (!records || !Array.isArray(records)) {
            return res.status(400).json({ message: 'Missing "records" array in request body.' });
        }
        
        const printwayAccounts = (accounts || []).filter(a => a.provider === 'printway');
        if (printwayAccounts.length === 0) {
             return res.status(200).json({});
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
        let maxDate = new Date(Math.max(...dates));
        
        minDate.setDate(minDate.getDate() - 1);
        maxDate.setDate(maxDate.getDate() + 14); // Extended to +14 days to catch delayed fulfillment
        
        // Cap maxDate to current time to avoid unnecessary API requests into the future
        const now = new Date();
        if (maxDate > now) {
             maxDate = now;
        }
        
        const printwayDateRange = { from: minDate.toISOString(), to: maxDate.toISOString() };

        const printwayDataArrays = await Promise.all(printwayAccounts.map(acc => fetchPrintwayCosts(printwayDateRange, acc)));
        const printwayData = printwayDataArrays.flat();

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