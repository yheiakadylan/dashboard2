/**
 * PWA Auto-Update Service using virtual:pwa-register
 * This is the official way to handle PWA updates with vite-plugin-pwa
 */
import { registerSW } from 'virtual:pwa-register';

export interface UpdateCallback {
    onUpdateFound?: () => void;
    onUpdateReady?: () => void;
    onUpdateError?: (error: Error) => void;
}

let updateSW: (reloadPage?: boolean) => Promise<void> | undefined;

export const registerPWAUpdate = (callbacks?: UpdateCallback) => {
    // Register the Service Worker via the virtual module
    const update = registerSW({
        immediate: true, // Register immediately
        onNeedRefresh() {
            // This is called when a new SW is installed and waiting
            console.log('[PWA] New content is available, click reload button to update.');
            if (callbacks?.onUpdateReady) {
                callbacks.onUpdateReady();
            }
        },
        onOfflineReady() {
            console.log('[PWA] App is ready to work offline.');
            if (callbacks?.onUpdateFound) {
                callbacks.onUpdateFound();
            }
        },
        onRegisterError(error) {
            console.error('[PWA] SW registration error', error);
            if (callbacks?.onUpdateError) {
                callbacks.onUpdateError(error as Error);
            }
        },
    });

    // Save the update function for later use
    updateSW = update;

    // Return cleanup function (not strictly necessary for registerSW but good practice if needed)
    return () => {
        // virtual:pwa-register doesn't expose a direct unregister for listeners easily, 
        // but this lifecycle is usually bound to the app root anyway.
    };
};

/**
 * Apply the update by reloading the service worker
 * Includes robust fallback logic for web clients
 */
export const applyUpdate = async () => {
    if (updateSW) {
        console.log('[PWA] Applying update via updateSW(true)...');
        try {
            // Attempt standard PWA update
            await updateSW(true);
        } catch (error) {
            console.error('[PWA] Standard update failed, trying fallback:', error);
            forceUpdate();
        }
    } else {
        console.warn('[PWA] updateSW function not initialized, forcing reload');
        forceUpdate();
    }
};

/**
 * Aggressive fallback: Unregister SW, clear site data, and reload
 * Used when standard update fails or for pure web clients having cache issues
 */
const forceUpdate = async () => {
    if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
            await registration.unregister();
        }
    }
    // Force reload ignoring cache
    window.location.reload();
};
