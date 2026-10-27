import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { RulesManagerView } from "./RulesManagerView";
import { api } from "../../services/api";
import type { Category, Account, CategorizationRule, ClassificationStatus, ClassificationResult } from "../../types";

const mockCategories: Category[] = [
  {
    id: "cat-dining",
    name: "Dining & Coffee",
    slug: "dining",
    color: "#F59E0B",
    type: "EXPENSE",
    is_budgeted: true,
    is_rollover: false,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "cat-groceries",
    name: "Groceries",
    slug: "groceries",
    color: "#10B981",
    type: "EXPENSE",
    is_budgeted: true,
    is_rollover: false,
    sort_order: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockAccounts: Account[] = [
  {
    id: "acc-1",
    name: "RBC Visa Infinite",
    type: "CREDIT_CARD",
    currency: "CAD",
    current_balance: -450.25,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockRules: CategorizationRule[] = [
  {
    id: "rule-1",
    category_id: "cat-dining",
    pattern: "TIM HORTONS",
    pattern_type: "CONTAINS",
    priority: 1,
    normalized_payee_override: "Tim Hortons",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockStatus: ClassificationStatus = {
  bedrock_enabled: true,
  bedrock_model_id: "amazon.nova-micro-v1:0",
  bedrock_region: "ca-central-1",
  confidence_threshold: 0.75,
  rules_count: 1,
  historical_matches_available: true,
};

const mockEvaluationResult: ClassificationResult = {
  matched: true,
  category_id: "cat-dining",
  category_name: "Dining & Coffee",
  category_color: "#F59E0B",
  normalized_payee: "Tim Hortons",
  confidence: 0.95,
  tier: "HEURISTIC",
  reason: "Matched Canadian bilingual dining taxonomy: 'tim hortons' with 95% confidence",
  rule_id: null,
};

describe("RulesManagerView & Auto-Classification Engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getRules").mockResolvedValue(mockRules);
    vi.spyOn(api.classification, "getStatus").mockResolvedValue(mockStatus);
    vi.spyOn(api.classification, "evaluate").mockResolvedValue(mockEvaluationResult);
    vi.spyOn(api.classification, "autoClassifyUncategorized").mockResolvedValue({
      classified_count: 12,
      remaining_count: 2,
    });
  });

  it("renders Active Rules tab by default and displays configured rules", async () => {
    render(<RulesManagerView categories={mockCategories} accounts={mockAccounts} />);

    expect(screen.getByText("Categorization & Rules")).toBeDefined();
    expect(screen.getByText("Active Rules")).toBeDefined();
    expect(screen.getByText("Classification Engine & Sandbox")).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByText("TIM HORTONS").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Tim Hortons").length).toBeGreaterThan(0);
    });
  });

  it("switches to Classification Engine & Sandbox tab and renders 4-tier status banner", async () => {
    render(<RulesManagerView categories={mockCategories} accounts={mockAccounts} />);

    const sandboxTabButton = screen.getByRole("button", { name: /Classification Engine & Sandbox/i });
    fireEvent.click(sandboxTabButton);

    await waitFor(() => {
      expect(screen.getByText("Cascading Multi-Tier Classification Architecture")).toBeDefined();
      expect(screen.getByText("Local Rules")).toBeDefined();
      expect(screen.getByText("User History")).toBeDefined();
      expect(screen.getByText("Heuristics")).toBeDefined();
      expect(screen.getByText("Bedrock AI Recourse")).toBeDefined();
      expect(screen.getByText("Enabled")).toBeDefined();
    });
  });

  it("evaluates live transaction in Sandbox and renders full classification diagnostic card", async () => {
    render(<RulesManagerView categories={mockCategories} accounts={mockAccounts} />);

    // Switch to Sandbox
    fireEvent.click(screen.getByRole("button", { name: /Classification Engine & Sandbox/i }));

    await waitFor(() => {
      expect(screen.getByText("Live Interactive Classifier Sandbox")).toBeDefined();
    });

    const payeeInput = screen.getByPlaceholderText(/e.g. TIM HORTONS/i);
    fireEvent.change(payeeInput, { target: { value: "TIM HORTONS #4921 TORONTO ON" } });

    const classifyBtn = screen.getByRole("button", { name: /Classify/i });
    fireEvent.click(classifyBtn);

    await waitFor(() => {
      expect(api.classification.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          raw_payee: "TIM HORTONS #4921 TORONTO ON",
          enable_bedrock: true,
        })
      );
    });

    // Check results card
    await waitFor(() => {
      expect(screen.getByText("Classification Result")).toBeDefined();
      expect(screen.getByText("Dining & Coffee")).toBeDefined();
      expect(screen.getAllByText("Heuristics").length).toBeGreaterThan(1);
      expect(screen.getByText("95%")).toBeDefined();
      expect(screen.getByText("High Confidence")).toBeDefined();
      expect(screen.getByText("Detailed Diagnostic Reason")).toBeDefined();
      expect(
        screen.getByText(/Matched Canadian bilingual dining taxonomy/i)
      ).toBeDefined();
    });
  });

  it("runs batch auto-classification of uncategorized transactions", async () => {
    const onDataModified = vi.fn();
    render(
      <RulesManagerView
        categories={mockCategories}
        accounts={mockAccounts}
        onDataModified={onDataModified}
      />
    );

    // Switch to Sandbox tab
    fireEvent.click(screen.getByRole("button", { name: /Classification Engine & Sandbox/i }));

    await waitFor(() => {
      expect(screen.getByText("Batch Auto-Classify Uncategorized Transactions")).toBeDefined();
    });

    // Slider check
    const slider = screen.getByLabelText(/Minimum Confidence Threshold/i);
    expect(slider).toBeDefined();
    fireEvent.change(slider, { target: { value: "0.80" } });

    // Run batch auto-classify button
    const runBtn = screen.getByRole("button", { name: /Run Auto-Classification/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(api.classification.autoClassifyUncategorized).toHaveBeenCalledWith(
        expect.objectContaining({
          min_confidence: 0.8,
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Batch Auto-Classification Complete")).toBeDefined();
      expect(
        screen.getByText("12 transactions classified, 2 remaining uncategorized")
      ).toBeDefined();
      expect(onDataModified).toHaveBeenCalled();
    });
  });
});
