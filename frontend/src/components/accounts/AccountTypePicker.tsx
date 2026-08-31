import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Search, Info, Check, ChevronDown } from "lucide-react";
import type { AccountType } from "../../types";
import {
  CANADIAN_ACCOUNT_TYPES,
  ACCOUNT_CATEGORY_LABELS,
  type AccountCategoryGroup,
  getAccountTypeMeta,
} from "../../constants/canadianAccountTypes";
import { AccountIcon } from "../common/AccountIcon";
import { CanadianRulesModal } from "./CanadianRulesModal";

interface AccountTypePickerProps {
  value: AccountType;
  onChange: (type: AccountType) => void;
  className?: string;
}

export const AccountTypePicker: React.FC<AccountTypePickerProps> = ({
  value,
  onChange,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<AccountCategoryGroup | "ALL">("ALL");
  const [infoType, setInfoType] = useState<AccountType | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const currentMeta = getAccountTypeMeta(value);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 12;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;

    const openDownwards = spaceBelow >= 260 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(
      520,
      Math.max(240, (openDownwards ? spaceBelow : spaceAbove) - 16)
    );
    const top = openDownwards ? rect.bottom + 6 : Math.max(margin, rect.top - maxHeight - 6);

    setPopoverStyle({
      top,
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin)),
      width: rect.width,
      maxHeight,
    });
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleReposition = () => updatePosition();
      window.addEventListener("resize", handleReposition);
      window.addEventListener("scroll", handleReposition, true);
      return () => {
        window.removeEventListener("resize", handleReposition);
        window.removeEventListener("scroll", handleReposition, true);
      };
    }
  }, [isOpen]);

  const categories: Array<{ id: AccountCategoryGroup | "ALL"; label: string }> = [
    { id: "ALL", label: "All Types" },
    { id: "REGISTERED", label: "Registered (CRA)" },
    { id: "CASH", label: "Cash & Banking" },
    { id: "INVESTMENT", label: "Investments" },
    { id: "DEBT", label: "Loans & Debt" },
    { id: "ASSET", label: "Physical Assets" },
  ];

  const allTypes = Object.values(CANADIAN_ACCOUNT_TYPES);

  const filteredTypes = allTypes.filter((item) => {
    const matchesCategory = selectedCategory === "ALL" || item.category === selectedCategory;
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.shortName.toLowerCase().includes(q) ||
      item.badge.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className={`relative ${className}`}>
      {/* Selector Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3.5 bg-input border border-default hover:border-strong rounded-xl text-left transition-all shadow-xs group cursor-pointer"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <AccountIcon type={currentMeta.type} size="md" />
          <div className="truncate flex-1">
            <div className="text-sm font-bold text-main flex items-center gap-2.5 truncate">
              <span>{currentMeta.name}</span>
              <span
                className="px-2 py-0.5 rounded-md text-xs font-semibold border shrink-0 font-mono"
                style={{
                  backgroundColor: `${currentMeta.defaultColor}15`,
                  color: currentMeta.defaultColor,
                  borderColor: `${currentMeta.defaultColor}30`,
                }}
              >
                {currentMeta.badge}
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5 truncate">
              {ACCOUNT_CATEGORY_LABELS[currentMeta.category]} • {currentMeta.description}
            </div>
          </div>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-muted group-hover:text-main transition-transform ml-2 shrink-0 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Floating Popover Portal */}
      {isOpen &&
        popoverStyle &&
        createPortal(
          <>
            {/* Backdrop click dismiss */}
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown Panel */}
            <div
              style={{
                position: "fixed",
                top: `${popoverStyle.top}px`,
                left: `${popoverStyle.left}px`,
                width: `${popoverStyle.width}px`,
                maxHeight: `${popoverStyle.maxHeight}px`,
              }}
              className="z-[101] rounded-2xl bg-surface border border-default shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95"
            >
              {/* Search and Category Filter Tabs */}
              <div className="p-3.5 border-b border-subtle bg-surface-subtle space-y-3 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-muted absolute left-3.5 top-3" />
                  <input
                    type="text"
                    placeholder="Search accounts (TFSA, RRSP, FHSA, Chequing, Mortgage...)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-input border border-default rounded-xl text-xs text-main placeholder:text-muted focus:outline-hidden focus:ring-1 focus:ring-accent-main transition-all"
                    autoFocus
                  />
                </div>

                {/* Category Pills */}
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCategory(c.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                        selectedCategory === c.id
                          ? "bg-accent-main text-accent-contrast shadow-xs"
                          : "bg-surface hover:bg-surface-hover text-sub border border-default"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* List of Account Types */}
              <div className="overflow-y-auto p-2 space-y-1 divide-y divide-subtle flex-1">
                {filteredTypes.length > 0 ? (
                  filteredTypes.map((item) => {
                    const isSelected = item.type === value;
                    return (
                      <div
                        key={item.type}
                        className={`group flex items-center justify-between p-3 rounded-xl transition-all ${
                          isSelected
                            ? "bg-accent-subtle border border-accent-main/40 shadow-xs"
                            : "hover:bg-surface-hover"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onChange(item.type);
                            setIsOpen(false);
                          }}
                          className="flex items-start gap-3 text-left flex-1 min-w-0 cursor-pointer"
                        >
                          <div className="mt-0.5">
                            <AccountIcon type={item.type} size="md" />
                          </div>
                          <div className="truncate flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-main">
                                {item.name}
                              </span>
                              <span
                                className="px-2 py-0.5 rounded-md text-[10px] font-semibold border shrink-0 font-mono"
                                style={{
                                  backgroundColor: `${item.defaultColor}15`,
                                  color: item.defaultColor,
                                  borderColor: `${item.defaultColor}30`,
                                }}
                              >
                                {item.badge}
                              </span>
                            </div>
                            <p className="text-xs text-muted line-clamp-2 mt-0.5 leading-relaxed">
                              {item.description}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          <button
                            type="button"
                            title="View Canadian Rules & Regulations"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInfoType(item.type);
                            }}
                            className="p-1.5 rounded-lg text-muted hover:text-accent-main hover:bg-surface transition-colors cursor-pointer"
                          >
                            <Info className="w-4 h-4" />
                          </button>

                          {isSelected ? (
                            <div className="w-5 h-5 rounded-full bg-accent-main flex items-center justify-center text-accent-contrast shadow-xs">
                              <Check className="w-3 h-3" />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-xs text-muted">
                    No Canadian account types match your search.
                  </div>
                )}
              </div>
            </div>
          </>,
          document.body
        )}

      {/* Embedded Rules Modal */}
      {infoType && (
        <CanadianRulesModal
          accountType={infoType}
          isOpen={!!infoType}
          onClose={() => setInfoType(null)}
          onSelectType={(newType) => {
            onChange(newType);
            setInfoType(null);
            setIsOpen(false);
          }}
        />
      )}
    </div>
  );
};
