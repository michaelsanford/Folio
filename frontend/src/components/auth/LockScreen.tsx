import React, { useState } from "react";
import {
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  Mail,
  Copy,
  Check,
  Smartphone,
  RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

const ICON_CLASS =
  "w-5 h-5 text-sub absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none";

const INPUT_CLASS =
  "w-full h-12 rounded-t-lg rounded-b-none border-0 border-b-2 border-default bg-surface-subtle text-main text-base placeholder:text-sub outline-none focus:border-[var(--accent-primary)] transition-colors";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "id"> & {
  id: string;
};

interface FieldShellProps {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

/** Label above, control below, optional hint line under the control. */
const FieldShell: React.FC<FieldShellProps> = ({ id, label, hint, children }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-medium text-main">
      {label}
    </label>
    {children}
    {hint}
  </div>
);

interface FieldProps extends InputProps {
  label: React.ReactNode;
  icon?: LucideIcon;
  mono?: boolean;
  hint?: React.ReactNode;
}

/** Plain text-like input with an optional leading icon. */
const Field: React.FC<FieldProps> = ({ label, icon: Icon, mono, hint, id, ...input }) => (
  <FieldShell id={id} label={label} hint={hint}>
    <div className="relative">
      <input
        id={id}
        {...input}
        className={`${INPUT_CLASS} ${Icon ? "pl-9" : "pl-3"} pr-3 ${mono ? "font-mono" : ""}`}
      />
      {Icon && <Icon className={ICON_CLASS} strokeWidth={1.5} aria-hidden="true" />}
    </div>
  </FieldShell>
);

interface PasswordFieldProps extends Omit<InputProps, "type"> {
  label: React.ReactNode;
  visible: boolean;
  onToggleVisible: () => void;
  /** Accessible names for the show/hide toggle, e.g. ["Show password", "Hide password"]. */
  toggleLabels: [show: string, hide: string];
  hint?: React.ReactNode;
}

/** Secret input with a leading key icon and a show/hide toggle. */
const PasswordField: React.FC<PasswordFieldProps> = ({
  label,
  visible,
  onToggleVisible,
  toggleLabels,
  hint,
  id,
  ...input
}) => (
  <FieldShell id={id} label={label} hint={hint}>
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        {...input}
        className={`${INPUT_CLASS} pl-10 pr-12 font-mono`}
      />
      <KeyRound className={ICON_CLASS} strokeWidth={1.5} aria-hidden="true" />
      <button
        type="button"
        onClick={onToggleVisible}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 size-11 flex items-center justify-center rounded-full text-sub hover:text-main outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] transition-colors cursor-pointer"
        aria-label={visible ? toggleLabels[1] : toggleLabels[0]}
      >
        {visible ? (
          <EyeOff className="w-5 h-5" strokeWidth={1.5} />
        ) : (
          <Eye className="w-5 h-5" strokeWidth={1.5} />
        )}
      </button>
    </div>
  </FieldShell>
);

interface CodeFieldProps extends Omit<InputProps, "type" | "inputMode" | "autoComplete"> {
  label: React.ReactNode;
}

/** Six-digit authenticator code input. */
const CodeField: React.FC<CodeFieldProps> = ({ label, id, ...input }) => (
  <FieldShell id={id} label={label}>
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={12}
        {...input}
        className={`${INPUT_CLASS} pl-10 pr-3 font-mono tracking-widest`}
      />
      <Smartphone className={ICON_CLASS} strokeWidth={1.5} aria-hidden="true" />
    </div>
  </FieldShell>
);

interface PrimaryButtonProps {
  disabled: boolean;
  isLoading: boolean;
  children: React.ReactNode;
}

/** Full-width submit button; its label stays put on hover and focus. */
const PrimaryButton: React.FC<PrimaryButtonProps> = ({ disabled, isLoading, children }) => (
  <button
    type="submit"
    disabled={disabled}
    className="w-full h-12 px-4 rounded-lg bg-accent-main hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-accent-main text-accent-contrast text-base font-semibold flex items-center justify-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] transition-colors active:scale-[0.98] cursor-pointer"
  >
    {isLoading ? (
      <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
    ) : (
      <span>{children}</span>
    )}
  </button>
);

interface SecondaryButtonProps {
  onClick: () => void;
  children: React.ReactNode;
}

/** Quiet text button used for "Start over" / "Back to sign in". */
const SecondaryButton: React.FC<SecondaryButtonProps> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full h-11 px-3 rounded-lg text-base text-sub hover:text-main flex items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] transition-colors cursor-pointer"
  >
    <RotateCcw className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
    <span>{children}</span>
  </button>
);

