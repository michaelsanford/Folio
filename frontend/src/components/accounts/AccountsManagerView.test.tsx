import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import { AccountsManagerView } from "./AccountsManagerView";
import type { Account, HouseholdMember } from "../../types";
import { api } from "../../services/api";

vi.mock("../../services/api", () => ({
  api: {
    createAccount: vi.fn().mockResolvedValue({}),
    updateAccount: vi.fn().mockResolvedValue({}),
    deleteAccount: vi.fn().mockResolvedValue({}),
  },
}));

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
    name: "Michael TFSA",
    type: "TFSA",
    currency: "CAD",
    current_balance: 50000,
    owner_member_id: "member-1",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "acc-2",
    name: "Joint Chequing",
    type: "CHECKING",
    currency: "CAD",
    current_balance: 8500,
    owner_member_id: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

describe("AccountsManagerView Household Features", () => {
  it("renders Manage Household button and handles click", () => {
    const handleManage = vi.fn();
    render(
      <AccountsManagerView
        accounts={mockAccounts}
        householdMembers={mockMembers}
        onAccountsModified={vi.fn()}
        onManageHousehold={handleManage}
      />
    );

    const manageBtn = screen.getByRole("button", { name: /Manage Household/i });
    expect(manageBtn).toBeDefined();
    fireEvent.click(manageBtn);
    expect(handleManage).toHaveBeenCalledTimes(1);
  });

  it("displays member badge on owned account and Joint / Shared on unassigned account", () => {
    render(
      <AccountsManagerView
        accounts={mockAccounts}
        householdMembers={mockMembers}
        onAccountsModified={vi.fn()}
      />
    );

    expect(screen.getByText("Michael")).toBeDefined();
    expect(screen.getByText("Joint / shared")).toBeDefined();
  });

  it("renders Owner dropdown and Canadian note in modal", () => {
    render(
      <AccountsManagerView
        accounts={mockAccounts}
        householdMembers={mockMembers}
        onAccountsModified={vi.fn()}
      />
    );

    const addAccountBtn = screen.getByRole("button", { name: /Add Account/i });
    fireEvent.click(addAccountBtn);

    expect(screen.getByText("Owner")).toBeDefined();
    expect(
      screen.getByText(/In Canada, registered accounts \(TFSA, RRSP, FHSA\) are individual legal registrations/i)
    ).toBeDefined();

    // Check options
    expect(screen.getByText("Joint / shared household")).toBeDefined();
    expect(screen.getByText("Michael (Primary)")).toBeDefined();
    expect(screen.getByText("Sarah (Partner)")).toBeDefined();
  });
});

const heloc: Account = {
  id: "acc-loc",
  name: "Home Equity Line",
  type: "LINE_OF_CREDIT",
  currency: "CAD",
  current_balance: -24000,
  interest_rate: 6,
  loan_term_months: 360,
  loan_original_principal: 50000,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function openEdit(account: Account) {
  render(
    <AccountsManagerView accounts={[account]} householdMembers={[]} onAccountsModified={vi.fn()} />
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit account" }));
}

describe("AccountsManagerView line of credit", () => {
  it("has no term or original principal, and defaults to an interest-only minimum", () => {
    openEdit(heloc);
    expect(screen.queryByText("Term (months)")).toBeNull();
    expect(screen.queryByText("Original principal")).toBeNull();
    expect(screen.getByRole("radio", { name: "Interest only" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByLabelText("Minimum payment, percent of balance")).toBeNull();
    // 24,000 at 6% is 120 a month in interest.
    expect(screen.getByText(/At today's balance the minimum is about/).textContent).toMatch(/120/);
  });

  it("saves a percentage minimum and clears the term-loan fields", async () => {
    openEdit(heloc);
    fireEvent.click(screen.getByRole("radio", { name: "% of balance" }));
    fireEvent.change(screen.getByLabelText("Minimum payment, percent of balance"), {
      target: { value: "3" },
    });
    // Submit the form directly: jsdom's step validation misjudges 6 as off a 0.01 step.
    fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);

    await waitFor(() => expect(api.updateAccount).toHaveBeenCalled());
    expect(vi.mocked(api.updateAccount).mock.calls.at(-1)?.[1]).toMatchObject({
      interest_rate: 6,
      minimum_payment_percent: 3,
      loan_term_months: null,
      loan_original_principal: null,
      monthly_payment: null,
    });
  });
});

describe("AccountsManagerView number fields", () => {
  it("leaves a zero balance blank so it can be typed straight away", () => {
    openEdit({ ...mockAccounts[1], current_balance: 0 });
    const balance = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    expect(balance.value).toBe("");
    fireEvent.change(balance, { target: { value: "13" } });
    expect(balance.value).toBe("13");
  });
});

describe("Canadian rules modal", () => {
  it("opens above the account type dropdown", () => {
    openEdit(heloc);
    // The trigger shows the current type; open the dropdown, then its (i) button.
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Line of Credit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Canadian rules for Line of Credit" }));

    const heading = screen.getAllByRole("heading", { name: "Line of Credit" }).at(-1)!;
    const overlay = heading.closest(".fixed.inset-0") as HTMLElement;
    // Portaled to <body>, so the form modal's stacking context can't trap it.
    expect(overlay.parentElement).toBe(document.body);
    expect(within(overlay).getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });
});
