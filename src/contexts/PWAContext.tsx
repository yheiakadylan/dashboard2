import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PWAContext, type PWAContextValue } from './pwa';
import { useNotification } from './NotificationContext';
import Spinner from '../components/ui/Spinner';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const ACTIVE_BUILD_KEY = 'nhmedia_active_build';
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const UPDATE_INSTALL_TIMEOUT_MS = 30 * 1000;
const UPDATE_RETRY_DELAYS_MS = [5 * 1000, 15 * 1000, 30 * 1000, 60 * 1000];

interface VersionManifest {
  version?: string;
}

const waitForUpdatedWorker = (
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
) => new Promise<ServiceWorker>((resolve, reject) => {
  let trackedWorker: ServiceWorker | null = null;

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    registration.removeEventListener('updatefound', handleUpdateFound);
    trackedWorker?.removeEventListener('statechange', handleStateChange);
  };
  const finish = (worker: ServiceWorker) => {
    cleanup();
    resolve(worker);
  };
  const fail = (message: string) => {
    cleanup();
    reject(new Error(message));
  };
  const handleStateChange = () => {
    if (!trackedWorker) return;
    if (['installed', 'activating', 'activated'].includes(trackedWorker.state)) {
      finish(trackedWorker);
    } else if (trackedWorker.state === 'redundant') {
      fail('The updated service worker became redundant.');
    }
  };
  const trackWorker = (worker: ServiceWorker | null) => {
    if (!worker || worker === trackedWorker) return;
    trackedWorker?.removeEventListener('statechange', handleStateChange);
    trackedWorker = worker;
    trackedWorker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  };
  const handleUpdateFound = () => trackWorker(registration.installing);
  const timeoutId = window.setTimeout(
    () => fail('Timed out waiting for the updated service worker to install.'),
    timeoutMs,
  );

  registration.addEventListener('updatefound', handleUpdateFound);
  if (registration.waiting) finish(registration.waiting);
  else trackWorker(registration.installing);
});

