/**
 * Number and money formatting for the whole UI.
 *
 * Conventions (negative style, separators, symbol placement) are a per-device
 * preference held in a small module-level store, so plain functions like
 * `formatMoney` work outside React. Components that must re-render on change
 * subscribe through `useFormatPrefs`.
 */

export type NegativeStyle = "minus" | "parentheses";
export type GroupSeparator = "," | "." | " " | "'" | "";
export type DecimalSeparator = "." | ",";
export type SymbolPosition = "before" | "after";
export type FormatPreset = "en-CA" | "fr-CA" | "accounting" | "custom";

export interface NumberFormatPrefs {
  preset: FormatPreset;
  negativeStyle: NegativeStyle;
  groupSeparator: GroupSeparator;
  decimalSeparator: DecimalSeparator;
  symbolPosition: SymbolPosition;
  symbolSpace: boolean;
}

export const FORMAT_PRESETS: Record<Exclude<FormatPreset, "custom">, { label: string; prefs: NumberFormatPrefs }> = {
  "en-CA": {
    label: "English (Canada)",
    prefs: { preset: "en-CA", negativeStyle: "minus", groupSeparator: ",", decimalSeparator: ".", symbolPosition: "before", symbolSpace: false },
  },
  "fr-CA": {
    label: "Français (Canada)",
    prefs: { preset: "fr-CA", negativeStyle: "minus", groupSeparator: " ", decimalSeparator: ",", symbolPosition: "after", symbolSpace: true },
  },
  accounting: {
    label: "Accounting (brackets)",
    prefs: { preset: "accounting", negativeStyle: "parentheses", groupSeparator: ",", decimalSeparator: ".", symbolPosition: "before", symbolSpace: false },
  },
};

export const DEFAULT_FORMAT_PREFS: NumberFormatPrefs = FORMAT_PRESETS["en-CA"].prefs;

const STORAGE_KEY = "folio-number-format";
const MINUS = "−";

const GROUPS: readonly GroupSeparator[] = [",", ".", " ", "'", ""];

/** Coerces any partial/unknown input into a valid, self-consistent prefs object. */
export const normalizePrefs = (input: Partial<NumberFormatPrefs> | null | undefined): NumberFormatPrefs => {
  const p = { ...DEFAULT_FORMAT_PREFS, ...(input ?? {}) };
  const prefs: NumberFormatPrefs = {
    preset: ["en-CA", "fr-CA", "accounting", "custom"].includes(p.preset) ? p.preset : "custom",
    negativeStyle: p.negativeStyle === "parentheses" ? "parentheses" : "minus",
    groupSeparator: GROUPS.includes(p.groupSeparator) ? p.groupSeparator : ",",
    decimalSeparator: p.decimalSeparator === "," ? "," : ".",
    symbolPosition: p.symbolPosition === "after" ? "after" : "before",
    symbolSpace: Boolean(p.symbolSpace),
  };
  // Group and decimal separators must differ or numbers become ambiguous.
  if (prefs.groupSeparator === prefs.decimalSeparator) {
    prefs.decimalSeparator = prefs.groupSeparator === "." ? "," : ".";
  }
  return prefs;
};

const load = (): NumberFormatPrefs => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? normalizePrefs(JSON.parse(raw)) : DEFAULT_FORMAT_PREFS;
  } catch {
    return DEFAULT_FORMAT_PREFS;
  }
};

let current: NumberFormatPrefs = load();
const listeners = new Set<() => void>();

export const getFormatPrefs = (): NumberFormatPrefs => current;

export const setFormatPrefs = (next: Partial<NumberFormatPrefs>): void => {
  current = normalizePrefs({ ...current, ...next });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: preference lasts for this session only */
  }
  listeners.forEach((l) => l());
};

export const subscribeFormatPrefs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Locale used for dates and month names, following the number preset. */
export const getDateLocale = (): string => (current.preset === "fr-CA" ? "fr-CA" : "en-CA");

// ---------------------------------------------------------------------------
// Core assembly
// ---------------------------------------------------------------------------

