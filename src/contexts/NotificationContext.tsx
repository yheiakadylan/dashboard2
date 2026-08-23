import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import Toast, { ToastType } from '../components/ui/Toast';

interface Notification {
  id: string;
  message: string;
  type: ToastType;
}

interface NotificationContextType {
  addNotification: (message: string, type: ToastType) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const lastNotificationRef = useRef<{ message: string; time: number } | null>(null);

  const addNotification = useCallback((message: string, type: ToastType) => {
    const now = Date.now();
    if (
      lastNotificationRef.current &&
      lastNotificationRef.current.message === message &&
      now - lastNotificationRef.current.time < 10000
    ) {
      console.log('Duplicate notification prevented:', message);
      return;
    }

    lastNotificationRef.current = { message, time: now };

    const id = Math.random().toString(36).substring(2, 9);
    setNotifications((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const contextValue = useMemo(() => ({ addNotification }), [addNotification]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}

      <div className="fixed top-20 right-5 z-[9999] flex flex-col gap-2 pointer-events-none">
        {notifications.map((n) => (
          <div key={n.id} className="pointer-events-auto">
            <Toast
              id={n.id}
              message={n.message}
              type={n.type}
              onClose={removeNotification}
            />
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
