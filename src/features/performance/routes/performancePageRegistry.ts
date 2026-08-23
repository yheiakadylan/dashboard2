import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PerformanceSectionId } from '../types';

export const performancePageRegistry: Record<PerformanceSectionId, LazyExoticComponent<ComponentType>> = {
  'company-overview': lazy(() => import('../pages/CompanyOverviewPage')),
  'designer-idea': lazy(() => import('../pages/DesignerIdeaPage')),
  'designer-fulfillment': lazy(() => import('../pages/DesignerFulfillmentPage')),
  'research-development': lazy(() => import('../pages/ResearchDevelopmentPage')),
  scale: lazy(() => import('../pages/ScalePage')),
  'customer-service': lazy(() => import('../pages/CustomerServicePage')),
  fulfillment: lazy(() => import('../pages/FulfillmentPerformancePage')),
  'kpi-assignment': lazy(() => import('../pages/KpiAssignmentPage')),
};
