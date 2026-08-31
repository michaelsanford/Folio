import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Landmark, Check, ChevronDown, X } from "lucide-react";
import {
  searchCanadianInstitutions,
  type CanadianInstitution,
} from "../../constants/canadianInstitutions";

interface InstitutionAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const InstitutionAutocomplete: React.FC<InstitutionAutocompleteProps> = ({
  value,
  onChange,
  placeholder = "e.g. RBC, TD, Wealthsimple, Questrade",
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const filtered = searchCanadianInstitutions(value);

  const updatePosition = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;

    const openDownwards = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(
      320,
      Math.max(160, (openDownwards ? spaceBelow : spaceAbove) - 16)
    );
    const top = openDownwards
      ? rect.bottom + 4
      : Math.max(margin, rect.top - maxHeight - 4);

    setPopoverStyle({
      top,
      left: rect.left,
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

  const handleSelect = (inst: CanadianInstitution) => {
    onChange(inst.shortName);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        e.preventDefault();
        handleSelect(filtered[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          className="w-full pl-3 pr-8 py-2 bg-input border border-default hover:border-strong focus:border-accent-main focus:ring-1 focus:ring-accent-main rounded-xl text-main text-sm transition-all placeholder:text-muted"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
              className="p-1 text-muted hover:text-main rounded-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="p-1 text-muted hover:text-main rounded-md"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Popover Portal */}
      {isOpen &&
        popoverStyle &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setIsOpen(false)}
            />

            <div
              style={{
                position: "fixed",
                top: `${popoverStyle.top}px`,
                left: `${popoverStyle.left}px`,
                width: `${popoverStyle.width}px`,
                maxHeight: `${popoverStyle.maxHeight}px`,
              }}
              className="z-[101] rounded-xl bg-surface border border-default shadow-2xl overflow-y-auto p-1.5 space-y-1 animate-in fade-in zoom-in-95 text-sm"
            >
              {filtered.length > 0 ? (
                filtered.map((inst, index) => {
                  const isSelected =
                    value.toLowerCase() === inst.shortName.toLowerCase() ||
                    value.toLowerCase() === inst.name.toLowerCase();
                  const isHighlighted = index === highlightedIndex;

                  return (
                    <button
                      key={inst.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(inst);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all cursor-pointer ${
                        isHighlighted || isSelected
                          ? "bg-accent-subtle text-accent-subtle border border-accent-main/30"
                          : "text-sub hover:bg-surface-hover hover:text-main"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Landmark className="w-4 h-4 text-accent-main shrink-0" />
                        <div className="truncate">
                          <span className="font-semibold text-xs text-main">
                            {inst.shortName}
                          </span>
                          <span className="text-[11px] text-muted ml-2 truncate">
                            {inst.name !== inst.shortName ? inst.name : ""}
                          </span>
                        </div>
                      </div>

                      {isSelected && <Check className="w-3.5 h-3.5 text-accent-main shrink-0 ml-1" />}
                    </button>
                  );
                })
              ) : (
                <div className="p-3 text-center text-xs text-muted">
                  Press enter to use &quot;<span className="text-main font-semibold">{value}</span>&quot;
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
};
