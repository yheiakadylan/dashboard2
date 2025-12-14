import React, { useState, useEffect, useCallback, Suspense, lazy, useTransition, useRef } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth, db } from './services/firebaseService';
import { sendLarkLoginNotification } from './services/notificationService';
import { doc, getDoc } from 'firebase/firestore';
import Header from './components/Header';
import KpiCard from './components/KpiCard';
import Tabs from './components/Tabs';
import Auth from './components/Auth';
import { DashboardProvider, useDashboard } from './contexts/DashboardContext';
import { NotificationProvider, useNotification } from './contexts/NotificationContext';
import { Record, Tab } from './api/_lib/types';
import { reprocessRecord } from './services/emailService';
import { requestForToken } from './services/notificationService';
import CollapsibleContainer from './components/CollapsibleContainer';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { triggerHaptic } from './utils/haptics';

import SkeletonLoader from './components/SkeletonLoader';
import Spinner from './components/Spinner';
import ChartErrorBoundary from './components/ChartErrorBoundary';

// Lazy load heavy components
const DataTable = lazy(() => import('./components/DataTable'));
const AccountManager = lazy(() => import('./components/AccountManager'));
const OverviewChart = lazy(() => import('./components/OverviewChart'));
const SummaryChart = lazy(() => import('./components/SummaryChart'));
const TopProductsChart = lazy(() => import('./components/TopProductsChart'));
const FulfillChart = lazy(() => import('./components/FulfillChart'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));
const TabSettings = lazy(() => import('./components/TabSettings'));
const BottomNav = lazy(() => import('./components/BottomNav'));
const InstallPrompt = lazy(() => import('./components/InstallPrompt'));

// Loading component for Suspense fallback
const LoadingSpinner: React.FC<{ variant?: 'table-row' | 'card' | 'chart' | 'kpi-card'; count?: number }> = ({ variant = 'table-row', count = 3 }) => (
    <SkeletonLoader variant={variant} count={count} />
);

const Sidebar = lazy(() => import('./components/Sidebar'));
import { DraggableGrid } from './components/DraggableGrid';


