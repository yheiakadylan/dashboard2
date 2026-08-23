import type { KpiTargetComparison, PerformanceSectionId } from './types';

type KpiActualSource = {
  points: number;
  creditedPoints: number;
  ideas: number;
  listings: number;
  output: number;
};

export type KpiMetricDefinition = {
  code: string;
  label: string;
  sectionId: PerformanceSectionId;
  unit: string;
  comparison: KpiTargetComparison;
  roles: string[];
  getActual: (employee: KpiActualSource) => number;
};

export const KPI_METRIC_DEFINITIONS: KpiMetricDefinition[] = [
  {
    code: 'DS_IDEA_POINTS',
    label: 'Designer Idea points',
    sectionId: 'designer-idea',
    unit: 'points',
    comparison: 'minimum',
    roles: ['DS_IDEA', 'LEADDS_IDEA'],
    getActual: employee => employee.creditedPoints,
  },
  {
    code: 'DS_FF_POINTS',
    label: 'Designer Fulfillment points',
    sectionId: 'designer-fulfillment',
    unit: 'points',
    comparison: 'minimum',
    roles: ['DS_FULFILL', 'LEADDS_FULFILL'],
    getActual: employee => employee.creditedPoints,
  },
  {
    code: 'RND_LISTINGS_CREATED',
    label: 'R&D listings created',
    sectionId: 'research-development',
    unit: 'listings',
    comparison: 'minimum',
    roles: ['IDEA_RD', 'LEADIDEA_RD'],
    getActual: employee => employee.listings,
  },
  {
    code: 'SCALE_LISTINGS_CREATED',
    label: 'Scale listings created',
    sectionId: 'scale',
    unit: 'listings',
    comparison: 'minimum',
    roles: ['IDEA_SCALE', 'LEADIDEA_SCALE'],
    getActual: employee => employee.listings,
  },
  {
    code: 'CS_ORDERS_CLOSED',
    label: 'Orders processed',
    sectionId: 'customer-service',
    unit: 'orders',
    comparison: 'minimum',
    roles: ['CS_SUPPORT', 'LEADCS_SUPPORT'],
    getActual: employee => employee.output,
  },
  {
    code: 'FF_DONE',
    label: 'Orders fulfilled',
    sectionId: 'fulfillment',
    unit: 'orders',
    comparison: 'minimum',
    roles: ['CS_FULFILL', 'LEADCS_FULFILL'],
    getActual: employee => employee.output,
  },
];

export const getPrimaryKpiDefinition = (sectionId: PerformanceSectionId) => (
  KPI_METRIC_DEFINITIONS.find(metric => metric.sectionId === sectionId)
);

export const DESIGNER_KPI_SECTIONS = KPI_METRIC_DEFINITIONS.filter(metric => (
  metric.sectionId === 'designer-idea' || metric.sectionId === 'designer-fulfillment'
));

export const CONFIGURABLE_KPI_SECTIONS = KPI_METRIC_DEFINITIONS;
