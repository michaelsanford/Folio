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
    { id: "all", label: "All Glyphs" },
    { id: "registered", label: "Registered (CRA)" },
    { id: "banking", label: "Banking" },
    { id: "growth", label: "Investments" },
    { id: "debt", label: "Loans & Debt" },
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-xl rounded-2xl bg-surface border border-default shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-subtle bg-surface-subtle flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-main">
              Customize Account Glyph & Color
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Choose a representative icon and accent hue for your account
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted hover:text-main rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {/* Live Card Preview */}
          <div>
            <label className="block text-muted font-semibold uppercase tracking-wider text-xs mb-2">
              Live Preview
            </label>
            <div className="p-4 rounded-xl bg-surface-subtle border border-default shadow-xs flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <AccountIcon
                  type={accountType}
                  icon={selectedIcon}
                  color={selectedColor}
                  size="lg"
                />
                <div>
                  <div className="text-sm font-bold text-main">
                    {accountName || meta.name}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {institution || "Institution"} • {meta.shortName}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div
                  className="text-base font-bold font-mono"
                  style={{ color: selectedColor }}
                >
                  ${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-muted">Current Balance</div>
              </div>
            </div>
          </div>

          {/* Color Palette Swatches */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-muted font-semibold uppercase tracking-wider text-xs">
                Accent Color Swatch
              </label>
              <button
                type="button"
                onClick={() => setSelectedColor(meta.defaultColor)}
                className="text-xs text-accent-main hover:underline font-semibold cursor-pointer"
              >
                Reset to Default ({meta.shortName})
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
                    onClick={() => setSelectedColor(swatch.hex)}
                    className={`h-8 rounded-lg flex items-center justify-center transition-transform hover:scale-105 border cursor-pointer ${
                      isSelected
                        ? "ring-2 ring-accent-main ring-offset-2 ring-offset-surface border-white"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow-md" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Icon Category Tabs & Glyphs Grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-muted font-semibold uppercase tracking-wider text-xs">
                Icon Glyph Selection
              </label>
              <button
                type="button"
                onClick={() => setSelectedIcon(meta.defaultIcon)}
                className="text-xs text-accent-main hover:underline font-semibold cursor-pointer"
              >
                Reset to Default Icon
              </button>
            </div>

            {/* Category Tabs */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2.5 no-scrollbar">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    activeCategory === c.id
                      ? "bg-accent-main text-accent-contrast shadow-xs"
                      : "bg-surface hover:bg-surface-hover text-sub border border-default"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Icons Grid */}
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 max-h-52 overflow-y-auto p-1 pr-1.5">
              {filteredIcons.map((opt: IconOption) => {
                const isSelected = selectedIcon === opt.id;
                const IconComponent = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedIcon(opt.id)}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-accent-subtle border-accent-main shadow-xs ring-1 ring-accent-main"
                        : "bg-surface-subtle border-subtle hover:bg-surface-hover hover:border-default text-sub"
                    }`}
                  >
                    <IconComponent
                      className="w-4 h-4 mb-1"
                      style={{ color: isSelected ? selectedColor : undefined }}
                    />
                    <span className="text-[10px] text-muted font-medium truncate w-full text-center">
                      {opt.name.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-subtle bg-surface-subtle flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-default text-sub font-semibold text-xs hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-5 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast font-semibold text-xs shadow-xs transition-all cursor-pointer"
          >
            Apply Glyph & Color
          </button>
        </div>
      </div>
    </div>
  );
};
