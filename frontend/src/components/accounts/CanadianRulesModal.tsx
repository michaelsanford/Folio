import React from "react";
import { ExternalLink, ShieldCheck, Info, X } from "lucide-react";
import type { AccountType } from "../../types";
import { getAccountTypeMeta, CANADIAN_ACCOUNT_TYPES } from "../../constants/canadianAccountTypes";
import { AccountIcon } from "../common/AccountIcon";

interface CanadianRulesModalProps {
  accountType: AccountType;
  isOpen: boolean;
  onClose: () => void;
  onSelectType?: (type: AccountType) => void;
}

export const CanadianRulesModal: React.FC<CanadianRulesModalProps> = ({
  accountType,
  isOpen,
  onClose,
  onSelectType,
}) => {
  if (!isOpen) return null;

  const meta = getAccountTypeMeta(accountType);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-xl rounded-2xl bg-surface border border-default shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-subtle flex items-start justify-between bg-surface-subtle">
          <div className="flex items-center gap-3.5">
            <AccountIcon type={meta.type} size="lg" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-main">{meta.name}</h3>
                <span className="px-2 py-0.5 rounded-md text-xs font-semibold font-mono bg-accent-subtle text-accent-subtle border border-accent-main/30">
                  {meta.badge}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">{meta.description}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-main transition-colors rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {/* Key CRA & Regulatory Rules */}
          <div>
            <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-positive" />
              Key Canadian Rules & Regulations
            </h4>
            <div className="space-y-2">
              {meta.keyRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-subtle border border-subtle text-sub text-xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-main mt-1.5 shrink-0" />
                  <span className="leading-relaxed">{rule}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Official Government Documentation */}
          {meta.craUrl && (
            <div className="p-3.5 rounded-xl bg-surface-subtle border border-default flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Info className="w-4 h-4 text-accent-main shrink-0" />
                <div>
                  <div className="font-semibold text-main text-xs">Official Government of Canada Guide</div>
                  <div className="text-[11px] text-muted">
                    Review CRA / FCAC statutory guidelines & limits
                  </div>
                </div>
              </div>

              <a
                href={meta.craUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast font-semibold text-xs shadow-xs transition-colors shrink-0"
              >
                <span>Canada.ca</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Quick Account Switcher */}
          <div className="pt-3.5 border-t border-subtle">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Explore Other Canadian Account Types
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(CANADIAN_ACCOUNT_TYPES).map((item) => (
                <button
                  key={item.type}
                  onClick={() => onSelectType ? onSelectType(item.type) : undefined}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    item.type === meta.type
                      ? "bg-accent-main text-accent-contrast shadow-xs"
                      : "bg-surface hover:bg-surface-hover text-sub border border-default"
                  }`}
                >
                  {item.shortName}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-subtle bg-surface-subtle flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover border border-default text-sub font-semibold text-xs transition-colors cursor-pointer"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
