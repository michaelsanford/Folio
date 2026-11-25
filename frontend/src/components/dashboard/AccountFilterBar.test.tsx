import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { AccountFilterBar } from "./AccountFilterBar";
import type { Account, AccountType } from "../../types";

const acc = (id: string, type: AccountType, name = id): Account => ({
  id,
  name,
  type,
  currency: "CAD",
  current_balance: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const accounts = [
  acc("chq", "CHECKING", "Chequing"),
  acc("sav", "SAVINGS", "Savings"),
  acc("visa", "CREDIT_CARD", "Visa"),
  acc("amex", "CREDIT_CARD", "Amex"),
];

const renderBar = (hidden: string[] = []) => {
  const onChange = vi.fn();
  render(<AccountFilterBar accounts={accounts} hiddenAccountIds={hidden} onHiddenAccountsChange={onChange} />);
  return onChange;
};

describe("AccountFilterBar", () => {
  it("offers chips only for account families the household has", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /Chequing & savings/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Credit cards/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Investments/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Loans/ })).toBeNull();
  });

  it("hides a whole family at once", () => {
    const onChange = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Credit cards/ }));
    expect(onChange.mock.calls[0][0].sort()).toEqual(["amex", "visa"]);
  });

  it("shows a partly hidden family in full and marks it mixed", () => {
    const onChange = renderBar(["visa"]);
    const chip = screen.getByRole("button", { name: /Credit cards/ });
    expect(chip.getAttribute("aria-pressed")).toBe("mixed");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("resets with All accounts", () => {
    const onChange = renderBar(["chq", "visa"]);
    expect(screen.getByRole("button", { name: "All accounts" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "All accounts" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("toggles single accounts from the menu, portaled to the body", () => {
    const onChange = renderBar(["sav"]);
    fireEvent.click(screen.getByRole("button", { name: /3 of 4 accounts/ }));
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);

    expect(screen.getByRole("menuitemcheckbox", { name: /Savings/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Visa/ }));
    expect(onChange.mock.calls[0][0].sort()).toEqual(["sav", "visa"]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("drops ids of accounts that no longer exist", () => {
    const onChange = renderBar(["gone"]);
    fireEvent.click(screen.getByRole("button", { name: /Credit cards/ }));
    expect(onChange.mock.calls[0][0].sort()).toEqual(["amex", "visa"]);
  });
});
