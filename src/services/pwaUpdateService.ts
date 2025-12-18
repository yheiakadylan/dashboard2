/**
 * PWA Auto-Update Service
 * Uses vite-plugin-pwa's auto-generated service worker
 * This service monitors for updates and handles refresh logic
 */

export interface UpdateCallback {
    onUpdateFound?: () => void;
    onUpdateInstalling?: () => void;
    onUpdateReady?: () => void;
    onUpdateError?: (error: Error) => void;
}

/**
 * Initialize PWA update monitoring
 * The service worker is registered automatically by vite-plugin-pwa
 * This function only sets up update detection and refresh behavior
 * @param callbacks - Optional callbacks for update lifecycle events
 * @returns Cleanup function
 */
export const registerPWAUpdate = (callbacks?: UpdateCallback) => {
    // Check if service workers are supported
    if (!('serviceWorker' in navigator)) {
        console.warn('[PWA] Service workers are not supported in this browser');
        return () => { };
    }

    let refreshing = false;

    // GUARD: Prevent reload loop - track last reload time
    const RELOAD_COOLDOWN = 10000; // 10 seconds cooldown between reloads
    const getLastReloadTime = (): number => {
        const stored = sessionStorage.getItem('pwa_last_reload');
        return stored ? parseInt(stored, 10) : 0;
    };
    const setLastReloadTime = () => {
        sessionStorage.setItem('pwa_last_reload', Date.now().toString());
    };

    // Listen for controlling service worker change (new version activated)
    const handleControllerChange = () => {
        if (refreshing) return;

        // GUARD: Check if we just reloaded recently
        const lastReload = getLastReloadTime();
        const timeSinceLastReload = Date.now() - lastReload;

        if (timeSinceLastReload < RELOAD_COOLDOWN) {
            console.warn(`[PWA] Preventing reload loop - last reload was ${timeSinceLastReload}ms ago`);
            return;
        }

        refreshing = true;
        setLastReloadTime();
        console.log('[PWA] New version activated, reloading page...');
        window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // Monitor existing service worker registration (created by vite-plugin-pwa)
    const setupUpdateMonitoring = async () => {
        try {
            const registration = await navigator.serviceWorker.getRegistration();

            if (!registration) {
                console.log('[PWA] No service worker registration found (expected in development)');
                return;
            }

            console.log('[PWA] Service worker monitoring initialized');

            // Check for updates every 5 minutes (reduced from 60s to prevent excessive checks)
            const updateInterval = setInterval(() => {
                console.log('[PWA] Checking for updates...');
                registration.update();
            }, 300000); // 5 minutes instead of 60 seconds

            // Listen for service worker state changes
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;

                console.log('[PWA] New version found, installing...');
                callbacks?.onUpdateFound?.();

                newWorker.addEventListener('statechange', () => {
                    console.log(`[PWA] Service worker state: ${newWorker.state}`);

                    switch (newWorker.state) {
                        case 'installing':
                            callbacks?.onUpdateInstalling?.();
                            break;

                        case 'installed':
                            if (navigator.serviceWorker.controller) {
                                // New version installed and ready
                                // With skipWaiting: false, the new SW won't activate until all tabs are closed
                                // This prevents the reload loop issue
                                console.log('[PWA] New version ready (will activate when all tabs are closed)');
                                callbacks?.onUpdateReady?.();

                                // DO NOT send SKIP_WAITING - let user close tabs naturally
                                // This prevents the infinite reload loop
                            }
                            break;

                        case 'activated':
                            console.log('[PWA] New version activated');
                            break;

                        case 'redundant':
                            console.log('[PWA] Service worker became redundant');
                            break;
                    }
                });
            });

            // Explicitly check for updates on page load
            registration.update();

            // Store interval ID for cleanup
            return updateInterval;

        } catch (error) {
            console.error('[PWA] Service worker monitoring failed:', error);
            callbacks?.onUpdateError?.(error as Error);
        }
    };

    // Set up monitoring when page loads
    let updateInterval: NodeJS.Timeout | undefined;
    if (document.readyState === 'complete') {
        setupUpdateMonitoring().then(interval => { updateInterval = interval; });
    } else {
        window.addEventListener('load', () => {
            setupUpdateMonitoring().then(interval => { updateInterval = interval; });
        });
    }

    // Check for updates when page becomes visible (tab switching)
    const handleVisibilityChange = () => {
        if (!document.hidden) {
            navigator.serviceWorker.getRegistration().then((registration) => {
                if (registration) {
                    console.log('[PWA] Page became visible, checking for updates...');
                    registration.update();
                }
            });
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup function
    return () => {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
};
