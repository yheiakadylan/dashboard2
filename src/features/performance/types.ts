export const PERFORMANCE_SECTIONS = [
  { id: 'company-overview', label: 'Company Overview' },
  { id: 'designer-idea', label: 'Designer Idea' },
  { id: 'designer-fulfillment', label: 'Designer Fulfillment' },
  { id: 'research-development', label: 'Research & Development' },
  { id: 'scale', label: 'Scale' },
  { id: 'customer-service', label: 'Customer Service' },
  { id: 'fulfillment', label: 'Fulfillment' },
  { id: 'kpi-assignment', label: 'KPI Configuration' },
] as const;

export type PerformanceSectionId = typeof PERFORMANCE_SECTIONS[number]['id'];
export type MetricTone = 'green' | 'amber' | 'red' | 'gray';
export type MetricSource = 'real' | 'mockup';
export type PerformanceAccessLevel = 'employee' | 'leader' | 'manager';

export interface PerformanceBreakdownItem {
  label: string;
  value: string;
  secondary?: string;
}

export interface MetricHelpContent {
  summary: string;
  currentSummary?: string;
  calculation: string[];
  sources: string[];
  rules?: string[];
  scope?: string[];
}

export interface PerformanceMetric {
  code: string;
  label: string;
  value: string;
  secondaryValue?: string;
  target: string;
  progress: number;
  change: number;
  tone: MetricTone;
  source: MetricSource;
  comparisonLabel?: string;
  comparisonAvailable?: boolean;
  drillDownLabel?: string;
  breakdown?: PerformanceBreakdownItem[];
  help?: MetricHelpContent;
}

export interface CompanyActivityTrendRow {
  date: string;
  label: string;
  listings: number;
  designerIdea: number;
  designerFulfillment: number;
  csCompleted: number;
  fulfilled: number;
}

export interface CompanySupplierChartRow {
  name: string;
  value: number;
}

export interface CompanyRatingChartRow {
  name: string;
  rangeAverage: number | null;
  lifetimeAverage: number | null;
  reviewCount: number;
}

export interface CompanyOverviewChartData {
  activityTrend: CompanyActivityTrendRow[];
  supplierBreakdown: CompanySupplierChartRow[];
  supplierCoverage: number | null;
  ratingComparison: CompanyRatingChartRow[];
}

export interface EmployeePerformanceRow {
  id: string;
  name: string;
  role: string;
  teamId?: string;
  ideas: number;
  designs: number;
  fulfilled: number;
  received: number;
  completed: number;
  customOrdersCompleted: number;
  nonCustomOrdersCompleted: number;
  points: number;
  supportCompleted: number;
  supportPoints: number;
  supportBoard: 'Designer Idea' | 'Designer Fulfillment';
  creditedPoints: number;
  ideasWithSales: number;
  ideaSales: number;
  ideaSaleBreakdown: PerformanceBreakdownItem[];
  listings: number;
  listingsWithSales: number;
  soldSkus: number;
  saleQuantity: number;
  saleRevenueUsd: number;
  saleOrders: number;
  saleBreakdown: PerformanceBreakdownItem[];
  averageFirstSaleHours: number | null;
  firstSaleCohort: number;
  firstSaleHoursTotal: number;
  firstSaleDurationsHours: number[];
  firstSaleD7Eligible: number;
  firstSaleD7Converted: number;
  firstSaleD7Rate: number | null;
  firstSaleD14Eligible: number;
  firstSaleD14Converted: number;
  firstSaleD14Rate: number | null;
  firstSaleD30Eligible: number;
  firstSaleD30Converted: number;
  firstSaleD30Rate: number | null;
  averageCycleHours: number | null;
  cycleDurationsHours: number[];
  averageCustomCycleHours: number | null;
  averageNonCustomCycleHours: number | null;
  kpiCode: string;
  kpiLabel: string;
  kpiTarget: number | null;
  kpiActual: number;
  kpiCompletion: number | null;
  kpiUnit: string;
  kpiTargetSource?: 'department' | 'role' | 'employee' | null;
  kpiProgress?: KpiProgress | null;
  output: number;
}

export interface DesignerPointDataQuality {
  totalCompletedTasks: number;
  snapshottedTasks: number;
  configuredTasks: number;
  fallbackTasks: number;
  tasksWithoutTemplate: number;
}

export const isPerformanceSectionId = (value: string): value is PerformanceSectionId =>
  PERFORMANCE_SECTIONS.some(section => section.id === value);
export type KpiTargetScope = 'department' | 'role' | 'employee';
export type KpiTargetPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type KpiTargetComparison = 'minimum' | 'maximum';
export type KpiApprovalStatus = 'pending' | 'approved' | 'rejected';
export type KpiPaceStatus = 'not_started' | 'at_risk' | 'on_track' | 'ahead' | 'achieved';

export interface KpiProgress {
  period: KpiTargetPeriod;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  asOf: string;
  fullTarget: number;
  expectedTarget: number;
  actual: number;
  completion: number;
  pace: number;
  remaining: number;
  forecast: number;
  requiredPerWorkday: number;
  elapsedWorkdays: number;
  totalWorkdays: number;
  remainingWorkdays: number;
  countdownLabel: string;
  status: KpiPaceStatus;
}

export interface KpiTarget {
  id: string;
  scope: KpiTargetScope;
  scopeId: string;
  scopeLabel: string;
  metricCode: string;
  metricLabel: string;
  comparison: KpiTargetComparison;
  targetValue: number;
  unit: string;
  period: KpiTargetPeriod;
  sectionId?: PerformanceSectionId;
  departmentId?: string;
  departmentLabel?: string;
  reason?: string;
  status?: KpiApprovalStatus;
  version?: number;
  active: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  activationMode?: 'current_period' | 'next_period' | 'custom';
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  proposerRole?: 'leader' | 'head';
  approvedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectionReason?: string;
  supersedesId?: string;
  supersededById?: string;
  updatedAt: string;
  updatedBy?: string;
}
