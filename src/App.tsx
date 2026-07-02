import React, { useState, useCallback, Suspense, lazy, useEffect, useMemo } from 'react';
// import { User } from 'firebase/auth';
import Header from './components/layout/Header';
import { useDashboard } from './contexts/DashboardContext';
import { useAuthLogic } from './features/auth/hooks/useAuthLogic';
import { NotificationProvider, useNotification } from './contexts/NotificationContext';
import { Record } from './types';
import { reprocessRecord } from './services/emailService';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { getPermittedTabs } from './utils/permissions';
import { UIProvider, useUILayout, useUIModals, useUITabs } from './contexts/UIContext';
import Spinner from './components/ui/Spinner';
import { DeepLinkHandler } from './components/layout/DeepLinkHandler';
import { triggerHaptic } from './utils/haptics';
import Sidebar from './components/layout/Sidebar';
import BottomNav from './components/layout/BottomNav';
import InstallPrompt from './components/ui/InstallPrompt';

import LoginNotificationHandler from './features/auth/components/LoginNotificationHandler';
import ConnectedDashboardProvider from './contexts/ConnectedDashboardProvider';
import MainContent from './components/layout/MainContent';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { getMessagingInstance } from './services/firebaseService';
import { onMessage } from 'firebase/messaging';
import CommandPalette from './components/ui/CommandPalette';

const AccountManager = lazy(() => import('./features/accounts/components/AccountManager'));
const Auth = lazy(() => import('./features/auth/components/Auth'));
const OrderDetailModal = lazy(() => import('./components/modals/OrderDetailModal'));
const TabSettings = lazy(() => import('./features/settings/components/TabSettings'));

const ModalLoadingFallback = () => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
            <Spinner size="lg" />
            <span className="mt-4 text-gray-500 dark:text-gray-400 font-medium">Loading...</span>
        </div>
    </div>
);

