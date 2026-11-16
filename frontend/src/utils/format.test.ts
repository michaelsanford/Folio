import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FORMAT_PREFS,
  FORMAT_PRESETS,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  formatPercent,
  getDateLocale,
  getFormatPrefs,
  normalizePrefs,
  setFormatPrefs,
  subscribeFormatPrefs,
  type NumberFormatPrefs,
} from "./format";

const NBSP = " ";
const MINUS = "−";
const enCA = FORMAT_PRESETS["en-CA"].prefs;
const frCA = FORMAT_PRESETS["fr-CA"].prefs;
const accounting = FORMAT_PRESETS.accounting.prefs;
const custom = (p: Partial<NumberFormatPrefs>) => normalizePrefs({ ...enCA, preset: "custom", ...p });

afterEach(() => setFormatPrefs(DEFAULT_FORMAT_PREFS));

describe("formatMoney", () => {
  it("defaults to en-CA with a true minus sign", () => {
    expect(formatMoney(48210.4)).toBe("$48,210.40");
    expect(formatMoney(-1234.56)).toBe(`${MINUS}$1,234.56`);
    expect(formatMoney(12.5, { signed: true })).toBe("+$12.50");
    expect(formatMoney(1234.56, { cents: false })).toBe("$1,235");
  });

  it("formats French Canadian style", () => {
    expect(formatMoney(1234.56, {}, frCA)).toBe(`1${NBSP}234,56${NBSP}$`);
    expect(formatMoney(-1234.56, {}, frCA)).toBe(`${MINUS}1${NBSP}234,56${NBSP}$`);
  });

  it("brackets negatives in accounting style and never marks positives", () => {
    expect(formatMoney(-1234.56, {}, accounting)).toBe("($1,234.56)");
    expect(formatMoney(5, { signed: true }, accounting)).toBe("$5.00");
  });

  it("honours custom separators and symbol spacing", () => {
    expect(formatMoney(1234567.8, {}, custom({ groupSeparator: "'" }))).toBe("$1'234'567.80");
    expect(formatMoney(1234.5, {}, custom({ groupSeparator: "" }))).toBe("$1234.50");
    expect(formatMoney(1234.5, {}, custom({ symbolSpace: true }))).toBe(`$${NBSP}1,234.50`);
    expect(formatMoney(1234.5, {}, custom({ groupSeparator: ".", decimalSeparator: "," }))).toBe("$1.234,50");
  });

  it("treats non-finite and rounds-to-zero values as unsigned zero", () => {
    expect(formatMoney(Number.NaN)).toBe("$0.00");
    expect(formatMoney(-0.001)).toBe("$0.00");
    expect(formatMoney(-0.001, {}, accounting)).toBe("$0.00");
  });

  it("uses the currency's own symbol", () => {
    expect(formatMoney(10, { currency: "USD" })).toBe("US$10.00");
  });
});

describe("normalizePrefs", () => {
  it("keeps group and decimal separators distinct", () => {
    expect(normalizePrefs({ groupSeparator: ".", decimalSeparator: "." }).decimalSeparator).toBe(",");
    expect(normalizePrefs({ groupSeparator: ",", decimalSeparator: "," }).decimalSeparator).toBe(".");
  });

  it("falls back to defaults for junk input", () => {
    const p = normalizePrefs({ groupSeparator: "x" as never, negativeStyle: "weird" as never });
    expect(p.groupSeparator).toBe(",");
    expect(p.negativeStyle).toBe("minus");
  });
});

describe("other formatters", () => {
  it("compacts axis labels with the user's conventions", () => {
    expect(formatMoneyCompact(48210)).toBe("$48k");
    expect(formatMoneyCompact(-2_500_000)).toBe(`${MINUS}$2.5M`);
    expect(formatMoneyCompact(-2_500_000, "CAD", frCA)).toBe(`${MINUS}2,5M${NBSP}$`);
    expect(formatMoneyCompact(-480, "CAD", accounting)).toBe("($480)");
  });

  it("formats percentages", () => {
    expect(formatPercent(4.5)).toBe("4.5%");
    expect(formatPercent(-3, true)).toBe(`${MINUS}3%`);
    expect(formatPercent(4.5, false, frCA)).toBe(`4,5${NBSP}%`);
    expect(formatPercent(null)).toBe("—");
  });

  it("formats plain numbers", () => {
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(1.23456789, 8, frCA)).toBe("1,23456789");
  });
});

describe("preference store", () => {
  it("notifies subscribers, persists and drives the date locale", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFormatPrefs(listener);
    setFormatPrefs(frCA);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getFormatPrefs().preset).toBe("fr-CA");
    expect(getDateLocale()).toBe("fr-CA");
    expect(JSON.parse(localStorage.getItem("folio-number-format")!).decimalSeparator).toBe(",");
    expect(formatMoney(1)).toBe(`1,00${NBSP}$`);
    unsubscribe();
  });
});
