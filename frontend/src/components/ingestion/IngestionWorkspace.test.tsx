import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { IngestionWorkspace } from "./IngestionWorkspace";
import { api } from "../../services/api";
import type { Account, Category, IngestionPreviewResponse } from "../../types";

vi.mock("../../services/api", () => ({
  api: {
    uploadStatementPreview: vi.fn(),
    commitIngestionBatch: vi.fn(),
  },
}));

const mockCategories: Category[] = [
  {
    id: "cat-groceries",
    name: "Groceries",
    slug: "groceries",
    type: "EXPENSE",
    is_budgeted: true,
    is_rollover: false,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "cat-restaurants",
    name: "Restaurants",
    slug: "restaurants",
    type: "EXPENSE",
    is_budgeted: true,
    is_rollover: false,
    sort_order: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "cat-health",
    name: "Health & Medical",
    slug: "health-medical",
    type: "EXPENSE",
    is_budgeted: true,
    is_rollover: false,
    sort_order: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockMultiAccountPreview: IngestionPreviewResponse = {
  file_id: "file-123",
  filename: "rbc_multi.csv",
  file_type: "CSV",
  account_id: null,
  is_multi_account: true,
  total_parsed: 2,
  duplicates_count: 0,
  new_count: 2,
  detected_accounts: [
    {
      source_account_key: "acct_chq",
      suggested_name: "RBC Chequing (*1234)",
      suggested_type: "CHECKING",
      institution: "Royal Bank of Canada (RBC)",
      account_number_mask: "*1234",
      currency: "CAD",
      raw_account_type: "Chequing",
      matched_account_id: null,
      matched_account_name: null,
      transaction_count: 1,
      new_count: 1,
      duplicates_count: 0,
    },
    {
      source_account_key: "acct_visa",
      suggested_name: "RBC Visa (*5678)",
      suggested_type: "CREDIT_CARD",
      institution: "Royal Bank of Canada (RBC)",
      account_number_mask: "*5678",
      currency: "CAD",
      raw_account_type: "Visa",
      matched_account_id: null,
      matched_account_name: null,
      transaction_count: 1,
      new_count: 1,
      duplicates_count: 0,
    },
  ],
  items: [
    {
      transaction_date: "2026-07-28",
      raw_payee: "MISC PAYMENT",
      normalized_payee: "Misc Payment",
      amount: -450.0,
      currency: "CAD",
      is_duplicate: false,
      import_hash: "h1",
      notes: "RBC CREDIT CARD",
      source_account_key: "acct_chq",
      account_label: "RBC Chequing (*1234)",
      potential_transfer_account_name: "RBC Visa (*5678)",
      confidence_score: 0.5,
    },
    {
      transaction_date: "2026-07-28",
      raw_payee: "PAYMENT THANK YOU",
      normalized_payee: "Payment Thank You",
      amount: 450.0,
      currency: "CAD",
      is_duplicate: false,
      import_hash: "h2",
      notes: null,
      source_account_key: "acct_visa",
      account_label: "RBC Visa (*5678)",
      potential_transfer_account_name: "RBC Chequing (*1234)",
      confidence_score: 0.5,
    },
  ],
};

describe("IngestionWorkspace Auto-Account Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads a multi-account CSV in an empty workspace, allows editing detected accounts, and commits", async () => {
    const mockedPreview = vi.mocked(api.uploadStatementPreview);
    const mockedCommit = vi.mocked(api.commitIngestionBatch);
    mockedPreview.mockResolvedValue(mockMultiAccountPreview);
    mockedCommit.mockResolvedValue({
      committed_count: 2,
      account_id: "new-acc-1",
      new_account_balance: -450,
      accounts_created_count: 2,
      accounts: [
        {
          account_id: "new-acc-1",
          account_name: "Primary RBC Chequing",
          account_type: "CHECKING",
          created: true,
          committed_count: 1,
          new_account_balance: -450,
        },
        {
          account_id: "new-acc-2",
          account_name: "RBC Visa (*5678)",
          account_type: "CREDIT_CARD",
          created: true,
          committed_count: 1,
          new_account_balance: 450,
        },
      ],
      transfers_linked_count: 1,
    });

    const onCommitSuccess = vi.fn();
    const { container } = render(
      <IngestionWorkspace
        accounts={[]}
        categories={mockCategories}
        onCommitSuccess={onCommitSuccess}
      />
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const csvFile = new File(["Account Type,Account Number\n"], "rbc_multi.csv", {
      type: "text/csv",
    });
    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      expect(mockedPreview).toHaveBeenCalledWith(null, csvFile);
    });

    // Review UI shows both detected accounts and Description 2 notes
    expect(screen.getByText("Accounts in this statement")).toBeDefined();
    expect(screen.getAllByText(/RBC CREDIT CARD/).length).toBeGreaterThan(0);

    // Desktop review uses a flex layout without overflow-x-auto or truncated account masks
    const desktopReview = container.querySelector('[data-testid="ingestion-desktop-review"]');
    expect(desktopReview).toBeTruthy();
    expect(desktopReview?.className).not.toContain("overflow-x-auto");
    const accountCells = screen.getAllByText("RBC Chequing (*1234)");
    expect(accountCells.length).toBeGreaterThan(0);
    accountCells.forEach((el) => {
      expect(el.className).not.toContain("truncate");
    });

    // Rename the first detected account before importing
    const chequingNameInput = screen.getByLabelText(
      "Account name for RBC Chequing (*1234)"
    ) as HTMLInputElement;
    fireEvent.change(chequingNameInput, { target: { value: "Primary RBC Chequing" } });

    const importBtn = screen.getByRole("button", { name: /Import 2/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockedCommit).toHaveBeenCalledTimes(1);
    });

    expect(mockedCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        statement_file_id: "file-123",
        auto_detect_transfers: true,
        accounts: expect.arrayContaining([
          expect.objectContaining({
            source_account_key: "acct_chq",
            name: "Primary RBC Chequing",
            type: "CHECKING",
          }),
          expect.objectContaining({
            source_account_key: "acct_visa",
            name: "RBC Visa (*5678)",
            type: "CREDIT_CARD",
          }),
        ]),
      })
    );

    await waitFor(() => {
      expect(onCommitSuccess).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText(/Imported 2 transactions across 2 accounts \(2 created\) · 1 transfer paired/i)
    ).toBeDefined();
  });

  it("allows mapping a detected account onto an existing account", async () => {
    const existingAccounts: Account[] = [
      {
        id: "existing-visa-id",
        name: "My Existing Visa",
        type: "CREDIT_CARD",
        institution: "Royal Bank of Canada (RBC)",
        account_number_mask: "*5678",
        currency: "CAD",
        current_balance: 0,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    const mockedPreview = vi.mocked(api.uploadStatementPreview);
    const mockedCommit = vi.mocked(api.commitIngestionBatch);
    mockedPreview.mockResolvedValue(mockMultiAccountPreview);
    mockedCommit.mockResolvedValue({
      committed_count: 2,
      account_id: "new-acc-1",
      new_account_balance: -450,
      accounts_created_count: 1,
      accounts: [],
      transfers_linked_count: 1,
    });

    const { container } = render(
      <IngestionWorkspace
        accounts={existingAccounts}
        categories={mockCategories}
        onCommitSuccess={vi.fn()}
      />
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csvFile = new File(["a"], "rbc_multi.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      expect(screen.getByText("Accounts in this statement")).toBeDefined();
    });

    const destSelect = document.getElementById("target-acct_visa") as HTMLSelectElement;
    fireEvent.change(destSelect, { target: { value: "existing-visa-id" } });

    fireEvent.click(screen.getByRole("button", { name: /Import 2/i }));

    await waitFor(() => {
      expect(mockedCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          accounts: expect.arrayContaining([
            expect.objectContaining({
              source_account_key: "acct_visa",
              existing_account_id: "existing-visa-id",
            }),
          ]),
        })
      );
    });
  });

  it("propagates a manual category change to identical uncategorized rows without clobbering generic payees or categorized rows", async () => {
    const propagationPreview: IngestionPreviewResponse = {
      file_id: "file-prop",
      filename: "propagation.csv",
      file_type: "CSV",
      account_id: "acc-1",
      is_multi_account: false,
      total_parsed: 5,
      duplicates_count: 0,
      new_count: 5,
      detected_accounts: [],
      items: [
        {
          transaction_date: "2026-07-01",
          raw_payee: "LOCAL BAKERY",
          normalized_payee: "Local Bakery",
          amount: -12.5,
          currency: "CAD",
          is_duplicate: false,
          import_hash: "b1",
          notes: null,
          confidence_score: 0.5,
        },
        {
          transaction_date: "2026-07-02",
          raw_payee: "LOCAL BAKERY",
          normalized_payee: "Local Bakery",
          amount: -8.75,
          currency: "CAD",
          is_duplicate: false,
          import_hash: "b2",
          notes: null,
          confidence_score: 0.5,
        },
        {
          transaction_date: "2026-07-03",
          raw_payee: "LOCAL BAKERY",
          normalized_payee: "Local Bakery",
          amount: -14.0,
          currency: "CAD",
          suggested_category_id: "cat-groceries",
          suggested_category_name: "Groceries",
          is_duplicate: false,
          import_hash: "b3",
          notes: null,
          confidence_score: 1.0,
        },
        {
          transaction_date: "2026-07-04",
          raw_payee: "MISC PAYMENT",
          normalized_payee: "Misc Payment",
          amount: -50.0,
          currency: "CAD",
          is_duplicate: false,
          import_hash: "m1",
          notes: "GYM A",
          confidence_score: 0.5,
        },
        {
          transaction_date: "2026-07-05",
          raw_payee: "MISC PAYMENT",
          normalized_payee: "Misc Payment",
          amount: -75.0,
          currency: "CAD",
          is_duplicate: false,
          import_hash: "m2",
          notes: "GYM B",
          confidence_score: 0.5,
        },
      ],
    };

    const mockedPreview = vi.mocked(api.uploadStatementPreview);
    mockedPreview.mockResolvedValue(propagationPreview);

    const existingAccounts: Account[] = [
      {
        id: "acc-1",
        name: "Checking",
        type: "CHECKING",
        currency: "CAD",
        current_balance: 1000,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    const { container } = render(
      <IngestionWorkspace
        accounts={existingAccounts}
        categories={mockCategories}
        onCommitSuccess={vi.fn()}
      />
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csvFile = new File(["a"], "propagation.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      expect(screen.getAllByText("LOCAL BAKERY").length).toBeGreaterThan(0);
    });

    const desktopReview = container.querySelector(
      '[data-testid="ingestion-desktop-review"]'
    ) as HTMLElement;
    const selects = Array.from(
      desktopReview.querySelectorAll('select[aria-label="Category"]')
    ) as HTMLSelectElement[];
    expect(selects).toHaveLength(5);

    // Assign Restaurants to the first uncategorized LOCAL BAKERY row -> propagates to 2nd uncategorized row, leaves 3rd categorized row intact
    fireEvent.change(selects[0], { target: { value: "cat-restaurants" } });

    expect(selects[0].value).toBe("cat-restaurants");
    expect(selects[1].value).toBe("cat-restaurants");
    expect(selects[2].value).toBe("cat-groceries");
    expect(screen.getByText("Applied to 2 matching rows")).toBeDefined();

    // Assign Health & Medical to MISC PAYMENT (GYM A) -> must NOT propagate to MISC PAYMENT (GYM B)
    fireEvent.change(selects[3], { target: { value: "cat-health" } });
    expect(selects[3].value).toBe("cat-health");
    expect(selects[4].value).toBe("");
  });

  it("resolves category by suggested_category_name when suggested_category_id does not match loaded categories", async () => {
    vi.mocked(api.uploadStatementPreview).mockResolvedValueOnce({
      file_id: "file-stale-id",
      filename: "stale_ids.csv",
      file_type: "CSV",
      account_id: "acc-1",
      is_multi_account: false,
      total_parsed: 1,
      duplicates_count: 0,
      new_count: 1,
      detected_accounts: [],
      items: [
        {
          transaction_date: "2026-08-01",
          raw_payee: "METRO #42",
          normalized_payee: "Metro",
          amount: -64.15,
          currency: "CAD",
          suggested_category_id: "foreign-container-uuid",
          suggested_category_name: "Groceries",
          is_duplicate: false,
          import_hash: "h-stale-cat",
          confidence_score: 1.0,
        },
      ],
    });
    vi.mocked(api.commitIngestionBatch).mockResolvedValueOnce({
      committed_count: 1,
      account_id: "acc-1",
      new_account_balance: 935.85,
      accounts_created_count: 0,
      accounts: [],
      transfers_linked_count: 0,
    });

    const existingAccounts: Account[] = [
      {
        id: "acc-1",
        name: "Checking",
        type: "CHECKING",
        currency: "CAD",
        current_balance: 1000,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    const { container } = render(
      <IngestionWorkspace
        accounts={existingAccounts}
        categories={mockCategories}
        onCommitSuccess={vi.fn()}
      />
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "stale_ids.csv", { type: "text/csv" })] },
    });

    await waitFor(() => {
      expect(screen.getAllByText("Metro").length).toBeGreaterThan(0);
    });

    const desktopReview = container.querySelector(
      '[data-testid="ingestion-desktop-review"]'
    ) as HTMLElement;
    const select = desktopReview.querySelector(
      'select[aria-label="Category"]'
    ) as HTMLSelectElement;
    expect(select.value).toBe("cat-groceries");

    fireEvent.click(screen.getByRole("button", { name: /Import 1/i }));

    await waitFor(() => {
      expect(api.commitIngestionBatch).toHaveBeenCalledTimes(1);
    });

    const payload = vi.mocked(api.commitIngestionBatch).mock.calls[0][0];
    expect(payload.items[0].category_id).toBe("cat-groceries");
    expect(payload.items[0].category_name).toBe("Groceries");
  });
});
