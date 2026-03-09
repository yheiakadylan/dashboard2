// Background Service Worker - Manages communication and pagination

let pendingCrawls = new Map(); // shopName -> { tabId, resolve, reject, accumulatedListings, page, pageRetries }

// Unified handler for both Internal (Popup) and External (Web) messages
const handleMessage = (request, sender, sendResponse) => {
    // 0. FORCE SNAPSHOT
    if (request.type === 'FORCE_SNAPSHOT') {
        console.log('[Background] Force snapshot requested.');
        triggerDailySnapshot(request.config, true);
        sendResponse({ success: true, message: 'Daily Snapshot check started.' });
        return true;
    }

    // 0.5 RUN BACKFILL
    if (request.type === 'RUN_BACKFILL') {
        console.log(`[Background] RUN_BACKFILL requested from ${request.startDate} to ${request.endDate}`);
        (async () => {
            try {
                const start = new Date(request.startDate + 'T00:00:00Z');
                const end = new Date(request.endDate + 'T00:00:00Z');
                let cur = new Date(start);

                while (cur <= end) {
                    const dateStr = cur.toISOString().split('T')[0];
                    console.log(`[Background] Backfilling... ${dateStr}`);
                    await triggerDailySnapshot(request.config, true, dateStr);
                    cur.setDate(cur.getDate() + 1);
                }
                console.log(`[Background] Backfill complete.`);
                sendResponse({ success: true, message: 'Backfill complete.' });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // Keep channel open for async sendResponse
    }

    // 1. PING
    if (request.type === 'PING') {
        sendResponse({ status: 'ok', version: '1.1.0' });
        return true;
    }

    // 2. CRAWL REQUEST (Direct)
    if (request.type === 'CRAWL_REQUEST') {
        handleCrawlRequest(request.shopName, request.startPage)
            .then(listings => sendResponse({ success: true, listings }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    // 3. TRIGGER RUN NOW (From Popup or Web)
    if (request.type === 'TRIGGER_CRAWL_NOW') {
        console.log('[Background] Manual trigger received. Initiating crawl immediately...');

        // Use a small timeout to allow response to send back first
        setTimeout(() => {
            performAutoCrawl(true); // Force run
        }, 100);

        sendResponse({ success: true, message: 'Triggered' });
        return true;
    }

    // 4. CRAWL RESULT (From Content Script)
    if (request.type === 'CRAWL_RESULT') {
        handleCrawlResult(request, sender);
        sendResponse({ received: true });
        return true;
    }

    // 5. CRAWL ERROR (From Content Script)
    if (request.type === 'CRAWL_ERROR') {
        handleCrawlError(request, sender);
        sendResponse({ received: true });
        return true;
    }

    // 6. SET CONFIG (From Popup or Web)
    if (request.type === 'SET_CONFIG') {
        // Handle logout (null config)
        if (!request.config || request.config === null) {
            chrome.storage.local.remove(['config'], () => {
                chrome.alarms.clear('auto_crawl');
                console.log('[Background] Config cleared (logout)');
            });
            sendResponse({ success: true });
            return true;
        }

        chrome.storage.local.get(['config'], (result) => {
            const oldConfig = result.config || {};
            // Merge to preserve existing auth if missing in request
            const newConfig = { ...oldConfig, ...request.config };

            // Explicitly preserve critical fields
            if (!request.config.token && oldConfig.token) newConfig.token = oldConfig.token;
            if (!request.config.email && oldConfig.email) newConfig.email = oldConfig.email;
            if (!request.config.appUrl && oldConfig.appUrl) newConfig.appUrl = oldConfig.appUrl;

            chrome.storage.local.set({ config: newConfig }, () => {
                if (newConfig.autoCrawlEnabled) {
                    setupAlarm(newConfig);
                } else {
                    chrome.alarms.clear('auto_crawl');
                }
                console.log('[Background] Config updated:', { teamId: newConfig.teamId, autoCrawl: newConfig.autoCrawlEnabled });
            });
        });
        sendResponse({ success: true });
        return true;
    }

    // 5. STOP CRAWL (Abort All)
    if (request.type === 'STOP_CRAWL') {
        console.log('[Background] Stop signal received - aborting all crawls');

        // Reject and clean up all pending crawls
        for (const [shopName, task] of pendingCrawls.entries()) {
            task.reject(new Error('Stopped by user'));
            if (task.tabId) {
                try {
                    chrome.tabs.remove(task.tabId);
                } catch (e) { /* Tab may already be closed */ }
            }
        }
        pendingCrawls.clear();

        // Update stats to STOPPED (direct set for immediate effect)
        chrome.storage.local.set({
            stats: {
                status: 'IDLE',
                currentShopName: 'Stopped by user',
                totalShops: 0,
                currentShopIndex: 0,
                totalListings: 0,
                lastRun: new Date().toISOString()
            }
        });

        sendResponse({ success: true, message: 'All crawls stopped' });
        return true;
    }

    // Default: No handler match
    return false;
};

// Listeners
chrome.runtime.onMessage.addListener(handleMessage);
chrome.runtime.onMessageExternal.addListener(handleMessage);


// Handle Alarms (Scheduled Crawls)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'auto_crawl') {
        console.log('[Background] Alarm triggered. Starting auto-crawl...');
        performAutoCrawl();
    }
});

function setupAlarm(config) {
    chrome.alarms.clear('auto_crawl', (wasCleared) => {
        if (!config || !config.autoCrawlEnabled) {
            console.log('[Background] Auto-crawl disabled.');
            return;
        }

        const mode = config.autoCrawlMode || 'interval';

        if (mode === 'interval') {
            const hours = config.intervalHours || 6;
            const intervalMinutes = hours * 60;
            console.log(`[Background] Scheduler: Interval Mode (${hours}h)`);

            // Fetch last run to calculate delay
            chrome.storage.local.get(['stats'], (result) => {
                const lastRunStr = result.stats?.lastRun;
                const lastRun = lastRunStr ? new Date(lastRunStr).getTime() : 0;
                const now = Date.now();
                const intervalMs = hours * 60 * 60 * 1000;

                let nextRun = lastRun + intervalMs;

                // If never ran or overdue, schedule soon (1 min)
                if (nextRun <= now) {
                    // But if it was just cleared, we don't want to spam.
                    // If no lastRun (0), run soon.
                    // If overdue, run soon.
                    nextRun = now + 1000 * 60;
                }

                console.log(`[Background] Next Interval Run: ${new Date(nextRun).toLocaleString()}`);

                chrome.alarms.create('auto_crawl', {
                    when: nextRun,
                    periodInMinutes: intervalMinutes
                });
            });
        }
        else if (mode === 'daily') {
            const timeStr = config.dailyTime || '06:00'; // HH:mm
            const [h, m] = timeStr.split(':').map(Number);

            const now = new Date();
            const nextRun = new Date();
            nextRun.setHours(h, m, 0, 0);

            // If time passed today, schedule for tomorrow
            if (nextRun <= now) {
                nextRun.setDate(nextRun.getDate() + 1);
            }

            console.log(`[Background] Scheduler: Daily Mode at ${timeStr}. Next run: ${nextRun.toLocaleString()}`);

            // 'periodInMinutes: 1440' makes it repeat daily after the first run
            // Note: 'when' expects Milliseconds
            chrome.alarms.create('auto_crawl', {
                when: nextRun.getTime(),
                periodInMinutes: 1440 // 24 Hours
            });
        }
    });
}

async function performAutoCrawl(force = false) {
    console.log('[Background] performAutoCrawl started...', force ? '(FORCED)' : '(AUTO)');

    // Check previous run to prevent rapid-fire loops
    const { stats: oldStats } = await chrome.storage.local.get('stats');
    if (!force && oldStats && oldStats.lastRun) {
        const last = new Date(oldStats.lastRun).getTime();
        const diff = Date.now() - last;
        if (diff < 5 * 60 * 1000) { // 5 minutes buffer
            console.warn(`[Background] Skipping auto-crawl. Last run was ${Math.round(diff / 1000)}s ago (Too soon).`);
            return;
        }
    }

    const { config } = await chrome.storage.local.get('config');

    // Debug Log
    console.log('[Background] Config loaded:', config);

    if (!config || !config.teamId) {
        console.error('[Background] Missing config or teamId. Cannot crawl.');
        return;
    }

    const appUrl = config.appUrl || 'http://localhost:3000';
    const activeShops = (config.shops || []).filter(s => s.selected);

    if (activeShops.length === 0) {
        console.warn('[Background] No shops selected for crawling.');
        return;
    }

    console.log(`[Background] Starting batch crawl for ${activeShops.length} shops...`);

    // ✅ NEW: Notify Dashboard that crawl has started
    // This allows Dashboard to show progress bar when extension crawls
    try {
        // Send message to all dashboard tabs
        const tabs = await chrome.tabs.query({ url: `${appUrl}/*` });
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'EXTENSION_CRAWL_START',
                    totalShops: activeShops.length
                }).catch(() => {
                    // Tab might not have content script, ignore
                });
            }
        }
        console.log('[Background] Sent EXTENSION_CRAWL_START to dashboard tabs');
    } catch (error) {
        console.warn('[Background] Failed to notify dashboard:', error);
    }

    // INIT REAL-TIME STATS
    const stats = {
        status: 'RUNNING',
        totalShops: activeShops.length,
        currentShopIndex: 0,
        currentShopName: '',
        totalListings: 0,
        lastRun: new Date().toISOString()
    };
    await chrome.storage.local.set({ stats });

    // ✅ Track success/error counts
    let successCount = 0;
    let errorCount = 0;
    const crawlStartTime = Date.now();

    // Sequential Crawl
    for (let i = 0; i < activeShops.length; i++) {
        const shop = activeShops[i];

        // Update Current Shop Stat
        stats.currentShopIndex = i + 1;
        stats.currentShopName = shop.label;
        await chrome.storage.local.set({ stats });

        try {
            console.log(`[Background] Auto-crawling ${shop.label} (ID: ${shop.id})...`);

            // Open Tab & Crawl
            const listings = await handleCrawlRequest(shop.label);

            if (listings && listings.length > 0) {
                // listings count updated incrementally in handleCrawlResult

                console.log(`[Background] Scraped ${listings.length} listings. Saving to ${appUrl}...`);
                await saveListingsToDashboard(listings, config.teamId, shop.id, config.userId, appUrl);
                successCount++; // ✅ Track success
            } else {
                console.log(`[Background] No listings found or empty result for ${shop.label}. Pushing empty array to reset DB.`);
                // ✅ KEY FIX: Must call save with empty array so API updates `last_listing_crawl` and clears removed items
                await saveListingsToDashboard([], config.teamId, shop.id, config.userId, appUrl);
                successCount++; // Still count as success (empty shop)
            }

            // Wait 5s between shops
            await new Promise(r => setTimeout(r, 5000));

        } catch (err) {
            console.error(`[Background] Failed to crawl ${shop.label}:`, err);
            errorCount++; // ✅ Track error
            // Push error to DB so user can see it natively!
            await saveListingsToDashboard([], config.teamId, shop.id, config.userId, appUrl, err.message || 'Unknown error');
        }
    }

    // FINISH
    stats.status = 'IDLE';
    stats.currentShopName = 'Done';
    await chrome.storage.local.set({ stats });

    // ✅ NEW: Notify Dashboard that crawl is COMPLETE
    const finalStats = {
        totalShops: activeShops.length,
        successCount,
        errorCount,
        totalListings: stats.totalListings || 0,
        duration: Date.now() - crawlStartTime
    };

    await notifyDashboard('EXTENSION_CRAWL_COMPLETE', { stats: finalStats });

    console.log('[Background] Auto-crawl batch complete:', finalStats);

    // ✅ NEW: Trigger Daily Snapshot
    await triggerDailySnapshot(config);
}

