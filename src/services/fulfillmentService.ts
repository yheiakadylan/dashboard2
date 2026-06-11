// FIX: Import `CostData` from shared `types.ts` and remove local definition.
import { Record, CostData, FulfillmentAccount } from '../types';

export const fetchCostsForRecords = async (records: Record[], accounts: FulfillmentAccount[]): Promise<Map<string, CostData>> => {
  const orderRecords = records.filter(r => r.kind === 'order' && r.order_id);

  // Create a mapping from clean ID (no #) to the exact local order_id (with or without #)
  const originalIdMap = new Map<string, string>();
  for (const r of orderRecords) {
    if (r.order_id) {
      const cleanId = r.order_id.replace(/^#/, '').trim();
      originalIdMap.set(cleanId, r.order_id);
    }
  }

  if (orderRecords.length === 0 || accounts.length === 0) {
    return new Map();
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    
    // Create a separate request for each configured account
    const promises = accounts.map(async (account) => {
      // Backend functions still expect an accounts array
      const body = JSON.stringify({ records: orderRecords, accounts: [account] });
      const encodedName = encodeURIComponent(account.name || 'Unknown');
      
      let url = '';
      if (account.provider === 'printway') {
        url = `/api/get-costs-pw?name=${encodedName}`;
      } else if (account.provider === 'merchize') {
        url = `/api/get-costs-mz?name=${encodedName}`;
      }

      if (!url) return {};

      try {
        const response = await fetch(url, { method: 'POST', headers, body });
        if (!response.ok) {
          console.error(`Failed to fetch costs for ${account.name} (${account.provider}):`, response.statusText);
          return {};
        }
        const data = await response.json();
        console.log(`>>> [F12] Costs Result for ${account.name}:`, data);
        return data as { [key: string]: CostData };
      } catch (err) {
        console.error(`Exception fetching costs for ${account.name}:`, err);
        return {};
      }
    });

    const resultsArray = await Promise.all(promises);

    const combinedCosts: { [key: string]: CostData } = {};

    resultsArray.forEach((costs) => {
      for (const orderId in costs) {
        if (combinedCosts[orderId]) {
          // If order exists in multiple accounts, sum costs and merge ff_code if needed.
          combinedCosts[orderId].cost_total += costs[orderId].cost_total;
          if (!combinedCosts[orderId].ff_code && costs[orderId].ff_code) {
            combinedCosts[orderId].ff_code = costs[orderId].ff_code;
          }
          if (!combinedCosts[orderId].product_name && costs[orderId].product_name) {
             combinedCosts[orderId].product_name = costs[orderId].product_name;
          }
        } else {
          // If new order ID, add it
          combinedCosts[orderId] = { ...costs[orderId] };
        }
      }
    });

    const costMap = new Map<string, CostData>();
    for (const [orderId, costData] of Object.entries(combinedCosts)) {
      const cleanId = orderId.replace(/^#/, '').trim();
      const originalId = originalIdMap.get(cleanId) || orderId;
      costMap.set(originalId, { ...costData, order_id: originalId });
    }
    
    return costMap;
  } catch (error) {
    console.error("Failed to fetch costs via serverless functions:", error);
    // Return an empty map on failure to prevent the app from crashing.
    return new Map();
  }
};
