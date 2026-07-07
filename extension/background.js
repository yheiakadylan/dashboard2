const DEFAULT_APP_URL = 'https://dashboardvikcom.vercel.app';
const CONFIG_KEY = 'config';
const STATS_KEY = 'shopHealthStats';
const EXTENSION_API_PATH = '/api/extension-shop-health';
const SHOP_DELAY_MIN_MS = 1200;
const SHOP_DELAY_MAX_MS = 2600;
const HEALTH_ALARM_NAME = 'etsy_shop_health_cron';
const HEALTH_COMMAND_ALARM_NAME = 'etsy_shop_health_remote_commands';
const TAB_LOAD_TIMEOUT_MS = 45000;
const TAB_PARSE_DELAY_MS = 2500;

let healthRunInProgress = false;
let stopRequested = false;
let currentHealthTabId = null;

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM_NAME) {
        runShopHealthCheck(false).catch(error => {
            console.warn('[Background] Scheduled shop health check failed:', error);
        });
        return;
    }

    if (alarm.name === HEALTH_COMMAND_ALARM_NAME) {
        pollRemoteHealthCommand().catch(error => {
            console.warn('[Background] Remote health command poll failed:', error);
        });
    }
});

chrome.runtime.onStartup.addListener(() => {
    restoreHealthExtensionAlarms().catch(error => {
        console.warn('[Background] Failed to restore health extension alarms:', error);
    });
});

