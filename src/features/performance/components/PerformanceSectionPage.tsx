import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PerformanceSectionId } from '../types';
import { usePerformanceData } from '../hooks/usePerformanceData';
import EmployeePerformanceTable from './EmployeePerformanceTable';
import MetricCard from './MetricCard';
import PerformancePageSkeleton from './PerformancePageSkeleton';
import CompanyOverviewCharts from './CompanyOverviewCharts';

interface Props {
  sectionId: PerformanceSectionId;
  title: string;
}

const PerformanceSectionPage: React.FC<Props> = ({ sectionId, title }) => {
  const { metrics, employees, companyOverviewCharts, accessLevel, isLoading, error } = usePerformanceData(sectionId);

  if (isLoading && !error) return <PerformancePageSkeleton />;

  return (
    <div className="h-full overflow-y-auto p-2 pb-28 md:p-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
      <div className="mx-auto max-w-[1500px] space-y-4">
        {error && (
          <section className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {error}
          </section>
        )}

        <section className={`grid gap-3 sm:grid-cols-2 ${metrics.length === 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
          {metrics.map(metric => <MetricCard key={metric.code} metric={metric} />)}
        </section>

        {sectionId === 'company-overview' ? (
          <CompanyOverviewCharts data={companyOverviewCharts} />
        ) : (
          <EmployeePerformanceTable
            employees={employees}
            isLoading={isLoading}
            sectionId={sectionId}
            title={accessLevel === 'employee' ? 'Hiệu suất của bạn' : title}
          />
        )}
      </div>
    </div>
  );
};

export default PerformanceSectionPage;