const DashboardLayout: React.FC = () => {
    // Sidebar state


    const {
        syncState,
        isAccountManagerOpen,
        isTabSettingsOpen,
        isLoading,
        records,
        setRecords,
        activeTab,
        handleTabClick,
        isFetchingNewRange,
        processedData,
        handleViewDayDetails,
        dayFilter,
        timeZone,
        teamId,
        accounts,
        role,
        permissions,
        tabOrder,
        hiddenTabs,
        handleSyncClick,
        filterDateRange,

        sourceFilter,
        isSidebarCollapsed,
        toggleSidebar,
    } = useDashboard();

    const [selectedOrder, setSelectedOrder] = useState<Record | null>(null);






    // Dashboard Customization State (Summary Widgets)
    const [summaryWidgets, setSummaryWidgets] = useState<string[]>(() => {
        const saved = localStorage.getItem('dashboard_layout_summary');
        // Default order
        return saved ? JSON.parse(saved) : ['kpi-section', 'revenue-chart'];
    });

    const handleReorderSummary = useCallback((newOrder: string[]) => {
        setSummaryWidgets(newOrder);
        localStorage.setItem('dashboard_layout_summary', JSON.stringify(newOrder));
    }, []);


    // Pull-to-refresh for mobile
    const { isPulling, isRefreshing, pullDistance, pullProgress, touchHandlers } = usePullToRefresh({
        onRefresh: async () => {
            // Hard reload page like F5
            triggerHaptic('medium');
            window.location.reload();
        },
        threshold: 120, // Increased from 80 to make it less sensitive
        maxPullDistance: 150,
        resistance: 0.4, // Reduced from 0.5 for more resistance
    });

    const handleViewOrderDetails = useCallback((recordId: string) => {
        const record = records.find(r => r.id === recordId);
        if (record && record.details) {
            setSelectedOrder(record);
        } else {
            alert("Details not available for this order.");
        }
    }, [records]);

    const handleResyncOrder = useCallback(async (recordId: string) => {
        const record = records.find(r => r.id === recordId);
        if (!record || !record.email_id) {
            alert("Cannot resync this order (missing email_id).");
            return;
        }

        const account = accounts.find(a => a.email === record.account);
        if (!account) {
            alert("Account for this order not found.");
            return;
        }

        console.log(`Resyncing order #${record.order_id}...`);

        try {
            const updatedRecord = await reprocessRecord(teamId, account, record);
            if (updatedRecord) {
                setRecords(prev => prev.map(r => r.id === recordId ? updatedRecord : r));
                alert(`Order #${record.order_id} resynced successfully!`);
            } else {
                alert(`Failed to resync order #${record.order_id}. No data parsed.`);
            }
        } catch (e: any) {
            console.error(e);
            alert(`Error resyncing order: ${e.message}`);
        }
    }, [records, accounts, teamId, setRecords]);

    const closeOrderDetail = useCallback(() => setSelectedOrder(null), []);

    const formatDate = (dateStr: string): string => {
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return 'Invalid Date';
            return new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(date);
        } catch (e) {
            return 'Invalid Date';
        }
    };



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
                return (
                    <div className="p-2 md:p-6 overflow-y-auto h-full">
                        {/* 1. KPIs Section (Merged from Summary) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6 mb-6">
                            <KpiCard title="Total Orders" value={processedData.summary.kpis['Total Orders'] || { value: '---' }} />
                            <KpiCard title="Shops" value={processedData.summary.kpis['Shops'] || { value: '---' }} />
                            <KpiCard title="Revenue" value={processedData.summary.kpis['Revenue'] || { value: '---' }} />
                            <KpiCard title="Funds" value={processedData.summary.kpis['Funds'] || { value: '---' }} />
                            <KpiCard title="Cost" value={processedData.summary.kpis['Cost'] || { value: '---' }} />
                        </div>

                        {/* 2. Charts Section */}
                        {/* 2. Charts Section */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                            {/* Main Overview Chart - Takes 1/2 width */}
                            <ChartErrorBoundary>
                                <Suspense fallback={<LoadingSpinner variant="chart" count={1} />}>
                                    <OverviewChart data={processedData.overview.chartData} />
                                </Suspense>
                            </ChartErrorBoundary>

                            {/* Revenue Chart - Takes 1/2 width */}
                            <ChartErrorBoundary>
                                <Suspense fallback={<LoadingSpinner variant="chart" />}>
                                    <SummaryChart data={processedData.summary.chartData} hideTitle={true} />
                                </Suspense>
                            </ChartErrorBoundary>
                        </div>

                        {/* 3. Detailed Tables - Tabbed Interface */}
                        {/* 3. Detailed Tables - Split View */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                            {/* Left: Daily Breakdown (Card View) */}
                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Breakdown</h3>
                                </div>
                                <div className="min-h-[400px]">
                                    <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                                        <DataTable
                                            headers={processedData.overview.table.headers}
                                            data={processedData.overview.table.rows}
                                            onViewDayDetails={handleViewDayDetails}
                                            autoHeight={true}
                                            mobileRowHeight={220} // Slightly more compact card for desktop split view
                                            forceCardView={true}
                                        />
                                    </Suspense>
                                </div>
                            </div>

                            {/* Right: Shop Summary (Table View) */}
                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Shop Summary</h3>
                                </div>
                                <div className="min-h-[400px]">
                                    <Suspense fallback={<LoadingSpinner variant="table-row" count={5} />}>
                                        <DataTable
                                            headers={processedData.summary.table.headers}
                                            data={processedData.summary.table.rows}
                                            autoHeight={true}
                                        />
                                    </Suspense>
                                </div>
                            </div>
                        </div>
                    </div >
                );
            case 'Products':
                return (
                    <div className="p-2 md:p-6 overflow-y-auto h-full space-y-6">
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
                            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Top Products</h3>
                            <div>
                                <ChartErrorBoundary>
                                    <Suspense fallback={<LoadingSpinner variant="chart" />}>
                                        <TopProductsChart data={processedData.summary.topProductsByShop} />
                                    </Suspense>
                                </ChartErrorBoundary>
                            </div>
                        </div>
                        <div className="flex-grow">
                            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Product Details</h3>
                            <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                                <DataTable
                                    headers={processedData.products.headers}
                                    data={processedData.products.rows}
                                    autoHeight={true}
                                />
                            </Suspense>
                        </div>
                    </div>
                );
            case 'Order List': {
                const orderListHeaders = processedData.orders.headers;
                let orderListRows = processedData.orders.rows;

                if (dayFilter) {
                    orderListRows = orderListRows.filter(row => {
                        const dtLocal = row[orderListHeaders.length] as string; // index 12
                        return formatDate(dtLocal) === dayFilter;
                    });
                }

                if (sourceFilter !== 'All') {
                    orderListRows = orderListRows.filter(row => {
                        const source = row[orderListHeaders.length + 1] as string; // index 13
                        return source === sourceFilter;
                    });
                }

                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-grow px-2 md:px-6 pb-2 md:pb-6 overflow-hidden">
                            <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                                <DataTable
                                    headers={orderListHeaders}
                                    data={orderListRows}
                                    onViewOrderDetails={handleViewOrderDetails}
                                    onResyncOrder={handleResyncOrder}
                                />
                            </Suspense>
                        </div>
                    </div>
                );
            }
            case 'Case': return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.cases.headers} data={processedData.cases.rows} /></Suspense>;
            case 'Help': return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.help.headers} data={processedData.help.rows} /></Suspense>;
            case 'Fulfill':
                return (
                    <div className="p-2 md:p-6 overflow-y-auto h-full">
                        <div className="mb-6 hidden md:block">
                            <ChartErrorBoundary>
                                <Suspense fallback={<LoadingSpinner />}>
                                    <div className="flex flex-col md:flex-row gap-6 mb-6">
                                        <FulfillChart
                                            title="Top 10 Merchize Products"
                                            data={processedData.fulfill.merchizeChartData}
                                        />
                                        <FulfillChart
                                            title="Top 10 Printway Products"
                                            data={processedData.fulfill.printwayChartData}
                                        />
                                    </div>
                                </Suspense>
                            </ChartErrorBoundary>
                        </div>
                        <div className="md:hidden space-y-4 mb-6">
                            <ChartErrorBoundary>
                                <Suspense fallback={<LoadingSpinner />}>
                                    <CollapsibleContainer title="Top 10 Merchize Products">
                                        <FulfillChart
                                            title="Top 10 Merchize Products"
                                            data={processedData.fulfill.merchizeChartData}
                                        />
                                    </CollapsibleContainer>
                                    <CollapsibleContainer title="Top 10 Printway Products">
                                        <FulfillChart
                                            title="Top 10 Printway Products"
                                            data={processedData.fulfill.printwayChartData}
                                        />
                                    </CollapsibleContainer>
                                </Suspense>
                            </ChartErrorBoundary>
                        </div>
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                                All Fulfillment Records
                            </h3>
                            <Suspense fallback={<LoadingSpinner />}>
                                <DataTable
                                    headers={processedData.fulfill.table.headers}
                                    data={processedData.fulfill.table.rows}
                                    autoHeight={true}
                                />
                            </Suspense>
                        </div>
                    </div>
                );

            default: return <div className="p-8 text-center text-gray-500">Selected tab content not available.</div>;
        }
    };

    // Filter tabs based on permissions for bottom nav
    const getPermittedTabs = (tabs: any[]) => {
        return tabs.filter(tab => {
            if (role === 'owner') return true;
            switch (tab) {
                case 'Products':
                    return permissions.viewSales;

                case 'Overview':
                case 'Order List':
                case 'eBay':
                case 'Etsy':
                case 'Case':
                case 'Help':
                    return permissions.viewSales;
                case 'Fulfill':
                    return permissions.viewFulfill;

                default:
                    return false;
            }
        });
    };
    const visibleTabs = getPermittedTabs(tabOrder).filter(tab => !hiddenTabs.has(tab));

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex overflow-hidden">
            {/* Sidebar for Desktop */}
            <Suspense fallback={null}>
                <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />
            </Suspense>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
                <Header />
                <main className="flex-grow p-2 md:p-6 flex flex-col overflow-hidden relative">


                    <div className="relative flex-grow bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-100 dark:border-gray-700">
                        {/* Pull-to-refresh indicator */}
                        {(isPulling || isRefreshing) && (
                            <div
                                className="absolute top-0 left-0 right-0 flex justify-center items-center z-20 transition-all duration-200"
                                style={{
                                    height: `${Math.min(pullDistance, 60)}px`,
                                    opacity: pullProgress
                                }}
                            >
                                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                    {isRefreshing ? (
                                        <>
                                            <Spinner size="sm" color="text-blue-600 dark:text-blue-400" />
                                            <span className="text-sm font-medium">Refreshing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ transform: `rotate(${pullProgress * 360}deg)` }}>
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                            <span className="text-sm font-medium">
                                                {pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {isFetchingNewRange && (
                            <div className="absolute inset-0 bg-white/50 dark:bg-gray-800/50 flex items-center justify-center z-10 backdrop-blur-sm">
                                <Spinner size="lg" />
                            </div>
                        )}
                        <div
                            className={`h-full w-full transition-opacity duration-200 animate-fade-in ${isFetchingNewRange ? 'opacity-50' : 'opacity-100'}`}
                            {...touchHandlers}
                        >
                            {renderActiveTab()}
                        </div>
                    </div>
                </main>
            </div>

            {/* REMOVED: Footer with old status string */}

            {isAccountManagerOpen && (
                <Suspense fallback={<LoadingSpinner />}>
                    <AccountManager />
                </Suspense>
            )}
            {isTabSettingsOpen && (
                <Suspense fallback={<LoadingSpinner />}>
                    <TabSettings />
                </Suspense>
            )}
            {selectedOrder && (
                <Suspense fallback={<LoadingSpinner />}>
                    <OrderDetailModal record={selectedOrder} onClose={closeOrderDetail} />
                </Suspense>
            )}
            {/* Bottom Navigation for Mobile */}
            <Suspense fallback={null}>
                <BottomNav tabs={visibleTabs} />
            </Suspense>
            {/* PWA Install Prompt */}
            <Suspense fallback={null}>
                <InstallPrompt />
            </Suspense>
        </div>
    );
};

// Component to handle login notifications
const LoginNotificationHandler: React.FC<{
    user: User | null;
    userProfile: any;
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

            // Send Lark + FCM notification (keep existing functionality)
            sendLarkLoginNotification(user.email, userProfile.role, userProfile.teamId);

            hasShownNotification.current = true;
        }

        // Reset flag when user logs out
        if (!user) {
            hasShownNotification.current = false;
        }
    }, [user, userProfile, addNotification]);

    return null;
};

