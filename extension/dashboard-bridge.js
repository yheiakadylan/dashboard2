// Dashboard Bridge - Relays messages from background to page
// This script is injected ONLY into Dashboard pages (localhost + production)

console.log('[Dashboard Bridge] Loaded and ready');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Dashboard Bridge] Received from background:', message.type);

    // Forward CRAWL_START to window (Dashboard React app can listen)
    if (message.type === 'EXTENSION_CRAWL_START') {
        window.postMessage({
            type: 'EXTENSION_CRAWL_START',
            totalShops: message.totalShops,
            timestamp: Date.now()
        }, '*');
        sendResponse({ received: true, forwarded: true });
    }

    // Forward CRAWL_COMPLETE to window
    if (message.type === 'EXTENSION_CRAWL_COMPLETE') {
        window.postMessage({
            type: 'EXTENSION_CRAWL_COMPLETE',
            stats: message.stats,
            timestamp: Date.now()
        }, '*');
        sendResponse({ received: true, forwarded: true });
    }

    // Forward CRAWL_PROGRESS (real-time updates during crawl)
    if (message.type === 'EXTENSION_CRAWL_PROGRESS') {
        window.postMessage({
            type: 'EXTENSION_CRAWL_PROGRESS',
            current: message.current,
            total: message.total,
            shopName: message.shopName,
            timestamp: Date.now()
        }, '*');
        sendResponse({ received: true, forwarded: true });
    }

    return true; // Keep channel open for async response
});

console.log('[Dashboard Bridge] Message relay active');
