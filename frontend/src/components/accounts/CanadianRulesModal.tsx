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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-800/80 flex items-start justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <AccountIcon type={meta.type} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100">{meta.name}</h3>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {meta.badge}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{meta.description}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Key CRA & Regulatory Rules */}
          <div>
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Key Canadian Rules & Regulations
            </h4>
            <div className="space-y-2">
              {meta.keyRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 text-slate-300"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                  <span className="leading-relaxed">{rule}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Official Government Documentation */}
          {meta.craUrl && (
            <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-800/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-200">Official Government of Canada Guide</div>
                  <div className="text-[11px] text-slate-400">
                    Review CRA / FCAC statutory guidelines & limits
                  </div>
                </div>
              </div>

              <a
                href={meta.craUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition-colors"
              >
                <span>Canada.ca</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Quick Account Switcher */}
          <div className="pt-3 border-t border-slate-800/80">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Explore Other Canadian Account Types
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(CANADIAN_ACCOUNT_TYPES).map((item) => (
                <button
                  key={item.type}
                  onClick={() => onSelectType ? onSelectType(item.type) : undefined}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                    item.type === meta.type
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/50"
                  }`}
                >
                  {item.shortName}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
