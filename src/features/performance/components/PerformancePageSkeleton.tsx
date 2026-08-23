import React from 'react';

interface Props {
  variant?: 'section' | 'configuration';
}

const SkeletonBlock: React.FC<{ className: string }> = ({ className }) => (
  <div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className}`} />
);

const PerformancePageSkeleton: React.FC<Props> = ({ variant = 'section' }) => (
  <div
    className="h-full overflow-y-auto p-2 pb-28 md:p-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
    aria-busy="true"
    aria-label="Đang tải dữ liệu KPI"
  >
    <span className="sr-only">Đang tải dữ liệu KPI</span>
    <div className="mx-auto max-w-[1500px] space-y-4">
      {variant === 'configuration' && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <SkeletonBlock className="h-6 w-64 max-w-full" />
              <SkeletonBlock className="h-4 w-[520px] max-w-full" />
            </div>
            <SkeletonBlock className="h-11 w-full lg:w-72" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map(item => <SkeletonBlock key={item} className="h-20" />)}
          </div>
        </section>
      )}

      {variant === 'section' && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map(item => (
            <article key={item} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between gap-3">
                <SkeletonBlock className="h-4 w-28" />
                <SkeletonBlock className="h-6 w-12 rounded-full" />
              </div>
              <SkeletonBlock className="mt-5 h-9 w-24" />
              <SkeletonBlock className="mt-5 h-4 w-full" />
              <SkeletonBlock className="mt-2 h-4 w-3/4" />
            </article>
          ))}
        </section>
      )}

      {variant === 'configuration' && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <SkeletonBlock className="h-5 w-48" />
            <div className="mt-5 space-y-3">
              {[0, 1, 2, 3].map(item => <SkeletonBlock key={item} className="h-11 w-full" />)}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <SkeletonBlock className="h-5 w-56" />
            <SkeletonBlock className="mt-5 h-52 w-full" />
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-gray-700">
          <div className="space-y-2">
            <SkeletonBlock className="h-5 w-52" />
            <SkeletonBlock className="h-3 w-80 max-w-full" />
          </div>
          <SkeletonBlock className="h-7 w-24 rounded-full" />
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {[0, 1, 2, 3, 4, 5].map(item => (
            <div key={item} className="grid gap-4 p-5 md:grid-cols-[1.2fr_repeat(4,minmax(100px,1fr))]">
              <div className="space-y-2"><SkeletonBlock className="h-4 w-36" /><SkeletonBlock className="h-3 w-24" /></div>
              {[0, 1, 2, 3].map(cell => <SkeletonBlock key={cell} className="h-9 w-full" />)}
            </div>
          ))}
        </div>
      </section>
    </div>
  </div>
);

export default PerformancePageSkeleton;
