import { describe, it, expect } from "vitest";
import { budgetLineState } from "./budgetLine";

describe("budgetLineState", () => {
  it("counts spending against a $0 target as over, with no made-up percentage", () => {
    expect(budgetLineState(0, 64)).toEqual({ status: "OVER", isOver: true, percentUsed: 100, usedLabel: "No target" });
  });

  it("is unspent when nothing was spent, with or without a target", () => {
    expect(budgetLineState(0, 0).status).toBe("UNSPENT");
    expect(budgetLineState(200, 0).status).toBe("UNSPENT");
  });

  it("is near the limit from 80% up to the target itself", () => {
    expect(budgetLineState(100, 80).status).toBe("WARNING");
    expect(budgetLineState(100, 100)).toMatchObject({ status: "WARNING", isOver: false, usedLabel: "100%" });
  });

  it("is over once spending passes the target", () => {
    expect(budgetLineState(120, 125.5)).toMatchObject({ status: "OVER", isOver: true, usedLabel: "105%" });
  });

  it("is on track below 80%", () => {
    expect(budgetLineState(600, 450)).toMatchObject({ status: "ON_TRACK", usedLabel: "75%" });
  });
});
