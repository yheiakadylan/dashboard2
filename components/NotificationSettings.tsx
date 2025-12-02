import React, { useState, useEffect } from 'react';
import { getMessaging, getToken } from 'firebase/messaging';
import { doc, getDoc, updateDoc, arrayUnion, setDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebaseService';
import { useDashboard } from '../contexts/DashboardContext';
import { useNotification } from '../contexts/NotificationContext';

// VAPID Key from Firebase Console -> Project Settings -> Cloud Messaging -> Web Configuration
const VAPID_KEY = "BL_YOUR_VAPID_KEY_HERE_FROM_FIREBASE_CONSOLE"; 

interface NotificationPrefs {
  order: boolean;
  funds: boolean;
  summary: boolean;
}

const NotificationSettings: React.FC = () => {
  const { user } = useDashboard();
  const { addNotification } = useNotification();
  const [permission, setPermission] = useState<NotificationPermission>(Notification.permission);
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    order: false,
    funds: false,
    summary: false
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // Load settings from Firestore
    const loadSettings = async () => {
      try {
        const userRef = doc(db, 'user_roles', user.uid);
        const snapshot = await getDoc(userRef);
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.notificationSettings) {
            setPrefs(data.notificationSettings);
          }
        }
      } catch (err) {
        console.error("Error loading notification settings", err);
      }
    };
    loadSettings();
  }, [user]);

  const requestPermission = async () => {
    setLoading(true);
    try {
      const messaging = getMessaging();
      const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
      
      if (currentToken) {
        setPermission('granted');
        
        // Save Token to Firestore
        const userRef = doc(db, 'user_roles', user.uid);
        await updateDoc(userRef, {
          fcmTokens: arrayUnion(currentToken)
        });
        
        addNotification("Notifications enabled successfully!", "success");
      } else {
        addNotification("No registration token available. Request permission to generate one.", "error");
      }
    } catch (err) {
      console.error('An error occurred while retrieving token. ', err);
      addNotification("Failed to enable notifications.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (key: keyof NotificationPrefs) => {
    if (permission !== 'granted') {
      addNotification("Please enable browser notifications first.", "info");
      return;
    }

    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs);

    try {
      const userRef = doc(db, 'user_roles', user.uid);
      await updateDoc(userRef, {
        notificationSettings: newPrefs
      });
    } catch (err) {
      console.error("Error saving settings", err);
      // Revert UI on error
      setPrefs(prefs); 
      addNotification("Failed to save settings.", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-blue-900 dark:text-blue-100">Browser Permission</h4>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Status: <span className="font-bold uppercase">{permission}</span>
            </p>
          </div>
          {permission !== 'granted' && (
            <button
              onClick={requestPermission}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Requesting...' : 'Enable Push'}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
          Notification Preferences
        </h3>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-800 dark:text-gray-200">New Orders</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Get notified when a new sales email is parsed.</p>
          </div>
          <button
            onClick={() => handleToggle('order')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              prefs.order ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                prefs.order ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-800 dark:text-gray-200">Funds Received</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Get notified when payout/funds emails arrive.</p>
          </div>
          <button
            onClick={() => handleToggle('funds')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              prefs.funds ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                prefs.funds ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-800 dark:text-gray-200">Daily Summary</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Receive a daily report at 00:30 UTC-7.</p>
          </div>
          <button
            onClick={() => handleToggle('summary')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              prefs.summary ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                prefs.summary ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationSettings;