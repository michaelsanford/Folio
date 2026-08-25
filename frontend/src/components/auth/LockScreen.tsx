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
        // Direct Cognito token or auth credential injection
        api.auth.setToken(password.trim());
        await api.getAccounts(); // Probe endpoint with token to verify
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
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 -left-20 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-sm z-10">
        {/* Folio Brand & Lock Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 mb-4 shadow-xl shadow-indigo-500/10">
            <Lock className="w-7 h-7 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Folio Vault</h1>
          <p className="text-xs text-slate-400 mt-1">
            {authMode === "cognito"
              ? "Zero-Trust AWS Cognito authentication required"
              : isInitialSetup
              ? "Set up your master passphrase to encrypt and secure your vault"
              : "Enter master passphrase to unlock your personal finances"}
          </p>
          {authMode === "cognito" && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-950/60 border border-indigo-500/30 text-[10px] text-indigo-300 font-medium">
              <Cpu className="w-3 h-3" />
              <span>AWS Cognito Protected</span>
            </div>
          )}
        </div>

        {/* Form Container */}
        <div className="bg-slate-900/80 border border-slate-800/90 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
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
                  className="w-full px-4 py-3 pl-10 pr-12 rounded-2xl bg-slate-950/80 border border-slate-700/60 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm font-mono transition-all"
                />
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-slate-500 hover:text-slate-300"
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
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium animate-shake">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !password}
              className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all"
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

          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>End-to-End Encrypted Session</span>
          </div>
        </div>
      </div>
    </div>
  );
};

