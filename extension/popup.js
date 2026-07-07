document.addEventListener('DOMContentLoaded', () => {
    const DEFAULT_APP_URL = 'https://dashboardvikcom.vercel.app';
    const EXTENSION_API_PATH = '/api/extension-shop-health';

    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const runNowBtn = document.getElementById('runNowBtn');
    const refreshShopsBtn = document.getElementById('refreshShopsBtn');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const stopRunBtn = document.getElementById('stopRunBtn');
    const shopListContainer = document.getElementById('shopListContainer');
    const autoCheckEnable = document.getElementById('autoCheckEnable');
    const healthIntervalHours = document.getElementById('healthIntervalHours');
    const nextRunEl = document.getElementById('nextRun');

    let currentConfig = null;
    let isRefreshingShops = false;

    chrome.storage.local.get(['config', 'shopHealthStats'], (result) => {
        if (result.config && result.config.token) {
            currentConfig = sanitizeConfig(result.config);
            if (result.config.password) {
                chrome.storage.local.set({ config: currentConfig });
            }
            renderMain(result.shopHealthStats);
            handleRefreshShops({ silent: true }).catch(error => {
                console.warn('[Popup] Auto refresh shops failed:', error);
            });
        } else {
            showLogin();
        }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes.config) {
            currentConfig = changes.config.newValue || null;
            if (currentConfig) renderShopList(currentConfig.shops || []);
        }

        if (changes.shopHealthStats) {
            updateStatusUI(changes.shopHealthStats.newValue || null);
        }
    });

    loginBtn.addEventListener('click', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    runNowBtn.addEventListener('click', handleRunHealthCheck);
    stopRunBtn.addEventListener('click', handleStopHealthCheck);
    refreshShopsBtn.addEventListener('click', handleRefreshShops);
    saveConfigBtn.addEventListener('click', handleSaveSelection);

    function showLogin() {
        loginScreen.style.display = 'block';
        mainApp.style.display = 'none';
        chrome.storage.local.get(['config'], (result) => {
            if (result.config?.appUrl) {
                const url = (result.config.appUrl || '').trim().replace(/\/$/, '');
                const selectEl = document.getElementById('loginAppUrl');
                if (url.includes('localhost') || url.includes('127.0.0.1')) {
                    selectEl.value = 'http://localhost:3000';
                } else {
                    selectEl.value = 'https://dashboardvikcom.vercel.app';
                }
            }
        });
    }

    function renderMain(stats) {
        loginScreen.style.display = 'none';
        mainApp.style.display = 'block';
        renderScheduleControls();
        renderShopList(currentConfig?.shops || []);
        updateStatusUI(stats || null);
    }

    async function handleLogin() {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPass').value.trim();
        const appUrl = (document.getElementById('loginAppUrl').value || DEFAULT_APP_URL).replace(/\/$/, '');
        const errorDiv = document.getElementById('loginError');

        if (!email || !password) {
            errorDiv.textContent = 'Email and password are required.';
            return;
        }

        loginBtn.textContent = 'Signing in...';
        loginBtn.disabled = true;
        errorDiv.textContent = '';

        try {
            const response = await fetch(`${appUrl}${EXTENSION_API_PATH}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', email, password })
            });
            const data = await readJsonResponse(response);

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Login failed.');
            }

            currentConfig = {
                appUrl,
                teamId: data.teamId,
                token: data.token,
                refreshToken: data.refreshToken,
                email: data.email,
                shops: Array.isArray(data.shops) ? data.shops.map(shop => ({ ...shop, selected: true })) : [],
                autoCheckEnabled: false,
                healthIntervalHours: 24,
                updatedAt: new Date().toISOString()
            };

            await chrome.storage.local.set({ config: currentConfig });
            chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: currentConfig });
            renderMain(null);
        } catch (error) {
            errorDiv.textContent = error.message;
        } finally {
            loginBtn.textContent = 'Sign In';
            loginBtn.disabled = false;
        }
    }

    function handleLogout() {
        chrome.storage.local.remove(['config', 'shopHealthStats'], () => {
            currentConfig = null;
            chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: null });
            showLogin();
        });
    }

    async function handleRunHealthCheck() {
        await handleSaveSelection(false);
        runNowBtn.textContent = 'Checking...';
        runNowBtn.disabled = true;
        stopRunBtn.style.display = 'block';

        chrome.runtime.sendMessage({ type: 'TRIGGER_SHOP_HEALTH_CHECK', force: true }, (response) => {
            if (!response?.success) {
                showSaveMessage(response?.error || 'Failed to start health check.', true);
                runNowBtn.disabled = false;
                runNowBtn.textContent = 'Check Selected Shops';
                stopRunBtn.style.display = 'none';
            }
        });
    }

    function handleStopHealthCheck() {
        stopRunBtn.textContent = 'Stopping...';
        stopRunBtn.disabled = true;

        chrome.runtime.sendMessage({ type: 'STOP_SHOP_HEALTH_CHECK' }, (response) => {
            stopRunBtn.disabled = false;
            stopRunBtn.textContent = 'Stop / Reset Check';
            stopRunBtn.style.display = 'none';
            runNowBtn.disabled = false;
            runNowBtn.textContent = 'Check Selected Shops';
            if (!response?.success) {
                showSaveMessage(response?.error || 'Failed to stop check.', true);
            }
        });
    }

    async function handleRefreshShops(options = {}) {
        if (!currentConfig) return;
        if (isRefreshingShops) return;

        const silent = options.silent === true;
        isRefreshingShops = true;
        if (!silent) {
            refreshShopsBtn.textContent = 'Refreshing...';
            refreshShopsBtn.disabled = true;
        }

        try {
            const { response, data, config: nextConfig } = await callExtensionApi(currentConfig, {
                action: 'get-shops',
                teamId: currentConfig.teamId
            });

            if (!response.ok || !Array.isArray(data.shops)) {
                throw new Error(data.message || 'No shops returned.');
            }

            const oldById = new Map((currentConfig.shops || []).map(shop => [String(shop.id), shop]));
            currentConfig = {
                ...nextConfig,
                shops: data.shops.map(shop => ({
                    ...oldById.get(String(shop.id)),
                    ...shop,
                    selected: oldById.has(String(shop.id)) ? oldById.get(String(shop.id)).selected !== false : true
                })),
                updatedAt: new Date().toISOString()
            };

            await chrome.storage.local.set({ config: currentConfig });
            chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: currentConfig });
            renderShopList(currentConfig.shops);
            await refreshStatsFromCurrentShops();
            if (!silent) showSaveMessage('Shop list refreshed.', false);
        } catch (error) {
            if (!silent) showSaveMessage(error.message, true);
            if (silent) throw error;
        } finally {
            isRefreshingShops = false;
            if (!silent) {
                refreshShopsBtn.textContent = 'Refresh Shops';
                refreshShopsBtn.disabled = false;
            }
        }
    }

    async function refreshStatsFromCurrentShops() {
        const stored = await chrome.storage.local.get('shopHealthStats');
        const oldStats = stored.shopHealthStats || {};
        const selectedEtsyShops = (currentConfig.shops || []).filter(shop => shop.selected !== false && supportsEtsy(shop));
        const suspendedCount = selectedEtsyShops.filter(shop => shop.suspended === true).length;
        const nextStats = {
            ...oldStats,
            status: oldStats.status === 'RUNNING' ? oldStats.status : 'IDLE',
            totalShops: selectedEtsyShops.length || oldStats.totalShops || 0,
            suspendedCount,
            currentShopName: oldStats.status === 'RUNNING' ? oldStats.currentShopName : '',
            refreshedAt: new Date().toISOString()
        };

        await chrome.storage.local.set({ shopHealthStats: nextStats });
        updateStatusUI(nextStats);
    }

    function handleSaveSelection(showMessage = true) {
        if (!currentConfig) return Promise.resolve();

        const rows = Array.from(shopListContainer.querySelectorAll('.shop-item'));
        const selectedById = new Map();
        rows.forEach(row => {
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (checkbox) selectedById.set(String(checkbox.value), checkbox.checked);
        });

        currentConfig = {
            ...currentConfig,
            shops: (currentConfig.shops || []).map(shop => ({
                ...shop,
                selected: selectedById.has(String(shop.id)) ? selectedById.get(String(shop.id)) : shop.selected !== false
            })),
            autoCheckEnabled: autoCheckEnable.checked === true,
            healthIntervalHours: Math.max(1, Number(healthIntervalHours.value || 24)),
            updatedAt: new Date().toISOString()
        };

        return new Promise(resolve => {
            chrome.storage.local.set({ config: currentConfig }, () => {
                chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: currentConfig }, () => {
                    renderShopList(currentConfig.shops);
                    renderScheduleControls();
                    if (showMessage) showSaveMessage('Selection saved.', false);
                    resolve();
                });
            });
        });
    }

    function updateStatusUI(stats) {
        const statusEl = document.getElementById('serviceStatus');
        const checkedEl = document.getElementById('checkedCount');
        const suspendedEl = document.getElementById('suspendedCount');
        const errorEl = document.getElementById('errorCount');
        const lastEl = document.getElementById('lastRun');
        const currentEl = document.getElementById('currentShop');

        const isRunning = stats?.status === 'RUNNING';
        const captchaRequired = stats?.status === 'CAPTCHA_REQUIRED';
        const suspended = stats?.suspendedCount || 0;
        const errors = stats?.errorCount || 0;

        statusEl.textContent = isRunning ? 'RUNNING' : captchaRequired ? 'CAPTCHA' : suspended > 0 ? 'WARNING' : 'IDLE';
        statusEl.className = `status-badge ${isRunning ? 'running' : (captchaRequired || suspended > 0) ? 'warn' : ''}`;

        checkedEl.textContent = String(stats?.checkedShops || 0);
        suspendedEl.textContent = String(suspended);
        errorEl.textContent = String(errors);
        suspendedEl.style.color = suspended > 0 ? '#dc2626' : '#0f172a';
        errorEl.style.color = errors > 0 ? '#ca8a04' : '#0f172a';
        lastEl.textContent = stats?.lastRun ? formatRelativeTime(stats.lastRun) : 'Never';
        currentEl.textContent = stats?.currentShopName || '-';

        runNowBtn.disabled = isRunning;
        runNowBtn.textContent = isRunning ? 'Checking...' : 'Check Selected Shops';
        stopRunBtn.style.display = isRunning || captchaRequired ? 'block' : 'none';
        stopRunBtn.disabled = false;
        stopRunBtn.textContent = 'Stop / Reset Check';

        if (currentConfig) renderShopList(currentConfig.shops || []);
        updateNextRunLabel();
    }

    function renderShopList(shops) {
        shopListContainer.innerHTML = '';
        const etsyShops = Array.isArray(shops) ? shops.filter(supportsEtsy) : [];

        if (etsyShops.length === 0) {
            shopListContainer.innerHTML = '<div class="card muted" style="text-align:center;">No Etsy shops loaded. Refresh shops or mark accounts as Etsy in Mail settings.</div>';
            return;
        }

        etsyShops.forEach(shop => {
            const row = document.createElement('div');
            row.className = `shop-item ${shop.suspended ? 'suspended' : ''}`;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = shop.id;
            checkbox.checked = shop.selected !== false;

            const healthTick = document.createElement('div');
            healthTick.innerHTML = getShopHealthTickHtml(shop);

            const info = document.createElement('div');
            info.innerHTML = `
                <div class="shop-name" title="${escapeHtml(shop.label || '')}">${escapeHtml(shop.label || '-')}</div>
                <div class="shop-meta">${getShopStatusText(shop)}</div>
            `;

            const rating = document.createElement('div');
            rating.className = 'rating';
            rating.innerHTML = getRatingHtml(shop);

            row.appendChild(checkbox);
            row.appendChild(healthTick);
            row.appendChild(info);
            row.appendChild(rating);
            shopListContainer.appendChild(row);
        });
    }

    function getShopHealthTickHtml(shop) {
        const isSuspended = shop.suspended === true;
        const label = isSuspended ? 'Suspended' : 'Live';
        const stateClass = isSuspended ? 'suspended' : 'live';
        return `<span class="shop-health-tick ${stateClass}" title="${label}">&#10003;</span>`;
    }

    function getRatingHtml(shop) {
        if (shop.suspended) {
            return '<div class="status-badge bad">SUSPENDED</div>';
        }

        if (shop.healthStatus === 'captcha_required') {
            return '<div class="status-badge warn">CAPTCHA</div>';
        }

        if (typeof shop.reviewAverage === 'number') {
            const count = typeof shop.reviewCount === 'number' ? shop.reviewCount.toLocaleString() : '-';
            return `
                <div class="rating-main">&#9733;${shop.reviewAverage.toFixed(2)}</div>
                <div class="rating-count">(${count})</div>
            `;
        }

        if (shop.healthStatus === 'error') {
            return '<div class="status-badge warn">ERROR</div>';
        }

        return '<div class="rating-main muted">-</div><div class="rating-count">not checked</div>';
    }

    function getShopStatusText(shop) {
        if (shop.suspended) return escapeHtml(shop.suspendedReason || 'Currently not selling on Etsy');
        if (shop.healthStatus === 'captcha_required') return 'CAPTCHA opened in Etsy tab. Complete it, then run again.';
        if (shop.healthError) return escapeHtml(shop.healthError);
        if (shop.healthCheckedAt) return `Checked ${formatRelativeTime(shop.healthCheckedAt)}`;
        return 'Not checked yet';
    }

    function showSaveMessage(message, isError) {
        const el = document.getElementById('saveMsg');
        el.textContent = message;
        el.style.color = isError ? '#dc2626' : '#059669';
        setTimeout(() => {
            if (el.textContent === message) el.textContent = '';
        }, 2500);
    }

    function formatRelativeTime(value) {
        const date = new Date(value);
        const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (diffSeconds < 60) return 'Just now';
        if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
        if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
        return date.toLocaleDateString();
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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

    async function readJsonResponse(response) {
        const text = await response.text();
        try {
            return text ? JSON.parse(text) : {};
        } catch (error) {
            throw new Error(`Server did not return JSON (${response.status}). ${text.slice(0, 120)}`);
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
                currentConfig = fallbackConfig;
                await chrome.storage.local.set({ config: fallbackConfig });
                chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: fallbackConfig });
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
            throw new Error('Session expired. Please sign in again.');
        }

        const { response, data } = await callExtensionApi(config, {
            action: 'refresh-token',
            refreshToken: config.refreshToken
        }, { auth: false, retry: false });

        if (!response.ok || !data?.success || !data.token) {
            throw new Error(data?.message || 'Session expired. Please sign in again.');
        }

        const nextConfig = {
            ...config,
            token: data.token,
            refreshToken: data.refreshToken || config.refreshToken,
            email: data.email || config.email,
            teamId: data.teamId || config.teamId,
            updatedAt: new Date().toISOString(),
            authUpdatedAt: new Date().toISOString()
        };

        currentConfig = nextConfig;
        await chrome.storage.local.set({ config: nextConfig });
        chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: nextConfig });
        return nextConfig;
    }

    function sanitizeConfig(config) {
        if (!config) return config;
        const { password, ...safeConfig } = config;
        return safeConfig;
    }

    function renderScheduleControls() {
        if (!currentConfig) return;
        autoCheckEnable.checked = currentConfig.autoCheckEnabled === true;
        healthIntervalHours.value = String(Math.max(1, Number(currentConfig.healthIntervalHours || 24)));
        updateNextRunLabel();
    }

    function updateNextRunLabel() {
        if (!chrome.alarms || !nextRunEl) return;
        chrome.alarms.get('etsy_shop_health_cron', (alarm) => {
            if (!alarm) {
                nextRunEl.textContent = 'Not scheduled';
                return;
            }
            const next = new Date(alarm.scheduledTime);
            nextRunEl.textContent = next.toLocaleString([], {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        });
    }
});
