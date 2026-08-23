// Keep the worker SDK aligned with the Firebase version used by the application.
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js');

// Load config from static file (Service Worker cannot access import.meta.env or URL params)
importScripts('/firebase-config.js');

firebase.initializeApp(self.FIREBASE_CONFIG);

const messaging = firebase.messaging();
const APP_ID = 'dashboard';

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Background message:', payload);
    if (payload.data?.appId !== APP_ID) return;

    const notificationTitle = payload.data?.title || payload.notification?.title || 'Thông báo mới';
    const notificationOptions = {
        body: payload.data?.body || payload.notification?.body || '',
        icon: '/pwa-192x192.png',
        data: {
            url: payload.data?.url || '/'
        }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});
