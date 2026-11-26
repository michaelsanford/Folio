import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { AppLayout } from "./AppLayout";
import { ThemeProvider } from "../../context/ThemeContext";

const renderLayout = (updateReady: boolean, onApplyUpdate = vi.fn(), updating = false) =>
  render(
    <ThemeProvider>
      <AppLayout
        activeTab="dashboard"
        onTabChange={vi.fn()}
        accounts={[]}
        updateReady={updateReady}
        updating={updating}
        onApplyUpdate={onApplyUpdate}
      >
        <div>Main View</div>
      </AppLayout>
    </ThemeProvider>
  );

describe("AppLayout update-available item", () => {
  beforeEach(() => localStorage.clear());

  it("is hidden when no update is waiting", () => {
    renderLayout(false);
    expect(screen.queryByText("Update available")).toBeNull();
    expect(screen.queryByRole("button", { name: /update available/i })).toBeNull();
  });

  it("shows a prominent item at the top of the expanded sidebar and reloads on click", () => {
    const onApplyUpdate = vi.fn();
    renderLayout(true, onApplyUpdate);
    const sidebar = within(screen.getByTestId("desktop-sidebar"));
    const item = sidebar.getByRole("button", { name: /update available/i });
    expect(item.textContent).toContain("Reload to update");
    // Above the net-worth card, so it is the first thing under the wordmark.
    const netWorth = sidebar.getByText("Net worth");
    expect(item.compareDocumentPosition(netWorth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(item);
    expect(onApplyUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps an icon button when the sidebar is collapsed", () => {
    const onApplyUpdate = vi.fn();
    renderLayout(true, onApplyUpdate);
    const sidebar = within(screen.getByTestId("desktop-sidebar"));
    fireEvent.click(sidebar.getByRole("button", { name: "Collapse sidebar" }));
    const button = sidebar.getByRole("button", { name: "Update available. Reload" });
    fireEvent.click(button);
    expect(onApplyUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows in the mobile header and at the top of the mobile menu", () => {
    const onApplyUpdate = vi.fn();
    renderLayout(true, onApplyUpdate);
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: "Update available. Reload" }));
    fireEvent.click(within(header).getByRole("button", { name: "Toggle navigation menu" }));
    const menuItems = screen.getAllByText("Reload to update");
    // Sidebar item plus the mobile-menu item.
    expect(menuItems).toHaveLength(2);
    fireEvent.click(menuItems[1]);
    expect(onApplyUpdate).toHaveBeenCalledTimes(2);
  });

  it("shows that the update is under way and ignores further clicks", () => {
    const onApplyUpdate = vi.fn();
    renderLayout(true, onApplyUpdate, true);
    const sidebar = within(screen.getByTestId("desktop-sidebar"));
    const item = sidebar.getByRole("button", { name: /updating/i });
    expect(item.textContent).toContain("Folio will reload");
    expect(item).toHaveProperty("disabled", true);
    expect(item.getAttribute("aria-busy")).toBe("true");
    const header = within(screen.getByRole("banner"));
    const headerButton = header.getByRole("button", { name: "Updating Folio. It will reload" });
    expect(headerButton).toHaveProperty("disabled", true);
    fireEvent.click(item);
    fireEvent.click(headerButton);
    expect(onApplyUpdate).not.toHaveBeenCalled();
  });
});

describe("AppLayout brand icon", () => {
  it("uses the Folio app icon in the sidebar and mobile header", () => {
    const { container } = renderLayout(false);
    const marks = container.querySelectorAll('img[src="/folio-icon.svg"]');
    // Expanded desktop sidebar wordmark + mobile header wordmark.
    expect(marks.length).toBe(2);
  });
});
