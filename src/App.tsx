import React, { useState, useCallback, Suspense, lazy, useEffect } from 'react';
// import { User } from 'firebase/auth';
import Header from './components/Header';
import { useDashboard } from './contexts/DashboardContext';
import { useAuthLogic } from './hooks/useAuthLogic';
import { NotificationProvider, useNotification } from './contexts/NotificationContext';
import { Record } from './types';
import { reprocessRecord } from './services/emailService';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { triggerHaptic } from './utils/haptics';
import { getPermittedTabs } from './utils/permissions';
import { UIProvider, useUI } from './contexts/UIContext';
import SidebarSkeleton from './components/SidebarSkeleton';
import Spinner from './components/Spinner';
import { DeepLinkHandler } from './components/DeepLinkHandler';

// Lazy load heavy components
import Sidebar from './components/Sidebar';
// const DataTable = lazy(() => import('./components/DataTable'));
import AccountManager from './components/AccountManager';
import OrderDetailModal from './components/OrderDetailModal';
import TabSettings from './components/TabSettings';
import BottomNav from './components/BottomNav';
import InstallPrompt from './components/InstallPrompt';

import LoginNotificationHandler from './components/LoginNotificationHandler';
import ConnectedDashboardProvider from './components/ConnectedDashboardProvider';
import Auth from './components/Auth';
import MainContent from './components/MainContent';
import ErrorBoundary from './components/ErrorBoundary';
import { getMessagingInstance } from './services/firebaseService';
import { onMessage } from 'firebase/messaging';