chrome.runtime.onInstalled.addListener(() => {
    restoreHealthExtensionAlarms().catch(error => {
        console.warn('[Background] Failed to restore health extension alarms:', error);
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
        sendResponse({ status: 'ok', version: '2.0.0' });
        return true;
    }

    if (request.type === 'SET_CONFIG') {
        setConfig(request.config)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.type === 'GET_SHOP_HEALTH_STATUS') {
        chrome.storage.local.get([STATS_KEY, CONFIG_KEY], (result) => {
            sendResponse({
                success: true,
                stats: result[STATS_KEY] || null,
                config: result[CONFIG_KEY] || null
            });
        });
        return true;
    }

    if (request.type === 'TRIGGER_SHOP_HEALTH_CHECK') {
        if (healthRunInProgress) {
            sendResponse({ success: false, error: 'Shop health check already running.' });
            return true;
        }
        runShopHealthCheck(Boolean(request.force)).catch(error => {
            console.warn('[Background] Manual shop health check failed:', error);
        });
        sendResponse({ success: true, started: true });
        return true;
    }

    if (request.type === 'STOP_SHOP_HEALTH_CHECK') {
        stopShopHealthCheck()
            .then(stats => sendResponse({ success: true, stats }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    return false;
});

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    if (request.type === 'TRIGGER_SHOP_HEALTH_CHECK') {
        if (healthRunInProgress) {
            sendResponse({ success: false, error: 'Shop health check already running.' });
            return true;
        }
        runShopHealthCheck(Boolean(request.force)).catch(error => {
            console.warn('[Background] External shop health check failed:', error);
        });
        sendResponse({ success: true, started: true });
        return true;
    }
    return false;
});

async function setConfig(config) {
    if (!config) {
        await chrome.storage.local.remove([CONFIG_KEY, STATS_KEY]);
        await chrome.alarms.clear(HEALTH_ALARM_NAME);
        await chrome.alarms.clear(HEALTH_COMMAND_ALARM_NAME);
        return;
    }

    const existing = await chrome.storage.local.get(CONFIG_KEY);
    const oldConfig = existing[CONFIG_KEY] || {};
    const merged = {
        ...oldConfig,
        ...config,
        token: config.token || oldConfig.token,
        refreshToken: config.refreshToken || oldConfig.refreshToken,
        email: config.email || oldConfig.email,
        appUrl: config.appUrl || oldConfig.appUrl || DEFAULT_APP_URL,
        updatedAt: new Date().toISOString()
    };
    delete merged.password;

    await chrome.storage.local.set({ [CONFIG_KEY]: merged });
    await setupHealthAlarm(merged);
    await setupRemoteCommandAlarm(merged);
}

async function setupHealthAlarm(config) {
    await chrome.alarms.clear(HEALTH_ALARM_NAME);

    if (!config?.autoCheckEnabled) return;

    const hours = Math.max(1, Number(config.healthIntervalHours || 24));
    chrome.alarms.create(HEALTH_ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: hours * 60
    });
}

async function setupRemoteCommandAlarm(config) {
    await chrome.alarms.clear(HEALTH_COMMAND_ALARM_NAME);

    if (!config?.token || !config?.teamId) return;

    chrome.alarms.create(HEALTH_COMMAND_ALARM_NAME, {
        delayInMinutes: 0.5,
        periodInMinutes: 0.5
    });
}

async function restoreHealthExtensionAlarms() {
    const { config } = await chrome.storage.local.get(CONFIG_KEY);
    if (!config) return;
    await setupHealthAlarm(config);
    await setupRemoteCommandAlarm(config);
}

async function runShopHealthCheck(force = false) {
    if (healthRunInProgress) {
        throw new Error('Shop health check already running.');
    }

    healthRunInProgress = true;
    stopRequested = false;

    try {
        let { config } = await chrome.storage.local.get(CONFIG_KEY);
        if (!config || !Array.isArray(config.shops)) {
            throw new Error('Missing shop configuration.');
        }

        const activeShops = config.shops.filter(shop => shop.selected !== false && shop.label && supportsEtsy(shop));
        if (activeShops.length === 0) {
            throw new Error('No selected Etsy shops to check.');
        }

        const stats = {
            status: 'RUNNING',
            totalShops: activeShops.length,
            checkedShops: 0,
            suspendedCount: 0,
            errorCount: 0,
            currentShopName: '',
            lastRun: new Date().toISOString(),
            results: []
        };

        await chrome.storage.local.set({ [STATS_KEY]: stats });
        await notifyDashboard('EXTENSION_SHOP_HEALTH_START', { totalShops: activeShops.length });

        const results = [];

        for (let i = 0; i < activeShops.length; i++) {
            if (stopRequested) {
                stats.status = 'IDLE';
                stats.currentShopName = 'Stopped';
                stats.finishedAt = new Date().toISOString();
                await chrome.storage.local.set({ [STATS_KEY]: stats });
                return stats;
            }

            const shop = activeShops[i];
            stats.currentShopName = shop.label;
            stats.checkedShops = i;
            await chrome.storage.local.set({ [STATS_KEY]: stats });
            await notifyDashboard('EXTENSION_SHOP_HEALTH_PROGRESS', {
                current: i + 1,
                total: activeShops.length,
                shopName: shop.label
            }, 1);

            const result = await checkSingleShop(shop);
            if (stopRequested) {
                stats.status = 'IDLE';
                stats.currentShopName = 'Stopped';
                stats.finishedAt = new Date().toISOString();
                await chrome.storage.local.set({ [STATS_KEY]: stats });
                return stats;
            }
            results.push(result);

            stats.checkedShops = i + 1;
            stats.suspendedCount = results.filter(item => item.suspended).length;
            stats.errorCount = results.filter(item => item.status === 'error').length;
            stats.results = results;
            await chrome.storage.local.set({ [STATS_KEY]: stats });
            await mergeHealthResultIntoConfig(result);
            config = await saveHealthResultToDashboard(config, result);

            if (result.status === 'captcha_required') {
                stats.status = 'CAPTCHA_REQUIRED';
                stats.currentShopName = result.label;
                stats.errorCount = results.filter(item => item.status === 'error' || item.status === 'captcha_required').length;
                stats.finishedAt = new Date().toISOString();
                await chrome.storage.local.set({ [STATS_KEY]: stats });
                await notifyDashboard('EXTENSION_SHOP_HEALTH_COMPLETE', {
                    stats,
                    suspendedShops: results.filter(item => item.suspended)
                });
                return stats;
            }

            if (i < activeShops.length - 1) {
                await wait(randomDelay());
            }
        }

        stats.status = 'IDLE';
        stats.currentShopName = 'Done';
        stats.finishedAt = new Date().toISOString();
        await chrome.storage.local.set({ [STATS_KEY]: stats });

        await notifyDashboard('EXTENSION_SHOP_HEALTH_COMPLETE', {
            stats,
            suspendedShops: results.filter(item => item.suspended)
        });

        return stats;
    } finally {
        healthRunInProgress = false;
        currentHealthTabId = null;
    }
}

async function stopShopHealthCheck() {
    stopRequested = true;
    healthRunInProgress = false;

    if (currentHealthTabId) {
        try {
            await chrome.tabs.remove(currentHealthTabId);
        } catch (error) {
            // Tab may already be closed.
        }
        currentHealthTabId = null;
    }

    const stored = await chrome.storage.local.get(STATS_KEY);
    const oldStats = stored[STATS_KEY] || {};
    const stats = {
        ...oldStats,
        status: 'IDLE',
        currentShopName: 'Stopped',
        finishedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [STATS_KEY]: stats });
    return stats;
}

