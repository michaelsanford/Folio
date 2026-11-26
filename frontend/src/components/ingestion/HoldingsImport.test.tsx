import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import { IngestionWorkspace } from "./IngestionWorkspace";
import { api } from "../../services/api";
import type { Account, IngestionPreviewResponse } from "../../types";

vi.mock("../../services/api", () => ({
  api: {
    uploadStatementPreview: vi.fn(),
    commitIngestionBatch: vi.fn(),
    compareHoldingsImport: vi.fn(),
    commitHoldingsImport: vi.fn(),
  },
}));

const tfsa: Account = {
  id: "acc-tfsa",
  name: "RBC TFSA",
  type: "TFSA",
  currency: "CAD",
  current_balance: 900,
  is_active: true,
  account_number_mask: "*1234",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const detected = {
  source_account_key: "acct_abc",
  suggested_name: "RBC TFSA (*1234)",
  suggested_type: "TFSA" as const,
  institution: "Royal Bank of Canada (RBC)",
  account_number_mask: "*1234",
  currency: "CAD",
  raw_account_type: "TFSA",
  matched_account_id: "acc-tfsa",
  matched_account_name: "RBC TFSA",
  transaction_count: 2,
  new_count: 1,
  duplicates_count: 0,
};

const preview: IngestionPreviewResponse = {
  kind: "HOLDINGS",
  file_id: "file-1",
  filename: "Holdings 55501234 November 26, 2026.csv",
  file_type: "CSV",
  account_id: "acc-tfsa",
  detected_accounts: [detected],
  total_parsed: 2,
  duplicates_count: 1,
  new_count: 1,
  items: [],
  row_errors: [],
  holdings: {
    account: detected,
    as_of_date: "2026-11-26",
    account_id: "acc-tfsa",
    account_currency: "CAD",
    positions: [
      {
        symbol: "XEQT", name: "ISHARES CORE EQUITY ETF PORTFOLIO", asset_class: "ETF", currency: "CAD",
        quantity: "12", book_cost: 440, market_value: 480, last_price: 40, previous_close: 39.5,
        status: "CHANGED", current_quantity: "10", current_book_cost: 360,
      },
      {
        symbol: "PHYS", name: "SPROTT PHYSICAL GOLD", asset_class: "OTHER", currency: "CAD",
        quantity: "10", book_cost: 290, market_value: 300, last_price: 30, previous_close: 29.7,
        status: "UNCHANGED",
      },
    ],
    cash: [
      { currency: "CAD", amount: 100, rate_to_cad: 1, rate_to_account: 1, amount_in_account_currency: 100 },
      { currency: "USD", amount: 10, rate_to_cad: 1.4, rate_to_account: 1.4, amount_in_account_currency: 14 },
    ],
    cash_total: 114,
    missing: [{ holding_id: "h-abc", symbol: "ABC", name: "ABC MINING", quantity: "100", market_value: 250 }],
    import_total: 894,
    file_total: 894,
  },
};

async function uploadHoldings(container: HTMLElement) {
  vi.mocked(api.uploadStatementPreview).mockResolvedValue(preview);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], preview.filename, { type: "text/csv" })] } });
  await screen.findByText("Positions");
}

describe("Holdings export import", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows positions, cash and a total that matches the file", async () => {
    const { container } = render(
      <IngestionWorkspace accounts={[tfsa]} categories={[]} onCommitSuccess={vi.fn()} />
    );
    await uploadHoldings(container);

    const table = within(screen.getByTestId("holdings-review-table"));
    expect(table.getByText("XEQT")).toBeDefined();
    expect(table.getByText(/Changed · was 10 units/)).toBeDefined();
    expect(table.getByText("Unchanged")).toBeDefined();
    expect(screen.getByText(/Matches the file/)).toBeDefined();
    expect(screen.getByText("Cash")).toBeDefined();
    expect(screen.getByText("Existing")).toBeDefined();
  });

  it("keeps positions missing from the file unless ticked, and sends the snapshot", async () => {
    vi.mocked(api.commitHoldingsImport).mockResolvedValue({
      account_id: "acc-tfsa", account_name: "RBC TFSA", account_type: "TFSA", created: false,
      added_count: 0, updated_count: 1, unchanged_count: 1, removed_count: 1, cash_total: 114,
      new_account_balance: 894,
    });
    const onCommitSuccess = vi.fn();
    const { container } = render(
      <IngestionWorkspace accounts={[tfsa]} categories={[]} onCommitSuccess={onCommitSuccess} />
    );
    await uploadHoldings(container);

    const remove = screen.getByRole("checkbox", { name: "Remove ABC" }) as HTMLInputElement;
    expect(remove.checked).toBe(false);
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: /Import holdings/ }));

    await waitFor(() => expect(api.commitHoldingsImport).toHaveBeenCalled());
    const req = vi.mocked(api.commitHoldingsImport).mock.calls[0][0];
    expect(req.account.existing_account_id).toBe("acc-tfsa");
    expect(req.as_of_date).toBe("2026-11-26");
    expect(req.cash_total).toBe(114);
    expect(req.remove_holding_ids).toEqual(["h-abc"]);
    expect(req.positions.map((p) => [p.symbol, p.quantity, p.book_cost])).toEqual([
      ["XEQT", "12", 440],
      ["PHYS", "10", 290],
    ]);
    expect(await screen.findByText(/RBC TFSA updated: 1 changed, 1 unchanged, 1 removed/)).toBeDefined();
    expect(onCommitSuccess).toHaveBeenCalled();
  });

  it("re-compares when the destination changes to a new account", async () => {
    vi.mocked(api.compareHoldingsImport).mockResolvedValue({
      ...preview.holdings!,
      account_id: null,
      positions: preview.holdings!.positions.map((p) => ({ ...p, status: "NEW" as const })),
      missing: [],
    });
    const { container } = render(
      <IngestionWorkspace accounts={[tfsa]} categories={[]} onCommitSuccess={vi.fn()} />
    );
    await uploadHoldings(container);
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "create" } });

    await waitFor(() => expect(api.compareHoldingsImport).toHaveBeenCalled());
    expect(vi.mocked(api.compareHoldingsImport).mock.calls[0][0].account_id).toBeNull();
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Remove ABC" })).toBeNull());
    // Only investment and registered types are offered for the new account.
    const type = screen.getByLabelText(/Account type for/) as HTMLSelectElement;
    const values = Array.from(type.options).map((o) => o.value);
    expect(values).toContain("TFSA");
    expect(values).not.toContain("CHECKING");
  });
});
