import React, { useState } from "react";
import { X, Check } from "lucide-react";
import type { AccountType } from "../../types";
import { getAccountTypeMeta } from "../../constants/canadianAccountTypes";
import {
  ICON_PALETTE,
  COLOR_SWATCHES,
  type IconOption,
  type ColorSwatch,
} from "../../constants/iconPalette";
import { AccountIcon } from "../common/AccountIcon";
import { Money } from "../common/Money";
import { chipTab, iconButton, labelText, primaryButton, scrollList, secondaryButton } from "../common/ui";

interface AccountIconPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountType: AccountType;
  accountName: string;
  institution?: string;
  balance?: number;
  currentIcon?: string | null;
  currentColor?: string | null;
  onSave: (icon: string, color: string) => void;
}

const sectionLabel = `block ${labelText}`;
const linkButton =
  "min-h-11 md:min-h-0 text-sm text-accent-subtle text-right hover:underline underline-offset-4 cursor-pointer";

export const AccountIconPickerModal: React.FC<AccountIconPickerModalProps> = ({
  isOpen,
  onClose,
  accountType,
  accountName,
  institution,
  balance = 0,
  currentIcon,
  currentColor,
  onSave,
}) => {
  const meta = getAccountTypeMeta(accountType);

  const [selectedIcon, setSelectedIcon] = useState<string>(
    currentIcon || meta.defaultIcon || "wallet"
  );
  const [selectedColor, setSelectedColor] = useState<string>(
    currentColor || meta.defaultColor || "#10B981"
  );
  const [activeCategory, setActiveCategory] = useState<
    "all" | "banking" | "registered" | "growth" | "debt" | "assets"
  >("all");

  if (!isOpen) return null;

  const categories = [
    { id: "all", label: "All icons" },
    { id: "registered", label: "Registered (CRA)" },
    { id: "banking", label: "Banking" },
    { id: "growth", label: "Investments" },
    { id: "debt", label: "Loans and debt" },
    { id: "assets", label: "Assets" },
  ] as const;

  const filteredIcons =
    activeCategory === "all"
      ? ICON_PALETTE
      : ICON_PALETTE.filter((i) => i.category === activeCategory);

  const handleApply = () => {
    onSave(selectedIcon, selectedColor);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end md:items-center justify-center md:p-4 bg-black/60 animate-in fade-in">
      <div className="w-full md:max-w-xl rounded-t-2xl md:rounded-2xl bg-surface elevation-3 overflow-hidden flex flex-col max-h-[92dvh] md:max-h-[90vh] pb-[env(safe-area-inset-bottom)] animate-in sheet-enter">
        {/* Header */}
        <div className="px-6 pt-6 pb-2 md:px-8 md:pt-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-semibold text-main">Account icon and colour</h3>
            <p className="text-sm text-sub mt-1">
              Pick an icon and a color to tell this account apart
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={iconButton}
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="px-6 py-4 md:px-8 overflow-y-auto space-y-8 text-base">
          {/* Live Card Preview */}
          <div>
            <label className={`${sectionLabel} mb-2`}>Preview</label>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <AccountIcon
                  type={accountType}
                  icon={selectedIcon}
                  color={selectedColor}
                  size="lg"
                />
                <div className="min-w-0">
                  <div className="text-base font-medium text-main break-words">
                    {accountName || meta.name}
                  </div>
                  <div className="text-sm text-sub mt-0.5 break-words">
                    {institution || "Institution"} · {meta.shortName}
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <Money value={balance} className="block text-lg font-medium text-main" />
                <div className="text-sm text-sub mt-1">Current balance</div>
              </div>
            </div>
          </div>

          {/* Color Palette Swatches */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 mb-2">
              <label className={sectionLabel}>Color</label>
              <button
                type="button"
                onClick={() => setSelectedColor(meta.defaultColor)}
                className={linkButton}
              >
                Reset to default ({meta.shortName})
              </button>
            </div>

            <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
              {COLOR_SWATCHES.map((swatch: ColorSwatch) => {
                const isSelected =
                  selectedColor.toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    title={swatch.name}
                    aria-label={swatch.name}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedColor(swatch.hex)}
                    className={`h-11 md:h-8 rounded-lg flex items-center justify-center cursor-pointer ${
                      isSelected
                        ? "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-surface)]"
                        : ""
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  >
                    {isSelected && <Check className="w-4 h-4 text-white" strokeWidth={2} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Icon Category Tabs & Glyphs Grid */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 mb-2">
              <label className={sectionLabel}>Icon</label>
              <button
                type="button"
                onClick={() => setSelectedIcon(meta.defaultIcon)}
                className={linkButton}
              >
                Reset to default icon
              </button>
            </div>

            {/* Category Tabs */}
            <div className="flex flex-wrap gap-x-1 mb-3">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  className={chipTab(activeCategory === c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Icons Grid */}
            <div className={`grid grid-cols-4 sm:grid-cols-7 gap-2 md:max-h-52 md:overflow-y-auto p-1 ${scrollList}`}>
              {filteredIcons.map((opt: IconOption) => {
                const isSelected = selectedIcon === opt.id;
                const IconComponent = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.name}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedIcon(opt.id)}
                    className={`min-h-14 min-w-0 flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors cursor-pointer ${
                      isSelected ? "bg-accent-subtle text-accent-subtle" : "bg-surface-hover text-sub"
                    }`}
                  >
                    <IconComponent
                      className="w-5 h-5"
                      style={{ color: isSelected ? selectedColor : undefined, strokeWidth: 1.5 }}
                    />
                    <span className="text-xs break-words w-full text-center">
                      {opt.name.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 md:px-8 md:pb-6 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className={primaryButton}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
