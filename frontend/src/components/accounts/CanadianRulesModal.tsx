import React from "react";
import { ExternalLink, X } from "lucide-react";
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
      <div className="w-full max-w-xl rounded-xl bg-surface border border-default shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-subtle flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <AccountIcon type={meta.type} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-medium text-main">{meta.name}</h3>
                <span className="rounded-md px-1.5 py-0.5 text-xs font-mono bg-surface-subtle text-sub">
                  {meta.badge}
                </span>
              </div>
              <p className="text-sm text-sub mt-1">{meta.description}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 shrink-0 flex items-center justify-center text-muted hover:text-main bg-surface-hover transition-colors rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-6 text-sm">
          {/* Key CRA & Regulatory Rules */}
          <div>
            <h4 className="text-sm font-medium text-main mb-3">Key rules</h4>
            <ul className="space-y-2">
              {meta.keyRules.map((rule, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm text-sub">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] mt-2 shrink-0" />
                  <span className="leading-relaxed">{rule}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Official Government Documentation */}
          {meta.craUrl && (
            <div className="p-4 rounded-xl bg-surface-subtle border border-subtle flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-main">Government of Canada guide</div>
                <div className="text-xs text-muted mt-0.5">
                  CRA and FCAC guidelines and limits
                </div>
              </div>

              <a
                href={meta.craUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 px-4 inline-flex items-center gap-2 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors shrink-0"
              >
                <span>Canada.ca</span>
                <ExternalLink className="w-4 h-4 text-muted" strokeWidth={1.5} />
              </a>
            </div>
          )}

          {/* Quick Account Switcher */}
          <div className="pt-4 border-t border-subtle">
            <div className="text-sm text-sub mb-2">Other account types</div>
            <div className="flex flex-wrap gap-1">
              {Object.values(CANADIAN_ACCOUNT_TYPES).map((item) => (
                <button
                  key={item.type}
                  onClick={() => onSelectType ? onSelectType(item.type) : undefined}
                  aria-pressed={item.type === meta.type}
                  className={`h-7 px-2 rounded-md text-xs border transition-colors cursor-pointer ${
                    item.type === meta.type
                      ? "bg-accent-subtle text-accent-subtle border-accent-main/30 font-medium"
                      : "border-default text-sub hover:text-main bg-surface-hover"
                  }`}
                >
                  {item.shortName}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-subtle flex justify-end">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
