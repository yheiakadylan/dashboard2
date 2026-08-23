import React, { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useDashboard } from '../contexts/DashboardContext';
import { useUIFilters, useUITabs } from '../contexts/UIContext';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import { hasPermission } from '../utils/permissionHelper';
import { getPathForTab } from './appRoutes';

const OverviewTab = lazy(() => import('../components/tabs/OverviewTab'));
const ProductsTab = lazy(() => import('../components/tabs/ProductsTab'));
const SupportTab = lazy(() => import('../components/tabs/SupportTab'));
const OrderListTab = lazy(() => import('../components/tabs/OrderListTab'));
const FulfillTab = lazy(() => import('../components/tabs/FulfillTab'));
const ReviewsTab = lazy(() => import('../components/tabs/ReviewsTab'));
const DesignTab = lazy(() => import('../components/tabs/DesignTab'));
const TempleteTab = lazy(() => import('../components/tabs/TempleteTab'));
const ShopEvaluationTab = lazy(() => import('../components/tabs/ShopEvaluationTab'));

interface Props {
  onViewOrderDetails: (recordId: string) => void;
  onResyncOrder: (recordId: string) => Promise<void>;
}

const CardFallback = () => <div className="p-2 md:p-6"><SkeletonLoader variant="card" count={6} /></div>;
const TableFallback = () => <div className="p-4"><SkeletonLoader variant="table-row" count={8} /></div>;
const PermissionDenied = ({ children }: { children: ReactNode }) => <div className="p-8 text-center text-gray-500">{children}</div>;
const RouteBoundary = ({ children, fallback }: { children: ReactNode; fallback: ReactNode }) => (
  <Suspense fallback={fallback}>
    <ErrorBoundary>{children}</ErrorBoundary>
  </Suspense>
);

const DashboardRoutes: React.FC<Props> = ({ onViewOrderDetails, onResyncOrder }) => {
  const { processedData, role, permissions } = useDashboard();
  const { activeTab, handleViewDayDetails, handleShopDetails } = useUITabs();
  const { filterDateRange, dayFilter, sourceFilter, statusFilter, timeZone } = useUIFilters();
  const isSingleDay = filterDateRange.from === filterDateRange.to;

  return (
    <Routes>
      <Route path="/operations/overview" element={(
        <RouteBoundary fallback={<CardFallback />}>
          <OverviewTab processedData={processedData} isSingleDay={isSingleDay} handleViewDayDetails={handleViewDayDetails} handleShopDetails={handleShopDetails} />
        </RouteBoundary>
      )} />
      <Route path="/operations/orders" element={(
        <RouteBoundary fallback={<CardFallback />}>
          <OrderListTab processedData={processedData} dayFilter={dayFilter} sourceFilter={sourceFilter} statusFilter={statusFilter} timeZone={timeZone} handleViewOrderDetails={onViewOrderDetails} handleResyncOrder={onResyncOrder} />
        </RouteBoundary>
      )} />
      <Route path="/operations/products" element={(
        <RouteBoundary fallback={<CardFallback />}><ProductsTab processedData={processedData} /></RouteBoundary>
      )} />
      <Route path="/operations/listings" element={<Navigate to={getPathForTab('Overview')} replace />} />
      <Route path="/operations/support" element={(
        <RouteBoundary fallback={<TableFallback />}><SupportTab processedData={processedData} /></RouteBoundary>
      )} />
      <Route path="/operations/fulfillment" element={(
        <RouteBoundary fallback={<TableFallback />}><FulfillTab processedData={processedData} /></RouteBoundary>
      )} />
      <Route path="/operations/reviews" element={hasPermission(role, permissions, 'viewReviewsTab') ? (
        <RouteBoundary fallback={<CardFallback />}><ReviewsTab /></RouteBoundary>
      ) : <PermissionDenied>You do not have permission to view reviews.</PermissionDenied>} />
      <Route path="/operations/design" element={(
        <RouteBoundary fallback={<TableFallback />}><DesignTab /></RouteBoundary>
      )} />
      <Route path="/operations/templates" element={(
        <RouteBoundary fallback={<TableFallback />}><TempleteTab /></RouteBoundary>
      )} />
      <Route path="/operations/shop-evaluation" element={(
        <RouteBoundary fallback={<TableFallback />}><ShopEvaluationTab /></RouteBoundary>
      )} />
      <Route path="/legacy/kpi" element={<Navigate to={getPathForTab('Overview')} replace />} />
      <Route path="/kpi/*" element={<Navigate to={getPathForTab('Overview')} replace />} />
      <Route path="/" element={<Navigate to={getPathForTab(activeTab)} replace />} />
      <Route path="*" element={<Navigate to={getPathForTab(activeTab)} replace />} />
    </Routes>
  );
};

export default DashboardRoutes;