const DashboardLayout: React.FC = () => {
    const {
        records,
        setRecords,
        isFetchingNewRange,
        teamId,
        accounts,
        role,
        permissions,
        isProcessing,
    } = useDashboard();

    const { addNotification } = useNotification();

    const {
        isTabSettingsOpen,
        isAccountManagerOpen,
        isSidebarCollapsed,
        toggleSidebar,
        tabOrder,
        hiddenTabs,
        isMobileMenuOpen,
        setIsMobileMenuOpen
    } = useUI();

    const [selectedOrder, setSelectedOrder] = useState<Record | null>(null);

    // Pull-to-refresh for mobile
    const { isPulling, isRefreshing, pullDistance, pullProgress, touchHandlers } = usePullToRefresh({
        onRefresh: async () => {
            triggerHaptic('medium');
            window.location.reload();
        },
        threshold: 120,
        maxPullDistance: 150,
        resistance: 0.4,
    });

    const handleViewOrderDetails = useCallback((recordId: string) => {
        // Validate input
        if (!recordId || typeof recordId !== 'string' || recordId.trim() === '') {
            console.error('Invalid recordId:', recordId);
            addNotification("Invalid order ID.", "error");
            return;
        }

        const record = records.find(r => r.id === recordId);

        // Check if record exists
        if (!record) {
            addNotification("Order not found.", "error");
            return;
        }

        // Check if record has details
        if (!record.details) {
            addNotification("Details not available for this order.", "error");
            return;
        }

        setSelectedOrder(record);
    }, [records, addNotification]);

    const handleResyncOrder = useCallback(async (recordId: string) => {
        // Validate input
        if (!recordId || typeof recordId !== 'string' || recordId.trim() === '') {
            console.error('Invalid recordId:', recordId);
            addNotification("Invalid order ID.", "error");
            return;
        }

        const record = records.find(r => r.id === recordId);

        // Check if record exists and has email_id
        if (!record) {
            addNotification("Order not found.", "error");
            return;
        }

        if (!record.email_id) {
            addNotification("Cannot resync this order (missing email_id).", "error");
            return;
        }

        // Check if account exists
        const account = accounts.find(a => a.email === record.account);
        if (!account) {
            addNotification("Account for this order not found.", "error");
            return;
        }

        console.log(`Resyncing order #${record.order_id}...`);
        try {
            const updatedRecord = await reprocessRecord(teamId, account, record);
            if (updatedRecord) {
                setRecords(prev => prev.map(r => r.id === recordId ? updatedRecord : r));
                addNotification(`Order #${record.order_id} resynced successfully!`, 'success');
            } else {
                addNotification(`Failed to resync order #${record.order_id}. No data parsed.`, 'error');
            }
        } catch (error) {
            console.error(error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            addNotification(`Error resyncing order: ${errorMessage}`, 'error');
        }
    }, [records, accounts, teamId, setRecords, addNotification]);

    const closeOrderDetail = useCallback(() => setSelectedOrder(null), []);

    const handleOpenOrderById = useCallback((orderId: string) => {
        console.log('[Deep Link] Opening order:', orderId);
        // Find record by order_id (not by record.id)
        const record = records.find(r => r.order_id === orderId);
        if (record) {
            handleViewOrderDetails(record.id);
        } else {
            addNotification(`Order #${orderId} not found in current date range`, 'error');
        }
    }, [records, handleViewOrderDetails, addNotification]);

    // Listen for foreground FCM messages
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;

        const setupFCMListener = async () => {
            try {
                const messaging = await getMessagingInstance();
                if (!messaging) {
                    console.log('[FCM] Messaging not available');
                    return;
                }

                // Listen for messages when app is in foreground
                unsubscribe = onMessage(messaging, (payload) => {
                    console.log('[FCM] Foreground message received:', payload);

                    const { notification, data } = payload;
                    if (!notification) return;

                    // Show browser notification
                    if ('Notification' in window && Notification.permission === 'granted') {
                        const notif = new Notification(notification.title || 'New Notification', {
                            body: notification.body || '',
                            icon: '/icon-192x192.png',
                            badge: '/icon-192x192.png',
                            tag: data?.type || 'notification',
                            requireInteraction: false,
                        });

                        // Auto close after 5 seconds
                        setTimeout(() => notif.close(), 5000);

                        // Optional: Click handler
                        notif.onclick = () => {
                            window.focus();
                            notif.close();
                            if (data?.url) {
                                window.location.href = data.url;
                            }
                        };
                    }

                    // Also show in-app notification via NotificationContext
                    addNotification(notification.body || notification.title || 'New notification', 'info');
                });

                console.log('[FCM] Foreground listener setup complete');
            } catch (error) {
                console.error('[FCM] Error setting up foreground listener:', error);
            }
        };

        setupFCMListener();

        return () => {
            if (unsubscribe) {
                unsubscribe();
                console.log('[FCM] Foreground listener cleaned up');
            }
        };
    }, [addNotification]);



    const visibleTabs = getPermittedTabs(tabOrder, role, permissions).filter(tab => !hiddenTabs.has(tab));

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex overflow-hidden">
            <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />

            <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
                <Header />
                <main className="flex-grow p-2 md:p-6 flex flex-col overflow-hidden relative">
                    <div className="relative flex-grow bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-100 dark:border-gray-700">
                        {/* Pull-to-refresh UI */}
                        {(isPulling || isRefreshing) && (
                            <div className="absolute top-0 left-0 right-0 flex justify-center items-center z-20" style={{ height: `${Math.min(pullDistance, 60)}px`, opacity: pullProgress }}>
                                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                    <Spinner size="sm" color="text-blue-600 dark:text-blue-400" />
                                    <span className="text-sm font-medium">{isRefreshing ? 'Refreshing...' : 'Pull to refresh'}</span>
                                </div>
                            </div>
                        )}

                        {/* Loading Overlay when fetching new date range OR processing data */}
                        {(isFetchingNewRange || isProcessing) && (
                            <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm z-30 flex items-center justify-center">
                                <div className="flex flex-col items-center gap-3">
                                    <Spinner size="lg" />
                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        {isProcessing ? 'Processing data...' : 'Loading new data...'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Single scroll container - SIMPLE! */}
                        <div
                            id="active-tab-container"
                            className="h-full w-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] pb-24 md:pb-0"
                            onScroll={() => isMobileMenuOpen && setIsMobileMenuOpen(false)}
                            onClick={() => isMobileMenuOpen && setIsMobileMenuOpen(false)}
                            onWheel={() => isMobileMenuOpen && setIsMobileMenuOpen(false)}
                            onTouchStart={(e) => {
                                if (isMobileMenuOpen) setIsMobileMenuOpen(false);
                                touchHandlers.onTouchStart(e);
                            }}
                            onTouchMove={(e) => {
                                if (isMobileMenuOpen) setIsMobileMenuOpen(false);
                                touchHandlers.onTouchMove(e);
                            }}
                            onTouchEnd={touchHandlers.onTouchEnd}
                        >
                            <MainContent
                                onViewOrderDetails={handleViewOrderDetails}
                                onResyncOrder={handleResyncOrder}
                            />
                        </div>
                    </div>
                </main>
            </div>

            {isAccountManagerOpen && (
                <AccountManager />
            )}
            {isTabSettingsOpen && (
                <TabSettings />
            )}
            {selectedOrder && (
                <OrderDetailModal record={selectedOrder} onClose={closeOrderDetail} />
            )}
            <BottomNav tabs={visibleTabs} />
            <InstallPrompt />

            {/* Deep Link Handler */}
            <DeepLinkHandler onOpenOrder={handleOpenOrderById} />
        </div>
    );
};

const ModalLoadingFallback = () => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
            <Spinner size="lg" />
            <span className="mt-4 text-gray-500 dark:text-gray-400 font-medium">Loading...</span>
        </div>
    </div>
);




const App: React.FC = () => {
    // --- USE NEW AUTH HOOK ---
    const { user, userProfile, authLoading, authError, logout } = useAuthLogic();

    if (authLoading) {
        return (
            <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
                <Spinner size="xl" />
            </div>
        );
    }

    if (!user || !userProfile) {
        return <Auth authError={authError} />;
    }

    return (
        <NotificationProvider>
            <LoginNotificationHandler user={user} userProfile={userProfile} />
            <UIProvider userUid={user.uid} teamId={userProfile.teamId}>
                <ConnectedDashboardProvider user={user} userProfile={userProfile} logout={logout}>
                    <ErrorBoundary>
                        <DashboardLayout />
                    </ErrorBoundary>
                </ConnectedDashboardProvider>
            </UIProvider>
        </NotificationProvider>
    );
};

export default App;
