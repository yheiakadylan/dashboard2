import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { User } from 'firebase/auth';
import Header from './components/Header';
import { useDashboard } from './contexts/DashboardContext';
import { useAuthLogic, UserProfile } from './hooks/useAuthLogic'; // Import Hook
import { NotificationProvider, useNotification } from './contexts/NotificationContext';
import { Record, Tab } from './api/_lib/types';
import { requestForToken, sendLarkLoginNotification } from './services/notificationService';
import { reprocessRecord } from './services/emailService';
import { DashboardProvider } from './contexts/DashboardContext';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { triggerHaptic } from './utils/haptics';
import { getPermittedTabs } from './utils/permissions';
import { UIProvider, useUI } from './contexts/UIContext';




import SkeletonLoader from './components/SkeletonLoader';
import Spinner from './components/Spinner';

// Lazy load heavy components
const Sidebar = lazy(() => import('./components/Sidebar'));
const DataTable = lazy(() => import('./components/DataTable'));
const AccountManager = lazy(() => import('./components/AccountManager'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));
const TabSettings = lazy(() => import('./components/TabSettings'));
const BottomNav = lazy(() => import('./components/BottomNav'));
const InstallPrompt = lazy(() => import('./components/InstallPrompt'));
import Auth from './components/Auth';

// Tab Components
import OverviewTab from './components/tabs/OverviewTab';
import ProductsTab from './components/tabs/ProductsTab';
import OrderListTab from './components/tabs/OrderListTab';
import FulfillTab from './components/tabs/FulfillTab';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorBoundary from './components/ErrorBoundary';


// Component to handle login notifications
// Kept separate as it needs NotificationContext which is inside App but outside DashboardLayout
const LoginNotificationHandler: React.FC<{
    user: User;
    userProfile: UserProfile;
}> = ({ user, userProfile }) => {
    const { addNotification } = useNotification();
    const hasShownNotification = React.useRef(false);

    React.useEffect(() => {
        if (user && userProfile && !hasShownNotification.current) {
            // Only show notification for user role (owner will see this notification)
            if (userProfile.role === 'user') {
                addNotification(
                    `🔔 Người dùng ${user.email} đã đăng nhập vào dashboard`,
                    'info'
                );
            }
            sendLarkLoginNotification(user.email, userProfile.role, userProfile.teamId);
            hasShownNotification.current = true;
        }
        if (!user) {
            hasShownNotification.current = false;
        }
    }, [user, userProfile, addNotification]);

    return null;
};


const DashboardLayout: React.FC = () => {
    const {
        syncState,
        isLoading,
        records,
        setRecords,
        isFetchingNewRange,
        processedData,
        teamId,
        accounts,
        role,
        permissions,
    } = useDashboard();

    const {
        activeTab,
        isTabSettingsOpen,
        isAccountManagerOpen,
        isSidebarCollapsed,
        toggleSidebar,
        tabOrder,
        hiddenTabs,
        filterDateRange,
        sourceFilter,
        dayFilter,
        timeZone,
        handleViewDayDetails
    } = useUI();

    const { addNotification } = useNotification();


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

    const renderActiveTab = () => {
        if (isLoading && records.length === 0) {
            return (
                <div className="p-4">
                    <SkeletonLoader variant="table-row" count={8} />
                </div>
            );
        }

        switch (activeTab) {
            case 'Overview':
                const isSingleDay = filterDateRange.from === filterDateRange.to;
                return (
                    <OverviewTab
                        processedData={processedData}
                        isSingleDay={isSingleDay}
                        handleViewDayDetails={handleViewDayDetails}
                    />
                );

            case 'Products':
                return <ProductsTab processedData={processedData} />;

            case 'Order List':
                return (
                    <OrderListTab
                        processedData={processedData}
                        dayFilter={dayFilter}
                        sourceFilter={sourceFilter}
                        timeZone={timeZone}
                        handleViewOrderDetails={handleViewOrderDetails}
                        handleResyncOrder={handleResyncOrder}
                    />
                );

            case 'Case':
                return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.cases.headers} data={processedData.cases.rows} /></Suspense>;

            case 'Help':
                return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.help.headers} data={processedData.help.rows} /></Suspense>;

            case 'Fulfill':
                return <FulfillTab processedData={processedData} />;

            default:
                return <div className="p-8 text-center text-gray-500">Selected tab content not available.</div>;
        }
    };

    const visibleTabs = getPermittedTabs(tabOrder, role, permissions).filter(tab => !hiddenTabs.has(tab));

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex overflow-hidden">
            <Suspense fallback={null}>
                <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />
            </Suspense>

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

                        {/* Loading Overlay when fetching new date range */}
                        {isFetchingNewRange && (
                            <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm z-30 flex items-center justify-center">
                                <div className="flex flex-col items-center gap-3">
                                    <Spinner size="lg" />
                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Loading new data...
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Single scroll container - SIMPLE! */}
                        <div
                            id="active-tab-container"
                            className="h-full w-full overflow-y-auto"
                            {...touchHandlers}
                        >
                            {renderActiveTab()}
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
                    <OrderDetailModal record={selectedOrder} onClose={closeOrderDetail} />
                </Suspense>
            )}
            <Suspense fallback={null}>
                <BottomNav tabs={visibleTabs} />
            </Suspense>
            <Suspense fallback={null}>
                <InstallPrompt />
            </Suspense>
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

// Bridge component to inject UI state into DashboardProvider
const ConnectedDashboardProvider: React.FC<{
    user: User;
    userProfile: UserProfile;
    logout: () => Promise<void>;
    children: React.ReactNode;
}> = ({ user, userProfile, logout, children }) => {
    const { timeZone, filterDateRange, selectedAccountId, searchTerm } = useUI();

    return (
        <DashboardProvider
            user={user}
            teamId={userProfile.teamId}
            role={userProfile.role}
            permissions={userProfile.permissions || {}}
            allowedAccounts={userProfile.allowedAccounts || []}
            onLogout={logout}
            timeZone={timeZone}
            filterDateRange={filterDateRange}
            selectedAccountId={selectedAccountId}
            searchTerm={searchTerm}
        >
            {children}
        </DashboardProvider>
    );
};


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
