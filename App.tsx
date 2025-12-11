import React, { useState, useEffect, Suspense, lazy } from 'react';
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
import { Record } from './api/_lib/types';
import { reprocessRecord } from './services/emailService';
import { requestForToken } from './services/notificationService';
import CollapsibleContainer from './components/CollapsibleContainer';

import SkeletonLoader from './components/SkeletonLoader';

// Lazy load heavy components
const DataTable = lazy(() => import('./components/DataTable'));
const AccountManager = lazy(() => import('./components/AccountManager'));
const OverviewChart = lazy(() => import('./components/OverviewChart'));
const SummaryChart = lazy(() => import('./components/SummaryChart'));
const TopProductsChart = lazy(() => import('./components/TopProductsChart'));
const FulfillChart = lazy(() => import('./components/FulfillChart'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));

// Loading component for Suspense fallback
const LoadingSpinner: React.FC<{ variant?: 'table-row' | 'card' | 'chart' | 'kpi-card'; count?: number }> = ({ variant = 'table-row', count = 3 }) => (
    <SkeletonLoader variant={variant} count={count} />
);

const DashboardLayout: React.FC = () => {
    const {
        syncState, // <-- Updated from status
        isAccountManagerOpen,
        isLoading,
        records,
        setRecords,
        activeTab,
        isFetchingNewRange,
        processedData,
        handleViewDayDetails,
        dayFilter,
        timeZone,
        teamId,
        accounts,
    } = useDashboard();

    const [selectedOrder, setSelectedOrder] = useState<Record | null>(null);

    const handleViewOrderDetails = (recordId: string) => {
        const record = records.find(r => r.id === recordId);
        if (record && record.details) {
            setSelectedOrder(record);
        } else {
            alert("Details not available for this order.");
        }
    };

    const handleResyncOrder = async (recordId: string) => {
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
    };

    const closeOrderDetail = () => setSelectedOrder(null);

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
                    <div className="p-4 md:p-6 overflow-y-auto h-full">
                        <div className="mb-6 hidden md:block">
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
                    <div className="p-4 md:p-6 overflow-y-auto h-full">
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
                    <div className="p-4 md:p-6 overflow-y-auto h-full">
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
                        <div className="md:hidden space-y-4 mb-6">
                            <Suspense fallback={<LoadingSpinner />}>
                                <CollapsibleContainer title="Top Products by Shop">
                                    <TopProductsChart data={processedData.summary.topProductsByShop} />
                                </CollapsibleContainer>
                                <CollapsibleContainer title="Revenue & Funds by Shop">
                                    <SummaryChart data={processedData.summary.chartData} />
                                </CollapsibleContainer>
                            </Suspense>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6 mb-6">
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

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col">
            <Header />
            <main className="flex-grow p-4 md:p-6 flex flex-col h-[calc(100vh-64px)] overflow-hidden">
                <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <Tabs />
                    <div className="px-4 flex-shrink-0">
                        <button
                            onClick={handleExportCSV}
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
                    {isFetchingNewRange && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-gray-800/50 flex items-center justify-center z-10">
                            <svg className="animate-spin h-8 w-8 text-blue-600 dark:text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        </div>
                    )}
                    <div className={`h-full w-full transition-opacity duration-300 ${isFetchingNewRange ? 'opacity-50' : 'opacity-100'}`}>
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
            {selectedOrder && (
                <Suspense fallback={<LoadingSpinner />}>
                    <OrderDetailModal record={selectedOrder} onClose={closeOrderDetail} />
                </Suspense>
            )}
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
                <svg className="animate-spin h-10 w-10 text-blue-600 dark:text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
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