const FullPageLoadingFallback = () => (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <Spinner size="xl" />
    </div>
);

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

    const { isTabSettingsOpen, isAccountManagerOpen } = useUIModals();
    const { isSidebarCollapsed, toggleSidebar, isMobileMenuOpen, setIsMobileMenuOpen } = useUILayout();
    const { tabOrder, hiddenTabs, activeTab, handleTabClick } = useUITabs();

    const [selectedOrder, setSelectedOrder] = useState<Record | null>(null);
    const recordsById = useMemo(() => {
        const map = new Map<string, Record>();
        records.forEach(record => {
            if (record.id) map.set(record.id, record);
        });
        return map;
    }, [records]);
    const recordsByOrderId = useMemo(() => {
        const map = new Map<string, Record>();
        records.forEach(record => {
            if (record.order_id && !map.has(record.order_id)) map.set(record.order_id, record);
        });
        return map;
    }, [records]);
    const accountsByEmail = useMemo(() => {
        const map = new Map<string, typeof accounts[number]>();
        accounts.forEach(account => {
            if (account.email) map.set(account.email, account);
        });
        return map;
    }, [accounts]);

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

        const record = recordsById.get(recordId);

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
    }, [recordsById, addNotification]);

    const handleResyncOrder = useCallback(async (recordId: string) => {
        // Validate input
        if (!recordId || typeof recordId !== 'string' || recordId.trim() === '') {
            console.error('Invalid recordId:', recordId);
            addNotification("Invalid order ID.", "error");
            return;
        }

        const record = recordsById.get(recordId);

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
        const account = accountsByEmail.get(record.account);
        if (!account) {
            addNotification("Account for this order not found.", "error");
            return;
        }

        try {
            const updatedRecord = await reprocessRecord(teamId, account, record);
            if (updatedRecord) {
                setRecords(prev => {
                    const index = prev.findIndex(r => r.id === recordId);
                    if (index === -1 || prev[index] === updatedRecord) return prev;
                    const next = prev.slice();
                    next[index] = updatedRecord;
                    return next;
                });
                addNotification(`Order #${record.order_id} resynced successfully!`, 'success');
            } else {
                addNotification(`Failed to resync order #${record.order_id}. No data parsed.`, 'error');
            }
        } catch (error) {
            console.error(error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            addNotification(`Error resyncing order: ${errorMessage}`, 'error');
        }
    }, [recordsById, accountsByEmail, teamId, setRecords, addNotification]);

    const closeOrderDetail = useCallback(() => setSelectedOrder(null), []);

    const handleOpenOrderById = useCallback((orderId: string) => {
        // Find record by order_id (not by record.id)
        const record = recordsByOrderId.get(orderId);
        if (record) {
            handleViewOrderDetails(record.id);
        } else {
            addNotification(`Order #${orderId} not found in current date range`, 'error');
        }
    }, [recordsByOrderId, handleViewOrderDetails, addNotification]);

    // Listen for foreground FCM messages
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let isMounted = true;

        const setupFCMListener = async () => {
            try {
                const messaging = await getMessagingInstance();
                if (!messaging) {
                    console.log('[FCM] Messaging not available');
                    return;
                }

                if (!isMounted) return;

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

            } catch (error) {
                console.error('[FCM] Error setting up foreground listener:', error);
            }
        };

        setupFCMListener();

        return () => {
            isMounted = false;
            if (unsubscribe) {
                unsubscribe();
                console.log('[FCM] Foreground listener cleaned up');
            }
        };
    }, [addNotification]);



    const visibleTabs = React.useMemo(
        () => getPermittedTabs(tabOrder, role, permissions).filter(tab => !hiddenTabs.has(tab)),
        [tabOrder, role, permissions, hiddenTabs]
    );

    useEffect(() => {
        if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab)) {
            handleTabClick(visibleTabs[0]);
        }
    }, [activeTab, handleTabClick, visibleTabs]);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 bg-gradient-mesh text-gray-900 dark:text-gray-100 flex overflow-hidden">
            <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />

            <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden relative">
                <Header />
                <main className="flex-grow p-2 md:p-6 flex flex-col overflow-hidden relative">
                    <div className="relative flex-grow glass-panel rounded-lg shadow-lg overflow-hidden border-0">
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
                <Suspense fallback={<ModalLoadingFallback />}>
                    <AccountManager />
                </Suspense>
            )}
            {isTabSettingsOpen && (
                <Suspense fallback={<ModalLoadingFallback />}>
                    <TabSettings />
                </Suspense>
            )}
            {selectedOrder && (
                <Suspense fallback={<ModalLoadingFallback />}>
                    <OrderDetailModal
                        record={selectedOrder}
                        onClose={closeOrderDetail}
                        onResync={handleResyncOrder}
                        allRecords={records}
                    />
                </Suspense>
            )}
            <BottomNav tabs={visibleTabs} />
            <InstallPrompt />

            {/* Deep Link Handler */}
            <DeepLinkHandler onOpenOrder={handleOpenOrderById} />



            {/* NEW: Command Palette */}
            <CommandPalette />
        </div>
    );
};




const App: React.FC = () => {
    // --- USE NEW AUTH HOOK ---
    const { user, userProfile, authLoading, authError, logout } = useAuthLogic();

    let content;

    if (authLoading) {
        content = <FullPageLoadingFallback />;
    } else if (!user || !userProfile) {
        content = (
            <Suspense fallback={<FullPageLoadingFallback />}>
                <Auth authError={authError} />
            </Suspense>
        );
    } else {
        content = (
            <>
                <LoginNotificationHandler user={user} userProfile={userProfile} />
                <UIProvider userUid={user.uid} teamId={userProfile.teamId}>
                    <ConnectedDashboardProvider user={user} userProfile={userProfile} logout={logout}>
                        <ErrorBoundary>
                            <DashboardLayout />
                        </ErrorBoundary>
                    </ConnectedDashboardProvider>
                </UIProvider>
            </>
        );
    }

    return (
        <NotificationProvider>
            {content}
        </NotificationProvider>
    );
};

export default App;
