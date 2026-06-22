import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';


const handleAuthCallback = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (window.opener && code) {
    let messageType: string | null = null;

    // Use the 'state' parameter to determine the provider and set the message type.
    if (state === 'google') {
      messageType = 'google-auth-callback';
    } else if (state === 'microsoft') {
      messageType = 'microsoft-auth-callback';
    } else {
      // Fallback for the original Google flow which didn't include a state parameter.
      // Google's response includes a 'scope' parameter, whereas Microsoft's does not.
      if (params.has('scope') && !params.has('session_state')) {
        messageType = 'google-auth-callback';
      }
    }

    if (messageType) {
      window.opener.postMessage({
        type: messageType,
        code: code
      }, window.location.origin);
      window.close();
      return true;
    }
  }
  return false;
};

// Only render the main application if this is not an auth callback.
if (!handleAuthCallback()) {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Could not find root element to mount to");
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then(registration => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch(err => {
        console.error('Service Worker registration failed:', err);
      });
  }
}