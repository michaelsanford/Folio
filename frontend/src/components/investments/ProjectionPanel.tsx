import React, { useEffect, useMemo, useState } from "react";
import { LazyChart } from "../common/LazyChart";
import { NumberField } from "../common/NumberField";
import { useChartTheme } from "../../hooks/useChartTheme";
import { api } from "../../services/api";
import { formatMoney, formatMoneyCompact, getDateLocale } from "../../utils/format";
import { projectBalances } from "../../utils/projection";
import type { ReturnHistoryResponse } from "../../types";
import { inputClass, labelText, loneText, segmentButton, segmentTrack } from "../common/ui";

interface ProjectionPanelProps {
  accountId: string;
  currency: string;
  /** Today's market value, so the projection starts where the page's figures are. */
  marketValue: number;
}

const HORIZONS = [5, 10, 20, 30] as const;
const PATHS = 1000;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Month labels continuing on from an ISO date (`2026-11-30` → Dec 2026, Jan 2027, …). */
const monthLabel = (iso: string, offset = 0): string => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1 + offset, 1).toLocaleDateString(getDateLocale(), { month: "short", year: "numeric" });
};

/**
 * Where this account could be in N years, from its own past monthly returns.
 * The history is fetched when the panel mounts (the disclosure is opened);
 * the simulation runs here, so changing the horizon or contribution redraws at once.
 */
