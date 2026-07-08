console.log('[SKU Bridge] Loaded. Waiting for Health Extension config...');

const SYNC_KEY = 'sku_bridge_synced_config_hash';

function hashConfig(config: any): string {
  return `${config.teamId}|${config.shopsHash || ''}`;
}

function postResult(type: string, requestId: string | null, response: any, extra: Record<string, any> = {}) {
  window.postMessage({
    type,
    requestId,
    success: response?.success ?? false,
    error: response?.error || null,
    ...extra
  }, '*');
}

function normalizeRuntimeResponse(response: any) {
  if (chrome.runtime.lastError) {
    return { success: false, error: chrome.runtime.lastError.message };
  }
  return response;
}

// === RELAY: Dashboard page -> SKU Worker background (control commands) ===
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || typeof msg.type !== 'string') return;
  if (!msg.type.startsWith('VIKCOM_CMD_REVIEWS_')) return;

  const requestId = msg.requestId || null;

  if (msg.type === 'VIKCOM_CMD_REVIEWS_CRAWL_NOW') {
    chrome.runtime.sendMessage(
      { type: 'CRAWL_RECENT_REVIEWS_25' },
      (response) => {
        response = normalizeRuntimeResponse(response);
        postResult('VIKCOM_RESULT_REVIEWS_CRAWL_NOW', requestId, response, {
          started: response?.started ?? false,
          fetched: response?.fetched ?? 0,
          saved: response?.saved ?? 0
        });
      }
    );
    return;
  }

  if (msg.type === 'VIKCOM_CMD_REVIEWS_RUN_SYNC') {
    chrome.runtime.sendMessage(
      { type: 'RUN_ETSY_REVIEW_SYNC' },
      (response) => {
        response = normalizeRuntimeResponse(response);
        postResult('VIKCOM_RESULT_REVIEWS_RUN_SYNC', requestId, response, {
          started: response?.started ?? false,
          fetched: response?.fetched ?? 0,
          saved: response?.saved ?? 0
        });
      }
    );
    return;
  }

  if (msg.type === 'VIKCOM_CMD_REVIEWS_SET_CRON_HOURS') {
    const hours: number[] = Array.isArray(msg.hours) ? msg.hours : [];
    chrome.storage.local.set({ etsy_review_sync_hours: hours }, () => {
      chrome.runtime.sendMessage(
        { type: 'SCHEDULE_ETSY_REVIEW_CRON' },
        (response) => {
          response = normalizeRuntimeResponse(response);
          postResult('VIKCOM_RESULT_REVIEWS_SET_CRON_HOURS', requestId, response, {
            nextRunAt: response?.nextRunAt || null
          });
        }
      );
    });
    return;
  }

  if (msg.type === 'VIKCOM_CMD_REVIEWS_GET_STATUS') {
    chrome.storage.local.get(['etsy_review_sync_status', 'etsy_review_sync_hours'], (result) => {
      window.postMessage({
        type: 'VIKCOM_RESULT_REVIEWS_GET_STATUS',
        requestId,
        success: true,
        status: result.etsy_review_sync_status || null,
        cronHours: result.etsy_review_sync_hours || [8, 12]
      }, '*');
    });
    return;
  }
});

function readEtsyReviewShops(teamId: string): any[] {
  const accountsKey = `vikcom_accounts_${teamId}`;
  const accountsStr = localStorage.getItem(accountsKey);
  if (!accountsStr) return [];

  try {
    const accounts = JSON.parse(accountsStr);
    if (!Array.isArray(accounts)) return [];

    const isValidEtsyShopId = (value: any) => {
      const text = String(value || '').trim();
      if (!/^\d+$/.test(text)) return false;
      const numericValue = Number(text);
      return Number.isSafeInteger(numericValue) && numericValue > 0 && numericValue <= 2147483647;
    };
    const pickEtsyShopId = (acc: any) => [acc.etsy_shop_id, acc.etsyShopId, acc.shopId]
      .map(value => String(value || '').trim())
      .find(isValidEtsyShopId) || '';

    return accounts
      .filter((acc: any) => Array.isArray(acc.platforms) && acc.platforms.includes('etsy'))
      .map((acc: any) => ({
        shopId: pickEtsyShopId(acc),
        shopName: acc.label || acc.shopName || acc.name || acc.email || acc.id,
        label: acc.label || null,
        email: acc.email || null,
        name: acc.name || null,
        etsyShopName: acc.etsyShopName || acc.etsy_shop_name || null
      }))
      .filter((shop: any) => shop.shopName);
  } catch (e) {
    console.error('[SKU Bridge] Failed to parse accounts from localStorage:', e);
    return [];
  }
}

// === AUTO-SYNC SHOP LIST: Health Extension DOM -> SKU Worker storage ===
setInterval(() => {
  const configEl = document.getElementById('vikcom-health-config');
  if (!configEl) return;

  const configStr = configEl.getAttribute('data-config');
  if (!configStr) return;

  let config: any;
  try {
    config = JSON.parse(configStr);
  } catch {
    return;
  }

  if (!config.teamId) return;

  const etsyReviewShops = readEtsyReviewShops(config.teamId);
  const newHash = hashConfig({
    teamId: config.teamId,
    shopsHash: JSON.stringify(etsyReviewShops)
  });

  chrome.storage.local.get([SYNC_KEY], (existing) => {
    if (existing[SYNC_KEY] === newHash) return;

    const update: any = {
      teamId: config.teamId,
      appUrl: config.appUrl || null,
      etsy_review_shops: etsyReviewShops,
      [SYNC_KEY]: newHash
    };

    chrome.storage.local.set(update, () => {
      console.log('[SKU Bridge] Auto-synced team and Etsy shop list from Health Extension.');
    });
  });
}, 3000);
