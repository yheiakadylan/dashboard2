// File: api/get-costs-mz.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { merchizeConfig } from './_lib/fulfillmentConfig.js';
import type { CostData, Record } from './_lib/types.js';

// --- START: Merchize Catalog Cache ---

// Cache này sẽ lưu Map<VariantSKU, ProductName>
let skuToNameMap: Map<string, string> | null = null;
let lastCatalogFetch = 0;
const CATALOG_CACHE_TTL = 3600 * 1000; // Cache trong 1 giờ

/**
 * Lấy toàn bộ catalog từ Merchize và tạo map tra cứu SKU -> Tên sản phẩm
 */
async function fetchAndCacheMerchizeCatalog(): Promise<Map<string, string>> {
    const now = Date.now();
    // Nếu cache còn hạn, trả về cache
    if (skuToNameMap && (now - lastCatalogFetch < CATALOG_CACHE_TTL)) {
        return skuToNameMap;
    }

    const newMap = new Map<string, string>();
    let page = 1;
    const limit = 50;
    
    try {
        while (true) {
            const apiUrl = `${merchizeConfig.base_url}/product/catalog?limit=${limit}&page=${page}`;
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${merchizeConfig.access_token}`,
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
        return skuToNameMap || newMap; 
    }

    skuToNameMap = newMap;
    lastCatalogFetch = now;
    return skuToNameMap;
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

async function fetchMerchizeCosts(orderIds: string[]): Promise<CostData[]> {
    if (!merchizeConfig.base_url || !merchizeConfig.access_token || orderIds.length === 0) {
        console.log('Merchize config or orderIds missing. URL:', merchizeConfig.base_url, 'Has Token:', !!merchizeConfig.access_token, 'Order Count:', orderIds.length);
        return [];
    }

    // --- BẮT ĐẦU THAY ĐỔI ---
    // 1. Lấy map SKU -> Tên sản phẩm (từ cache hoặc API)
    const catalogMap = await fetchAndCacheMerchizeCatalog();
    // --- KẾT THÚC THAY ĐỔI ---

    const allCosts: CostData[] = [];
    const chunks = chunkArray(orderIds, merchizeConfig.batch_size);

    for (const chunk of chunks) {
        try {
            const requestBody = {
                orders: chunk.map(id => ({ code:"", external_number: id.startsWith('#') ? id : `#${id}`, identifier: "" }))
            };
            console.log('>>> [DEBUG] Merchize Request Body:', JSON.stringify(requestBody, null, 2));
            
            const apiUrl = `${merchizeConfig.base_url}/order/external/orders/list-orders-detail`;
            
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${merchizeConfig.access_token}`,
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
                console.log('>>> [DEBUG] Merchize Raw Data:', JSON.stringify(data, null, 2));
                if (data.success && Array.isArray(data.data)) {
                    for (const orderData of data.data) {
                        const rawExternalNumber = orderData.external_number?.trim();
                        if (rawExternalNumber) {
                            const externalNumber = rawExternalNumber.startsWith('#') ? rawExternalNumber.slice(1) : rawExternalNumber;

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
        const { records } = req.body as { records: Record[] };
        if (!records || !Array.isArray(records)) {
            return res.status(400).json({ message: 'Missing "records" array in request body.' });
        }

        const orderRecords = records.filter(r => r.kind === 'order' && r.order_id);
        if (orderRecords.length === 0) {
            return res.status(200).json({});
        }

        const orderIds = Array.from(new Set(orderRecords.map(r => r.order_id!)));

        const merchizeData = await fetchMerchizeCosts(orderIds);

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