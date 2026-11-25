import { describe, it, expect } from "vitest";
import { projectBalances } from "./projection";

describe("projectBalances", () => {
  it("collapses every band onto the deterministic path when there is no volatility", () => {
    const { points, totalContributed } = projectBalances({
      startValue: 1000,
      mu: Math.log(1.01),
      sigma: 0,
      months: 12,
      monthlyContribution: 100,
      paths: 50,
    });
    let expected = 1000;
    for (let m = 0; m < 12; m++) expected = expected * 1.01 + 100;
    const last = points.at(-1)!;
    expect(points).toHaveLength(12);
    for (const key of ["p10", "p25", "p50", "p75", "p90"] as const) {
      expect(last[key]).toBeCloseTo(expected, 6);
    }
    expect(totalContributed).toBe(1200);
  });

  it("keeps the percentiles ordered and widening with time", () => {
    const { points } = projectBalances({
      startValue: 10_000,
      mu: 0.005,
      sigma: 0.04,
      months: 120,
      monthlyContribution: 0,
    });
    for (const p of points) {
      expect(p.p10).toBeLessThanOrEqual(p.p25);
      expect(p.p25).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p75);
      expect(p.p75).toBeLessThanOrEqual(p.p90);
    }
    const spread = (i: number) => points[i].p90 - points[i].p10;
    expect(spread(119)).toBeGreaterThan(spread(11));
    // Median of a log-normal walk is close to exp(mu * months).
    expect(points[119].p50 / 10_000).toBeGreaterThan(Math.exp(0.6) * 0.85);
    expect(points[119].p50 / 10_000).toBeLessThan(Math.exp(0.6) * 1.15);
  });

  it("draws the same bands for the same seed", () => {
    const input = { startValue: 5000, mu: 0.004, sigma: 0.05, months: 24, monthlyContribution: 50 };
    expect(projectBalances(input)).toEqual(projectBalances(input));
    expect(projectBalances({ ...input, seed: 2 })).not.toEqual(projectBalances(input));
  });

  it("never projects a balance below zero", () => {
    const { points } = projectBalances({
      startValue: 1000,
      mu: 0,
      sigma: 0.02,
      months: 24,
      monthlyContribution: -200,
    });
    expect(points.at(-1)!.p90).toBe(0);
  });
});
