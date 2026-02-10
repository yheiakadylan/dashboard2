document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // Config State
    let currentUser = null;

    // --- VIEW MANAGEMENT ---
    function showLogin() {
        loginScreen.style.display = 'block';
        mainApp.style.display = 'none';

        // Auto-fill defaults if present but not fully logged in
        chrome.storage.local.get(['config'], (result) => {
            if (result.config && result.config.appUrl) {
                document.getElementById('loginAppUrl').value = result.config.appUrl;
            }
        });
    }

    function showMainApp() {
        loginScreen.style.display = 'none';
        mainApp.style.display = 'block';
        updateStatusUI();
    }

    // --- UI MODE TOGGLE ---
    const radioInterval = document.querySelector('input[name="crawlMode"][value="interval"]');
    const radioDaily = document.querySelector('input[name="crawlMode"][value="daily"]');
    const groupInterval = document.getElementById('groupInterval');
    const groupDaily = document.getElementById('groupDaily');

    function toggleModeUI() {
        if (radioInterval && radioInterval.checked) {
            if (groupInterval) groupInterval.style.display = 'block';
            if (groupDaily) groupDaily.style.display = 'none';
        } else {
            if (groupInterval) groupInterval.style.display = 'none';
            if (groupDaily) groupDaily.style.display = 'block';
        }
    }

    if (radioInterval) radioInterval.addEventListener('change', toggleModeUI);
    if (radioDaily) radioDaily.addEventListener('change', toggleModeUI);

    // Check Auth on Load
    chrome.storage.local.get(['config'], (result) => {
        if (result.config && result.config.token) {
            currentUser = result.config; // Contains token, teamId, shops
            // Pre-fill settings
            document.getElementById('appUrl').value = result.config.appUrl || 'https://dashboardvikcom.vercel.app';
            document.getElementById('teamId').value = result.config.teamId || 'jwnm5emo8mdG3gjIlh7CctiVvQO2';
            document.getElementById('autoCrawlEnable').checked = result.config.autoCrawlEnabled !== false;

            // Mode Logic
            const mode = result.config.autoCrawlMode || 'interval';
            if (mode === 'daily') {
                if (radioDaily) radioDaily.checked = true;
            } else {
                if (radioInterval) radioInterval.checked = true;
            }
            toggleModeUI();

            document.getElementById('intervalHours').value = result.config.intervalHours || 6;
            document.getElementById('dailyTime').value = result.config.dailyTime || '06:00';

            if (result.config.shops) {
                renderShopList(result.config.shops, true);
            }
            showMainApp();
        } else {
            showLogin();
        }
    });

    // --- LOGIN LOGIC ---
    loginBtn.addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPass').value.trim();
        const appUrl = document.getElementById('loginAppUrl').value.replace(/\/$/, '');
        const errorDiv = document.getElementById('loginError');

        if (!email || !password) {
            errorDiv.textContent = 'Email and password required';
            return;
        }

        loginBtn.textContent = 'Signing in...';
        loginBtn.disabled = true;
        errorDiv.textContent = '';

        try {
            const res = await fetch(`${appUrl}/api/listing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'login',
                    email,
                    password
                })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Login failed');
            }

            // Save Config
            const newConfig = {
                appUrl,
                teamId: data.teamId,
                token: data.token,
                email: data.email,
                shops: data.shops ? data.shops.map(s => ({ ...s, selected: true })) : [], // Select all by default
                intervalHours: 6,
                autoCrawlEnabled: true,
                updatedAt: new Date().toISOString()
            };

            chrome.storage.local.set({ config: newConfig }, () => {
                currentUser = newConfig;
                // Sync to Background
                chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: newConfig });

                // Update UI fields in Settings Tab
                document.getElementById('appUrl').value = appUrl;
                document.getElementById('teamId').value = data.teamId;
                renderShopList(newConfig.shops, true);

                showMainApp();
            });

        } catch (err) {
            console.error(err);
            errorDiv.textContent = err.message;
        } finally {
            loginBtn.textContent = 'Sign In';
            loginBtn.disabled = false;
        }
    });

    // --- LOGOUT LOGIC ---
    logoutBtn.addEventListener('click', () => {
        chrome.storage.local.remove(['config'], () => {
            currentUser = null;
            chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: null }); // Clear in background
            showLogin();
        });
    });


    // --- TABS LOGIC ---
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            // FIX: Ensure main-app context
            const target = tab.dataset.tab;
            document.getElementById(target).classList.add('active');
        });
    });

    // --- STATUS TAB ---
    function updateStatusUI() {
        chrome.storage.local.get(['stats', 'config'], (result) => {
            // Context Variables
            const elNext = document.getElementById('nextRun');
            const elStatus = document.getElementById('serviceStatus');
            const elLast = document.getElementById('lastRun');
            const elShops = document.getElementById('totalShops');
            const elListings = document.getElementById('totalListings');

            const s = result.stats || {};
            const isRunning = s.status === 'RUNNING';

            // 1. Update Counts & Running Status
            let shopText = (s.totalShops || 0).toLocaleString();

            if (isRunning) {
                // Formatting: "5 (Running 1/5) - ShopName"
                if (s.currentShopIndex) {
                    shopText += ` (Running ${s.currentShopIndex}/${s.totalShops})`;
                }
                if (s.currentShopName) {
                    shopText += ` - ${s.currentShopName}`;
                }

                if (elStatus) {
                    elStatus.innerHTML = '<div class="dot" style="background:#22c55e; box-shadow: 0 0 8px #22c55e;"></div> RUNNING';
                    elStatus.className = 'status-badge';
                }
            } else {
                if (elStatus && elStatus.textContent.includes('RUNNING')) {
                    elStatus.className = 'status-badge'; // Reset if needed, but wait for alarm check below
                }
            }

            if (elShops) elShops.textContent = shopText;
            if (elListings) elListings.textContent = (s.totalListings || 0).toLocaleString();

            // 2. Last Run Time
            if (s.lastRun && elLast) {
                const date = new Date(s.lastRun);
                const now = new Date();
                const diff = (now - date) / 1000;
                let timeStr = '';
                if (diff < 60) timeStr = 'Just now';
                else if (diff < 3600) timeStr = Math.floor(diff / 60) + 'm ago';
                else if (diff < 86400) timeStr = Math.floor(diff / 3600) + 'h ago';
                else timeStr = date.toLocaleDateString();
                elLast.textContent = timeStr;
            }

            // 3. Next Run (Only if NOT running)
            if (chrome.alarms) {
                chrome.alarms.get('auto_crawl', (alarm) => {
                    if (alarm) {
                        const next = new Date(alarm.scheduledTime);
                        const h = String(next.getHours()).padStart(2, '0');
                        const m = String(next.getMinutes()).padStart(2, '0');
                        if (elNext) elNext.textContent = `${h}:${m}`;

                        // Only show ACTIVE if not currently RUNNING
                        if (elStatus && !isRunning) {
                            elStatus.innerHTML = '<div class="dot"></div> ACTIVE';
                            elStatus.className = 'status-badge';
                        }
                    } else {
                        if (elNext) elNext.textContent = 'Not Scheduled';

                        if (elStatus && !isRunning) {
                            elStatus.innerHTML = '<div class="dot" style="background:#64748b"></div> STOPPED';
                            elStatus.className = 'status-badge inactive';
                        }
                    }
                });
            }
        });
    }

    // Run Now Button
    document.getElementById('runNowBtn').addEventListener('click', () => {
        console.log('[Popup] Run Now clicked');

        const runBtn = document.getElementById('runNowBtn');
        const stopBtn = document.getElementById('stopCrawlBtn');

        // Immediate UI feedback
        runBtn.textContent = '⏳ Starting...';
        runBtn.disabled = true;

        chrome.runtime.sendMessage({ type: 'TRIGGER_CRAWL_NOW' }, (response) => {
            console.log('[Popup] Run Now response:', response);

            // Switch to Stop button
            runBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            runBtn.disabled = false;
            runBtn.textContent = '▶ Run Now';

            // Update status
            const statusEl = document.getElementById('serviceStatus');
            if (statusEl) {
                statusEl.innerHTML = '<div class="dot" style="background:#22c55e; box-shadow: 0 0 8px #22c55e;"></div> RUNNING';
                statusEl.className = 'status-badge';
            }
        });
    });

    // Stop Crawl Button
    let manualActionLock = false; // Prevent polling interference during manual actions

    document.getElementById('stopCrawlBtn').addEventListener('click', () => {
        console.log('[Popup] Stop button clicked');
        manualActionLock = true; // Lock to prevent polling override

        // Immediate UI feedback
        const stopBtn = document.getElementById('stopCrawlBtn');
        const runBtn = document.getElementById('runNowBtn');
        stopBtn.textContent = '⏳ Stopping...';
        stopBtn.disabled = true;

        chrome.runtime.sendMessage({ type: 'STOP_CRAWL' }, (response) => {
            console.log('[Popup] Stop response:', response);

            // Force immediate UI update
            stopBtn.style.display = 'none';
            runBtn.style.display = 'block';
            stopBtn.disabled = false;
            stopBtn.textContent = '⏸ Stop Crawl';

            // Also update status display
            const statusEl = document.getElementById('serviceStatus');
            if (statusEl) {
                statusEl.innerHTML = '<div class="dot" style="background:#64748b"></div> STOPPED';
                statusEl.className = 'status-badge inactive';
            }

            // Release lock after UI settles
            setTimeout(() => {
                manualActionLock = false;
            }, 2000);
        });
    });

    // Update Button Visibility based on Status
    function updateActionButtons() {
        if (manualActionLock) return; // Skip during manual Stop/Run actions

        chrome.storage.local.get(['stats'], (result) => {
            const runNowBtn = document.getElementById('runNowBtn');
            const stopBtn = document.getElementById('stopCrawlBtn');

            if (result.stats && result.stats.status === 'RUNNING') {
                runNowBtn.style.display = 'none';
                stopBtn.style.display = 'block';
            } else {
                runNowBtn.style.display = 'block';
                stopBtn.style.display = 'none';
            }
        });
    }

    // Call on load and every second
    updateActionButtons();
    setInterval(updateActionButtons, 1000);

    // --- SETTINGS TAB ---

    // Fetch Shops (Refresh) - Using Single API
    document.getElementById('fetchShopsBtn').addEventListener('click', async () => {
        if (!currentUser) return;

        const btn = document.getElementById('fetchShopsBtn');
        const teamId = document.getElementById('teamId').value;
        const appUrl = document.getElementById('appUrl').value.replace(/\/$/, '');

        btn.textContent = 'Refreshing...';
        btn.disabled = true;

        try {
            // Using unified API 'get-shops' action
            const res = await fetch(`${appUrl}/api/listing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'get-shops',
                    teamId: teamId
                    // token: currentUser.token 
                })
            });
            const data = await res.json();

            if (data.shops) {
                // Determine selection state (preserve)
                const oldSelected = new Set((currentUser.shops || []).filter(s => s.selected).map(s => s.id));
                const newShops = data.shops.map(s => ({
                    ...s,
                    selected: oldSelected.has(s.id) || (currentUser.shops || []).length === 0 // Select all if fresh
                }));

                renderShopList(newShops, true);
            } else {
                alert('No shops found.');
            }
        } catch (err) {
            alert('Error fetching shops: ' + err.message);
        } finally {
            btn.textContent = 'Refresh Shops List';
            btn.disabled = false;
        }
    });

    function renderShopList(shops, useSelectedProp = false) {
        const container = document.getElementById('shopListContainer');
        container.innerHTML = '';

        if (!shops || shops.length === 0) {
            container.innerHTML = '<div style="padding:10px; color:#94a3b8; text-align:center; font-size:12px;">No shops found.</div>';
            return;
        }

        shops.forEach(shop => {
            const div = document.createElement('div');
            div.className = 'shop-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = shop.id;
            checkbox.dataset.label = shop.label;
            checkbox.checked = useSelectedProp ? !!shop.selected : true;

            const label = document.createElement('span');
            label.textContent = shop.label;

            div.appendChild(checkbox);
            div.appendChild(label);
            container.appendChild(div);
        });
    }

    // Save Config
    document.getElementById('saveConfigBtn').addEventListener('click', () => {
        const appUrl = document.getElementById('appUrl').value.replace(/\/$/, '');
        const teamId = document.getElementById('teamId').value.trim();
        const autoCrawlEnabled = document.getElementById('autoCrawlEnable').checked;

        // Mode Data
        let autoCrawlMode = 'interval';
        const checkedMode = document.querySelector('input[name="crawlMode"]:checked');
        if (checkedMode) autoCrawlMode = checkedMode.value;

        const intervalHours = parseFloat(document.getElementById('intervalHours').value);
        const dailyTime = document.getElementById('dailyTime').value;

        // Get selected shops
        const selectedShops = [];
        document.querySelectorAll('#shopListContainer input[type="checkbox"]').forEach(cb => {
            if (cb.checked) {
                selectedShops.push({
                    id: cb.value,
                    label: cb.dataset.label,
                    selected: true
                });
            }
        });

        if (!teamId) {
            alert('Team ID is required.');
            return;
        }

        if (selectedShops.length === 0) {
            alert('Please select at least one shop to crawl.');
            return;
        }

        // Read latest config from storage first (to preserve token/email)
        chrome.storage.local.get(['config'], (result) => {
            const existingConfig = result.config || {};

            const newConfig = {
                ...existingConfig, // Preserve ALL existing fields including token/email
                appUrl,
                teamId,
                autoCrawlEnabled,
                autoCrawlMode,
                intervalHours,
                dailyTime,
                shops: selectedShops,
                updatedAt: new Date().toISOString()
            };

            // Persistent Save
            chrome.storage.local.set({ config: newConfig }, () => {
                currentUser = newConfig; // Update current state
                chrome.runtime.sendMessage({
                    type: 'SET_CONFIG',
                    config: newConfig
                }, (response) => {
                    const msg = document.getElementById('saveMsg');
                    if (msg) {
                        msg.style.opacity = '1';
                        setTimeout(() => msg.style.opacity = '0', 2000);
                    }
                    updateStatusUI();
                });
            });
        });
    });

    setInterval(updateStatusUI, 1000); // Poll status every 1s for realtime
});
