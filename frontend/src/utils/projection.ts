/**
 * Monte Carlo projection of an investment balance.
 *
 * Each simulated month multiplies the balance by exp(N(mu, sigma)), using the
 * account's own monthly log-return mean and spread, then adds the monthly
 * contribution. Percentiles across the paths give the error bands. A seeded
 * generator means the same inputs always draw the same bands, so the chart
 * does not shimmer when it re-renders.
 */

export interface ProjectionInput {
  startValue: number;
  /** Mean monthly log return. */
  mu: number;
  /** Standard deviation of monthly log returns. */
  sigma: number;
  months: number;
  monthlyContribution: number;
  paths?: number;
  seed?: number;
}

export interface ProjectionPoint {
  /** Months from today (1 = one month out). */
  month: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface Projection {
  points: ProjectionPoint[];
  /** Money added over the horizon (contributions only, no growth). */
  totalContributed: number;
}

/** mulberry32: small, fast, good enough for drawing chart bands. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws (Box–Muller, both halves used). */
function normalSource(random: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = random();
    const v = random();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/** Linear-interpolated percentile of an ascending-sorted array. */
function percentile(sorted: Float64Array, p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function projectBalances({
  startValue,
  mu,
  sigma,
  months,
  monthlyContribution,
  paths = 1000,
  seed = 1,
}: ProjectionInput): Projection {
  const n = Math.max(1, Math.floor(paths));
  const horizon = Math.max(0, Math.floor(months));
  const normal = normalSource(mulberry32(seed));

  const balances = new Float64Array(n).fill(startValue);
  const column = new Float64Array(n);
  const points: ProjectionPoint[] = [];

  for (let m = 1; m <= horizon; m++) {
    for (let i = 0; i < n; i++) {
      const grown = balances[i] * Math.exp(mu + sigma * normal()) + monthlyContribution;
      // A withdrawal plan can drain an account; it cannot go below empty.
      balances[i] = grown > 0 ? grown : 0;
    }
    column.set(balances);
    column.sort();
    points.push({
      month: m,
      p10: percentile(column, 0.1),
      p25: percentile(column, 0.25),
      p50: percentile(column, 0.5),
      p75: percentile(column, 0.75),
      p90: percentile(column, 0.9),
    });
  }

  return { points, totalContributed: monthlyContribution * horizon };
}
