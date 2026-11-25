import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { AccountFilterBar } from "./AccountFilterBar";
import { clearSession, setSession } from "../../utils/session";
import type { Account } from "../../types";

const acc = (id: string, owner: string | null): Account => ({
  id,
  name: id,
  type: "CHECKING",
  currency: "CAD",
  current_balance: 0,
  is_active: true,
  owner_member_id: owner,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const accounts = [acc("mine", "m1"), acc("joint", null), acc("theirs", "m2")];

const linkAs = (memberId: string | null) =>
  setSession(
    { user_key: "k", role: "MEMBER", member_id: memberId, can_edit: true, is_owner: false, can_manage_people: false },
    []
  );

describe("AccountFilterBar Mine chip", () => {
  afterEach(() => clearSession());

  it("keeps your accounts and shared ones, and hides the rest", () => {
    linkAs("m1");
    const onChange = vi.fn();
    render(<AccountFilterBar accounts={accounts} hiddenAccountIds={[]} onHiddenAccountsChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(onChange).toHaveBeenCalledWith(["theirs"]);
  });

  it("is pressed when only yours are shown, and pressing again shows everything", () => {
    linkAs("m1");
    const onChange = vi.fn();
    render(<AccountFilterBar accounts={accounts} hiddenAccountIds={["theirs"]} onHiddenAccountsChange={onChange} />);
    const mine = screen.getByRole("button", { name: "Mine" });
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(mine);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("is absent until you are linked to a member", () => {
    linkAs(null);
    render(<AccountFilterBar accounts={accounts} hiddenAccountIds={[]} onHiddenAccountsChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Mine" })).toBeNull();
  });
});
