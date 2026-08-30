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
    currentColor || meta.defaultColor || "#6366F1"
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-100">
              Customize Account Glyph & Color
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Choose a representative icon and accent hue for your account
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm">
          {/* Live Card Preview */}
          <div>
            <label className="block text-slate-300 font-semibold uppercase tracking-wider text-xs mb-2.5">
              Live Preview
            </label>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 shadow-lg flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <AccountIcon
                  type={accountType}
                  icon={selectedIcon}
                  color={selectedColor}
                  size="lg"
                />
                <div>
                  <div className="text-sm font-bold text-slate-100">
                    {accountName || meta.name}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {institution || "Institution"} • {meta.shortName}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div
                  className="text-lg font-bold font-mono"
                  style={{ color: selectedColor }}
                >
                  ${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-slate-400">Current Balance</div>
              </div>
            </div>
          </div>

          {/* Color Palette Swatches */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="block text-slate-300 font-semibold uppercase tracking-wider text-xs">
                Accent Color Swatch
              </label>
              <button
                type="button"
                onClick={() => setSelectedColor(meta.defaultColor)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Reset to Type Default ({meta.shortName})
              </button>
            </div>

            <div className="grid grid-cols-6 sm:grid-cols-12 gap-2.5">
              {COLOR_SWATCHES.map((swatch: ColorSwatch) => {
                const isSelected =
                  selectedColor.toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    title={swatch.name}
                    onClick={() => setSelectedColor(swatch.hex)}
                    className={`h-9 rounded-xl flex items-center justify-center transition-transform hover:scale-105 border ${
                      isSelected
                        ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900 border-white"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  >
                    {isSelected && <Check className="w-4 h-4 text-white drop-shadow-md" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Icon Category Tabs & Glyphs Grid */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="block text-slate-300 font-semibold uppercase tracking-wider text-xs">
                Icon Glyph Selection
              </label>
              <button
                type="button"
                onClick={() => setSelectedIcon(meta.defaultIcon)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Reset to Default Icon
              </button>
            </div>

            {/* Category Tabs */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 no-scrollbar">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    activeCategory === c.id
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Icons Grid */}
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2.5 max-h-60 overflow-y-auto p-1.5 pr-2">
              {filteredIcons.map((opt: IconOption) => {
                const isSelected = selectedIcon === opt.id;
                const IconComponent = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedIcon(opt.id)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-indigo-950/60 border-indigo-500 shadow-md ring-1 ring-indigo-500"
                        : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600 text-slate-300 hover:text-white"
                    }`}
                  >
                    <IconComponent
                      className="w-5 h-5 mb-1.5"
                      style={{ color: isSelected ? selectedColor : undefined }}
                    />
                    <span className="text-[10px] text-slate-400 font-medium truncate w-full text-center">
                      {opt.name.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-500/20 transition-all"
          >
            Apply Glyph & Color
          </button>
        </div>
      </div>
    </div>
  );
};
