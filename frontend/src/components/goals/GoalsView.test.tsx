import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import React from "react";
import { GoalsView } from "./GoalsView";
import { api } from "../../services/api";
import { mockViewport } from "../../test/viewport";
import type { Goal } from "../../types";

vi.mock("../../services/api", () => ({
  api: {
    goals: {
      getGoals: vi.fn().mockResolvedValue([]),
      getCraLimits: vi.fn().mockResolvedValue({
        tax_year: 2026,
        tfsa_annual_limit: 7000,
        fhsa_annual_limit: 8000,
        fhsa_lifetime_limit: 40000,
        tfsa_contributed: 0,
        tfsa_remaining_room: 7000,
        fhsa_contributed: 0,
        fhsa_remaining_room: 8000,
        notes: "",
      }),
      createGoal: vi.fn(),
      updateGoal: vi.fn(),
      deleteGoal: vi.fn(),
      getEmergencyFundCalc: vi.fn().mockResolvedValue({
        months: 6,
        lookback_months: 6,
        monthly_fixed_expense: 3000,
        suggested_target: 18000,
        total_spent_in_period: 18000,
        categories: [],
      }),
    },
  },
}));

describe("GoalsView", () => {
  it("renders without crashing", async () => {
    render(
      <GoalsView
        accounts={[]}
        categories={[]}
        householdMembers={[]}
        onDataModified={vi.fn()}
      />
    );
    expect(await screen.findByText("Goals & savings envelopes")).toBeDefined();
    await waitFor(() => {
      expect(api.goals.getGoals).toHaveBeenCalled();
    });
  });
});

const longNotes = "Save for the down payment on a house in the city, including closing costs and land transfer tax";
const goal: Goal = {
  id: "g-1",
  name: "A very long goal name that should wrap rather than be cut off on a phone",
  type: "SAVINGS",
  target_amount: 50000,
  current_amount: 1000,
  effective_current_amount: 1000,
  progress_percentage: 2,
  notes: longNotes,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("GoalsView on a phone", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the full name and notes, and moves Edit and Delete into a sheet", async () => {
    mockViewport("phone");
    vi.mocked(api.goals.getGoals).mockResolvedValue([goal]);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.goals.deleteGoal).mockResolvedValue(undefined as never);
    render(<GoalsView accounts={[]} categories={[]} householdMembers={[]} onDataModified={vi.fn()} />);

    const name = await screen.findByText(goal.name);
    expect(name.className).not.toContain("truncate");
    expect(screen.getByText(longNotes).className).not.toContain("line-clamp");
    expect(screen.queryByRole("button", { name: "Delete goal" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `${goal.name}: actions` }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete goal" }));
    await waitFor(() => expect(api.goals.deleteGoal).toHaveBeenCalledWith("g-1"));
  });
});
