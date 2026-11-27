import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    // Skip the once-per-session refresh; tests that want it clear this.
    sessionStorage.setItem("folio.quotes.autoRefreshed", "1");
    vi.spyOn(api, "getPerformance").mockResolvedValue(performance);
    vi.spyOn(api, "getFxRate").mockResolvedValue({ pair: "USDCAD", rate: null });
    vi.spyOn(api, "fetchAutomatedQuotes").mockResolvedValue({} as never);
    vi.spyOn(api, "lookupSymbol").mockResolvedValue({ query: "XEQT", found: false });
  });

  it("runs ticker, value tiles, holdings, returns, then allocation", async () => {
    renderView();
    const holdings = await screen.findByRole("heading", { name: "Holdings" });
    const ticker = screen.getByRole("list", { name: "Holdings ticker" });
    const tiles = screen.getAllByText("Market value").find((el) => el.tagName !== "TH")!;
    const returns = screen.getByRole("heading", { name: "Returns" });
    const allocation = screen.getByRole("heading", { name: "Allocation by position" });
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(ticker, tiles)).toBe(true);
    expect(follows(tiles, holdings)).toBe(true);
    expect(follows(holdings, returns)).toBe(true);
    expect(follows(returns, allocation)).toBe(true);
    expect(screen.getByRole("heading", { name: "Allocation by asset class" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Gain and loss by position" })).toBeDefined();
  });

  it("lists the largest position first with its weight", async () => {
    renderView();
    await screen.findByRole("heading", { name: "Holdings" });
    const rows = screen.getAllByRole("row").filter((r) => r.closest("tbody") && r.textContent?.includes("%")).slice(0, 2);
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

describe("quote markers and ticker", () => {
  const priced = (overrides: Partial<HoldingValuation>): HoldingValuation => ({
    ...holding("XEQT.TO", 4317),
    price: 43.17,
    price_as_of: "2026-11-24",
    ...overrides,
  });

  const renderWith = (holdings: HoldingValuation[]) => {
    vi.spyOn(api, "getPerformance").mockResolvedValue({ ...performance, holdings });
    return renderView();
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.setItem("folio.quotes.autoRefreshed", "1");
    vi.spyOn(api, "getFxRate").mockResolvedValue({ pair: "USDCAD", rate: null });
  });

  it("marks delayed, extended-hours and hand-entered prices differently", async () => {
    renderWith([
      priced({ holding_id: "a", symbol: "XEQT.TO", price_source: "YAHOO", price_session: "REGULAR" }),
      priced({ holding_id: "b", symbol: "AAPL", price_source: "YAHOO", price_session: "POST", previous_close: 354.07 }),
      priced({ holding_id: "c", symbol: "PRIV", price_source: "MANUAL" }),
    ]);
    await screen.findByRole("heading", { name: "Holdings" });
    expect(within(document.body).getAllByTitle(/^Delayed quote · Yahoo Finance/).length).toBeGreaterThan(0);
    expect(within(document.body).getAllByTitle(/^After-hours quote/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Close \$354\.07/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Entered Nov 24").length).toBeGreaterThan(0);
  });

  it("ticker shows the day's change and hides its loop copy from screen readers", async () => {
    renderWith([
      priced({ holding_id: "a", symbol: "XEQT.TO", price_source: "YAHOO", day_change: -0.41, day_change_pct: -0.94 }),
      priced({ holding_id: "b", symbol: "VFV.TO", price_source: "TMX", day_change: 1.2, day_change_pct: 0.83 }),
      priced({ holding_id: "c", symbol: "ZAG.TO", price_source: "YAHOO", day_change: 0, day_change_pct: 0 }),
    ]);
    const ticker = await screen.findByRole("list", { name: "Holdings ticker" });
    const changes = within(ticker).getAllByText((_, el) => el?.tagName === "SPAN" && /%\)$/.test(el.textContent ?? ""));
    expect(changes[0].textContent).toMatch(/−\$0\.41 \(−0\.9%\)$/);
    expect(changes[0].className).toContain("text-negative");
    expect(changes[1].textContent).toMatch(/\+\$1\.20 \(\+0\.8%\)$/);
    expect(changes[1].className).toContain("text-positive");
    const copy = ticker.nextElementSibling as HTMLElement;
    expect(copy.getAttribute("aria-hidden")).toBe("true");
  });

  it("holds still with fewer than three holdings", async () => {
    renderWith([priced({ holding_id: "a", price_source: "YAHOO" })]);
    const ticker = await screen.findByRole("list", { name: "Holdings ticker" });
    expect(ticker.nextElementSibling).toBeNull();
    expect(ticker.closest(".ticker-viewport")?.getAttribute("data-static")).toBe("true");
  });

  it("previews the listing a typed symbol resolves to", async () => {
    vi.spyOn(api, "getPerformance").mockResolvedValue(performance);
    vi.spyOn(api, "lookupSymbol").mockResolvedValue({
      query: "XEQT", found: true, listing: "XEQT.TO", name: "iShares Core Equity ETF Portfolio",
      exchange: "TOR", currency: "CAD", price: 43.17, source: "YAHOO", session: "REGULAR",
    });
    const create = vi.spyOn(api, "createHolding").mockResolvedValue({} as never);
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /Add holding/ }));
    fireEvent.change(screen.getByPlaceholderText("VFV or VFV.TO"), { target: { value: "xeqt" } });
    await waitFor(() => expect(api.lookupSymbol).toHaveBeenCalledWith("xeqt", "CAD"), { timeout: 2000 });
    await waitFor(() =>
      expect((screen.getByLabelText("Name (optional)") as HTMLInputElement).value).toBe(
        "iShares Core Equity ETF Portfolio"
      )
    );
    expect(document.getElementById("symbol-lookup")?.textContent).toContain("XEQT → XEQT.TO");

    fireEvent.change(screen.getByPlaceholderText("100"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("10000.00"), { target: { value: "40" } });
    fireEvent.submit(screen.getByPlaceholderText("100").closest("form")!);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].symbol).toBe("XEQT.TO");
  });
});

describe("InvestmentsView holdings on a phone", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.setItem("folio.quotes.autoRefreshed", "1");
    vi.spyOn(api, "getPerformance").mockResolvedValue(performance);
    vi.spyOn(api, "getFxRate").mockResolvedValue({ pair: "USDCAD", rate: null });
    vi.spyOn(api, "fetchAutomatedQuotes").mockResolvedValue({} as never);
  });

  it("keeps phone cards read-only and offers Remove in the holding's sheet", async () => {
    const remove = vi.spyOn(api, "deleteHolding").mockResolvedValue(undefined as never);
    renderView();
    const more = await screen.findByRole("button", { name: "BIG: details and actions" });
    // The phone list has no inline Remove; the table (tablet and desktop) keeps it.
    const phoneList = screen.getByTestId("holdings-phone-list");
    expect(within(phoneList).queryByRole("button", { name: /Remove/ })).toBeNull();

    fireEvent.click(more);
    const sheet = screen.getByRole("dialog", { name: "BIG" });
    expect(within(sheet).getByText("Market value")).toBeDefined();
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove BIG" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("BIG"));
  });
});
