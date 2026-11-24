import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { LockScreen } from "./LockScreen";
import { api } from "../../services/api";

describe("LockScreen Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it("renders master passphrase input and lock branding", () => {
    render(<LockScreen onUnlocked={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: "Folio" });
    expect(heading.querySelector('img[src="/folio-icon.svg"]')).not.toBeNull();
    expect(screen.getByText("Master passphrase")).toBeDefined();
    expect(screen.getByPlaceholderText("••••••••••••")).toBeDefined();
    expect(screen.getByRole("button", { name: /Unlock vault/i })).toBeDefined();
    expect(screen.getByLabelText("Master passphrase")).toBeDefined();
    expect(screen.getByText("End-to-end encrypted session")).toBeDefined();
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
  });

  it("handles successful unlock submission", async () => {
    const onUnlocked = vi.fn();
    const mockToken = ["mock", "token", Date.now()].join("-");
    vi.spyOn(api.auth, "login").mockResolvedValueOnce({ access_token: mockToken });

    render(<LockScreen onUnlocked={onUnlocked} />);

    const input = screen.getByPlaceholderText("••••••••••••");
    fireEvent.change(input, { target: { value: "CorrectPassword123" } });

    const submitBtn = screen.getByRole("button", { name: /Unlock vault/i });
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

    const submitBtn = screen.getByRole("button", { name: /Unlock vault/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Incorrect master password");
    });
  });

  it("handles Cognito invited-user onboarding through NEW_PASSWORD_REQUIRED and MFA_SETUP", async () => {
    const onUnlocked = vi.fn();
    const cognitoLoginSpy = vi.spyOn(api.auth, "cognitoLogin").mockResolvedValueOnce({
      status: "challenge",
      challenge: "NEW_PASSWORD_REQUIRED",
      session: "sess-1",
      username: "owner@example.com",
      message: "Choose a permanent passphrase (20+ chars).",
    });
    const cognitoChallengeSpy = vi
      .spyOn(api.auth, "cognitoChallenge")
      .mockResolvedValueOnce({
        status: "challenge",
        challenge: "MFA_SETUP",
        session: "sess-2",
        username: "owner@example.com",
        totp_secret: "JBSWY3DPEHPK3PXP",
        otpauth_uri: "otpauth://totp/Folio:owner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Folio",
        qr_data_uri: "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E",
      })
      .mockResolvedValueOnce({
        status: "authenticated",
        username: "owner@example.com",
      });

    render(<LockScreen onUnlocked={onUnlocked} authMode="cognito" />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "Owner@Example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "TempPass123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(cognitoLoginSpy).toHaveBeenCalledWith("owner@example.com", "TempPass123!");
      expect(screen.getByLabelText("New passphrase")).toBeDefined();
    });
    expect(screen.getByText("Step 2 of 3")).toBeDefined();
    expect(screen.getByText(/Set passphrase/)).toBeDefined();

    // Rejects short passphrase client-side
    fireEvent.change(screen.getByLabelText("New passphrase"), {
      target: { value: "too-short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "too-short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue to MFA setup/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/at least 20 characters/i);
    expect(cognitoChallengeSpy).not.toHaveBeenCalled();

    // Rejects mismatched passphrases client-side
    fireEvent.change(screen.getByLabelText("New passphrase"), {
      target: { value: "very-long-household-passphrase-one" },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "very-long-household-passphrase-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue to MFA setup/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/Passphrases do not match/i);
    expect(cognitoChallengeSpy).not.toHaveBeenCalled();

    // Submits matching valid passphrase -> transitions to MFA_SETUP with QR and secret
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "very-long-household-passphrase-one" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue to MFA setup/i }));

    await waitFor(() => {
      expect(cognitoChallengeSpy).toHaveBeenCalledWith({
        challenge: "NEW_PASSWORD_REQUIRED",
        username: "owner@example.com",
        session: "sess-1",
        new_password: "very-long-household-passphrase-one",
      });
      const qrImg = screen.getByAltText("Authenticator QR code") as HTMLImageElement;
      expect(qrImg.src).toContain("data:image/svg+xml");
      expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeDefined();
    });
    expect(screen.getByText("Step 3 of 3")).toBeDefined();
    expect(screen.getByText(/Set up authenticator/)).toBeDefined();

    // Verifies 6-digit setup code -> unlocks app
    fireEvent.change(screen.getByLabelText("6-digit verification code"), {
      target: { value: "123 456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Verify & sign in/i }));

    await waitFor(() => {
      expect(cognitoChallengeSpy).toHaveBeenCalledWith({
        challenge: "MFA_SETUP",
        username: "owner@example.com",
        session: "sess-2",
        totp_code: "123456",
      });
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
  });

  it("handles returning Cognito user SOFTWARE_TOKEN_MFA login", async () => {
    const onUnlocked = vi.fn();
    vi.spyOn(api.auth, "cognitoLogin").mockResolvedValueOnce({
      status: "challenge",
      challenge: "SOFTWARE_TOKEN_MFA",
      session: "mfa-sess",
      username: "owner@example.com",
      message: "Enter the 6-digit code from your authenticator app.",
    });
    const challengeSpy = vi
      .spyOn(api.auth, "cognitoChallenge")
      .mockResolvedValueOnce({
        status: "authenticated",
        username: "owner@example.com",
      });

    render(<LockScreen onUnlocked={onUnlocked} authMode="cognito" />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "very-long-household-passphrase-one" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Authenticator code")).toBeDefined();
    });
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Verify & unlock/i }));

    await waitFor(() => {
      expect(challengeSpy).toHaveBeenCalledWith({
        challenge: "SOFTWARE_TOKEN_MFA",
        username: "owner@example.com",
        session: "mfa-sess",
        totp_code: "654321",
      });
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
  });
});
