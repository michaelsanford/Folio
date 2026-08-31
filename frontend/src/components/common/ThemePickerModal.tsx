import React, { useEffect } from "react";
import { X, Sun, Moon, Monitor, Check, Palette } from "lucide-react";
import { useTheme, THEMES, type ThemeId, type ColorMode } from "../../context/ThemeContext";

interface ThemePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThemePickerModal: React.FC<ThemePickerModalProps> = ({ isOpen, onClose }) => {
  const { theme, mode, resolvedMode, setTheme, setMode } = useTheme();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const financialThemes = THEMES.filter((t) => t.category === "Financial");
  const developerThemes = THEMES.filter((t) => t.category === "Developer");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div
        className="w-full max-w-2xl bg-surface border border-default rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-subtle bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent-subtle text-accent-subtle">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 id="theme-modal-title" className="text-base font-bold text-main">
                Appearance & Theme
              </h2>
              <p className="text-xs text-muted">
                Customize your visual palette, contrast, and color mode.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface transition-colors"
            aria-label="Close theme settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Mode Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-2.5">
              Color Mode
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { id: "light" as ColorMode, label: "Light", icon: Sun },
                  { id: "dark" as ColorMode, label: "Dark", icon: Moon },
                  { id: "system" as ColorMode, label: "System", icon: Monitor },
                ] as const
              ).map((m) => {
                const Icon = m.icon;
                const isSelected = mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                      isSelected
                        ? "bg-accent-subtle text-accent-main border-accent-main ring-1 ring-accent-main shadow-xs"
                        : "bg-surface text-sub border-default hover:bg-surface-hover hover:text-main"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{m.label}</span>
                    {isSelected && (
                      <span className="text-[10px] opacity-75 font-normal">
                        ({resolvedMode})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Financial Themes */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                Financial & Wealth Palettes
              </label>
              <span className="text-[10px] text-muted font-medium">Grounded & Institutional</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {financialThemes.map((t) => {
                const isSelected = theme === t.id;
                const canvasColor = resolvedMode === "dark" ? t.darkCanvasHex : t.lightCanvasHex;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id as ThemeId)}
                    className={`relative text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-accent-subtle/50 border-accent-main ring-1 ring-accent-main shadow-md"
                        : "bg-surface border-default hover:border-subtle hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-main">{t.name}</span>
                      {isSelected && <Check className="w-4 h-4 text-accent-main" />}
                    </div>

                    <p className="text-[11px] text-muted mb-3 leading-snug">
                      {t.description}
                    </p>

                    {/* Color Swatches */}
                    <div className="flex items-center gap-1.5 pt-1.5 border-t border-subtle">
                      <div
                        className="w-5 h-5 rounded-full border border-subtle shadow-2xs"
                        style={{ backgroundColor: canvasColor }}
                        title="Canvas Background"
                      />
                      <div
                        className="w-5 h-5 rounded-full shadow-2xs"
                        style={{ backgroundColor: t.accentHex }}
                        title="Primary Accent"
                      />
                      <div
                        className="w-5 h-5 rounded-full bg-emerald-500 shadow-2xs"
                        title="Positive (Assets / Inflow)"
                      />
                      <div
                        className="w-5 h-5 rounded-full bg-rose-500 shadow-2xs"
                        title="Negative (Debt / Outflow)"
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Developer Themes */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                Developer & Coding Themes
              </label>
              <span className="text-[10px] text-muted font-medium">Iconic IDE & Terminal</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {developerThemes.map((t) => {
                const isSelected = theme === t.id;
                const canvasColor = resolvedMode === "dark" ? t.darkCanvasHex : t.lightCanvasHex;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id as ThemeId)}
                    className={`relative text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-accent-subtle/50 border-accent-main ring-1 ring-accent-main shadow-md"
                        : "bg-surface border-default hover:border-subtle hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-main">{t.name}</span>
                      {isSelected && <Check className="w-4 h-4 text-accent-main" />}
                    </div>

                    <p className="text-[11px] text-muted mb-3 leading-snug">
                      {t.description}
                    </p>

                    {/* Color Swatches */}
                    <div className="flex items-center gap-1.5 pt-1.5 border-t border-subtle">
                      <div
                        className="w-5 h-5 rounded-full border border-subtle shadow-2xs"
                        style={{ backgroundColor: canvasColor }}
                        title="Canvas Background"
                      />
                      <div
                        className="w-5 h-5 rounded-full shadow-2xs"
                        style={{ backgroundColor: t.accentHex }}
                        title="Primary Accent"
                      />
                      <div
                        className="w-5 h-5 rounded-full bg-emerald-500/80 shadow-2xs"
                        title="Positive"
                      />
                      <div
                        className="w-5 h-5 rounded-full bg-rose-500/80 shadow-2xs"
                        title="Negative"
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-subtle bg-surface-subtle">
          <div className="text-[11px] text-muted">
            Active: <span className="font-semibold text-main">{THEMES.find((t) => t.id === theme)?.name}</span> ({resolvedMode})
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-sm transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
