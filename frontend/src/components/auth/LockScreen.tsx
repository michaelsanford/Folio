import React, { useState } from "react";
import {
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  Mail,
  Copy,
  Check,
  Smartphone,
  RotateCcw,
} from "lucide-react";
import { FolioMark } from "../common/FolioMark";
import { api } from "../../services/api";
import type { CognitoAuthResponse } from "../../types";

interface LockScreenProps {
  onUnlocked: () => void;
  isInitialSetup?: boolean;
  authMode?: "cognito" | "master_password" | "unconfigured";
}

type CognitoStep =
  | "login"
  | "NEW_PASSWORD_REQUIRED"
  | "MFA_SETUP"
  | "SOFTWARE_TOKEN_MFA";

const MIN_COGNITO_PASSWORD_LENGTH = 20;

export const LockScreen: React.FC<LockScreenProps> = ({
  onUnlocked,
  isInitialSetup = false,
  authMode = "master_password",
}) => {
  // Master passphrase state
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Cognito sign-in & challenge state
  const [cognitoStep, setCognitoStep] = useState<CognitoStep>("login");
  const [email, setEmail] = useState("");
  const [cognitoPassword, setCognitoPassword] = useState("");
  const [showCognitoPassword, setShowCognitoPassword] = useState(false);
  const [challengeSession, setChallengeSession] = useState("");
  const [challengeUsername, setChallengeUsername] = useState("");
  const [challengeMessage, setChallengeMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [totpSecret, setTotpSecret] = useState("");
  const [qrDataUri, setQrDataUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const resetCognitoFlow = (errorMessage: string | null = null) => {
    setCognitoStep("login");
    setChallengeSession("");
    setChallengeMessage(null);
    setNewPassword("");
    setConfirmPassword("");
    setTotpSecret("");
    setQrDataUri("");
    setTotpCode("");
    setCopiedSecret(false);
    setError(errorMessage);
  };

  const applyCognitoResponse = (res: CognitoAuthResponse, fallbackUser: string) => {
    if (res.status === "authenticated") {
      onUnlocked();
      return;
    }

    const user = res.username || fallbackUser;
    setChallengeUsername(user);
    setChallengeSession(res.session || "");
    setChallengeMessage(res.message || null);

    if (res.challenge === "NEW_PASSWORD_REQUIRED") {
      setCognitoStep("NEW_PASSWORD_REQUIRED");
      setCognitoPassword("");
      setNewPassword("");
      setConfirmPassword("");
      return;
    }

    if (res.challenge === "MFA_SETUP") {
      setCognitoStep("MFA_SETUP");
      setTotpSecret(res.totp_secret || "");
      setQrDataUri(res.qr_data_uri || "");
      setTotpCode("");
      setNewPassword("");
      setConfirmPassword("");
      return;
    }

    if (res.challenge === "SOFTWARE_TOKEN_MFA") {
      setCognitoStep("SOFTWARE_TOKEN_MFA");
      setCognitoPassword("");
      setTotpCode("");
      return;
    }

    setError("Unsupported authentication challenge received from Cognito.");
  };

  const handleMasterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      if (isInitialSetup) {
        await api.auth.setup(password);
        await api.auth.login(password);
        onUnlocked();
      } else {
        await api.auth.login(password);
        onUnlocked();
      }
    } catch (err: any) {
      setError(err.message || "Incorrect master passphrase");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCognitoLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cognitoPassword) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await api.auth.cognitoLogin(cleanEmail, cognitoPassword);
      applyCognitoResponse(res, cleanEmail);
    } catch (err: any) {
      setError(err.message || "Unable to sign in with Cognito.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      newPassword.length < MIN_COGNITO_PASSWORD_LENGTH ||
      !/[a-z]/.test(newPassword)
    ) {
      setError(
        "Passphrase must be at least 20 characters and include at least one lowercase letter."
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passphrases do not match.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await api.auth.cognitoChallenge({
        challenge: "NEW_PASSWORD_REQUIRED",
        username: challengeUsername,
        session: challengeSession,
        new_password: newPassword,
      });
      applyCognitoResponse(res, challengeUsername);
    } catch (err: any) {
      const msg = err.message || "Failed to update passphrase.";
      if (/expired|start over/i.test(msg)) {
        resetCognitoFlow(msg);
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleTotpChallengeSubmit = async (
    e: React.FormEvent,
    challenge: "MFA_SETUP" | "SOFTWARE_TOKEN_MFA"
  ) => {
    e.preventDefault();
    const cleanCode = totpCode.replace(/[\s-]/g, "");
    if (!/^\d{6}$/.test(cleanCode)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await api.auth.cognitoChallenge({
        challenge,
        username: challengeUsername,
        session: challengeSession,
        totp_code: cleanCode,
      });
      applyCognitoResponse(res, challengeUsername);
    } catch (err: any) {
      const msg = err.message || "Invalid authenticator code.";
      if (/expired|start over/i.test(msg)) {
        resetCognitoFlow(msg);
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopySecret = async () => {
    if (!totpSecret) return;
    try {
      await navigator.clipboard?.writeText(totpSecret);
      setCopiedSecret(true);
      window.setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      // Clipboard API unavailable in restricted environments
    }
  };

  const formattedTotpSecret = totpSecret
    ? totpSecret.match(/.{1,4}/g)?.join(" ") ?? totpSecret
    : "";

  const meetsCognitoPolicy =
    newPassword.length >= MIN_COGNITO_PASSWORD_LENGTH && /[a-z]/.test(newPassword);

  const cognitoSubtitle = (() => {
    switch (cognitoStep) {
      case "NEW_PASSWORD_REQUIRED":
        return "Set your permanent passphrase";
      case "MFA_SETUP":
        return "Set up your authenticator app";
      case "SOFTWARE_TOKEN_MFA":
        return "Two-factor verification";
      default:
        return "Sign in with your invited account";
    }
  })();

  const headerSubtitle =
    authMode === "cognito"
      ? cognitoSubtitle
      : authMode === "unconfigured" && !isInitialSetup
      ? "Vault authentication is not configured"
      : isInitialSetup
      ? "Set a master passphrase to encrypt your vault"
      : "Enter your master passphrase to unlock your vault";

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-4 relative select-none">
      <div className="w-full max-w-sm z-10">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <Lock className="w-5 h-5 text-muted mx-auto mb-4" strokeWidth={1.5} aria-hidden="true" />
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold text-main leading-none">
            <FolioMark className="w-8 h-8" />
            Folio
          </h1>
          <p className="text-sm text-sub mt-2">{headerSubtitle}</p>
        </div>

        {/* Form Card */}
        <div className="bg-surface border border-default rounded-xl p-6">
          {authMode === "unconfigured" && !isInitialSetup ? (
            <div className="space-y-3 text-xs text-sub">
              <p className="text-main font-medium text-sm">Authentication unavailable</p>
              <p>
                No master passphrase hash or AWS Cognito User Pool is configured on this server.
                Configure deployment credentials and redeploy before accessing this vault.
              </p>
            </div>
          ) : authMode === "cognito" ? (
            <>
              {cognitoStep === "login" && (
                <form onSubmit={handleCognitoLoginSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="cognito-email" className="block text-xs text-sub mb-2">
                      Email address
                    </label>
                    <div className="relative">
                      <input
                        id="cognito-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        autoFocus
                        required
                        className="w-full h-9 pl-9 pr-3 rounded-lg bg-input border border-default text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] text-sm transition-colors"
                      />
                      <Mail
                        className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        strokeWidth={1.5}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="cognito-password" className="block text-xs text-sub mb-2">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="cognito-password"
                        type={showCognitoPassword ? "text" : "password"}
                        value={cognitoPassword}
                        onChange={(e) => setCognitoPassword(e.target.value)}
                        placeholder="••••••••••••"
                        autoComplete="current-password"
                        required
                        className="w-full h-9 pl-9 pr-10 rounded-lg bg-input border border-default text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] text-sm font-mono transition-colors"
                      />
                      <KeyRound
                        className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        strokeWidth={1.5}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCognitoPassword(!showCognitoPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-muted hover:text-main transition-colors cursor-pointer"
                        aria-label={showCognitoPassword ? "Hide password" : "Show password"}
                      >
                        {showCognitoPassword ? (
                          <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                        ) : (
                          <Eye className="w-4 h-4" strokeWidth={1.5} />
                        )}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-negative-subtle text-negative text-xs">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !email.trim() || !cognitoPassword}
                    className="w-full h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main disabled:opacity-50 disabled:cursor-not-allowed text-accent-contrast text-sm font-medium flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer"
                  >
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <span>Sign in</span>
                        <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                      </>
                    )}
                  </button>
                </form>
              )}

              {cognitoStep === "NEW_PASSWORD_REQUIRED" && (
                <form onSubmit={handleNewPasswordSubmit} className="space-y-4">
                  <div className="text-xs text-sub leading-relaxed">
                    {challengeMessage ||
                      "Choose a permanent passphrase (at least 20 characters, including a lowercase letter)."}
                  </div>

                  <div>
                    <label htmlFor="cognito-new-password" className="block text-xs text-sub mb-2">
                      New passphrase
                    </label>
                    <div className="relative">
                      <input
                        id="cognito-new-password"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 20 characters"
                        autoComplete="new-password"
                        autoFocus
                        required
                        className="w-full h-9 pl-9 pr-10 rounded-lg bg-input border border-default text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] text-sm font-mono transition-colors"
                      />
                      <KeyRound
                        className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        strokeWidth={1.5}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-muted hover:text-main transition-colors cursor-pointer"
                        aria-label={showNewPassword ? "Hide passphrase" : "Show passphrase"}
                      >
                        {showNewPassword ? (
                          <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                        ) : (
                          <Eye className="w-4 h-4" strokeWidth={1.5} />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-xs">
                      <span className={meetsCognitoPolicy ? "text-accent-main" : "text-muted"}>
                        {newPassword.length}/{MIN_COGNITO_PASSWORD_LENGTH}+ chars
                        {/[a-z]/.test(newPassword) ? " · lowercase OK" : " · needs lowercase"}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="cognito-confirm-password" className="block text-xs text-sub mb-2">
                      Confirm passphrase
                    </label>
                    <input
                      id="cognito-confirm-password"
                      type={showNewPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter passphrase"
                      autoComplete="new-password"
                      required
                      className="w-full h-9 px-3 rounded-lg bg-input border border-default text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] text-sm font-mono transition-colors"
                    />
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-negative-subtle text-negative text-xs">
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      type="submit"
                      disabled={isLoading || !newPassword || !confirmPassword}
                      className="w-full h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main disabled:opacity-50 disabled:cursor-not-allowed text-accent-contrast text-sm font-medium flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer"
                    >
                      {isLoading ? (
                        <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                      ) : (
                        <>
                          <span>Continue to MFA setup</span>
                          <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => resetCognitoFlow()}
                      className="w-full h-8 px-3 rounded-lg text-xs text-muted hover:text-main flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                      <span>Start over</span>
                    </button>
                  </div>
                </form>
              )}

              {cognitoStep === "MFA_SETUP" && (
                <form
                  onSubmit={(e) => handleTotpChallengeSubmit(e, "MFA_SETUP")}
                  className="space-y-4"
                >
                  <div className="text-xs text-sub leading-relaxed">
                    {challengeMessage ||
                      "Scan this QR code with your authenticator app, then enter the 6-digit code."}
                  </div>

                  {qrDataUri && (
                    <div className="flex justify-center">
                      <div className="p-2.5 rounded-lg bg-white border border-default inline-block">
                        <img
                          src={qrDataUri}
                          alt="Authenticator QR code"
                          className="w-44 h-44"
                        />
                      </div>
                    </div>
                  )}

                  {totpSecret && (
                    <div className="p-2.5 rounded-lg bg-input border border-default space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted">Manual setup key</span>
                        <button
                          type="button"
                          onClick={handleCopySecret}
                          className="inline-flex items-center gap-1 text-xs text-sub hover:text-main cursor-pointer"
                        >
                          {copiedSecret ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-accent-main" strokeWidth={1.75} />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                              <span>Copy key</span>
                            </>
                          )}
                        </button>
                      </div>
                      <code className="block text-xs font-mono text-main break-all select-all">
                        {formattedTotpSecret}
                      </code>
                    </div>
                  )}

                  <div>
                    <label htmlFor="cognito-mfa-setup-code" className="block text-xs text-sub mb-2">
                      6-digit verification code
                    </label>
                    <div className="relative">
                      <input
                        id="cognito-mfa-setup-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        placeholder="123456"
                        maxLength={12}
                        autoFocus
                        required
                        className="w-full h-9 pl-9 pr-3 rounded-lg bg-input border border-default text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] text-sm font-mono tracking-widest transition-colors"
                      />
                      <Smartphone
                        className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        strokeWidth={1.5}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-negative-subtle text-negative text-xs">
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      type="submit"
                      disabled={isLoading || !totpCode.trim()}
                      className="w-full h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main disabled:opacity-50 disabled:cursor-not-allowed text-accent-contrast text-sm font-medium flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer"
                    >
                      {isLoading ? (
                        <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                      ) : (
                        <>
                          <span>Verify &amp; sign in</span>
                          <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => resetCognitoFlow()}
                      className="w-full h-8 px-3 rounded-lg text-xs text-muted hover:text-main flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                      <span>Start over</span>
                    </button>
                  </div>
                </form>
              )}

              {cognitoStep === "SOFTWARE_TOKEN_MFA" && (
                <form
                  onSubmit={(e) => handleTotpChallengeSubmit(e, "SOFTWARE_TOKEN_MFA")}
                  className="space-y-4"
                >
                  <div className="text-xs text-sub leading-relaxed">
                    {challengeUsername && (
                      <div className="text-main font-medium mb-1 truncate">{challengeUsername}</div>
                    )}
                    {challengeMessage || "Enter the 6-digit code from your authenticator app."}
                  </div>

                  <div>
                    <label htmlFor="cognito-totp-code" className="block text-xs text-sub mb-2">
                      Authenticator code
                    </label>
                    <div className="relative">
                      <input
                        id="cognito-totp-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        placeholder="123456"
                        maxLength={12}
                        autoFocus
                        required
                        className="w-full h-9 pl-9 pr-3 rounded-lg bg-input border border-default text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] text-sm font-mono tracking-widest transition-colors"
                      />
                      <Smartphone
                        className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        strokeWidth={1.5}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-negative-subtle text-negative text-xs">
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      type="submit"
                      disabled={isLoading || !totpCode.trim()}
                      className="w-full h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main disabled:opacity-50 disabled:cursor-not-allowed text-accent-contrast text-sm font-medium flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer"
                    >
                      {isLoading ? (
                        <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                      ) : (
                        <>
                          <span>Verify &amp; unlock</span>
                          <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => resetCognitoFlow()}
                      className="w-full h-8 px-3 rounded-lg text-xs text-muted hover:text-main flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                      <span>Back to sign in</span>
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <form onSubmit={handleMasterSubmit} className="space-y-4">
              <div>
                <label htmlFor="lock-passphrase" className="block text-xs text-sub mb-2">
                  {isInitialSetup ? "New master passphrase" : "Master passphrase"}
                </label>
                <div className="relative">
                  <input
                    id="lock-passphrase"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    autoFocus
                    required
                    className="w-full h-9 pl-9 pr-10 rounded-lg bg-input border border-default text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] text-sm font-mono transition-colors"
                  />
                  <KeyRound
                    className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    strokeWidth={1.5}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-muted hover:text-main transition-colors cursor-pointer"
                    aria-label={showPassword ? "Hide passphrase" : "Show passphrase"}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                    ) : (
                      <Eye className="w-4 h-4" strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-negative-subtle text-negative text-xs">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !password}
                className="w-full h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main disabled:opacity-50 disabled:cursor-not-allowed text-accent-contrast text-sm font-medium flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span>{isInitialSetup ? "Initialize vault" : "Unlock vault"}</span>
                    <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-subtle flex items-center justify-center gap-2 text-xs text-muted">
            <ShieldCheck className="w-4 h-4 text-muted" strokeWidth={1.5} />
            <span>
              {authMode === "cognito"
                ? "Invite-only access · AWS Cognito & TOTP MFA"
                : "End-to-end encrypted session"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