const symbols = new Map<string, string>();
const currencySymbol = (currency: string): string => {
  let s = symbols.get(currency);
  if (s === undefined) {
    try {
      const part = new Intl.NumberFormat("en-CA", { style: "currency", currency })
        .formatToParts(0)
        .find((x) => x.type === "currency");
      s = part?.value ?? currency;
    } catch {
      s = currency;
    }
    symbols.set(currency, s);
  }
  return s;
};

/** Groups and joins an absolute value: 48210.4 → "48,210.40" under en-CA. */
const formatDigits = (abs: number, minFrac: number, maxFrac: number, prefs: NumberFormatPrefs): string => {
  const fixed = abs.toLocaleString("en-US", {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
    useGrouping: false,
  });
  const [int, frac] = fixed.split(".");
  const grouped = prefs.groupSeparator ? int.replace(/\B(?=(\d{3})+(?!\d))/g, prefs.groupSeparator) : int;
  return frac ? `${grouped}${prefs.decimalSeparator}${frac}` : grouped;
};

const withSymbol = (body: string, symbol: string, prefs: NumberFormatPrefs): string => {
  const gap = prefs.symbolSpace ? " " : "";
  return prefs.symbolPosition === "before" ? `${symbol}${gap}${body}` : `${body}${gap}${symbol}`;
};

const withSign = (body: string, negative: boolean, signed: boolean, isPositive: boolean, prefs: NumberFormatPrefs): string => {
  if (negative) return prefs.negativeStyle === "parentheses" ? `(${body})` : `${MINUS}${body}`;
  if (signed && isPositive && prefs.negativeStyle === "minus") return `+${body}`;
  return body;
};

const safe = (v: number): number => (Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------------------
// Public formatters
// ---------------------------------------------------------------------------

export interface MoneyFormatOptions {
  /** Show cents. Defaults to true. */
  cents?: boolean;
  /** Prefix positive values with "+" (minus style only; accounting style never marks positives). */
  signed?: boolean;
  currency?: string;
}

/** Formats a major-unit amount, e.g. 48210.4 → "$48,210.40", "48 210,40 $" or "($48,210.40)". */
export const formatMoney = (value: number, opts: MoneyFormatOptions = {}, prefs: NumberFormatPrefs = current): string => {
  const { cents = true, signed = false, currency = "CAD" } = opts;
  const v = safe(value);
  const digits = cents ? 2 : 0;
  const body = withSymbol(formatDigits(Math.abs(v), digits, digits, prefs), currencySymbol(currency), prefs);
  // Rounding to zero should never show a sign.
  const rounded = Number(Math.abs(v).toFixed(digits));
  return withSign(body, v < 0 && rounded !== 0, signed, v > 0 && rounded !== 0, prefs);
};

/** Compact axis label, e.g. 48210 → "$48k". */
export const formatMoneyCompact = (value: number, currency = "CAD", prefs: NumberFormatPrefs = current): string => {
  const v = safe(value);
  const abs = Math.abs(v);
  let core: string;
  if (abs >= 1_000_000) core = `${formatDigits(abs / 1_000_000, 1, 1, prefs)}M`;
  else if (abs >= 1_000) core = `${formatDigits(Math.round(abs / 1_000), 0, 0, prefs)}k`;
  else core = formatDigits(Math.round(abs), 0, 0, prefs);
  return withSign(withSymbol(core, currencySymbol(currency), prefs), v < 0, false, false, prefs);
};

export const formatPercent = (value: number | null | undefined, signed = false, prefs: NumberFormatPrefs = current): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const frac = value % 1 === 0 ? 0 : 1;
  const gap = prefs.preset === "fr-CA" ? " " : "";
  const body = `${formatDigits(Math.abs(value), frac, frac, prefs)}${gap}%`;
  return withSign(body, value < 0, signed, value > 0, prefs);
};

/** Plain number with the user's separators, e.g. counts and share quantities. */
export const formatNumber = (value: number, maxFractionDigits = 0, prefs: NumberFormatPrefs = current): string => {
  const v = safe(value);
  const body = formatDigits(Math.abs(v), 0, maxFractionDigits, prefs);
  return v < 0 ? `${MINUS}${body}` : body;
};
