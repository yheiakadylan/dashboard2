importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCf9A3apdFE24uU4M3E4j1cnBvmjiB9Z7E",
  authDomain: "dashboard-13ec8.firebaseapp.com",
  projectId: "dashboard-13ec8",
  storageBucket: "dashboard-13ec8.firebasestorage.app",
  messagingSenderId: "604763790543",
  appId: "1:604763790543:web:26905ec5742624300e6bba"
});

const messaging = firebase.messaging();

// --- SỬA ĐỔI: Xử lý Data Message ---
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  // Kiểm tra xem dữ liệu nằm ở đâu (thường là trong payload.data với cấu hình mới)
  const data = payload.data || payload;

  if (data.title && data.body) {
    const notificationTitle = data.title;
    const notificationOptions = {
      body: data.body,
      icon: '/pwa-192x192.png',
      // Quan trọng: Truyền URL vào data của notification để xử lý click
      data: { url: data.url || '/' } 
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  // Lấy URL từ data đã truyền vào ở trên
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