const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setAuthLoading(true);
            setUser(currentUser);
            setUserProfile(null);
            setAuthError(null);

            if (currentUser) {
                try {
                    const roleDocRef = doc(db, "user_roles", currentUser.uid);
                    const roleDoc = await getDoc(roleDocRef);

                    if (!roleDoc.exists()) {
                        setAuthError("Tài khoản của bạn không được cấp quyền truy cập.");
                        await signOut(auth);
                        setUser(null);
                    } else {
                        const profile = roleDoc.data();
                        setUserProfile(profile);
                        // Notification now handled by LoginNotificationHandler component
                    }
                } catch (err) {
                    console.error("Auth check error:", err);
                    setAuthError("Lỗi khi kiểm tra quyền truy cập.");
                    await signOut(auth);
                    setUser(null);
                }
                requestForToken(currentUser.uid);
                // --------------------
            }
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

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
        // Wrap with NotificationProvider
        <NotificationProvider>
            <LoginNotificationHandler user={user} userProfile={userProfile} />
            <DashboardProvider
                user={user}
                teamId={userProfile.teamId}
                role={userProfile.role}
                permissions={userProfile.permissions || {}}
                allowedAccounts={userProfile.allowedAccounts || []}
            >
                <DashboardLayout />
            </DashboardProvider>
        </NotificationProvider>
    );
};

export default App;