export const ProjectionPanel: React.FC<ProjectionPanelProps> = ({ accountId, currency, marketValue }) => {
  const chartTheme = useChartTheme();
  const [history, setHistory] = useState<ReturnHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<(typeof HORIZONS)[number]>(10);
  const [contribution, setContribution] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(null);
    api
      .getReturnHistory(accountId)
      .then((h) => {
        if (cancelled) return;
        setHistory(h);
        const avg = Math.round(h.average_monthly_contribution);
        setContribution(avg > 0 ? avg : null);
      })
      .catch((err: any) => !cancelled && setError(err?.message || "Could not load the return history."));
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const mu = history?.mean_monthly_log_return ?? null;
  const sigma = history?.stdev_monthly_log_return ?? null;
  const months = years * 12;
  const monthly = contribution ?? 0;

  const projection = useMemo(
    () =>
      mu === null || sigma === null
        ? null
        : projectBalances({ startValue: marketValue, mu, sigma, months, monthlyContribution: monthly, paths: PATHS }),
    [mu, sigma, marketValue, months, monthly]
  );

  const option = useMemo(() => {
    if (!history || !projection) return null;
    const past = history.points;
    const today = history.as_of;
    const labels = [
      ...past.slice(0, -1).map((p) => monthLabel(p.month)),
      "Today",
      ...projection.points.map((p) => monthLabel(today, p.month)),
    ];
    const lastPast = past.length - 1;
    const pad = (n: number) => Array<null>(n).fill(null);
    // Each projected series starts at today's value so it joins the history line.
    const fromToday = (pick: (i: number) => number) => [
      ...pad(lastPast),
      marketValue,
      ...projection.points.map((_, i) => pick(i)),
    ];
    const pts = projection.points;
    const round = (v: number) => Math.round(v * 100) / 100;

    const bandBase = { type: "line", symbol: "none", lineStyle: { opacity: 0 }, silent: true, smooth: 0.2 } as const;

    return {
      backgroundColor: "transparent",
      animationDuration: 300,
      tooltip: {
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        extraCssText: "border-radius: 8px; box-shadow: none;",
        textStyle: { color: chartTheme.tooltipText, fontSize: chartTheme.labelFontSize, fontFamily: chartTheme.fontFamily },
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: chartTheme.axisLineColor } },
        formatter: (params: any[]) => {
          const idx = params[0]?.dataIndex ?? 0;
          const head = `<div style="color:${chartTheme.subtleTextColor}">${labels[idx]}</div>`;
          const fig = (s: string) => `<div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${s}</div>`;
          if (idx < lastPast) return head + fig(formatMoney(past[idx].value, { currency }));
          if (idx === lastPast) return head + fig(formatMoney(marketValue, { currency }));
          const p = pts[idx - lastPast - 1];
          return (
            head +
            fig(`Median ${formatMoney(p.p50, { currency, cents: false })}`) +
            `<div style="margin-top:2px;color:${chartTheme.subtleTextColor};font-family:${chartTheme.figureFontFamily}">` +
            `80% between ${formatMoney(p.p10, { currency, cents: false })} and ${formatMoney(p.p90, { currency, cents: false })}</div>`
          );
        },
      },
      grid: { left: 8, right: 16, bottom: 8, top: 16, containLabel: true },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
        axisTick: { show: false },
        axisLabel: { color: chartTheme.subtleTextColor, fontSize: chartTheme.axisFontSize, fontFamily: chartTheme.figureFontFamily, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: chartTheme.axisFontSize,
          fontFamily: chartTheme.figureFontFamily,
          formatter: (v: number) => formatMoneyCompact(v, currency),
        },
      },
      series: [
        // 10–90% band: an invisible floor at p10, then the band's height stacked on top.
        { ...bandBase, name: "p10", stack: "outer", data: fromToday((i) => round(pts[i].p10)) },
        {
          ...bandBase,
          name: "10–90%",
          stack: "outer",
          areaStyle: { color: chartTheme.accentColor, opacity: 0.12 },
          data: fromToday((i) => round(pts[i].p90 - pts[i].p10)).map((v, i) => (i === lastPast ? 0 : v)),
        },
        // 25–75% band, the same way.
        { ...bandBase, name: "p25", stack: "inner", data: fromToday((i) => round(pts[i].p25)) },
        {
          ...bandBase,
          name: "25–75%",
          stack: "inner",
          areaStyle: { color: chartTheme.accentColor, opacity: 0.2 },
          data: fromToday((i) => round(pts[i].p75 - pts[i].p25)).map((v, i) => (i === lastPast ? 0 : v)),
        },
        {
          name: "Median",
          type: "line",
          symbol: "none",
          smooth: 0.2,
          lineStyle: { width: 2, type: "dashed", color: chartTheme.accentColor },
          itemStyle: { color: chartTheme.accentColor },
          data: fromToday((i) => round(pts[i].p50)),
        },
        {
          name: "History",
          type: "line",
          symbol: "none",
          smooth: 0.2,
          lineStyle: { width: 2, color: chartTheme.textColor },
          itemStyle: { color: chartTheme.textColor },
          data: [...past.slice(0, -1).map((p) => p.value), marketValue],
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: chartTheme.axisLineColor, type: "solid" },
            data: [{ xAxis: lastPast }],
          },
        },
      ],
    };
  }, [history, projection, marketValue, currency, chartTheme]);

  if (error) return <p className="text-base text-negative">{error}</p>;
  if (!history) return <p role="status" className={`py-8 text-center ${loneText}`}>Loading return history…</p>;
  if (!projection) {
    return (
      <p className={`py-8 text-center ${loneText}`}>
        Projection needs at least 6 months of price history for these holdings (
        <span className="tabular-nums">{history.months_of_history}</span> so far). Update quotes regularly and it
        will appear here.
      </p>
    );
  }

  const end = projection.points.at(-1)!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className={`${labelText} mb-1`} id="projection-horizon">
              Horizon
            </div>
            <div role="radiogroup" aria-labelledby="projection-horizon" className={segmentTrack}>
              {HORIZONS.map((y) => (
                <button key={y} type="button" role="radio" aria-checked={years === y} onClick={() => setYears(y)} className={segmentButton(years === y)}>
                  {y} yr
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={`block ${labelText} mb-1`}>Monthly contribution</span>
            <NumberField
              value={contribution}
              onValueChange={setContribution}
              step="any"
              placeholder="0"
              className={`${inputClass.replace("w-full ", "")} w-36 tabular-nums`}
            />
          </label>
        </div>
        <p className="text-sm text-sub">
          Based on <span className="tabular-nums">{history.months_of_history}</span> months:{" "}
          <span className="tabular-nums text-sub">{pct(history.annualized_return ?? 0)}</span> a year,{" "}
          <span className="tabular-nums text-sub">{pct(history.annualized_volatility ?? 0)}</span> volatility
        </p>
      </div>

      {option && <LazyChart option={option} className="h-72" />}

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-6">
        <div>
          <dt className={labelText}>Median in {years} years</dt>
          <dd className="mt-1 text-xl md:text-2xl font-medium text-main tabular-nums">{formatMoney(end.p50, { currency, cents: false })}</dd>
        </div>
        <div>
          <dt className={labelText}>80% of outcomes</dt>
          <dd className="mt-1 text-xl md:text-2xl font-medium text-main tabular-nums">
            {formatMoneyCompact(end.p10, currency)} – {formatMoneyCompact(end.p90, currency)}
          </dd>
        </div>
        <div>
          <dt className={labelText}>You'd add</dt>
          <dd className="mt-1 text-xl md:text-2xl font-medium text-main tabular-nums">
            {formatMoney(projection.totalContributed, { currency, cents: false })}
          </dd>
        </div>
      </dl>

      <p className="text-sm text-sub">
        Past returns don't predict future results. The shaded bands hold the middle 50% and 80% of {PATHS.toLocaleString()}{" "}
        simulated paths drawn from this account's own monthly returns and volatility, valued at today's holdings.
      </p>
    </div>
  );
};
