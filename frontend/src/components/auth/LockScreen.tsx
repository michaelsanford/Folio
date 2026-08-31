import React, { useState } from "react";
import { Lock, KeyRound, Eye, EyeOff, ShieldCheck, ArrowRight, Cpu } from "lucide-react";
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
        {/* Folio Brand & Lock Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent-subtle text-accent-main mb-3.5 border border-accent-main/30 shadow-xs">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-main tracking-tight">Folio Vault</h1>
          <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
            {authMode === "cognito"
              ? "Zero-Trust AWS Cognito authentication required"
              : isInitialSetup
              ? "Set up your master passphrase to encrypt and secure your vault"
              : "Enter master passphrase to unlock your personal finances"}
          </p>
          {authMode === "cognito" && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-default text-[10px] text-accent-subtle font-semibold">
              <Cpu className="w-3 h-3" />
              <span>AWS Cognito Protected</span>
            </div>
          )}
        </div>

        {/* Form Container */}
        <div className="bg-surface border border-default rounded-2xl p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                {authMode === "cognito"
                  ? "Cognito Access Token / Secret"
                  : isInitialSetup
                  ? "New Master Passphrase"
                  : "Master Passphrase"}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoFocus
                  required
                  className="w-full px-4 py-2.5 pl-10 pr-12 rounded-xl bg-input border border-default text-main placeholder:text-muted focus:outline-hidden focus:ring-1 focus:ring-accent-main focus:border-accent-main text-sm font-mono transition-all"
                />
                <KeyRound className="w-4 h-4 text-muted absolute left-3.5 top-3" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3 text-muted hover:text-main"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-negative-subtle border border-rose-500/30 text-negative text-xs font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !password}
              className="w-full py-2.5 px-4 rounded-xl bg-accent-main hover:bg-accent-main disabled:opacity-50 disabled:cursor-not-allowed text-accent-contrast text-sm font-semibold shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  <span>
                    {authMode === "cognito"
                      ? "Authenticate with Cognito"
                      : isInitialSetup
                      ? "Initialize Vault"
                      : "Unlock Vault"}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-3.5 border-t border-subtle flex items-center justify-center gap-2 text-[11px] text-muted font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-positive" />
            <span>End-to-End Encrypted Session</span>
          </div>
        </div>
      </div>
    </div>
  );
};
