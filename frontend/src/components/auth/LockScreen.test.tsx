import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { LockScreen } from "./LockScreen";
import { api } from "../../services/api";

describe("LockScreen Component", () => {
  it("renders master passphrase input and lock branding", () => {
    render(<LockScreen onUnlocked={vi.fn()} />);

    expect(screen.getByText("Folio Vault")).toBeDefined();
    expect(screen.getByText("Master Passphrase")).toBeDefined();
    expect(screen.getByPlaceholderText("••••••••••••")).toBeDefined();
    expect(screen.getByRole("button", { name: /Unlock Vault/i })).toBeDefined();
  });

  it("handles successful unlock submission", async () => {
    const onUnlocked = vi.fn();
    vi.spyOn(api.auth, "login").mockResolvedValueOnce({ access_token: "token-123" });

    render(<LockScreen onUnlocked={onUnlocked} />);

    const input = screen.getByPlaceholderText("••••••••••••");
    fireEvent.change(input, { target: { value: "CorrectPassword123" } });

    const submitBtn = screen.getByRole("button", { name: /Unlock Vault/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.auth.login).toHaveBeenCalledWith("CorrectPassword123");
      expect(onUnlocked).toHaveBeenCalled();
    });
  });

  it("displays error message on invalid password", async () => {
    vi.spyOn(api.auth, "login").mockRejectedValueOnce(new Error("Incorrect master password"));

    render(<LockScreen onUnlocked={vi.fn()} />);

    const input = screen.getByPlaceholderText("••••••••••••");
    fireEvent.change(input, { target: { value: "WrongPassword" } });

    const submitBtn = screen.getByRole("button", { name: /Unlock Vault/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Incorrect master password")).toBeDefined();
    });
  });
});
