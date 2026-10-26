import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
      getEmergencyFundCalc: vi.fn(),
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
    expect(screen.getByText("Goals & Savings Envelopes")).toBeDefined();
  });
});