async function pollRemoteHealthCommand() {
    if (healthRunInProgress) return;

    let { config } = await chrome.storage.local.get(CONFIG_KEY);
    if (!config?.token || !config?.teamId) return;

    const { response, data, config: nextConfig } = await callExtensionApi(config, {
        action: 'claim-command',
        teamId: config.teamId,
        target: 'health'
    });
    config = nextConfig;

    if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Cannot claim remote health command (${response.status}).`);
    }

    const command = data?.command;
    if (!command?.id) return;

    try {
        if (command.command !== 'run_health_check') {
            throw new Error(`Unsupported health command: ${command.command || 'unknown'}`);
        }

        const payload = command.payload || {};
        if (Array.isArray(payload.shops) && payload.shops.length > 0) {
            config = {
                ...config,
                shops: payload.shops,
                updatedAt: new Date().toISOString()
            };
            await chrome.storage.local.set({ [CONFIG_KEY]: config });
        }

        const stats = await runShopHealthCheck(Boolean(payload.force));
        await completeRemoteHealthCommand(config, command.id, 'success', { stats });
    } catch (error) {
        await completeRemoteHealthCommand(config, command.id, 'error', null, error);
        throw error;
    }
}

async function completeRemoteHealthCommand(config, commandId, status, result = null, error = null) {
    if (!commandId) return;

    await callExtensionApi(config, {
        action: 'complete-command',
        teamId: config.teamId,
        commandId,
        status,
        result,
        error: error ? (error.message || String(error)) : null
    }).catch(completeError => {
        console.warn('[Background] Failed to complete remote health command:', completeError);
    });
}

async function saveHealthResultToDashboard(config, result) {
    if (!config?.token || !config?.teamId) return config;

    try {
        const { response, data, config: nextConfig } = await callExtensionApi(config, {
            action: 'save-health',
            teamId: config.teamId,
            result
        });

        if (!response.ok || data?.success === false) {
            console.warn(`[Background] Failed to save shop health for ${result.label}: ${response.status} ${data?.message || 'Unknown error'}`);
        }

        return nextConfig;
    } catch (error) {
        console.warn(`[Background] Failed to save shop health for ${result.label}:`, error);
        if (/sign in again|refresh token|session expired/i.test(error?.message || '')) {
            await markAuthRequired(error.message);
            throw error;
        }
        return config;
    }
}

async function callExtensionApi(config, payload, options = {}) {
    const auth = options.auth !== false;
    const retry = options.retry !== false;
    const appUrl = (config.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');

    const headers = { 'Content-Type': 'application/json' };
    if (auth && config.token) headers.Authorization = `Bearer ${config.token}`;

    let response;
    try {
        response = await fetch(`${appUrl}${EXTENSION_API_PATH}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
    } catch (error) {
        if (appUrl !== DEFAULT_APP_URL && /localhost|127\.0\.0\.1/i.test(appUrl)) {
            const fallbackConfig = { ...config, appUrl: DEFAULT_APP_URL, updatedAt: new Date().toISOString() };
            await chrome.storage.local.set({ [CONFIG_KEY]: fallbackConfig });
            return callExtensionApi(fallbackConfig, payload, options);
        }
        throw error;
    }
    const data = await readJsonResponse(response);

    if (auth && retry && response.status === 401) {
        const refreshedConfig = await refreshAuthToken(config);
        return callExtensionApi(refreshedConfig, payload, { ...options, retry: false });
    }

    return { response, data, config };
}

