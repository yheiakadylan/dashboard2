const isPerfLoggingEnabled = () => {
  try {
    return import.meta.env.DEV && localStorage.getItem('performanceVerbose') === '1';
  } catch {
    return false;
  }
};

export const startMeasure = (name: string, details?: Record<string, unknown>) => {
  if (!isPerfLoggingEnabled() || typeof performance === 'undefined') return () => {};

  const start = `${name}:start:${Math.random().toString(36).slice(2)}`;
  performance.mark(start);
  if (details) console.info(`[Perf] ${name}:start`, details);

  return (endDetails?: Record<string, unknown>) => {
    const end = `${name}:end:${Math.random().toString(36).slice(2)}`;
    performance.mark(end);
    const measure = performance.measure(name, start, end);
    console.info(`[Perf] ${name}:done`, {
      durationMs: Math.round(measure.duration),
      ...(details || {}),
      ...(endDetails || {})
    });
    performance.clearMarks(start);
    performance.clearMarks(end);
    performance.clearMeasures(name);
  };
};

export const markPerf = (name: string, details?: Record<string, unknown>) => {
  if (!isPerfLoggingEnabled()) return;
  console.info(`[Perf] ${name}`, details || {});
};
