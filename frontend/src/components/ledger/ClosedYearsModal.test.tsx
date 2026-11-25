import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ClosedYearsModal } from "./ClosedYearsModal";
import { api } from "../../services/api";
import { clearSession, setSession } from "../../utils/session";
import type { PeriodsResponse, YearClosure } from "../../types";

const closure = (year: number, overrides: Partial<YearClosure> = {}): YearClosure => ({
  year,
  closed_through: `${year}-12-31`,
  closed_at: `${year + 1}-01-15T12:00:00Z`,
  closed_by_name: "Michael",
  is_active: true,
  archive_available: true,
  archive_bytes: 48_000,
  row_counts: { transactions: 812 },
  ...overrides,
});

const periods: PeriodsResponse = {
  closed_through_year: 2024,
  closures: [closure(2024), closure(2023)],
  closable_years: [2025],
};

const asRole = (role: "OWNER" | "MEMBER") =>
  setSession(
    { user_key: "k", role, can_edit: true, is_owner: role === "OWNER", can_manage_people: role === "OWNER" },
    []
  );

describe("ClosedYearsModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api.periods, "list").mockResolvedValue(periods);
  });
  afterEach(() => clearSession());

  it("closes a finished year after confirming", async () => {
    asRole("OWNER");
    window.confirm = vi.fn(() => true);
    const close = vi.spyOn(api.periods, "close").mockResolvedValue(closure(2025));
    const onChanged = vi.fn();
    render(<ClosedYearsModal onClose={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Close 2025" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(2025));
    expect(await screen.findByText("2025 is closed and archived.")).toBeDefined();
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers to reopen only the latest closed year", async () => {
    asRole("OWNER");
    render(<ClosedYearsModal onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByText(/Transactions up to Dec 31, 2024 are locked/)).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Reopen" })).toHaveLength(1);
    expect(screen.getAllByText(/Closed Jan 15, 2025 by Michael · 812 transactions/).length).toBe(1);
  });

  it("lets non-owners download archives but not close or reopen", async () => {
    asRole("MEMBER");
    render(<ClosedYearsModal onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Download the 2024 archive" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Close 2025/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });
});