async function refreshAuthToken(config) {
    if (!config?.refreshToken) {
        throw new Error('Session expired. Please sign in again in the extension.');
    }

    const { response, data } = await callExtensionApi(config, {
        action: 'refresh-token',
        refreshToken: config.refreshToken
    }, { auth: false, retry: false });

    if (!response.ok || !data?.success || !data.token) {
        throw new Error(data?.message || 'Session expired. Please sign in again in the extension.');
    }

    const stored = await chrome.storage.local.get(CONFIG_KEY);
    const oldConfig = stored[CONFIG_KEY] || config;
    const nextConfig = {
        ...oldConfig,
        token: data.token,
        refreshToken: data.refreshToken || oldConfig.refreshToken || config.refreshToken,
        email: data.email || oldConfig.email,
        teamId: data.teamId || oldConfig.teamId,
        updatedAt: new Date().toISOString(),
        authUpdatedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({ [CONFIG_KEY]: nextConfig });
    return nextConfig;
}

async function readJsonResponse(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch (error) {
        return {
            success: false,
            message: `Server did not return JSON (${response.status}). ${text.slice(0, 120)}`
        };
    }
}

async function markAuthRequired(message) {
    const stored = await chrome.storage.local.get(STATS_KEY);
    const oldStats = stored[STATS_KEY] || {};
    await chrome.storage.local.set({
        [STATS_KEY]: {
            ...oldStats,
            status: 'AUTH_REQUIRED',
            currentShopName: 'Sign in again',
            errorCount: (oldStats.errorCount || 0) + 1,
            authError: message,
            finishedAt: new Date().toISOString()
        }
    });
}

async function checkSingleShop(shop) {
    const checkedAt = new Date().toISOString();
    const label = String(shop.label || '').trim();
    const url = `https://www.etsy.com/shop/${encodeURIComponent(label)}/reviews`;
    let tabId = null;
    let keepTabOpen = false;

    try {
        const tab = await createVisibleTab(url);
        tabId = tab.id;
        currentHealthTabId = tabId;
        await waitForTabComplete(tabId);
        await wait(TAB_PARSE_DELAY_MS);

        const [{ result: pageResult }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: parseShopHealthFromPage
        });

        if (pageResult?.captchaRequired) {
            keepTabOpen = true;
            return buildHealthResult(shop, {
                status: 'captcha_required',
                suspended: false,
                error: 'Etsy CAPTCHA / bot check appeared. The tab was left open for manual verification.',
                checkedAt,
                keepTabOpen: true
            });
        }

        if (pageResult?.notFound) {
            return buildHealthResult(shop, {
                status: 'suspended',
                suspended: true,
                suspendedReason: 'Etsy reviews page returned not found.',
                checkedAt
            });
        }

        if (pageResult?.suspended) {
            return buildHealthResult(shop, {
                status: 'suspended',
                suspended: true,
                suspendedReason: pageResult.suspendedReason || 'Shop is currently not selling on Etsy.',
                reviewAverage: pageResult.reviewAverage,
                reviewCount: pageResult.reviewCount,
                checkedAt
            });
        }

        return buildHealthResult(shop, {
            status: 'ok',
            suspended: false,
            reviewAverage: pageResult?.reviewAverage,
            reviewCount: pageResult?.reviewCount,
            checkedAt
        });
    } catch (error) {
        return buildHealthResult(shop, {
            status: 'error',
            suspended: false,
            error: error.message || 'Failed to fetch Etsy reviews page.',
            checkedAt
        });
    } finally {
        if (tabId) {
            if (currentHealthTabId === tabId) currentHealthTabId = null;
            if (keepTabOpen) return;
            try {
                const [{ result: pageState }] = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => ({
                        captchaRequired: /captcha|robot|are you human|verify you are/i.test(document.body?.innerText || '')
                    })
                });
                if (!pageState?.captchaRequired) await chrome.tabs.remove(tabId);
            } catch (error) {
                try { await chrome.tabs.remove(tabId); } catch (closeError) { /* noop */ }
            }
        }
    }
}

function buildHealthResult(shop, data) {
    const wasSuspended = shop.suspended === true;
    const isConfirmedState = data.status === 'ok' || data.status === 'suspended';
    const isSuspended = isConfirmedState && Boolean(data.suspended);

    return {
        id: shop.id,
        label: shop.label,
        selected: shop.selected !== false,
        reviewAverage: typeof data.reviewAverage === 'number' ? data.reviewAverage : null,
        reviewCount: typeof data.reviewCount === 'number' ? data.reviewCount : null,
        status: data.status,
        suspended: Boolean(data.suspended),
        suspendedReason: data.suspendedReason || null,
        newlySuspended: isSuspended && !wasSuspended,
        suspendedSince: isSuspended
            ? (wasSuspended ? (shop.suspendedSince || shop.suspensionStatusChangedAt || shop.healthCheckedAt || data.checkedAt) : data.checkedAt)
            : null,
        error: data.error || null,
        checkedAt: data.checkedAt,
        keepTabOpen: Boolean(data.keepTabOpen)
    };
}

async function mergeHealthResultIntoConfig(result) {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    const config = stored[CONFIG_KEY];
    if (!config || !Array.isArray(config.shops)) return;

    const shops = config.shops.map(shop => {
        if (String(shop.id) !== String(result.id) && String(shop.label) !== String(result.label)) return shop;
        const nextShop = {
            ...shop,
            reviewAverage: result.reviewAverage,
            reviewCount: result.reviewCount,
            healthStatus: result.status,
            healthError: result.error,
            healthCheckedAt: result.checkedAt
        };

        if (result.status === 'ok' || result.status === 'suspended') {
            const wasSuspended = shop.suspended === true;
            nextShop.suspended = result.suspended;
            nextShop.suspendedReason = result.suspendedReason;
            nextShop.newlySuspended = result.newlySuspended === true;
            nextShop.suspendedSince = result.suspended ? result.suspendedSince : null;
            nextShop.suspensionStatusChangedAt = wasSuspended !== result.suspended ? result.checkedAt : shop.suspensionStatusChangedAt;
        }

        return nextShop;
    });

    await chrome.storage.local.set({
        [CONFIG_KEY]: {
            ...config,
            shops,
            lastShopHealthCheckAt: new Date().toISOString()
        }
    });
}

