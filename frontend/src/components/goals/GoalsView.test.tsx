import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { GoalsView } from "./GoalsView";
import { api } from "../../services/api";

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
    expect(await screen.findByText("Goals & Savings Envelopes")).toBeDefined();
    await waitFor(() => {
      expect(api.goals.getGoals).toHaveBeenCalled();
    });
  });
});
