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
        className={`relative min-w-0 text-left p-4 rounded-lg transition-colors cursor-pointer ${
          isSelected ? "bg-accent-subtle" : "bg-surface-hover"
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className={`text-base font-semibold break-words ${isSelected ? "text-accent-subtle" : "text-main"}`}>{t.name}</span>
          {isSelected && <Check className="w-5 h-5 shrink-0 text-accent-subtle" strokeWidth={2} />}
        </div>

        <p className="text-sm text-sub mb-3 leading-snug break-words">{t.description}</p>

        {/* Colour swatches */}
        <div className="flex items-center gap-1.5">
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
        className="w-full md:max-w-2xl bg-surface elevation-3 rounded-t-2xl md:rounded-2xl overflow-hidden flex flex-col max-h-[92dvh] md:max-h-[90vh] pb-[env(safe-area-inset-bottom)] animate-in sheet-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-2 md:px-8 md:pt-8">
          <div className="min-w-0">
            <h2 id="theme-modal-title" className="font-display text-xl md:text-2xl font-semibold text-main">
              Appearance
            </h2>
            <p className="text-sm text-sub mt-1">Colour mode, type, palette and number formats</p>
          </div>
          <button
            onClick={onClose}
            className={iconButton}
            aria-label="Close appearance settings"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 pt-4 md:px-8 md:pb-8 space-y-10 overflow-y-auto">
          {/* Mode selector */}
          <div>
            <h3 className="text-base font-semibold text-main mb-3">Colour mode</h3>
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
                    className={`min-h-11 md:min-h-10 flex flex-wrap items-center justify-center gap-x-2 px-3 py-1 rounded-lg text-base md:text-sm transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-accent-subtle text-accent-subtle font-semibold"
                        : "bg-surface-subtle text-sub hover:text-main"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 ${isSelected ? "text-accent-subtle" : "text-sub"}`}
                      strokeWidth={1.5}
                    />
                    <span>{m.label}</span>
                    {isSelected && m.id === "system" && (
                      <span className="text-sm font-normal">({resolvedMode})</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type styles */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
              <h3 className="text-base font-semibold text-main">Type style</h3>
              <span className="text-sm text-sub">Fonts for text, headings and figures</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TYPE_STYLES.map((t) => {
                const isSelected = typeStyle === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTypeStyle(t.id)}
                    aria-pressed={isSelected}
                    className={`relative min-w-0 text-left p-4 rounded-lg transition-colors cursor-pointer ${
                      isSelected ? "bg-accent-subtle" : "bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-base font-semibold break-words ${isSelected ? "text-accent-subtle" : "text-main"}`}>{t.name}</span>
                      {isSelected && <Check className="w-5 h-5 shrink-0 text-accent-subtle" strokeWidth={2} />}
                    </div>
                    {/* Sample set in the style's own fonts, so the choice is visible before applying it */}
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-main">
                      <span className="text-lg font-medium" style={{ fontFamily: t.display }}>
                        Net worth
                      </span>
                      <span
                        className="text-lg font-medium break-words"
                        style={{ fontFamily: t.figures, fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatMoney(248310.42, {}, formatPrefs)}
                      </span>
                    </div>
                    <p className="text-sm text-sub mt-2 leading-snug break-words" style={{ fontFamily: t.sans }}>
                      {t.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Financial themes */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
              <h3 className="text-base font-semibold text-main">Financial palettes</h3>
              <span className="text-sm text-sub">Grounded and institutional</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {financialThemes.map(renderThemeCard)}
            </div>
          </div>

          {/* Developer themes */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
              <h3 className="text-base font-semibold text-main">Developer themes</h3>
              <span className="text-sm text-sub">Familiar editor and terminal palettes</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {developerThemes.map(renderThemeCard)}
            </div>
          </div>

          {/* Accessibility themes */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
              <h3 className="text-base font-semibold text-main">Accessibility</h3>
              <span className="text-sm text-sub">Maximum contrast</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {accessibilityThemes.map(renderThemeCard)}
            </div>
          </div>

          {/* Number formats */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
              <h3 className="text-base font-semibold text-main">Numbers and currency</h3>
              <span className="text-sm text-sub">Saved on this device</span>
            </div>
            <NumberFormatSettings />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 md:px-8 py-4 border-t border-subtle">
          <div className="text-sm text-sub min-w-0 break-words">
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
