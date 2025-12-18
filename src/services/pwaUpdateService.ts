/**
 * PWA Auto-Update Service
 * Handles automatic updates for the Progressive Web App
 */

export interface UpdateCallback {
    onUpdateFound?: () => void;
    onUpdateInstalling?: () => void;
    onUpdateReady?: () => void;
    onUpdateError?: (error: Error) => void;
}

/**
 * Register service worker with auto-update behavior
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

    // Listen for controlling service worker change (new version activated)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        console.log('[PWA] New version activated, reloading page...');
        window.location.reload();
    });

    // Register service worker
    const registerWorker = async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', {
                updateViaCache: 'none', // Always check for updates
            });

            console.log('[PWA] Service worker registered successfully');

            // Check for updates every 60 seconds
            setInterval(() => {
                console.log('[PWA] Checking for updates...');
                registration.update();
            }, 60000);

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
                                // New version installed, ready to activate
                                console.log('[PWA] New version installed, activating...');
                                callbacks?.onUpdateReady?.();

                                // Tell the new service worker to skip waiting and activate immediately
                                newWorker.postMessage({ type: 'SKIP_WAITING' });
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

        } catch (error) {
            console.error('[PWA] Service worker registration failed:', error);
            callbacks?.onUpdateError?.(error as Error);
        }
    };

    // Register when page loads
    if (document.readyState === 'complete') {
        registerWorker();
    } else {
        window.addEventListener('load', registerWorker);
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
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
};
