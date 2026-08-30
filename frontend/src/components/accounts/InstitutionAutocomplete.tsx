import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Landmark, Check, ChevronDown, X } from "lucide-react";
import {
  CANADIAN_INSTITUTIONS,
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
          className="w-full pl-3.5 pr-8 py-2.5 bg-slate-800/90 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-slate-100 text-xs transition-all placeholder:text-slate-500"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
              className="p-1 text-slate-400 hover:text-slate-200 rounded-md"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="p-1 text-slate-400 hover:text-slate-200 rounded-md"
            >
              <ChevronDown className="w-3.5 h-3.5" />
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
              className="z-[101] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-y-auto p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 text-xs"
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
                        e.preventDefault(); // Prevent blur before click
                        handleSelect(inst);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all ${
                        isHighlighted || isSelected
                          ? "bg-indigo-950/60 text-indigo-200 border border-indigo-700/40"
                          : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Landmark className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <div className="truncate">
                          <span className="font-semibold text-xs text-slate-100">
                            {inst.shortName}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-2 truncate">
                            {inst.name !== inst.shortName ? inst.name : ""}
                          </span>
                        </div>
                      </div>

                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 ml-1" />}
                    </button>
                  );
                })
              ) : (
                <div className="p-3 text-center text-xs text-slate-500">
                  Press enter to use &quot;<span className="text-slate-300">{value}</span>&quot;
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
};
