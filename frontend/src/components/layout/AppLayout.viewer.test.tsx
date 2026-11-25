import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { AppLayout } from "./AppLayout";
import { ThemeProvider } from "../../context/ThemeContext";
import { clearSession, setSession } from "../../utils/session";

const renderLayout = () =>
  render(
    <ThemeProvider>
      <AppLayout activeTab="dashboard" onTabChange={vi.fn()} accounts={[]} householdMembers={[]} onManageHousehold={vi.fn()}>
        <div>Main View</div>
      </AppLayout>
    </ThemeProvider>
  );

describe("AppLayout for a view-only person", () => {
  afterEach(() => clearSession());

  it("leaves out Import and Rules", () => {
    setSession(
      { user_key: "k", role: "VIEWER", can_edit: false, is_owner: false, can_manage_people: false },
      []
    );
    renderLayout();
    expect(screen.queryAllByText("Import")).toHaveLength(0);
    expect(screen.queryAllByText("Rules")).toHaveLength(0);
    expect(screen.getAllByText("Ledger").length).toBeGreaterThan(0);
  });

  it("shows them to editors", () => {
    renderLayout();
    expect(screen.getAllByText("Import").length).toBeGreaterThan(0);
  });
});
