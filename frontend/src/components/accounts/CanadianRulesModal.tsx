import React from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import type { AccountType } from "../../types";
import { getAccountTypeMeta, CANADIAN_ACCOUNT_TYPES } from "../../constants/canadianAccountTypes";
import { AccountIcon } from "../common/AccountIcon";
import { iconButton, secondaryButton } from "../common/ui";

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

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end md:items-center justify-center md:p-4 bg-black/60 animate-in fade-in">
      <div className="w-full md:max-w-xl rounded-t-2xl md:rounded-2xl bg-surface elevation-3 overflow-hidden flex flex-col max-h-[92dvh] md:max-h-[90vh] pb-[env(safe-area-inset-bottom)] animate-in sheet-enter">
        {/* Header */}
        <div className="px-6 pt-6 pb-2 md:px-8 md:pt-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <AccountIcon type={meta.type} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-xl font-semibold text-main break-words">{meta.name}</h3>
                <span className="rounded-md px-1.5 py-0.5 text-sm font-mono bg-surface-subtle text-sub">
                  {meta.badge}
                </span>
              </div>
              <p className="text-sm text-sub mt-1">{meta.description}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className={iconButton}
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 md:px-8 overflow-y-auto space-y-8 text-base">
          {/* Key CRA & Regulatory Rules */}
          <div>
            <h4 className="text-base font-semibold text-main mb-3">Key rules</h4>
            <ul className="space-y-2">
              {meta.keyRules.map((rule, idx) => (
                <li key={idx} className="flex items-start gap-3 text-base text-sub">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)] mt-2.5 shrink-0" />
                  <span className="leading-relaxed min-w-0 break-words">{rule}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Official Government Documentation */}
          {meta.craUrl && (
            <div className="p-4 rounded-lg bg-surface-subtle flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-base font-semibold text-main">Government of Canada guide</div>
                <div className="text-sm text-sub mt-0.5">
                  CRA and FCAC guidelines and limits
                </div>
              </div>

              <a
                href={meta.craUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${secondaryButton} shrink-0`}
              >
                <span>Canada.ca</span>
                <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
              </a>
            </div>
          )}

          {/* Quick Account Switcher */}
          <div>
            <h4 className="text-base font-semibold text-main mb-3">Other account types</h4>
            <div className="flex flex-wrap gap-1">
              {Object.values(CANADIAN_ACCOUNT_TYPES).map((item) => (
                <button
                  key={item.type}
                  onClick={() => onSelectType ? onSelectType(item.type) : undefined}
                  aria-pressed={item.type === meta.type}
                  className={`min-h-11 md:min-h-9 px-3 rounded-lg text-base md:text-sm transition-colors cursor-pointer ${
                    item.type === meta.type
                      ? "bg-accent-subtle text-accent-subtle font-semibold"
                      : "text-sub hover:text-main bg-surface-hover"
                  }`}
                >
                  {item.shortName}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 md:px-8 md:pb-6 flex justify-end">
          <button
            onClick={onClose}
            className={secondaryButton}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