/** Inline form error, announced to assistive tech. */
const ErrorNote: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div
      role="alert"
      className="px-3 py-2.5 rounded-lg bg-negative-subtle text-negative text-base break-words"
    >
      {message}
    </div>
  ) : null;

/** Short explanatory text at the top of a challenge step. */
const StepIntro: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-base md:text-lg text-sub leading-relaxed break-words">{children}</div>
);

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

    setError("Unsupported sign-in step. Please start over.");
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
      setError(err.message || "Unable to sign in.");
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

  const stepper =
    authMode === "cognito"
      ? cognitoStep === "NEW_PASSWORD_REQUIRED"
        ? { n: 2, label: "Set passphrase" }
        : cognitoStep === "MFA_SETUP"
        ? { n: 3, label: "Set up authenticator" }
        : null
      : null;

  const securityNote =
    authMode === "cognito"
      ? "Invite-only access · two-factor sign-in"
      : "End-to-end encrypted session";

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-10 select-none">
      <div className="w-full max-w-sm sm:max-w-[640px] flex flex-col sm:flex-row sm:items-center gap-8 sm:gap-0">
        {/* Brand */}
        <div className="flex flex-col items-center text-center sm:flex-1 sm:pr-10">
          <h1 className="flex flex-col items-center gap-4 font-display text-[2rem] font-semibold text-main leading-none">
            <FolioMark className="w-24 h-24 sm:w-[200px] sm:h-[200px]" />
            Folio
          </h1>
          <p className="mt-3 text-base md:text-lg text-sub max-w-[280px]">{headerSubtitle}</p>
        </div>

        {/* Divider */}
        <div aria-hidden="true" className="hidden sm:block w-px self-stretch bg-[var(--border-subtle)]" />

        {/* Form column */}
        <div className="w-full sm:w-[340px] sm:shrink-0 sm:pl-10 flex flex-col gap-8">
          <div className="min-w-0">

            {stepper && (
              <p className="mb-5 text-base md:text-lg text-sub">
                <span className="text-accent-main font-medium">Step {stepper.n} of 3</span>
                {" · "}
                {stepper.label}
              </p>
            )}

            {authMode === "unconfigured" && !isInitialSetup ? (
              <div className="flex flex-col gap-2 text-base md:text-lg text-sub">
                <p className="text-main font-semibold">Authentication unavailable</p>
                <p>
                  No master passphrase or account sign-in is configured on this server.
                  Configure deployment credentials and redeploy before accessing this vault.
                </p>
              </div>
            ) : authMode === "cognito" ? (
              <>
                {cognitoStep === "login" && (
                  <form onSubmit={handleCognitoLoginSubmit} className="flex flex-col gap-4">
                    <Field
                      id="cognito-email"
                      label="Email address"
                      icon={Mail}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      autoFocus
                      required
                    />
                    <PasswordField
                      id="cognito-password"
                      label="Password"
                      visible={showCognitoPassword}
                      onToggleVisible={() => setShowCognitoPassword(!showCognitoPassword)}
                      toggleLabels={["Show password", "Hide password"]}
                      value={cognitoPassword}
                      onChange={(e) => setCognitoPassword(e.target.value)}
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      required
                    />
                    <ErrorNote message={error} />
                    <PrimaryButton
                      disabled={isLoading || !email.trim() || !cognitoPassword}
                      isLoading={isLoading}
                    >
                      Sign in
                    </PrimaryButton>
                  </form>
                )}

                {cognitoStep === "NEW_PASSWORD_REQUIRED" && (
                  <form onSubmit={handleNewPasswordSubmit} className="flex flex-col gap-4">
                    <StepIntro>
                      {challengeMessage ||
                        "Choose a permanent passphrase (at least 20 characters, including a lowercase letter)."}
                    </StepIntro>
                    <PasswordField
                      id="cognito-new-password"
                      label="New passphrase"
                      visible={showNewPassword}
                      onToggleVisible={() => setShowNewPassword(!showNewPassword)}
                      toggleLabels={["Show passphrase", "Hide passphrase"]}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 20 characters"
                      autoComplete="new-password"
                      autoFocus
                      required
                      hint={
                        <span
                          className={`text-sm ${meetsCognitoPolicy ? "text-accent-main" : "text-sub"}`}
                        >
                          {newPassword.length}/{MIN_COGNITO_PASSWORD_LENGTH}+ chars
                          {/[a-z]/.test(newPassword) ? " · lowercase OK" : " · needs lowercase"}
                        </span>
                      }
                    />
                    <Field
                      id="cognito-confirm-password"
                      label="Confirm passphrase"
                      mono
                      type={showNewPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter passphrase"
                      autoComplete="new-password"
                      required
                    />
                    <ErrorNote message={error} />
                    <div className="flex flex-col gap-1">
                      <PrimaryButton
                        disabled={isLoading || !newPassword || !confirmPassword}
                        isLoading={isLoading}
                      >
                        Continue to MFA setup
                      </PrimaryButton>
                      <SecondaryButton onClick={() => resetCognitoFlow()}>Start over</SecondaryButton>
                    </div>
                  </form>
                )}

                {cognitoStep === "MFA_SETUP" && (
                  <form
                    onSubmit={(e) => handleTotpChallengeSubmit(e, "MFA_SETUP")}
                    className="flex flex-col gap-4"
                  >
                    <StepIntro>
                      {challengeMessage ||
                        "Scan this QR code with your authenticator app, then enter the 6-digit code."}
                    </StepIntro>

                    {qrDataUri && (
                      <div className="flex justify-center">
                        <div className="p-2.5 rounded-lg bg-white inline-block">
                          <img src={qrDataUri} alt="Authenticator QR code" className="w-44 h-44" />
                        </div>
                      </div>
                    )}

                    {totpSecret && (
                      <div className="p-3 rounded-lg bg-surface-subtle flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3">
                          <span className="text-sm text-sub">Manual setup key</span>
                          <button
                            type="button"
                            onClick={handleCopySecret}
                            className="min-h-11 md:min-h-0 inline-flex items-center gap-1 rounded text-sm text-sub hover:text-main outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] cursor-pointer"
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
                        <code className="block text-sm font-mono text-main break-all select-all">
                          {formattedTotpSecret}
                        </code>
                      </div>
                    )}

                    <CodeField
                      id="cognito-mfa-setup-code"
                      label="6-digit verification code"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      placeholder="123456"
                      autoFocus
                      required
                    />
                    <ErrorNote message={error} />
                    <div className="flex flex-col gap-1">
                      <PrimaryButton disabled={isLoading || !totpCode.trim()} isLoading={isLoading}>
                        Verify &amp; sign in
                      </PrimaryButton>
                      <SecondaryButton onClick={() => resetCognitoFlow()}>Start over</SecondaryButton>
                    </div>
                  </form>
                )}

                {cognitoStep === "SOFTWARE_TOKEN_MFA" && (
                  <form
                    onSubmit={(e) => handleTotpChallengeSubmit(e, "SOFTWARE_TOKEN_MFA")}
                    className="flex flex-col gap-4"
                  >
                    <StepIntro>
                      {challengeUsername && (
                        <div className="text-main font-medium mb-1 break-words">{challengeUsername}</div>
                      )}
                      {challengeMessage || "Enter the 6-digit code from your authenticator app."}
                    </StepIntro>
                    <CodeField
                      id="cognito-totp-code"
                      label="Authenticator code"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      placeholder="123456"
                      autoFocus
                      required
                    />
                    <ErrorNote message={error} />
                    <div className="flex flex-col gap-1">
                      <PrimaryButton disabled={isLoading || !totpCode.trim()} isLoading={isLoading}>
                        Verify &amp; unlock
                      </PrimaryButton>
                      <SecondaryButton onClick={() => resetCognitoFlow()}>
                        Back to sign in
                      </SecondaryButton>
                    </div>
                  </form>
                )}
              </>
            ) : (
              <form onSubmit={handleMasterSubmit} className="flex flex-col gap-4">
                <PasswordField
                  id="lock-passphrase"
                  label={isInitialSetup ? "New master passphrase" : "Master passphrase"}
                  visible={showPassword}
                  onToggleVisible={() => setShowPassword(!showPassword)}
                  toggleLabels={["Show passphrase", "Hide passphrase"]}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoFocus
                  required
                />
                <ErrorNote message={error} />
                <PrimaryButton disabled={isLoading || !password} isLoading={isLoading}>
                  {isInitialSetup ? "Initialize vault" : "Unlock vault"}
                </PrimaryButton>
              </form>
            )}
          </div>

          <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-sub text-center">
            <ShieldCheck className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
            <span>{securityNote}</span>
          </p>
        </div>
      </div>
    </div>
  );
};
