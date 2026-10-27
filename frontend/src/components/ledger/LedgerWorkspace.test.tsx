import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { LedgerWorkspace } from "./LedgerWorkspace";
import { api } from "../../services/api";
import type { Account, Category, HouseholdMember, Transaction } from "../../types";

const mockMembers: HouseholdMember[] = [
  {
    id: "member-1",
    name: "Michael",
    color: "#3B82F6",
    role: "Primary",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "member-2",
    name: "Sarah",
    color: "#EC4899",
    role: "Partner",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockAccounts: Account[] = [
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
];

const mockCategories: Category[] = [
  {
    id: "cat-1",
    name: "Groceries",
    slug: "groceries",
    type: "EXPENSE",
    is_budgeted: true,
    is_rollover: false,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockTransactions: Transaction[] = [
  {
    id: "txn-1",
    account_id: "acc-1",
    transaction_date: "2026-10-25T12:00:00Z",
    raw_payee: "Loblaws",
    normalized_payee: "Loblaws",
    amount: -85.5,
    currency: "CAD",
    status: "CLEARED",
    assigned_member_id: "member-1",
    created_at: "2026-10-25T12:00:00Z",
    updated_at: "2026-10-25T12:00:00Z",
    splits: [{ category_id: "cat-1", amount: -85.5 }],
    confidence_score: 0.92,
    classification_tier: "EXPLICIT_RULE",
  },
  {
    id: "txn-2",
    account_id: "acc-1",
    transaction_date: "2026-10-25T14:00:00Z",
    raw_payee: "Hydro One",
    normalized_payee: "Hydro One",
    amount: -120.0,
    currency: "CAD",
    status: "CLEARED",
    assigned_member_id: null,
    created_at: "2026-10-25T14:00:00Z",
    updated_at: "2026-10-25T14:00:00Z",
    splits: [],
  },
];

describe("LedgerWorkspace Household Features", () => {
  beforeEach(() => {
    vi.spyOn(api, "getTransactions").mockResolvedValue({
      items: mockTransactions,
      total: mockTransactions.length,
      page: 1,
      page_size: 50,
    });
  });

  it("renders Household Member filter dropdown and triggers filtering", async () => {
    render(
      <LedgerWorkspace
        accounts={mockAccounts}
        categories={mockCategories}
        householdMembers={mockMembers}
        onDataModified={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("All Household")).toBeDefined();
    });

    const filterSelect = screen.getByDisplayValue("All Household");
    fireEvent.change(filterSelect, { target: { value: "member-1" } });

    await waitFor(() => {
      expect(api.getTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_member_id: "member-1",
        })
      );
    });
  });

  it("displays assigned member badge next to payee in table rows", async () => {
    render(
      <LedgerWorkspace
        accounts={mockAccounts}
        categories={mockCategories}
        householdMembers={mockMembers}
        onDataModified={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("Michael").length).toBeGreaterThan(0);
    });
  });

  it("renders Household Member Attribution select in Transaction modal", async () => {
    render(
      <LedgerWorkspace
        accounts={mockAccounts}
        categories={mockCategories}
        householdMembers={mockMembers}
        onDataModified={vi.fn()}
      />
    );

    const addBtn = screen.getByRole("button", { name: /Add Transaction/i });
    fireEvent.click(addBtn);

    expect(screen.getByText("Household Member Attribution")).toBeDefined();
    expect(screen.getAllByText("Joint / Unassigned").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Michael (Primary)")).toBeDefined();
    expect(screen.getByText("Sarah (Partner)")).toBeDefined();
  });

  it("renders confidence badge for auto-classified transactions", async () => {
    render(
      <LedgerWorkspace
        accounts={mockAccounts}
        categories={mockCategories}
        householdMembers={mockMembers}
        onDataModified={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("92%").length).toBeGreaterThan(0);
    });
  });

  it("opens Auto-Classify Uncategorized modal and invokes classification API on confirmation", async () => {
    const onDataModified = vi.fn();
    const autoClassifySpy = vi
      .spyOn(api.classification, "autoClassifyUncategorized")
      .mockResolvedValue({
        classified_count: 5,
        remaining_count: 0,
      });

    render(
      <LedgerWorkspace
        accounts={mockAccounts}
        categories={mockCategories}
        householdMembers={mockMembers}
        onDataModified={onDataModified}
      />
    );

    const autoClassifyBtn = screen.getByRole("button", { name: /Auto-Classify Uncategorized/i });
    fireEvent.click(autoClassifyBtn);

    expect(screen.getByRole("heading", { name: /Auto-Classify Uncategorized/i })).toBeDefined();

    const confirmBtn = screen.getByRole("button", { name: /^Classify Uncategorized$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(autoClassifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          min_confidence: 0.75,
        })
      );
      expect(screen.getByText("Auto-Classification Complete")).toBeDefined();
      expect(screen.getByText("5 transactions classified, 0 remaining uncategorized.")).toBeDefined();
      expect(onDataModified).toHaveBeenCalled();
    });
  });
});
