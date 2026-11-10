import React, { useEffect } from "react";
import { X, Sun, Moon, Monitor, Check } from "lucide-react";
import { useTheme, THEMES, type ThemeId, type ColorMode, type ThemeDefinition } from "../../context/ThemeContext";

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

  const renderThemeCard = (t: ThemeDefinition) => {
    const isSelected = theme === t.id;
    const canvasColor = resolvedMode === "dark" ? t.darkCanvasHex : t.lightCanvasHex;
    return (
      <button
        key={t.id}
        onClick={() => setTheme(t.id as ThemeId)}
        aria-pressed={isSelected}
        className={`relative text-left p-4 rounded-lg border transition-colors cursor-pointer ${
          isSelected
            ? "bg-surface-subtle border-accent-main"
            : "bg-surface border-default hover:border-[var(--border-strong)] bg-surface-hover"
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-main">{t.name}</span>
          {isSelected && <Check className="w-4 h-4 text-accent-main" strokeWidth={1.5} />}
        </div>

        <p className="text-xs text-muted mb-3 leading-snug">{t.description}</p>

        {/* Colour swatches */}
        <div className="flex items-center gap-1 pt-2 border-t border-subtle">
          <div
            className="w-4 h-4 rounded-full border border-subtle"
            style={{ backgroundColor: canvasColor }}
            title="Canvas background"
          />
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: t.accentHex }}
            title="Primary accent"
          />
          <div className="w-4 h-4 rounded-full bg-positive" title="Positive (assets, inflow)" />
          <div className="w-4 h-4 rounded-full bg-negative" title="Negative (debt, outflow)" />
        </div>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
      <div
        className="w-full max-w-2xl bg-surface border border-default rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-subtle">
          <div>
            <h2 id="theme-modal-title" className="text-base font-medium text-main">
              Appearance
            </h2>
            <p className="text-xs text-muted mt-1">Palette, contrast and colour mode</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer"
            aria-label="Close theme settings"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Mode selector */}
          <div>
            <div className="text-xs text-muted mb-2">Colour mode</div>
            <div className="grid grid-cols-3 gap-2">
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
                    aria-pressed={isSelected}
                    className={`h-9 flex items-center justify-center gap-2 px-3 rounded-lg border text-sm transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-surface-subtle text-main font-medium border-accent-main"
                        : "bg-surface text-sub border-default hover:text-main bg-surface-hover"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 ${isSelected ? "text-accent-main" : "text-muted"}`}
                      strokeWidth={1.5}
                    />
                    <span>{m.label}</span>
                    {isSelected && m.id === "system" && (
                      <span className="text-xs text-muted font-normal">({resolvedMode})</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Financial themes */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs text-muted">Financial palettes</div>
              <span className="text-xs text-muted">Grounded and institutional</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {financialThemes.map(renderThemeCard)}
            </div>
          </div>

          {/* Developer themes */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs text-muted">Developer themes</div>
              <span className="text-xs text-muted">Familiar editor and terminal palettes</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {developerThemes.map(renderThemeCard)}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-subtle">
          <div className="text-xs text-muted">
            Active: <span className="text-main">{THEMES.find((t) => t.id === theme)?.name}</span> ({resolvedMode})
          </div>
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
