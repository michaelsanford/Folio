import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { AppLayout } from "./AppLayout";
import { ThemeProvider } from "../../context/ThemeContext";
import type { Account, HouseholdMember } from "../../types";
import { mockViewport } from "../../test/viewport";

const mockAccounts: Account[] = [
  {
    id: "acc-1",
    name: "Main Checking",
    type: "CHECKING",
    institution: "RBC",
    account_number_mask: "*1234",
    currency: "CAD",
    current_balance: 2500,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockMembers: HouseholdMember[] = [
  {
    id: "mem-1",
    name: "Alex",
    role: "Owner",
    color: "#3fae86",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

describe("AppLayout Collapsible Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderLayout = (props?: {
    onTabChange?: (tab: any) => void;
    onManageHousehold?: () => void;
    householdMembers?: HouseholdMember[];
  }) =>
    render(
      <ThemeProvider>
        <AppLayout
          activeTab="dashboard"
          onTabChange={props?.onTabChange ?? vi.fn()}
          accounts={mockAccounts}
          householdMembers={props?.householdMembers ?? mockMembers}
          onManageHousehold={props?.onManageHousehold ?? vi.fn()}
        >
          <div>Main View</div>
        </AppLayout>
      </ThemeProvider>
    );

  it("renders expanded by default with icons+labels, net worth snapshot, and enlarged icons", () => {
    renderLayout();

    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    expect(sidebar.className).toContain("w-64");

    const inside = within(sidebar);
    expect(inside.getByText("Folio")).toBeDefined();
    expect(inside.getByText("Net worth")).toBeDefined();
    expect(inside.getByText("Dashboard")).toBeDefined();
    expect(inside.getByText("Ledger")).toBeDefined();

    const ledgerBtn = inside.getByRole("button", { name: "Ledger" });
    const ledgerSvg = ledgerBtn.querySelector("svg");
    expect(ledgerSvg?.getAttribute("class")).toContain("w-[22px]");
    expect(ledgerSvg?.getAttribute("class")).toContain("h-[22px]");
  });

  it("collapses to icon-only mode, enlarges icons to w-6 h-6, persists state, and expands back", () => {
    const onTabChange = vi.fn();
    renderLayout({ onTabChange });

    const sidebar = screen.getByTestId("desktop-sidebar");
    const inside = within(sidebar);

    fireEvent.click(inside.getByRole("button", { name: "Collapse sidebar" }));

    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    expect(sidebar.className).toContain("w-[72px]");
    expect(localStorage.getItem("folio-sidebar-collapsed")).toBe("true");

    // Text labels and Net worth snapshot are hidden in icon-only mode
    expect(inside.queryByText("Net worth")).toBeNull();
    expect(inside.queryByText("Dashboard")).toBeNull();
    expect(inside.queryByText("Ledger")).toBeNull();

    // Collapsed nav buttons keep accessible aria-label + title tooltips and enlarged w-6 h-6 icons
    const collapsedLedgerBtn = inside.getByRole("button", { name: "Ledger" });
    expect(collapsedLedgerBtn.getAttribute("title")).toBe("Ledger");
    const collapsedSvg = collapsedLedgerBtn.querySelector("svg");
    expect(collapsedSvg?.getAttribute("class")).toContain("w-6");
    expect(collapsedSvg?.getAttribute("class")).toContain("h-6");

    fireEvent.click(collapsedLedgerBtn);
    expect(onTabChange).toHaveBeenCalledWith("ledger");

    // Expand back to icons + labels
    fireEvent.click(inside.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    expect(sidebar.className).toContain("w-64");
    expect(localStorage.getItem("folio-sidebar-collapsed")).toBe("false");
    expect(inside.getByText("Net worth")).toBeDefined();
    expect(inside.getByText("Ledger")).toBeDefined();
  });

  it("initializes collapsed from localStorage and keeps utility buttons interactive", () => {
    localStorage.setItem("folio-sidebar-collapsed", "true");
    const onManageHousehold = vi.fn();
    renderLayout({ onManageHousehold });

    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    const inside = within(sidebar);

    // Household button clickable in collapsed mode
    const householdBtn = inside.getByRole("button", { name: "Manage household" });
    fireEvent.click(householdBtn);
    expect(onManageHousehold).toHaveBeenCalledTimes(1);

    // Colour mode toggle clickable in collapsed mode
    const modeBtn = inside.getByRole("button", { name: "Toggle colour mode" });
    fireEvent.click(modeBtn);
    expect(["light", "dark"]).toContain(localStorage.getItem("folio-color-mode"));

    // Appearance button opens theme modal from collapsed mode
    const appearanceBtn = inside.getByRole("button", { name: "Appearance" });
    fireEvent.click(appearanceBtn);
    expect(screen.getByText("Appearance")).toBeDefined();
  });

  it("renders a Sign out button when onSignOut is provided and invokes it on click", () => {
    const onSignOut = vi.fn();
    render(
      <ThemeProvider>
        <AppLayout
          activeTab="dashboard"
          onTabChange={vi.fn()}
          accounts={mockAccounts}
          householdMembers={mockMembers}
          onManageHousehold={vi.fn()}
          onSignOut={onSignOut}
        >
          <div>Main View</div>
        </AppLayout>
      </ThemeProvider>
    );

    const sidebar = screen.getByTestId("desktop-sidebar");
    const signOutBtn = within(sidebar).getByRole("button", { name: "Sign out" });
    fireEvent.click(signOutBtn);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("Sidebar on a tablet", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  const renderTablet = () =>
    render(
      <ThemeProvider>
        <AppLayout activeTab="dashboard" onTabChange={vi.fn()} accounts={mockAccounts}>
          <div>Main View</div>
        </AppLayout>
      </ThemeProvider>
    );

  it("starts as the narrow rail when nothing is stored", () => {
    mockViewport("tablet");
    renderTablet();
    expect(screen.getByTestId("desktop-sidebar").getAttribute("data-collapsed")).toBe("true");
  });

  it("keeps a stored choice to show the full sidebar", () => {
    mockViewport("tablet");
    localStorage.setItem("folio-sidebar-collapsed", "false");
    renderTablet();
    expect(screen.getByTestId("desktop-sidebar").getAttribute("data-collapsed")).toBe("false");
  });

  it("starts expanded on a desktop", () => {
    mockViewport("desktop");
    renderTablet();
    expect(screen.getByTestId("desktop-sidebar").getAttribute("data-collapsed")).toBe("false");
  });
});
