import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { InvestmentsView } from "./InvestmentsView";
import { ThemeProvider } from "../../context/ThemeContext";
import { api } from "../../services/api";
import type { Account, PerformanceResponse } from "../../types";

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

describe("InvestmentsView Automated Quotes and BoC FX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "getPerformance").mockResolvedValue(mockPerformance);
    vi.spyOn(api, "getFxRate").mockResolvedValue({
      pair: "USDCAD",
      rate: 1.385,
      source: "Bank of Canada",
      as_of_date: "2026-10-25",
    });
  });

  it("fetches and displays Bank of Canada FX rate badge and Canadian market context", async () => {
    renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={vi.fn()} />);

    // Check Canadian market coverage strip
    expect(screen.getByText(/Market Coverage:/i)).toBeDefined();
    expect(screen.getByText(/\.TO/i)).toBeDefined();
    expect(screen.getByText(/Bank of Canada Valet FX Daily/i)).toBeDefined();

    // Verify BoC FX rate badge loads
    await waitFor(() => {
      expect(screen.getAllByText("1.3850").length).toBeGreaterThan(0);
      expect(api.getFxRate).toHaveBeenCalledWith("USDCAD");
    });
  });

  it("renders Update Quotes (TSX / BoC) button and triggers automated quotes on click", async () => {
    const onDataModified = vi.fn();
    vi.spyOn(api, "fetchAutomatedQuotes").mockResolvedValueOnce({
      quotes_fetched: 2,
      updated_count: 2,
      failed_count: 0,
      quotes: [
        { symbol: "XEQT.TO", price: 32.5, currency: "CAD", as_of_date: "2026-10-25" },
        { symbol: "VFV.TO", price: 145.2, currency: "CAD", as_of_date: "2026-10-25" },
      ],
      failed_symbols: [],
      usdcad_fx_rate: 1.385,
      accounts_revalued: 1,
    });

    renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={onDataModified} />);

    const updateQuotesBtn = screen.getByRole("button", {
      name: /Update Quotes \(TSX \/ BoC\)/i,
    });
    expect(updateQuotesBtn).toBeDefined();

    fireEvent.click(updateQuotesBtn);

    await waitFor(() => {
      expect(api.fetchAutomatedQuotes).toHaveBeenCalled();
      expect(onDataModified).toHaveBeenCalled();
      expect(
        screen.getByText(/Automated quotes updated \(2 symbols\)\. Bank of Canada USD\/CAD: 1\.3850/i)
      ).toBeDefined();
    });
  });

  it("handles errors during automated quote fetching gracefully", async () => {
    vi.spyOn(api, "fetchAutomatedQuotes").mockRejectedValueOnce(
      new Error("Network connection failure")
    );

    renderWithTheme(<InvestmentsView accounts={[mockAccount]} onDataModified={vi.fn()} />);

    const updateQuotesBtn = screen.getByRole("button", {
      name: /Update Quotes \(TSX \/ BoC\)/i,
    });
    fireEvent.click(updateQuotesBtn);

    await waitFor(() => {
      expect(screen.getByText(/Network connection failure/i)).toBeDefined();
    });
  });
});