async function notifyDashboard(type, data = {}, retries = 2) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const stored = await chrome.storage.local.get(CONFIG_KEY);
            const appUrl = (stored[CONFIG_KEY]?.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
            const tabs = await chrome.tabs.query({ url: `${appUrl}/*` });

            let sent = 0;
            for (const tab of tabs) {
                if (!tab.id) continue;
                try {
                    await chrome.tabs.sendMessage(tab.id, { type, ...data });
                    sent++;
                } catch (error) {
                    // Dashboard tab may not have the bridge loaded yet.
                }
            }

            if (sent > 0) return true;
            if (attempt < retries - 1) await wait(1000);
        } catch (error) {
            if (attempt < retries - 1) await wait(1000);
        }
    }

    return false;
}

function randomDelay() {
    return SHOP_DELAY_MIN_MS + Math.random() * (SHOP_DELAY_MAX_MS - SHOP_DELAY_MIN_MS);
}

function normalizePlatforms(shop) {
    return Array.isArray(shop?.platforms)
        ? shop.platforms.map(platform => String(platform).trim().toLowerCase()).filter(Boolean)
        : [];
}

function supportsEtsy(shop) {
    const platforms = normalizePlatforms(shop);
    return platforms.includes('etsy');
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createVisibleTab(url) {
    return new Promise((resolve, reject) => {
        chrome.tabs.create({ url, active: false }, (tab) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(tab);
        });
    });
}

function waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Timed out waiting for Etsy tab to load.'));
        }, TAB_LOAD_TIMEOUT_MS);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };

        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) return;
            if (tab.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        });
    });
}

function parseShopHealthFromPage() {
    const bodyText = document.body?.innerText || '';
    const html = document.documentElement?.outerHTML || '';
    const captchaRequired = /captcha|robot|are you human|verify you are|security check/i.test(bodyText)
        || /\/captcha/i.test(location.href);
    const notFound = /Sorry,\s*the page you were looking for was not found/i.test(bodyText)
        || /page not found/i.test(document.title || '');
    const suspended = /currently\s+not\s+selling\s+on\s+Etsy/i.test(bodyText);

    const titleNode = document.querySelector('.wt-text-title-large');
    let reviewAverage = titleNode ? Number((titleNode.textContent || '').trim()) : null;
    let reviewCount = null;

    if (titleNode) {
        const candidates = Array.from(document.querySelectorAll('.wt-text-body-small, span'));
        const countNode = candidates.find(node => /^\(\s*[\d,]+\s*\)$/.test((node.textContent || '').trim()));
        if (countNode) {
            reviewCount = Number((countNode.textContent || '').replace(/[^\d]/g, ''));
        }
    }

    if (!Number.isFinite(reviewAverage)) {
        const ratingBlockMatch = html.match(/<span[^>]*class=["'][^"']*\bwt-text-title-large\b[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/span>[\s\S]{0,1600}?<span[^>]*class=["'][^"']*\bwt-text-body-small\b[^"']*["'][^>]*>\s*\(([0-9,]+)\)\s*<\/span>/i);
        if (ratingBlockMatch) {
            reviewAverage = Number(ratingBlockMatch[1]);
            reviewCount = Number(ratingBlockMatch[2].replace(/,/g, ''));
        }
    }

    if (!Number.isFinite(reviewAverage)) {
        const ariaMatch = html.match(/Rating:\s*([0-9]+(?:\.[0-9]+)?)\s*out of 5 stars,\s*([0-9,]+)\s*reviews/i);
        if (ariaMatch) {
            reviewAverage = Number(ariaMatch[1]);
            reviewCount = Number(ariaMatch[2].replace(/,/g, ''));
        }
    }

    return {
        captchaRequired,
        notFound,
        suspended,
        suspendedReason: suspended ? 'Shop is currently not selling on Etsy.' : null,
        reviewAverage: Number.isFinite(reviewAverage) ? reviewAverage : null,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
        url: location.href
    };
}
