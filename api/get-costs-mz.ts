// File: api/get-costs-mz.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { CostData, Record, FulfillmentAccount } from './_lib/types.js';

// --- START: Merchize Catalog Cache ---

// Cache này sẽ lưu Map<VariantSKU, ProductName>
let skuToNameMaps: { [accountId: string]: Map<string, string> } = {};
let lastCatalogFetches: { [accountId: string]: number } = {};
const CATALOG_CACHE_TTL = 3600 * 1000; // Cache trong 1 giờ

/**
 * Lấy toàn bộ catalog từ Merchize và tạo map tra cứu SKU -> Tên sản phẩm
 */
async function fetchAndCacheMerchizeCatalog(account: FulfillmentAccount): Promise<Map<string, string>> {
    const now = Date.now();
    const map = skuToNameMaps[account.id];
    const lastFetch = lastCatalogFetches[account.id] || 0;
    // Nếu cache còn hạn, trả về cache
    if (map && (now - lastFetch < CATALOG_CACHE_TTL)) {
        return map;
    }

    const newMap = new Map<string, string>();
    let page = 1;
    const limit = 50;
    
    try {
        while (true) {
            const apiUrl = `${account.base_url}/product/catalog?limit=${limit}&page=${page}`;
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${account.api_token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                console.error(`Failed to fetch Merchize catalog page ${page}: ${response.statusText}`);
                break;
            }

            const data = await response.json();
            if (!data.success || !data.data || !Array.isArray(data.data.products)) {
                console.error("Merchize catalog API response format error.");
                break;
            }

            const products = data.data.products;
            for (const product of products) {
                // Tên sản phẩm chính (e.g., "All-over Print Pajamas")
                const productName = product.title || 'Unknown Product';
                
                if (Array.isArray(product.variants)) {
                    for (const variant of product.variants) {
                        // SKU của variant (e.g., "LSRLVN000000AA00")
                        if (variant.sku) {
                            newMap.set(variant.sku, productName);
                        }
                    }
                }
            }

            // Dừng lại nếu đây là trang cuối cùng
            if (products.length < limit || data.data.total <= page * limit) {
                break;
            }
            page++;
        }
    } catch (e) {
        console.error("Exception during Merchize catalog fetch:", e);
        // Không cập nhật cache nếu lỗi, trả về cache cũ (nếu có)
        return skuToNameMaps[account.id] || newMap; 
    }

    skuToNameMaps[account.id] = newMap;
    lastCatalogFetches[account.id] = now;
    return newMap;
}

// --- END: Merchize Catalog Cache ---


// --- START: Merchize Functions ---
const chunkArray = <T>(array: T[], size: number): T[][] => {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
};

async function fetchMerchizeCosts(orderIds: string[], account: FulfillmentAccount): Promise<CostData[]> {
    if (!account.base_url || !account.api_token || orderIds.length === 0) {
        return [];
    }

    // 1. Lấy map SKU -> Tên sản phẩm (từ cache hoặc API)
    const catalogMap = await fetchAndCacheMerchizeCatalog(account);

    const allCosts: CostData[] = [];
    // Reduce chunk size to 50 since we send 2 requests per order ID
    const chunks = chunkArray(orderIds, 50);

    for (const chunk of chunks) {
        try {
            const ordersPayload = chunk.flatMap(id => {
                const cleanId = id.replace(/^#/, '').trim();
                return [
                    { code: "", external_number: cleanId, identifier: "" },
                    { code: "", external_number: `#${cleanId}`, identifier: "" }
                ];
            });
            const requestBody = {
                orders: ordersPayload
            };
            
            const apiUrl = `${account.base_url}/order/external/orders/list-orders-detail`;
            
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${account.api_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
            });

            const responseText = await response.text();
            
            if (!response.ok) {
                console.error("Raw Response Body on Error:", responseText);
                continue; 
            }

            if (responseText) {
                const data = JSON.parse(responseText);
                if (data.success && Array.isArray(data.data)) {
                    for (const orderData of data.data) {
                        const rawExternalNumber = orderData.external_number?.trim();
                        if (rawExternalNumber) {
                            const externalNumber = rawExternalNumber.replace(/^#/, '').trim();

                            // --- BẮT ĐẦU THAY ĐỔI: Lấy product_name ---
                            let product_name = 'N/A';
                            if (Array.isArray(orderData.items) && orderData.items.length > 0) {
                                product_name = orderData.items
                                    .map((item: any) => {
                                        // Dùng SKU (e.g., STKRVN000000DA59) để tra cứu tên từ catalog
                                        // Nếu không thấy, dùng title (e.g., "Gus sticker") làm fallback
                                        return catalogMap.get(item.sku) || item.title || 'Unknown';
                                    })
                                    .join(', ');
                            }
                            // --- KẾT THÚC THAY ĐỔI ---

                            allCosts.push({
                                order_id: externalNumber,
                                cost_total: parseFloat(orderData.fulfillment_cost?.total || 0),
                                ff_code: orderData.code?.trim() || '',
                                currency: orderData.invoice?.currency || 'USD',
                                product_name: product_name, // <-- Thêm vào
                            });
                        }
                    }
                } else {
                    console.warn('Merchize API response was not successful or data format is incorrect:', data);
                }
            } else {
                 console.warn('Merchize API returned an empty response body.');
            }

        } catch (e) {
            console.error(`Exception during fetch Merchize costs for a batch:`, e);
        }
    }

    return allCosts;
}
// --- END: Merchize Functions ---

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
        
        const merchizeAccounts = (accounts || []).filter(a => a.provider === 'merchize');
        if (merchizeAccounts.length === 0) {
            return res.status(200).json({});
        }

        const orderRecords = records.filter(r => r.kind === 'order' && r.order_id);
        if (orderRecords.length === 0) {
            return res.status(200).json({});
        }

        const orderIds = Array.from(new Set(orderRecords.map(r => r.order_id!)));

        const merchizeDataArrays = await Promise.all(merchizeAccounts.map(acc => fetchMerchizeCosts(orderIds, acc)));
        const merchizeData = merchizeDataArrays.flat();

        // --- CẬP NHẬT LOGIC MERGE ---
        const costMap: { [key: string]: CostData } = {};
        for (const item of merchizeData) {
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

        return res.status(200).json(costMap);
    } catch (error) {
        console.error('[API /get-costs-mz Error]', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}