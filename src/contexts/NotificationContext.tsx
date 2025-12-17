import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import Toast, { ToastType } from '../components/Toast';

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

  // 1. Ref to track last notification for de-duplication
  const lastNotificationRef = useRef<{ message: string; time: number } | null>(null);

  // 2. Dùng useCallback để hàm này không bị tạo mới mỗi lần render
  const addNotification = useCallback((message: string, type: ToastType) => {
    // Check for duplicate within 2000ms (Increased to 2s to be safe)
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

  // 1. Dùng useCallback cho hàm remove luôn
  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // 2. Dùng useMemo để gói object value lại. 
  // Nó chỉ thay đổi khi addNotification thay đổi (mà ta đã dùng useCallback nên nó sẽ giữ nguyên).
  const contextValue = useMemo(() => ({ addNotification }), [addNotification]);

  return (
    // Truyền contextValue đã được memoize vào Provider
    <NotificationContext.Provider value={contextValue}>
      {children}

      {/* Toast Container */}
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
