import React, { useEffect } from "react";
import { X, Sun, Moon, Monitor, Check } from "lucide-react";
import { NumberFormatSettings } from "./NumberFormatSettings";
import { useTheme, THEMES, TYPE_STYLES, type ThemeId, type ColorMode, type ThemeDefinition } from "../../context/ThemeContext";
import { formatMoney } from "../../utils/format";
import { useFormatPrefs } from "../../hooks/useFormatPrefs";
import { iconButton, modalOverlay, primaryButton } from "./ui";

interface ThemePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThemePickerModal: React.FC<ThemePickerModalProps> = ({ isOpen, onClose }) => {
  const { theme, mode, resolvedMode, setTheme, setMode, typeStyle, setTypeStyle } = useTheme();
  const formatPrefs = useFormatPrefs();

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
  const accessibilityThemes = THEMES.filter((t) => t.category === "Accessibility");

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
    <div className={modalOverlay}>
      <div
        className="w-full md:max-w-2xl bg-surface border border-default rounded-t-2xl md:rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh] md:max-h-[90vh] pb-[env(safe-area-inset-bottom)] animate-in sheet-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-4 border-b border-subtle">
          <div>
            <h2 id="theme-modal-title" className="text-base font-medium text-main">
              Appearance
            </h2>
            <p className="text-xs text-muted mt-1">Colour mode, type, palette and number formats</p>
          </div>
          <button
            onClick={onClose}
            className={iconButton}
            aria-label="Close appearance settings"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 md:p-6 space-y-6 overflow-y-auto">
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
                    className={`h-11 md:h-9 flex items-center justify-center gap-2 px-3 rounded-lg border text-sm transition-colors cursor-pointer ${
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

          {/* Type styles */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs text-muted">Type style</div>
              <span className="text-xs text-muted">Fonts for text, headings and figures</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TYPE_STYLES.map((t) => {
                const isSelected = typeStyle === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTypeStyle(t.id)}
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
                    {/* Sample set in the style's own fonts, so the choice is visible before applying it */}
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-main">
                      <span className="text-lg font-medium" style={{ fontFamily: t.display }}>
                        Net worth
                      </span>
                      <span
                        className="text-lg font-medium whitespace-nowrap"
                        style={{ fontFamily: t.figures, fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatMoney(248310.42, {}, formatPrefs)}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-2 leading-snug" style={{ fontFamily: t.sans }}>
                      {t.description}
                    </p>
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

          {/* Accessibility themes */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs text-muted">Accessibility</div>
              <span className="text-xs text-muted">Maximum contrast</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {accessibilityThemes.map(renderThemeCard)}
            </div>
          </div>

          {/* Number formats */}
          <div className="pt-6 border-t border-subtle">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-xs text-muted">Numbers and currency</div>
              <span className="text-xs text-muted">Saved on this device</span>
            </div>
            <NumberFormatSettings />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-4 border-t border-subtle">
          <div className="text-xs text-muted">
            Active: <span className="text-main">{THEMES.find((t) => t.id === theme)?.name}</span> ({resolvedMode})
          </div>
          <button
            onClick={onClose}
            className={primaryButton}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
