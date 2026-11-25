import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { InvestmentsView, summarizeRefresh } from "./InvestmentsView";
import { ThemeProvider } from "../../context/ThemeContext";
import { api } from "../../services/api";
import type { Account, PerformanceResponse, QuoteRefreshResponse } from "../../types";

vi.mock("../common/LazyChart", () => ({
  LazyChart: () => <div data-testid="mock-chart" />,
}));

const mockAccount: Account = {
  id: "acc-tfsa-1",
  name: "TFSA Wealthsimple",
  type: "TFSA",
  currency: "CAD",
  current_balance: 10000,
  is_active: true,
  institution: "Wealthsimple",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockPerformance: PerformanceResponse = {
  account_id: "inv-1",
  as_of: "2026-10-25",
  market_value: 12500,
  cost_basis: 10000,
  unrealized_gain: 2500,

  contributions: 10000,
  withdrawals: 0,
  net_invested: 10000,
  market_growth: 2500,
  holdings: [
    {
      holding_id: "h1",
      security_id: "s1",
      symbol: "XEQT.TO",
      name: "iShares Core Equity ETF",
      asset_class: "ETF",
      quantity: "100",
      cost_basis: 2800,
      market_value: 3250,
      unrealized_gain: 450,
      unrealized_gain_pct: 16.07,
      price: 32.5,
      price_as_of: "2026-10-25",
      is_priced: true,

    },
  ],
  returns: {},
  unpriced_holdings: [],
};

const renderWithTheme = (ui: React.ReactElement) => {
  return render(
    <ThemeProvider defaultTheme="folio-emerald" defaultMode="dark">
      {ui}
    </ThemeProvider>
  );
};

const refreshResult = (overrides: Partial<QuoteRefreshResponse> = {}): QuoteRefreshResponse => ({
  updated_count: 2,
  failed_count: 0,
  quotes: [
    { symbol: "XEQT.TO", listing: "XEQT.TO", price: 32.5, currency: "CAD", as_of_date: "2026-10-25",
      source: "YAHOO", session: "REGULAR", quoted_at: null, previous_close: 32.1 },
    { symbol: "VFV.TO", listing: "VFV.TO", price: 145.2, currency: "CAD", as_of_date: "2026-10-25",
      source: "TMX", session: "REGULAR", quoted_at: null, previous_close: 144 },
  ],
  failed_symbols: [],
  failures: [],
  usdcad_fx_rate: 1.385,
  accounts_revalued: 1,
  skipped_count: 0,
  skipped_symbols: [],
  skipped_closed: [],
  skipped_recent: [],
  skipped_manual: [],
  timed_out: false,
  refreshed_at: "2026-10-25T14:42:00Z",
  ...overrides,
});

describe("InvestmentsView quotes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    vi.spyOn(api, "getPerformance").mockResolvedValue(mockPerformance);
    vi.spyOn(api, "getFxRate").mockResolvedValue({
      pair: "USDCAD",
      rate: 1.385,
      source: "Bank of Canada",
      as_of_date: "2026-10-25",
    });
    vi.spyOn(api, "fetchAutomatedQuotes").mockResolvedValue(refreshResult());
  });

  it("shows the Bank of Canada rate and explains the delayed-quote marker", async () => {
    renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={vi.fn()} />);
    expect(screen.getByText(/Delayed about 15 minutes/i)).toBeDefined();
    expect(screen.getByText(/Bank of Canada FX daily/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getAllByText("1.3850").length).toBeGreaterThan(0);
      expect(api.getFxRate).toHaveBeenCalledWith("USDCAD");
    });
  });

  it("refreshes quotes by itself once per session, quietly", async () => {
    const first = renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={vi.fn()} />);
    await waitFor(() => expect(api.fetchAutomatedQuotes).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Quotes updated/)).toBeDefined();
    expect(screen.queryByText(/^Updated 2/)).toBeNull();
    first.unmount();

    renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={vi.fn()} />);
    await screen.findByRole("heading", { name: "Holdings" });
    expect(api.fetchAutomatedQuotes).toHaveBeenCalledTimes(1);
    // The time of the last refresh survives the revisit.
    expect(screen.getByText(/Quotes updated/)).toBeDefined();
  });

  it("refreshes on demand and says exactly what happened", async () => {
    sessionStorage.setItem("folio.quotes.autoRefreshed", "1");
    vi.mocked(api.fetchAutomatedQuotes).mockResolvedValueOnce(
      refreshResult({
        skipped_closed: ["ZAG.TO"],
        failed_count: 1,
        failed_symbols: ["XYZ"],
        failures: [{ symbol: "XYZ", reason: "not found" }],
      })
    );
    const onDataModified = vi.fn();
    renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={onDataModified} />);
    fireEvent.click(screen.getByRole("button", { name: /Refresh quotes/i }));

    expect(
      await screen.findByText("Updated 2 (Yahoo 1, TMX 1) · Market closed: 1 · Couldn't quote: XYZ (not found)")
    ).toBeDefined();
    expect(onDataModified).toHaveBeenCalled();
  });

  it("reports a failed refresh", async () => {
    sessionStorage.setItem("folio.quotes.autoRefreshed", "1");
    vi.mocked(api.fetchAutomatedQuotes).mockRejectedValueOnce(new Error("Network connection failure"));
    renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Refresh quotes/i }));
    expect(await screen.findByText(/Network connection failure/i)).toBeDefined();
  });
});

describe("summarizeRefresh", () => {
  it("names skips by reason", () => {
    expect(
      summarizeRefresh(refreshResult({ quotes: [], updated_count: 0, skipped_recent: ["A"], skipped_manual: ["B"] }))
    ).toBe("Updated 0 · Already current: 1 · Priced by hand today: B");
  });
});
