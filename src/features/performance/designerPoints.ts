import type { OperationTask, OperationTemplate } from '../../services/reportService';
import { DESIGNER_POINT_RULES } from './config';

export type DesignerBoard = 'idea' | 'fulfill';
export type DesignerPointSource = 'snapshot' | 'configured' | 'fallback' | 'none';

export type DesignerPointResolution = {
  points: number;
  source: DesignerPointSource;
  templateIds: string[];
  configuredTemplateCount: number;
  fallbackTemplateCount: number;
};

const isValidPointValue = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
);

export const getDesignerFallbackPoints = (board: DesignerBoard) => (
  board === 'idea'
    ? DESIGNER_POINT_RULES.defaultIdeaPointsPerTemplate
    : DESIGNER_POINT_RULES.defaultFulfillmentPointsPerTemplate
);

export const getTaskTemplateIds = (task: Pick<OperationTask, 'templateId'>) => {
  const rawTemplateIds = Array.isArray(task.templateId) ? task.templateId : [task.templateId];
  return Array.from(new Set(
    rawTemplateIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
  ));
};

export const createConfiguredTemplatePointMap = (templates: OperationTemplate[]) => new Map(
  templates.flatMap(template => (
    isValidPointValue(template.points) ? [[template.id, template.points] as const] : []
  ))
);

export const resolveDesignerTaskPoints = (
  task: Pick<OperationTask, 'templateId' | 'templatePointsSnapshot'>,
  board: DesignerBoard,
  configuredPoints: Map<string, number>
): DesignerPointResolution => {
  if (isValidPointValue(task.templatePointsSnapshot)) {
    return {
      points: task.templatePointsSnapshot,
      source: 'snapshot',
      templateIds: getTaskTemplateIds(task),
      configuredTemplateCount: 0,
      fallbackTemplateCount: 0,
    };
  }

  const templateIds = getTaskTemplateIds(task);
  if (!templateIds.length) {
    return {
      points: 0,
      source: 'none',
      templateIds,
      configuredTemplateCount: 0,
      fallbackTemplateCount: 0,
    };
  }

  const fallbackPoints = getDesignerFallbackPoints(board);
  let configuredTemplateCount = 0;
  let fallbackTemplateCount = 0;
  const points = templateIds.reduce((sum, templateId) => {
    const configuredPoint = configuredPoints.get(templateId);
    if (isValidPointValue(configuredPoint)) {
      configuredTemplateCount += 1;
      return sum + configuredPoint;
    }
    fallbackTemplateCount += 1;
    return sum + fallbackPoints;
  }, 0);

  return {
    points,
    source: fallbackTemplateCount > 0 ? 'fallback' : 'configured',
    templateIds,
    configuredTemplateCount,
    fallbackTemplateCount,
  };
};
