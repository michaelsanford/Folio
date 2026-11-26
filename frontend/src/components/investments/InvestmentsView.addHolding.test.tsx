import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { InvestmentsView } from "./InvestmentsView";
import { ThemeProvider } from "../../context/ThemeContext";
import { api } from "../../services/api";
import type { Account, HoldingValuation, PerformanceResponse, SymbolLookupResponse } from "../../types";

vi.mock("../common/LazyChart", () => ({
  LazyChart: () => <div data-testid="mock-chart" />,
}));

const account: Account = {
  id: "acc-tfsa",
  name: "TFSA",
  type: "TFSA",
  currency: "CAD",
  current_balance: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const emptyPerformance: PerformanceResponse = {
  account_id: "acc-tfsa",
  as_of: "2026-11-26",
  market_value: 0,
  cost_basis: 0,
  unrealized_gain: 0,
  contributions: 0,
  withdrawals: 0,
  net_invested: 0,
  market_growth: 0,
  holdings: [],
  returns: {},
  unpriced_holdings: [],
};

const vfv: SymbolLookupResponse = {
  query: "VFV",
  found: true,
  listing: "VFV.TO",
  name: "Vanguard S&P 500 Index ETF",
  exchange: "TSX",
  currency: "CAD",
  price: 160.25,
  source: "YAHOO",
  session: "REGULAR",
};

const renderView = (props: Partial<React.ComponentProps<typeof InvestmentsView>> = {}) =>
  render(
    <ThemeProvider defaultTheme="folio-emerald" defaultMode="dark">
      <InvestmentsView accounts={[account]} onDataModified={vi.fn()} {...props} />
    </ThemeProvider>
  );

async function openAddHolding(symbol = "VFV") {
  fireEvent.click(await screen.findByRole("button", { name: /Add holding/i }));
  fireEvent.change(screen.getByPlaceholderText("VFV or VFV.TO"), { target: { value: symbol } });
}

const nameField = () => screen.getByLabelText("Name (optional)") as HTMLInputElement;
const priceField = () => screen.getByLabelText("Price today") as HTMLInputElement;

describe("Add holding form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.setItem("folio.quotes.autoRefreshed", "1");
    vi.spyOn(api, "getPerformance").mockResolvedValue(emptyPerformance);
    vi.spyOn(api, "getFxRate").mockResolvedValue({ pair: "USDCAD", rate: null });
    vi.spyOn(api, "lookupSymbol").mockResolvedValue(vfv);
    vi.spyOn(api, "createHolding").mockResolvedValue({} as HoldingValuation);
  });

  it("fills Name and Price from the lookup and works out the market value", async () => {
    renderView();
    await openAddHolding();
    await waitFor(() => expect(nameField().value).toBe("Vanguard S&P 500 Index ETF"), { timeout: 2000 });
    expect(priceField().value).toBe("160.25");

    fireEvent.change(screen.getByPlaceholderText("100"), { target: { value: "10" } });
    expect(screen.getByTestId("new-holding-value").textContent).toContain("1,602.50");
  });

  it("saves the looked-up price with its source so the holding is priced at once", async () => {
    renderView();
    await openAddHolding();
    await waitFor(() => expect(priceField().value).toBe("160.25"), { timeout: 2000 });
    fireEvent.change(screen.getByPlaceholderText("100"), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText("10000.00"), { target: { value: "1400" } });
    fireEvent.submit(screen.getByPlaceholderText("100").closest("form")!);

    await waitFor(() => expect(api.createHolding).toHaveBeenCalled());
    expect(api.createHolding).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "VFV.TO",
        name: "Vanguard S&P 500 Index ETF",
        price: "160.25",
        price_source: "YAHOO",
        price_session: "REGULAR",
      })
    );
  });

  it("keeps what the person typed and saves a typed price as manual", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /Add holding/i }));
    fireEvent.change(nameField(), { target: { value: "My S&P fund" } });
    fireEvent.change(priceField(), { target: { value: "158" } });
    fireEvent.change(screen.getByPlaceholderText("VFV or VFV.TO"), { target: { value: "VFV" } });
    await waitFor(() => expect(api.lookupSymbol).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(() => expect(document.getElementById("symbol-lookup")?.textContent).toContain("VFV.TO"));
    expect(nameField().value).toBe("My S&P fund");
    expect(priceField().value).toBe("158");

    fireEvent.change(screen.getByPlaceholderText("100"), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText("10000.00"), { target: { value: "1400" } });
    fireEvent.submit(screen.getByPlaceholderText("100").closest("form")!);
    await waitFor(() => expect(api.createHolding).toHaveBeenCalled());
    expect(api.createHolding).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My S&P fund", price: "158", price_source: "MANUAL" })
    );
  });

  it("offers Import holdings, which opens the Import screen", async () => {
    const onImportHoldings = vi.fn();
    renderView({ onImportHoldings });
    fireEvent.click(await screen.findByRole("button", { name: /Import holdings/i }));
    expect(onImportHoldings).toHaveBeenCalledTimes(1);
  });
});
