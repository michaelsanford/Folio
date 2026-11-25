import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { App } from "./App";
import { api } from "./services/api";
import { emitWriteConflict, notify } from "./services/notifications";
import type { BootstrapResponse } from "./types";

vi.mock("./components/common/LazyChart", () => ({
  LazyChart: () => <div data-testid="mock-chart" />,
}));

const bootstrap: BootstrapResponse = {
  accounts: [
    {
      id: "acc-1",
      name: "RBC Chequing",
      type: "CHECKING",
      currency: "CAD",
      current_balance: 5000,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
  categories: [],
  analytics: {
    current_net_worth: 5000,
    total_assets: 5000,
    total_liabilities: 0,
    monthly_cash_flow: { total_income: 0, total_expenses: 0, net_savings: 0, savings_rate: 0 },
    net_worth_history: [],
    category_spending: [],
    sankey: { nodes: [], links: [] },
  },
  household_members: [],
  limits: { max_upload_mb: 5 },
};

describe("App data loading", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api.auth, "getStatus").mockResolvedValue({
      authenticated: true,
      auth_required: true,
      auth_mode: "cognito",
      cognito_enabled: true,
    });
    vi.spyOn(api, "getBootstrap").mockResolvedValue(bootstrap);
    vi.spyOn(api, "getAccounts");
    vi.spyOn(api, "getCategories");
    vi.spyOn(api, "getDashboardAnalytics");
    vi.spyOn(api.household, "getMembers");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the shell with one bootstrap request and renders the lazy dashboard", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("RBC Chequing").length).toBeGreaterThan(0);
    });
    // The lazily loaded dashboard replaces the Suspense fallback
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });

    expect(api.getBootstrap).toHaveBeenCalledTimes(1);
    expect(api.getAccounts).not.toHaveBeenCalled();
    expect(api.getCategories).not.toHaveBeenCalled();
    expect(api.getDashboardAnalytics).not.toHaveBeenCalled();
    expect(api.household.getMembers).not.toHaveBeenCalled();
  });

  it("reloads everything and shows the notice after a vault conflict", async () => {
    render(<App />);
    await waitFor(() => expect(api.getBootstrap).toHaveBeenCalledTimes(1));

    act(() => {
      notify("The vault was changed elsewhere.", "warning");
      emitWriteConflict();
    });

    await waitFor(() => expect(api.getBootstrap).toHaveBeenCalledTimes(2));
    const region = screen
      .getAllByRole("status")
      .find((el) => el.getAttribute("aria-live") === "polite");
    expect(region?.textContent).toContain("The vault was changed elsewhere.");
  });
});
