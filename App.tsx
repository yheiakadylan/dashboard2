import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
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

const DashboardLayout: React.FC = () => {
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
    } = useDashboard();

    const [selectedOrder, setSelectedOrder] = useState<Record | null>(null);

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

    const handleExportCSV = () => {
        // ... (Code export CSV giữ nguyên) ...
        let dataToExport: { headers: string[]; rows: any[][]; };
        let filename = `dashboard-export-${activeTab.toLowerCase().replace(/\s/g, '-')}.csv`;

        switch (activeTab) {
            case 'Overview':
                dataToExport = processedData.overview.table;
                break;
            case 'Order List':
                dataToExport = processedData.orders;
                break;
            case 'eBay':
                dataToExport = processedData.ebay;
                break;
            case 'Etsy':
                dataToExport = processedData.etsy;
                break;
            case 'Case':
                dataToExport = processedData.cases;
                break;
            case 'Help':
                dataToExport = processedData.help;
                break;
            case 'Fulfill':
                dataToExport = processedData.fulfill.table;
                break;
            case 'Summary':
                dataToExport = processedData.summary.table;
                break;
            default:
                console.warn('No exportable data for this tab.');
                alert('No data to export for the current view.');
                return;
        }

        if (!dataToExport || dataToExport.rows.length === 0) {
            alert('No data to export.');
            return;
        }

        const { headers, rows } = dataToExport;

        const escapeCSV = (cell: any): string => {
            if (cell === null || cell === undefined) {
                return '';
            }
            if (typeof cell === 'object' && 'type' in cell) {
                return '';
            }
            let str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                str = `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvContent = [
            headers.map(escapeCSV).join(','),
            ...rows.map(row => {
                const rowToExport = activeTab === 'Order List' ? row.slice(0, headers.length) : row;
                return rowToExport.map(escapeCSV).join(',');
            })
        ].join('\n');

        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
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
                        <div className="mb-4 md:mb-6 hidden md:block">
                            <Suspense fallback={<LoadingSpinner variant="chart" count={1} />}>
                                <OverviewChart data={processedData.overview.chartData} />
                            </Suspense>
                        </div>
                        <div className="mb-6 md:hidden">
                            <CollapsibleContainer title="Sales Overview Chart">
                                <Suspense fallback={<LoadingSpinner variant="chart" count={1} />}>
                                    <OverviewChart data={processedData.overview.chartData} />
                                </Suspense>
                            </CollapsibleContainer>
                        </div>
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                                Daily Breakdown
                            </h3>
                            <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                                <DataTable
                                    headers={processedData.overview.table.headers}
                                    data={processedData.overview.table.rows}
                                    onViewDayDetails={handleViewDayDetails}
                                    autoHeight={true} // Enable natural scrolling
                                    mobileRowHeight={350}
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
                        const dtLocal = row[orderListHeaders.length] as string;
                        return formatDate(dtLocal) === dayFilter;
                    });
                }

                return (
                    <Suspense fallback={<LoadingSpinner variant="card" count={5} />}>
                        <DataTable
                            headers={orderListHeaders}
                            data={orderListRows}
                            onViewOrderDetails={handleViewOrderDetails}
                            onResyncOrder={handleResyncOrder}
                            mobileRowHeight={340} // Increased height for cards
                        />
                    </Suspense>
                );
            }
            case 'eBay': return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.ebay.headers} data={processedData.ebay.rows} onViewOrderDetails={handleViewOrderDetails} onResyncOrder={handleResyncOrder} mobileRowHeight={340} /></Suspense>;
            case 'Etsy': return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.etsy.headers} data={processedData.etsy.rows} onViewOrderDetails={handleViewOrderDetails} onResyncOrder={handleResyncOrder} mobileRowHeight={340} /></Suspense>;
            case 'Case': return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.cases.headers} data={processedData.cases.rows} /></Suspense>;
            case 'Help': return <Suspense fallback={<LoadingSpinner />}><DataTable headers={processedData.help.headers} data={processedData.help.rows} /></Suspense>;
            case 'Fulfill':
                return (
                    <div className="p-2 md:p-6 overflow-y-auto h-full">
                        <div className="mb-6 hidden md:block">
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
                        </div>
                        <div className="md:hidden space-y-4 mb-6">
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
            case 'Summary':
                return (
                    <div className="p-2 md:p-6 overflow-y-auto h-full">
                        <div className="mb-6 hidden md:block">
                            <Suspense fallback={<LoadingSpinner />}>
                                <TopProductsChart data={processedData.summary.topProductsByShop} />
                            </Suspense>
                        </div>
                        <div className="mb-6 hidden md:block">
                            <Suspense fallback={<LoadingSpinner />}>
                                <SummaryChart data={processedData.summary.chartData} />
                            </Suspense>
                        </div>
                        <div className="md:hidden space-y-3 mb-4">
                            <Suspense fallback={<LoadingSpinner />}>
                                <CollapsibleContainer title="Top Products">
                                    <TopProductsChart data={processedData.summary.topProductsByShop} hideTitle />
                                </CollapsibleContainer>
                                <CollapsibleContainer title="Revenue & Funds">
                                    <SummaryChart data={processedData.summary.chartData} hideTitle />
                                </CollapsibleContainer>
                            </Suspense>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6 mb-4 md:mb-6">
                            {Object.entries(processedData.summary.kpis).map(([title, value]) => (
                                <KpiCard key={title} title={title} value={value} />
                            ))}
                        </div>

                        {/* Auto-height table container for Summary view.
                    Removed fixed height to allow full page scrolling.
                */}
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Shop Summary Detail</h3>
                            <Suspense fallback={<LoadingSpinner />}>
                                <DataTable
                                    headers={processedData.summary.table.headers}
                                    data={processedData.summary.table.rows}
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
                case 'Overview':
                case 'Order List':
                case 'eBay':
                case 'Etsy':
                case 'Case':
                case 'Help':
                    return permissions.viewSales;
                case 'Fulfill':
                    return permissions.viewFulfill;
                case 'Summary':
                    return permissions.viewSummary;
                default:
                    return false;
            }
        });
    };
    const visibleTabs = getPermittedTabs(tabOrder).filter(tab => !hiddenTabs.has(tab));

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col">
            <Header />
            <main className="flex-grow p-2 md:p-6 flex flex-col h-[calc(100vh-64px)] md:h-[calc(100vh-64px)] pb-20 md:pb-6 overflow-hidden">
                <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <Tabs />
                    <div className="hidden md:flex px-4 flex-shrink-0">
                        <button
                            onClick={() => {
                                triggerHaptic('light');
                                handleExportCSV();
                            }}
                            className="p-2 md:px-3 md:py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-900 focus:ring-green-500 flex items-center gap-2"
                            title="Export current view to CSV"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="hidden md:inline">Export</span>
                        </button>
                    </div>
                </div>
                <div className="relative flex-grow bg-white dark:bg-gray-800 rounded-b-lg shadow-lg overflow-hidden">
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
                        <div className="absolute inset-0 bg-white/50 dark:bg-gray-800/50 flex items-center justify-center z-10">
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
