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

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message', payload);
  // Không làm gì cả, để hệ điều hành tự xử lý hiển thị.
});
