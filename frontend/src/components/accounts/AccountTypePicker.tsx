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
    { id: "ALL", label: "All types" },
    { id: "REGISTERED", label: "Registered (CRA)" },
    { id: "CASH", label: "Cash and banking" },
    { id: "INVESTMENT", label: "Investments" },
    { id: "DEBT", label: "Loans and debt" },
    { id: "ASSET", label: "Physical assets" },
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
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-3 px-3 py-3 bg-input border border-default rounded-lg text-left transition-colors group cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <AccountIcon type={currentMeta.type} size="md" />
          <div className="truncate flex-1">
            <div className="text-sm font-medium text-main flex items-center gap-2 truncate">
              <span>{currentMeta.name}</span>
              <span className="rounded-md px-1.5 py-0.5 text-xs font-mono font-normal bg-surface-subtle text-sub shrink-0">
                {currentMeta.badge}
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5 truncate">
              {ACCOUNT_CATEGORY_LABELS[currentMeta.category]} · {currentMeta.description}
            </div>
          </div>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-muted group-hover:text-main transition-transform shrink-0 ${
            isOpen ? "rotate-180" : ""
          }`}
          strokeWidth={1.5}
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
              className="z-[101] rounded-xl bg-surface border border-default shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95"
            >
              {/* Search and Category Filter Tabs */}
              <div className="p-3 border-b border-subtle space-y-3 shrink-0">
                <div className="relative">
                  <Search
                    className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    strokeWidth={1.5}
                  />
                  <input
                    type="text"
                    placeholder="Search account types"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 bg-input border border-default rounded-lg text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                    autoFocus
                  />
                </div>

                {/* Category Tabs */}
                <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCategory(c.id)}
                      className={`h-7 px-2 rounded-md text-xs whitespace-nowrap border transition-colors cursor-pointer ${
                        selectedCategory === c.id
                          ? "bg-surface-subtle border-default text-main font-medium"
                          : "border-transparent text-sub hover:text-main bg-surface-hover"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* List of Account Types */}
              <div className="overflow-y-auto p-1 flex flex-col gap-0.5 flex-1">
                {filteredTypes.length > 0 ? (
                  filteredTypes.map((item) => {
                    const isSelected = item.type === value;
                    return (
                      <div
                        key={item.type}
                        className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-colors ${
                          isSelected ? "bg-accent-subtle" : "bg-surface-hover"
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
                              <span className="text-sm font-medium text-main">
                                {item.name}
                              </span>
                              <span className="rounded-md px-1.5 py-0.5 text-[11px] font-mono bg-surface-subtle text-sub shrink-0">
                                {item.badge}
                              </span>
                            </div>
                            <p className="text-xs text-muted line-clamp-2 mt-0.5 leading-relaxed">
                              {item.description}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            title="Canadian rules"
                            aria-label={`Canadian rules for ${item.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInfoType(item.type);
                            }}
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-main transition-colors cursor-pointer"
                          >
                            <Info className="w-4 h-4" strokeWidth={1.5} />
                          </button>

                          {isSelected ? (
                            <Check className="w-4 h-4 text-accent-subtle" strokeWidth={1.5} />
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-sm text-muted">
                    No account types match your search
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