// ✅ Trigger Daily Snapshot API
async function triggerDailySnapshot(providedConfig, force = false, specificDateStr = null) {
    let config = providedConfig;
    if (!config) {
        const res = await chrome.storage.local.get('config');
        config = res.config;
    }

    if (!config || !config.teamId) {
        console.log('[Background] Skipping Snapshot: No config/teamId found.');
        return;
    }

    // Calculate YESTERDAY (since we run past midnight to close the previous day)
    let targetDateStr = specificDateStr;
    if (!targetDateStr) {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        targetDateStr = date.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    }

    // Check if we already ran for this date to avoid duplicates (unless forced)
    const { stats } = await chrome.storage.local.get('stats');
    if (!force && stats && stats.lastSnapshotDate === targetDateStr) {
        console.log(`[Background] Snapshot for ${targetDateStr} already created. Skipping.`);
        return;
    }

    const baseUrl = config.appUrl || 'http://localhost:3000';
    // Remove trailing slash if any
    const cleanUrl = baseUrl.replace(/\/$/, '');
    const endpoint = `${cleanUrl}/api/listing`;

    console.log(`[Background] 📸 Triggering Daily Snapshot for ${targetDateStr} at ${endpoint}...`);

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'daily_snapshot',
                teamId: config.teamId,
                date: targetDateStr
            })
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Server returned ${res.status}: ${txt}`);
        }

        const json = await res.json();
        console.log('[Background] ✅ Daily Snapshot triggered successfully:', json);

        // Save state only if it was an automatic daily snapshot, not a custom backfill
        if (stats && !specificDateStr) {
            stats.lastSnapshotDate = targetDateStr;
            await chrome.storage.local.set({ stats });
        }

    } catch (e) {
        console.error('[Background] ❌ Failed to trigger snapshot:', e);
        throw e;
    }
}

// ✅ Helper function to notify Dashboard
async function notifyDashboard(type, data, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const { config } = await chrome.storage.local.get('config');
            const appUrl = config?.appUrl || 'http://localhost:3000';
            const tabs = await chrome.tabs.query({ url: `${appUrl}/*` });

            if (tabs.length === 0 && attempt < retries - 1) {
                console.log(`[Background] No dashboard tabs found, retrying in 1s (${attempt + 1}/${retries})...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            let sent = 0;
            for (const tab of tabs) {
                if (tab.id) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { type, ...data });
                        sent++;
                    } catch (e) {
                        // Content script might not be ready, ignore
                    }
                }
            }

            if (sent > 0) {
                console.log(`[Background] ✅ Sent ${type} to ${sent} dashboard tabs`);
                return true;
            }

            if (attempt < retries - 1) {
                console.log(`[Background] Failed to send to any tab, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.warn('[Background] Notify attempt failed:', error);
        }
    }

    console.warn(`[Background] ❌ Failed to notify dashboard after ${retries} attempts`);
    return false;
}

async function saveListingsToDashboard(listings, teamId, shopId, userId, baseUrl = 'http://localhost:3000', errorMessage = null) {
    try {
        const endpoint = `${baseUrl.replace(/\/$/, '')}/api/listing`;
        console.log(`[Background] Saving data to ${endpoint}...`);

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save',
                teamId: teamId,
                shopId: shopId,
                userId: userId,
                listings: listings,
                errorMessage: errorMessage
            })
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Server returned ${res.status}: ${txt}`);
        }

        const json = await res.json();
        console.log('[Background] Save success:', json);

    } catch (err) {
        console.error('[Background] Failed to save listings to dashboard:', err);
    }
}

async function handleCrawlRequest(shopName, startPage = 1) {
    return new Promise((resolve, reject) => {
        // Check if duplicate request
        if (pendingCrawls.has(shopName)) {
            reject(new Error('Crawl already in progress'));
            return;
        }

        const initialPage = typeof startPage === 'number' ? startPage : parseInt(startPage, 10) || 1;

        pendingCrawls.set(shopName, {
            resolve,
            reject,
            accumulatedListings: [],
            page: initialPage,
            pageRetries: 0
        });

        // Start with page X
        const url = `https://www.etsy.com/shop/${shopName}?page=${initialPage}#items`;
        console.log(`[Background] Opening tab for ${shopName} at page ${initialPage}: ${url}`);

        chrome.tabs.create({ url: url, active: false }, (tab) => {
            if (chrome.runtime.lastError) {
                pendingCrawls.delete(shopName);
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            const pending = pendingCrawls.get(shopName);
            if (pending) pending.tabId = tab.id;

            console.log(`[Background] Tab ${tab.id} created for ${shopName}. Content script will auto-inject.`);

            // Global Timeout (increased to 10 minutes to support delays)
            setTimeout(() => {
                if (pendingCrawls.has(shopName)) {
                    const stale = pendingCrawls.get(shopName);
                    pendingCrawls.delete(shopName);
                    if (stale.tabId) chrome.tabs.remove(stale.tabId);
                    stale.reject(new Error(`Timeout crawling ${shopName} at page ${stale.page}`));
                }
            }, 600000);
        });
    });
}

function handleCrawlResult(msg, sender) {
    const shopName = getShopNameFromUrl(sender.tab.url);
    const task = pendingCrawls.get(shopName);

    console.log(`[Background] CRAWL_RESULT received:`, {
        shopName,
        tabId: sender.tab.id,
        listingsFound: msg.listings?.length || 0,
        nextPageUrl: msg.nextPageUrl,
        hasTask: !!task,
        taskTabId: task?.tabId
    });

    if (!task) {
        console.warn(`[Background] No pending task for ${shopName}. Ignoring result.`);
        return;
    }

    // Verify Tab ID
    if (sender.tab.id !== task.tabId) {
        console.warn(`[Background] Tab ID mismatch. Expected ${task.tabId}, got ${sender.tab.id}`);
        return;
    }

    if (msg.listings && msg.listings.length > 0) {
        task.accumulatedListings = task.accumulatedListings.concat(msg.listings);
        console.log(`[Background] [${shopName}] Page ${task.page} done. Accumulated: ${task.accumulatedListings.length}`);

        // REAL-TIME STATS UPDATE
        chrome.storage.local.get(['stats'], (res) => {
            if (res.stats) {
                res.stats.totalListings = (res.stats.totalListings || 0) + msg.listings.length;
                chrome.storage.local.set({ stats: res.stats });
            }
        });
    }

    if (msg.nextPageUrl && task.accumulatedListings.length < 5000) { // Safety limit
        task.page = task.page + 1;
        task.pageRetries = 0;

        console.log(`[Background] [${shopName}] Advancing to page ${task.page} -> ${msg.nextPageUrl}`);

        // Use the URL from content script (which has all the right params)
        chrome.tabs.update(task.tabId, { url: msg.nextPageUrl });
    } else {
        // Done
        console.log(`[Background] [${shopName}] Crawl finished. Reason: ${!msg.nextPageUrl ? 'No next page' : 'Limit reached'}. Total: ${task.accumulatedListings.length} listings`);
        finishCrawl(shopName);
    }
}

function handleCrawlError(msg, sender) {
    const shopName = getShopNameFromUrl(sender.tab.url);
    const task = pendingCrawls.get(shopName);
    if (!task) return;

    console.error(`[Background] [${shopName}] Error on page ${task.page}: ${msg.error}`);

    // Retry Logic
    if (task.pageRetries < 3) {
        task.pageRetries++;
        console.log(`[Background] [${shopName}] Retrying page ${task.page} (${task.pageRetries}/3)...`);
        chrome.tabs.reload(task.tabId);
    } else {
        // If we have some data, resolve with what we have. Otherwise reject.
        if (task.accumulatedListings.length > 0) {
            console.warn(`[Background] [${shopName}] Max retries reached. Returning partial data.`);
            finishCrawl(shopName);
        } else {
            task.reject(new Error(`Max retries reached on page ${task.page}`));
            chrome.tabs.remove(task.tabId);
            pendingCrawls.delete(shopName);
        }
    }
}

function finishCrawl(shopName) {
    const task = pendingCrawls.get(shopName);
    if (task) {
        task.resolve(task.accumulatedListings);
        chrome.tabs.remove(task.tabId);
        pendingCrawls.delete(shopName);
        console.log(`[Background] [${shopName}] Crawl complete. Total: ${task.accumulatedListings.length}`);
    }
}

function getShopNameFromUrl(url) {
    const match = url.match(/etsy\.com\/shop\/([^/?#]+)/) || url.match(/etsy\.com\/([a-zA-Z0-9]+)/); // Fallback
    return match ? match[1] : null;
}
