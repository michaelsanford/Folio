/**
 * The one place ECharts modules are registered. Importing `echarts` itself pulls
 * in every chart type and component (over 1 MB minified); registering only what
 * the app's options use keeps the lazily loaded chart chunk small.
 *
 * Adding a new series type or option component (dataZoom, title, visualMap...)
 * to a chart means registering it here, or ECharts logs a "not registered"
 * warning and skips it.
 */
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, SankeyChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
// LazyChart renders with `renderer: "svg"`.
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  SankeyChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
]);

export { echarts };
