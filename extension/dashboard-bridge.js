console.log('[Dashboard Bridge] Shop health relay loaded');

function normalizeRuntimeResponse(response) {
    if (chrome.runtime.lastError) {
        return { success: false, error: chrome.runtime.lastError.message };
    }
    return response;
}

// === EXPOSE NON-SENSITIVE EXTENSION CONFIG TO DOM ===
function syncConfigToPage() {
    chrome.storage.local.get(['config'], (result) => {
        if (result?.config) {
            let div = document.getElementById('vikcom-health-config');
            if (!div) {
                div = document.createElement('div');
                div.id = 'vikcom-health-config';
                div.style.display = 'none';
                document.documentElement.appendChild(div);
            }
            div.setAttribute('data-config', JSON.stringify({
                appUrl: result.config.appUrl,
                email: result.config.email,
                teamId: result.config.teamId
            }));
        }
    });
}

// Initial sync on page load
syncConfigToPage();

// Re-sync when storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.config) {
        syncConfigToPage();
    }
});

// === RELAY: Extension background → Dashboard page (push notifications) ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;

    if (message.type.startsWith('EXTENSION_SHOP_HEALTH_')) {
        window.postMessage({
            type: message.type,
            totalShops: message.totalShops,
            current: message.current,
            total: message.total,
            shopName: message.shopName,
            stats: message.stats,
            suspendedShops: message.suspendedShops,
            timestamp: Date.now()
        }, '*');

        sendResponse({ received: true, forwarded: true });
        return true;
    }

    return false;
});

// === RELAY: Dashboard page → Extension background (control commands) ===
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;
    if (!msg.type.startsWith('VIKCOM_CMD_HEALTH_')) return;

    const requestId = msg.requestId || null;

    if (msg.type === 'VIKCOM_CMD_HEALTH_CHECK_RUN') {
        chrome.runtime.sendMessage(
            { type: 'TRIGGER_SHOP_HEALTH_CHECK', force: Boolean(msg.force) },
            (response) => {
                response = normalizeRuntimeResponse(response);
                window.postMessage({
                    type: 'VIKCOM_RESULT_HEALTH_CHECK_RUN',
                    requestId,
                    success: response?.success ?? false,
                    error: response?.error || null
                }, '*');
            }
        );
        return;
    }

    if (msg.type === 'VIKCOM_CMD_HEALTH_CHECK_STOP') {
        chrome.runtime.sendMessage(
            { type: 'STOP_SHOP_HEALTH_CHECK' },
            (response) => {
                response = normalizeRuntimeResponse(response);
                window.postMessage({
                    type: 'VIKCOM_RESULT_HEALTH_CHECK_STOP',
                    requestId,
                    success: response?.success ?? false
                }, '*');
            }
        );
        return;
    }

    if (msg.type === 'VIKCOM_CMD_HEALTH_CHECK_STATUS') {
        chrome.runtime.sendMessage(
            { type: 'GET_SHOP_HEALTH_STATUS' },
            (response) => {
                response = normalizeRuntimeResponse(response);
                window.postMessage({
                    type: 'VIKCOM_RESULT_HEALTH_CHECK_STATUS',
                    requestId,
                    success: response?.success ?? false,
                    running: response?.config ? true : false,
                    stats: response?.stats || null
                }, '*');
            }
        );
        return;
    }
});
