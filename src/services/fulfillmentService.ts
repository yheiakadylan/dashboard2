import { Record, CostData } from '../types';

type FetchCostsOptions = {
  signal?: AbortSignal;
};

export const fetchCostsForRecords = async (records: Record[], options: FetchCostsOptions = {}): Promise<Map<string, CostData>> => {
  const orderRecords = records.filter(r => r.kind === 'order' && r.order_id);

  if (orderRecords.length === 0) {
    return new Map();
  }

  const readCostResponse = async (response: Response, supplier: 'PW' | 'MZ') => {
    if (!response.ok) {
      throw new Error(`${supplier} cost fetch failed with status ${response.status}`);
    }
    return response.json() as Promise<{ [key: string]: CostData }>;
  };

  try {
    const body = JSON.stringify({ records: orderRecords });
    const headers = { 'Content-Type': 'application/json' };

    const [pwResult, mzResult] = await Promise.allSettled([
      fetch('/api/get-costs-pw', { method: 'POST', headers, body, signal: options.signal }).then(response => readCostResponse(response, 'PW')),
      fetch('/api/get-costs-mz', { method: 'POST', headers, body, signal: options.signal }).then(response => readCostResponse(response, 'MZ')),
    ]);

    const failedSuppliers = [pwResult, mzResult].filter(result => result.status === 'rejected');
    if (failedSuppliers.length === 2) {
      throw new Error(`Failed to fetch fulfillment costs: ${failedSuppliers.map(result => String(result.reason)).join('; ')}`);
    }

    failedSuppliers.forEach(result => {
      console.warn('[fulfillmentService] Partial fulfillment cost fetch failure:', result.reason);
    });

    const pwCosts = pwResult.status === 'fulfilled' ? pwResult.value : {};
    const mzCosts = mzResult.status === 'fulfilled' ? mzResult.value : {};

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
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.error("Failed to fetch costs via serverless functions:", error);
    throw error;
  }
};
