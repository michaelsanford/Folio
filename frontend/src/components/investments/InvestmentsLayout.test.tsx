import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { InvestmentsView } from "./InvestmentsView";
import { ThemeProvider } from "../../context/ThemeContext";
import { api } from "../../services/api";
import type { Account, HoldingValuation, PerformanceResponse, ReturnHistoryResponse } from "../../types";

vi.mock("../common/LazyChart", () => ({
  LazyChart: () => <div data-testid="mock-chart" />,
}));

const account: Account = {
  id: "acc-1",
  name: "TFSA",
  type: "TFSA",
  currency: "CAD",
  current_balance: 10000,
  is_active: true,
  institution: "Wealthsimple",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const holding = (symbol: string, market_value: number): HoldingValuation => ({
  holding_id: symbol,
  security_id: symbol,
  symbol,
  asset_class: "ETF",
  quantity: "10",
  cost_basis: market_value,
  market_value,
  unrealized_gain: 0,
  unrealized_gain_pct: 0,
  price: 1,
  price_as_of: "2026-10-25",
  is_priced: true,
});

const performance: PerformanceResponse = {
  account_id: "acc-1",
  as_of: "2026-10-25",
  market_value: 10000,
  cost_basis: 10000,
  unrealized_gain: 0,
  contributions: 10000,
  withdrawals: 0,
  net_invested: 10000,
  market_growth: 0,
  holdings: [holding("SMALL", 2500), holding("BIG", 7500)],
  returns: { "1Y": { time_weighted: 5, money_weighted: 4 } },
  unpriced_holdings: [],
};

const history: ReturnHistoryResponse = {
  account_id: "acc-1",
  as_of: "2026-10-25",
  points: Array.from({ length: 8 }, (_, i) => ({
    month: `2026-0${i + 1}-28`,
    value: 9000 + i * 100,
    return_pct: i === 0 ? null : 0.01,
  })),
  months_of_history: 7,
  mean_monthly_log_return: 0.005,
  stdev_monthly_log_return: 0.03,
  annualized_return: 0.0617,
  annualized_volatility: 0.104,
  average_monthly_contribution: 250,
};

const renderView = () =>
  render(
    <ThemeProvider defaultTheme="folio-emerald" defaultMode="dark">
      <InvestmentsView accounts={[account]} onDataModified={vi.fn()} />
    </ThemeProvider>
  );

describe("InvestmentsView layout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getPerformance").mockResolvedValue(performance);
    vi.spyOn(api, "getFxRate").mockResolvedValue({ pair: "USDCAD", rate: null });
  });

  it("puts holdings first, then returns, then allocation", async () => {
    renderView();
    const holdings = await screen.findByRole("heading", { name: "Holdings" });
    const returns = screen.getByRole("heading", { name: "Returns" });
    const allocation = screen.getByRole("heading", { name: "Allocation by position" });
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(holdings, returns)).toBe(true);
    expect(follows(returns, allocation)).toBe(true);
    expect(screen.getByRole("heading", { name: "Allocation by asset class" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Gain and loss by position" })).toBeDefined();
  });

  it("lists the largest position first with its weight", async () => {
    renderView();
    await screen.findByRole("heading", { name: "Holdings" });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("BIG");
    expect(rows[0].textContent).toContain("75.0%");
    expect(rows[1].textContent).toContain("SMALL");
  });

  it("loads the projection only when it is opened", async () => {
    const getHistory = vi.spyOn(api, "getReturnHistory").mockResolvedValue(history);
    renderView();
    const summary = await screen.findByText("Projection");
    expect(getHistory).not.toHaveBeenCalled();

    const details = summary.closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() => expect(getHistory).toHaveBeenCalledWith("acc-1"));
    expect(await screen.findByText(/Median in 10 years/)).toBeDefined();
    // Defaults to the account's recent monthly saving.
    expect((screen.getByLabelText("Monthly contribution") as HTMLInputElement).value).toBe("250");

    fireEvent.click(screen.getByRole("radio", { name: "20 yr" }));
    expect(screen.getByText(/Median in 20 years/)).toBeDefined();
  });

  it("explains when there is not enough history to project", async () => {
    vi.spyOn(api, "getReturnHistory").mockResolvedValue({
      ...history,
      months_of_history: 2,
      mean_monthly_log_return: null,
      stdev_monthly_log_return: null,
    });
    renderView();
    const details = (await screen.findByText("Projection")).closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText(/needs at least 6 months/)).toBeDefined();
  });
});
