/**
 * One money format for the whole UI: Canadian dollars, en-CA grouping.
 * Formatters are cached per (currency, cents) because Intl construction is
 * comparatively expensive and these run for every ledger row.
 */
const formatters = new Map<string, Intl.NumberFormat>();

const getFormatter = (currency: string, cents: boolean): Intl.NumberFormat => {
  const key = `${currency}:${cents}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
    formatters.set(key, fmt);
  }
  return fmt;
};

export interface MoneyFormatOptions {
  /** Show cents. Defaults to true. */
  cents?: boolean;
  /** Prefix positive values with "+". */
  signed?: boolean;
  currency?: string;
}

/** Formats a major-unit amount, e.g. 48210.4 → "$48,210.40". Negatives use a true minus sign. */
export const formatMoney = (value: number, opts: MoneyFormatOptions = {}): string => {
  const { cents = true, signed = false, currency = "CAD" } = opts;
  const safe = Number.isFinite(value) ? value : 0;
  const body = getFormatter(currency, cents).format(Math.abs(safe));
  if (safe < 0) return `−${body}`;
  if (signed && safe > 0) return `+${body}`;
  return body;
};

/** Compact axis label, e.g. 48210 → "$48k". */
export const formatMoneyCompact = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
};

export const formatPercent = (value: number | null | undefined, signed = false): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const body = `${Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}%`;
  if (value < 0) return `−${body}`;
  return signed && value > 0 ? `+${body}` : body;
};
