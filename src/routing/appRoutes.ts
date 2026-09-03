import type { Tab } from '../types';

export const TAB_PATHS: Partial<Record<Tab, string>> = {
  Overview: '/operations/overview',
  'Order List': '/operations/orders',
  Products: '/operations/products',
  Support: '/operations/support',
  Fulfill: '/operations/fulfillment',
  KPI: '/operations/kpi',
  Reviews: '/operations/reviews',
  Design: '/operations/design',
  'Shop Evaluation': '/operations/shop-evaluation',
  Workload: '/operations/workload',
};

const normalizePath = (pathname: string) => {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
};

export const getTabFromPath = (pathname: string): Tab | null => {
  const normalized = normalizePath(pathname);
  const route = Object.entries(TAB_PATHS).find(([, path]) => path === normalized);
  return route?.[0] as Tab | null;
};

export const getPathForTab = (tab: Tab) => TAB_PATHS[tab] || TAB_PATHS.Overview;
