import React, { useState } from "react";
import { Lock, KeyRound, Eye, EyeOff, ShieldCheck, ArrowRight, BookOpen } from "lucide-react";
import { api } from "../../services/api";

interface LockScreenProps {
  onUnlocked: () => void;
  isInitialSetup?: boolean;
  authMode?: "cognito" | "master_password" | "unconfigured";
}

export const LockScreen: React.FC<LockScreenProps> = ({
  onUnlocked,
  isInitialSetup = false,
  authMode = "master_password",
}) => {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      if (authMode === "cognito") {
        api.auth.setToken(password.trim());
        await api.getAccounts();
        onUnlocked();
      } else if (isInitialSetup) {
        await api.auth.setup(password);
        await api.auth.login(password);
        onUnlocked();
      } else {
        await api.auth.login(password);
        onUnlocked();
      }
    } catch (err: any) {
      setError(err.message || (authMode === "cognito" ? "Invalid Cognito token" : "Incorrect master passphrase"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-4 relative select-none">
      <div className="w-full max-w-sm z-10">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <Lock className="w-5 h-5 text-muted mx-auto mb-4" strokeWidth={1.5} aria-hidden="true" />
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold text-main leading-none">
            <BookOpen className="w-6 h-6 text-accent-main" strokeWidth={1.5} aria-hidden="true" />
            Folio
          </h1>
          <p className="text-sm text-sub mt-2">
            {authMode === "cognito"
              ? "Your vault is protected by AWS Cognito"
              : isInitialSetup
              ? "Set a master passphrase to encrypt your vault"
              : "Enter your master passphrase to unlock your vault"}
          </p>
        </div>

        {/* Form */}
        <div className="bg-surface border border-default rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="lock-passphrase" className="block text-xs text-sub mb-2">
                {authMode === "cognito"
                  ? "Cognito access token"
                  : isInitialSetup
                  ? "New master passphrase"
                  : "Master passphrase"}
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
                  <span>
                    {authMode === "cognito"
                      ? "Authenticate with Cognito"
                      : isInitialSetup
                      ? "Initialize vault"
                      : "Unlock vault"}
                  </span>
                  <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-subtle flex items-center justify-center gap-2 text-xs text-muted">
            <ShieldCheck className="w-4 h-4 text-muted" strokeWidth={1.5} />
            <span>End-to-end encrypted session</span>
          </div>
        </div>
      </div>
    </div>
  );
};
