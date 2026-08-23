export type BaselineConfidence = 'none' | 'partial' | 'complete';

export interface QuarterlyKpiBaselineSummary {
  monthCount: number;
  totalOutput: number;
  averagePerMonth: number | null;
  suggestedQuarterlyTarget: number | null;
  confidence: BaselineConfidence;
}

export interface EmployeeKpiBaselineSeries {
  id: string;
  name: string;
  role: string;
  dailyValues: number[];
  monthlyValues: number[];
  d7Rate: number | null;
  d14Rate: number | null;
  d30Rate: number | null;
}

const roundOne = (value: number) => Math.round(value * 10) / 10;

export const calculateQuarterlyKpiBaseline = (monthlyValues: number[]): QuarterlyKpiBaselineSummary => {
  const validValues = monthlyValues.filter(value => Number.isFinite(value) && value > 0);
  const totalOutput = validValues.reduce((sum, value) => sum + value, 0);
  const monthCount = validValues.length;

  return {
    monthCount,
    totalOutput: roundOne(totalOutput),
    averagePerMonth: totalOutput > 0 ? roundOne(totalOutput / 3) : null,
    suggestedQuarterlyTarget: totalOutput > 0 ? roundOne(totalOutput) : null,
    confidence: monthCount === 0 ? 'none' : monthCount === 3 ? 'complete' : 'partial',
  };
};
