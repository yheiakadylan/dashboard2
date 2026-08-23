import type { PerformanceMetric } from './types';

export const mockMetric = (metric: Omit<PerformanceMetric, 'source'>): PerformanceMetric => ({ ...metric, source: 'mockup' });

export const DESIGNER_POINT_RULES = {
  defaultIdeaPointsPerTemplate: 3,
  defaultFulfillmentPointsPerTemplate: 1,
  countEachTemplateOncePerFile: true,
  deductPointsForRejects: false,
} as const;
