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

const sectionLabel = "block text-sm text-sub";
const linkButton = "text-xs text-accent-subtle hover:underline underline-offset-4 cursor-pointer";
const tabClass = (active: boolean) =>
  `h-8 px-3 rounded-lg text-xs whitespace-nowrap border transition-colors cursor-pointer ${
    active
      ? "bg-surface-subtle border-default text-main font-medium"
      : "border-transparent text-sub hover:text-main bg-surface-hover"
  }`;

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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
      <div className="w-full max-w-xl rounded-xl bg-surface border border-default shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-subtle flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-main">Account icon and colour</h3>
            <p className="text-sm text-sub mt-1">
              Pick an icon and a color to tell this account apart
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 shrink-0 flex items-center justify-center text-muted hover:text-main rounded-lg bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-6 text-sm">
          {/* Live Card Preview */}
          <div>
            <label className={`${sectionLabel} mb-2`}>Preview</label>
            <div className="p-4 rounded-xl bg-surface-subtle border border-subtle flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <AccountIcon
                  type={accountType}
                  icon={selectedIcon}
                  color={selectedColor}
                  size="lg"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-main truncate">
                    {accountName || meta.name}
                  </div>
                  <div className="text-xs text-muted mt-0.5 truncate">
                    {institution || "Institution"} · {meta.shortName}
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <Money value={balance} className="block text-base font-medium text-main" />
                <div className="text-xs text-muted mt-1">Current balance</div>
              </div>
            </div>
          </div>

          {/* Color Palette Swatches */}
          <div>
            <div className="flex items-center justify-between mb-2">
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
                    className={`h-8 rounded-lg flex items-center justify-center cursor-pointer ${
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
            <div className="flex items-center justify-between mb-2">
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
            <div className="flex gap-1 overflow-x-auto pb-1 mb-2 no-scrollbar">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  className={tabClass(activeCategory === c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Icons Grid */}
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 max-h-52 overflow-y-auto p-1 pr-2">
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
                    className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-accent-subtle border-accent-main/40 text-main"
                        : "border-subtle bg-surface-hover text-sub"
                    }`}
                  >
                    <IconComponent
                      className="w-4 h-4"
                      style={{ color: isSelected ? selectedColor : undefined, strokeWidth: 1.5 }}
                    />
                    <span className="text-[11px] text-muted truncate w-full text-center">
                      {opt.name.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-subtle flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
