import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { AccountsManagerView } from "./AccountsManagerView";
import type { Account, HouseholdMember } from "../../types";

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
    expect(screen.getByText("Joint / Shared")).toBeDefined();
  });

  it("renders Account Ownership dropdown and Canadian note in modal", () => {
    render(
      <AccountsManagerView
        accounts={mockAccounts}
        householdMembers={mockMembers}
        onAccountsModified={vi.fn()}
      />
    );

    const addAccountBtn = screen.getByRole("button", { name: /Add Account/i });
    fireEvent.click(addAccountBtn);

    expect(screen.getByText("Account Ownership (Household Member)")).toBeDefined();
    expect(
      screen.getByText(/In Canada, registered accounts \(TFSA, RRSP, FHSA\) are individual legal registrations/i)
    ).toBeDefined();

    // Check options
    expect(screen.getByText("Joint / Shared Household")).toBeDefined();
    expect(screen.getByText("Michael (Primary)")).toBeDefined();
    expect(screen.getByText("Sarah (Partner)")).toBeDefined();
  });
});
