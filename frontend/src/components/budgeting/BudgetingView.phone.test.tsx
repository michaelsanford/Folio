import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import { BudgetingView } from "./BudgetingView";
import { ThemeProvider } from "../../context/ThemeContext";
import { api } from "../../services/api";
import { mockViewport } from "../../test/viewport";
import type { Budget, Category } from "../../types";

vi.mock("../common/LazyChart", () => ({
  LazyChart: () => <div data-testid="mock-chart" />,
}));

const groceries: Category = {
  id: "cat-groceries",
  parent_id: "cat-food",
  name: "Groceries and household supplies from the corner store",
  slug: "groceries",
  color: "#10B981",
  type: "EXPENSE",
  is_budgeted: true,
  is_rollover: false,
  sort_order: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const food: Category = { ...groceries, id: "cat-food", parent_id: null, name: "Food", slug: "food" };

const budget: Budget = {
  id: "budget-1",
  year: 2026,
  month: 11,
  total_income_target: 0,
  total_expense_target: 600,
  total_actual_income: 0,
  total_actual_expense: 450,
  items: [
    {
      category_id: "cat-groceries",
      planned_amount: 600,
      actual_amount: 450,
      remaining_amount: 150,
      rollover_amount: 25,
      available_amount: 625,
    },
  ],
};

const renderView = () =>
  render(
    <ThemeProvider defaultTheme="folio-emerald" defaultMode="dark">
      <BudgetingView categories={[groceries, food]} />
    </ThemeProvider>
  );

describe("Budget on a phone", () => {
  beforeEach(() => {
    mockViewport("phone");
    vi.spyOn(api, "getBudget").mockResolvedValue(budget);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows read-only envelopes with the full name and no row buttons", async () => {
    renderView();
    const list = await screen.findByTestId("budget-phone-list");
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(1);
    expect(within(list).getByText(groceries.name)).toBeDefined();
    expect(within(list).getByText("Food")).toBeDefined();
    expect(within(list).queryByTitle(/Remove|Rollover|View/)).toBeNull();
    expect(screen.queryByTitle("Table")).toBeNull();
    expect(document.querySelector("table")).toBeNull();
  });

  it("opens a sheet with the actions, and Remove still asks first", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const remove = vi.spyOn(api, "deleteBudgetItem").mockResolvedValue(undefined as never);
    renderView();
    const list = await screen.findByTestId("budget-phone-list");
    fireEvent.click(within(list).getByRole("button"));

    const sheet = screen.getByRole("dialog", { name: groceries.name });
    const labels = Array.from(sheet.querySelectorAll("li button")).map((b) => b.textContent);
    expect(labels[0]).toBe("Edit target");
    expect(labels[1]).toContain("Roll over unspent budget");
    expect(labels[labels.length - 1]).toBe("Remove from budget");

    fireEvent.click(within(sheet).getByRole("button", { name: "Remove from budget" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("budget-1", "cat-groceries"));
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("edits the target inside the sheet", async () => {
    const upsert = vi.spyOn(api, "upsertBudgetItem").mockResolvedValue({} as never);
    renderView();
    const list = await screen.findByTestId("budget-phone-list");
    fireEvent.click(within(list).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Edit target" }));
    const field = screen.getByLabelText("Monthly target");
    fireEvent.change(field, { target: { value: "700" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    fireEvent.submit(field.closest("form")!);
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), {
        category_id: "cat-groceries",
        planned_amount: 700,
      })
    );
  });
});

describe("Budget on a desktop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the table with its inline actions", async () => {
    mockViewport("desktop");
    vi.spyOn(api, "getBudget").mockResolvedValue(budget);
    renderView();
    await waitFor(() => expect(document.querySelector("table")).not.toBeNull());
    expect(screen.getByTitle("Remove category target from budget")).toBeDefined();
    expect(screen.queryByTestId("budget-phone-list")).toBeNull();
  });
});