export const PWAProvider = ({ children }: { children: ReactNode }) => {
  const { addNotification } = useNotification();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [requiredVersion, setRequiredVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [manualRetryToken, setManualRetryToken] = useState(0);
  const activationStartedRef = useRef(false);
  const pendingWorkerRef = useRef<ServiceWorker | null>(null);
  const reloadStartedRef = useRef(false);
  const hadControllerAtStartRef = useRef(
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller,
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let disposed = false;
    let removeUpdateFoundListener: (() => void) | null = null;
    const workerListeners = new Map<ServiceWorker, () => void>();

    const markWorkerReady = (worker: ServiceWorker) => {
      if (!navigator.serviceWorker.controller) return;
      pendingWorkerRef.current = worker;
      setUpdateReady(true);
      setUpdateError(null);
    };

    const trackWorker = (worker: ServiceWorker | null) => {
      if (!worker || workerListeners.has(worker)) return;

      const handleStateChange = () => {
        if (worker.state === 'installed') markWorkerReady(worker);
      };
      workerListeners.set(worker, handleStateChange);
      worker.addEventListener('statechange', handleStateChange);
      handleStateChange();
    };

    const handleControllerChange = () => {
      if (reloadStartedRef.current) return;
      if (!hadControllerAtStartRef.current && !activationStartedRef.current) return;

      reloadStartedRef.current = true;
      window.location.reload();
    };

    const registerWorker = async () => {
      try {
        const nextRegistration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          type: 'classic',
          updateViaCache: 'none',
        });
        if (disposed) return;

        setRegistration(nextRegistration);

        const handleUpdateFound = () => trackWorker(nextRegistration.installing);
        nextRegistration.addEventListener('updatefound', handleUpdateFound);
        removeUpdateFoundListener = () => {
          nextRegistration.removeEventListener('updatefound', handleUpdateFound);
        };

        if (nextRegistration.waiting && navigator.serviceWorker.controller) {
          markWorkerReady(nextRegistration.waiting);
        }
        trackWorker(nextRegistration.installing);
      } catch (error) {
        console.error('[PWA] service worker registration failed:', error);
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    void registerWorker();

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      removeUpdateFoundListener?.();
      workerListeners.forEach((listener, worker) => {
        worker.removeEventListener('statechange', listener);
      });
    };
  }, []);

  useEffect(() => {
        localStorage.removeItem('nhmedia_pending_update');
    const previousBuild = localStorage.getItem(ACTIVE_BUILD_KEY);
    if (previousBuild !== __APP_BUILD_ID__) {
      if (previousBuild) addNotification('Đã cập nhật ứng dụng lên phiên bản mới nhất.', 'success');
      localStorage.setItem(ACTIVE_BUILD_KEY, __APP_BUILD_ID__);
    }
  }, [addNotification]);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!registration) return;

    let updateInProgress = false;
    let retryAttempt = 0;
    let retryTimeoutId: number | null = null;

    const clearScheduledRetry = () => {
      if (retryTimeoutId === null) return;
      window.clearTimeout(retryTimeoutId);
      retryTimeoutId = null;
    };
    const scheduleRetry = () => {
      clearScheduledRetry();
      const delay = UPDATE_RETRY_DELAYS_MS[Math.min(retryAttempt, UPDATE_RETRY_DELAYS_MS.length - 1)];
      retryAttempt += 1;
      retryTimeoutId = window.setTimeout(() => {
        retryTimeoutId = null;
        void checkForUpdates(true);
      }, delay);
    };
    const checkForUpdates = async (force = false) => {
      if (!navigator.onLine || updateInProgress || (!force && retryTimeoutId !== null)) return;

      updateInProgress = true;
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`Version check failed with HTTP ${response.status}`);

        const manifest = await response.json() as VersionManifest;
        if (!manifest.version || manifest.version === __APP_VERSION__) {
          retryAttempt = 0;
          clearScheduledRetry();
          setUpdateError(null);
          return;
        }

        setRequiredVersion(manifest.version);
        setUpdateError(null);
        await registration.update();
        const updatedWorker = await waitForUpdatedWorker(registration, UPDATE_INSTALL_TIMEOUT_MS);
        pendingWorkerRef.current = updatedWorker;
        setUpdateReady(true);
        retryAttempt = 0;
        clearScheduledRetry();
      } catch (error) {
        console.error('[PWA] update check failed:', error);
        setUpdateError('Chưa thể tải xong phiên bản mới. Ứng dụng đang tự động thử lại.');
        scheduleRetry();
      } finally {
        updateInProgress = false;
      }
    };

    void checkForUpdates();
    const intervalId = window.setInterval(() => void checkForUpdates(), VERSION_CHECK_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForUpdates();
    };
    const handleOnline = () => void checkForUpdates();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      clearScheduledRetry();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [manualRetryToken, registration]);

  useEffect(() => {
    if (!updateReady || activationStartedRef.current) return;

    activationStartedRef.current = true;
    setUpdateError(null);

    // Paint the update screen before the new worker takes control and reloads once.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const pendingWorker = pendingWorkerRef.current || registration?.waiting;
        pendingWorker?.postMessage({ type: 'SKIP_WAITING' });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [registration, updateReady]);

  const retryUpdate = () => {
    setUpdateError(null);
    setManualRetryToken(previous => previous + 1);
  };

  const value = useMemo<PWAContextValue>(() => ({
    canInstall: !!installPrompt,
    installApp: async () => {
      if (!installPrompt) return false;
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstallPrompt(null);
      return choice.outcome === 'accepted';
    },
  }), [installPrompt]);

  if (requiredVersion || updateReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center dark:bg-gray-900">
        <Spinner size="xl" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Đang cập nhật ứng dụng</h1>
        <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
          {updateReady
            ? 'Đang chuẩn bị phiên bản mới. Vui lòng không đóng ứng dụng.'
            : 'Đang tải dữ liệu cập nhật. Vui lòng không đóng ứng dụng.'}
        </p>
        {updateError && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{updateError}</p>
            <button type="button" onClick={retryUpdate} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Thử lại ngay
            </button>
          </div>
        )}
      </div>
    );
  }

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
};
