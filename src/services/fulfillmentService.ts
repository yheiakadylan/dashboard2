// FIX: Import `CostData` from shared `types.ts` and remove local definition.
import { Record, CostData } from '../types';

export const fetchCostsForRecords = async (records: Record[]): Promise<Map<string, CostData>> => {
  const orderRecords = records.filter(r => r.kind === 'order' && r.order_id);

  if (orderRecords.length === 0) {
    return new Map();
  }

  try {
    const body = JSON.stringify({ records: orderRecords });
    const headers = { 'Content-Type': 'application/json' };

    const pwPromise = fetch('/api/get-costs-pw', { method: 'POST', headers, body });
    const mzPromise = fetch('/api/get-costs-mz', { method: 'POST', headers, body });

    const [pwResponse, mzResponse] = await Promise.all([pwPromise, mzPromise]);
    
    const pwCosts: { [key: string]: CostData } = pwResponse.ok ? await pwResponse.json() : {};
    if(!pwResponse.ok) console.error("Failed to fetch Printway costs:", pwResponse.statusText);
    console.log(">>> [F12] Printway Costs Result:", pwCosts);
    
    const mzCosts: { [key: string]: CostData } = mzResponse.ok ? await mzResponse.json() : {};
    if(!mzResponse.ok) console.error("Failed to fetch Merchize costs:", mzResponse.statusText);
    console.log(">>> [F12] Merchize Costs Result:", mzCosts);

    // Start with Printway costs and merge Merchize costs into them.
    const combinedCosts = { ...pwCosts };

    for (const orderId in mzCosts) {
      if (combinedCosts[orderId]) {
        // If order exists in both, sum costs and merge ff_code if needed.
        combinedCosts[orderId].cost_total += mzCosts[orderId].cost_total;
        if (!combinedCosts[orderId].ff_code && mzCosts[orderId].ff_code) {
          combinedCosts[orderId].ff_code = mzCosts[orderId].ff_code;
        }
      } else {
        // If order only exists in Merchize, add it.
        combinedCosts[orderId] = mzCosts[orderId];
      }
    }

    const costMap = new Map<string, CostData>(Object.entries(combinedCosts));
    
    return costMap;
  } catch (error) {
    console.error("Failed to fetch costs via serverless functions:", error);
    // Return an empty map on failure to prevent the app from crashing.
    return new Map();
  }
};
