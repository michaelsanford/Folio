import React, { Suspense, lazy } from "react";

/**
 * ECharts is roughly three quarters of the JavaScript this app ships. Loading it
 * eagerly meant the dashboard's balance figures waited on a megabyte of charting
 * code before painting -- on the mobile connection the PWA is meant for, that is
 * the whole of the perceived load time.
 *
 * Deferring it lets the numbers render immediately and the charts fill in.
 */
const ReactECharts = lazy(() => import("echarts-for-react"));

interface LazyChartProps {
  option: Record<string, unknown>;
  /** Tailwind height class for both the chart and its placeholder. */
  className?: string;
}

const ChartSkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`${className ?? ""} w-full rounded-xl bg-slate-800/30 animate-pulse flex items-center justify-center`}
    role="status"
    aria-label="Chart loading"
  >
    <span className="text-xs text-slate-500">Loading chart…</span>
  </div>
);

export const LazyChart: React.FC<LazyChartProps> = ({ option, className }) => (
  <Suspense fallback={<ChartSkeleton className={className} />}>
    <div className={`${className ?? ""} w-full`}>
      <ReactECharts
        option={option}
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "svg" }}
      />
    </div>
  </Suspense>
);
