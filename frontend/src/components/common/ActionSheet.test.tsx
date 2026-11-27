import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import { ActionSheet } from "./ActionSheet";

const Harness: React.FC<{ onDelete?: () => void; onEdit?: () => void }> = ({ onDelete = vi.fn(), onEdit = vi.fn() }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ActionSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Groceries"
        actions={[
          { label: "Delete", destructive: true, onSelect: onDelete },
          { label: "Edit", onSelect: onEdit },
        ]}
      />
    </>
  );
};

describe("ActionSheet", () => {
  it("lists the destructive action last and runs the chosen action", () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    fireEvent.click(screen.getByText("Open"));
    const dialog = screen.getByRole("dialog", { name: "Groceries" });
    const labels = Array.from(dialog.querySelectorAll("li button")).map((b) => b.textContent);
    expect(labels).toEqual(["Edit", "Delete"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and on the backdrop, and gives focus back", () => {
    render(<Harness />);
    const opener = screen.getByText("Open");
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    fireEvent.mouseDown(screen.getByTestId("action-sheet-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
