import React from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { echarts } from "./echarts";

type EChartsCoreProps = Omit<React.ComponentProps<typeof ReactEChartsCore>, "echarts">;

/** echarts-for-react bound to the trimmed ECharts build from `./echarts`. Lazily loaded by LazyChart. */
const EChartsCore: React.FC<EChartsCoreProps> = (props) => (
  <ReactEChartsCore echarts={echarts} {...props} />
);

export default EChartsCore;
