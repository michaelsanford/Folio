import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { App, startupPolicy } from "./App";
import { api, ApiError } from "./services/api";
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

describe("App start-up", () => {
  const HINT_KEY = "folio:signed-in";
  const signedIn = {
    authenticated: true,
    auth_required: true,
    auth_mode: "cognito" as const,
    cognito_enabled: true,
  };
  const signedOut = { ...signedIn, authenticated: false };
  const originalPolicy = { ...startupPolicy };

  beforeEach(() => {
    localStorage.clear();
    startupPolicy.baseDelayMs = 1;
    startupPolicy.maxDelayMs = 1;
    vi.spyOn(api, "getBootstrap").mockResolvedValue(bootstrap);
  });

  afterEach(() => {
    Object.assign(startupPolicy, originalPolicy);
    vi.restoreAllMocks();
  });

  it("draws the app at once when this browser was signed in, before the check answers", async () => {
    localStorage.setItem(HINT_KEY, JSON.stringify({ auth_mode: "cognito" }));
    let answer: (v: typeof signedIn) => void = () => {};
    vi.spyOn(api.auth, "getStatus").mockReturnValue(new Promise((r) => (answer = r)));

    render(<App />);
    // The shell (its navigation) is up while the session check is still pending.
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(api.getBootstrap).not.toHaveBeenCalled();

    await act(async () => answer(signedIn));
    await waitFor(() => expect(screen.getAllByText("RBC Chequing").length).toBeGreaterThan(0));
  });

  it("shows the mark, then says it is waking up, while a first check is slow", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(api.auth, "getStatus").mockReturnValue(new Promise(() => {}));
      render(<App />);
      expect(screen.getByAltText("Folio")).toBeDefined();
      expect(screen.queryByText("Folio is waking up…")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(screen.getByText("Folio is waking up…")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rides out a server that fails while starting, and never shows the sign-in screen for it", async () => {
    const status = vi
      .spyOn(api.auth, "getStatus")
      .mockRejectedValueOnce(new ApiError("Bad gateway", 502))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(signedIn);

    render(<App />);
    await waitFor(() => expect(screen.getAllByText("RBC Chequing").length).toBeGreaterThan(0));
    expect(status).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/Sign in with your invited account/)).toBeNull();
    expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? "null")).toEqual({ auth_mode: "cognito" });
  });

  it("says Folio isn't responding after the deadline, and tries again on request", async () => {
    startupPolicy.deadlineMs = 0;
    const status = vi.spyOn(api.auth, "getStatus").mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);
    expect(await screen.findByText("Folio isn’t responding.")).toBeDefined();
    expect(screen.queryByText(/Sign in with your invited account/)).toBeNull();

    status.mockResolvedValue(signedIn);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByText("RBC Chequing").length).toBeGreaterThan(0));
  });

  it("forgets the hint and shows the sign-in screen when the session has ended", async () => {
    localStorage.setItem(HINT_KEY, JSON.stringify({ auth_mode: "cognito" }));
    vi.spyOn(api.auth, "getStatus").mockResolvedValue(signedOut);

    render(<App />);
    expect(await screen.findByText(/Sign in with your invited account/)).toBeDefined();
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
    expect(api.getBootstrap).not.toHaveBeenCalled();
  });
});
