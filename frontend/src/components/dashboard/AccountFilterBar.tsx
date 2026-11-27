import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { AccountIcon } from "../common/AccountIcon";
import { ACCOUNT_FAMILIES, accountFamily, type AccountFamily } from "../../constants/canadianAccountTypes";
import type { Account } from "../../types";
import { useSession } from "../../hooks/useSession";
import { raised } from "../common/ui";

interface AccountFilterBarProps {
  accounts: Account[];
  hiddenAccountIds: readonly string[];
  onHiddenAccountsChange: (ids: string[]) => void;
}

// Filled chips: the accent tint marks what is counted; a dashed accent edge marks a part-counted group.
const pill =
  "inline-flex items-center gap-1.5 min-h-11 md:min-h-9 px-4 py-1 rounded-full border text-base md:text-sm transition-colors cursor-pointer";
const pillOn = "border-transparent bg-accent-subtle text-accent-subtle font-semibold";
const pillPartial = "border-dashed border-[var(--accent-primary)] text-main";
const pillOff = "border-transparent bg-surface-subtle text-sub hover:text-main";

/**
 * Which accounts the dashboard counts. Family chips include or exclude a whole
 * group at once and appear only for groups the household actually has; the
 * Accounts menu picks single accounts.
 */
export const AccountFilterBar: React.FC<AccountFilterBarProps> = ({
  accounts,
  hiddenAccountIds,
  onHiddenAccountsChange,
}) => {
  const hidden = useMemo(() => new Set(hiddenAccountIds), [hiddenAccountIds]);

  const families = useMemo(() => {
    const byFamily = new Map<AccountFamily, Account[]>();
    for (const account of accounts) {
      const family = accountFamily(account.type);
      byFamily.set(family, [...(byFamily.get(family) ?? []), account]);
    }
    return ACCOUNT_FAMILIES.filter(([id]) => byFamily.has(id)).map(([id, label]) => {
      const members = byFamily.get(id)!;
      const shown = members.filter((a) => !hidden.has(a.id)).length;
      return { id, label, members, state: shown === members.length ? "on" : shown === 0 ? "off" : "partial" };
    });
  }, [accounts, hidden]);

  // Ids of accounts that no longer exist are dropped whenever the selection changes.
  const known = useMemo(() => new Set(accounts.map((a) => a.id)), [accounts]);
  const commit = (next: Set<string>) => onHiddenAccountsChange([...next].filter((id) => known.has(id)));

  const toggleFamily = (members: Account[], state: string) => {
    const next = new Set(hidden);
    // A fully shown family hides; a partial or hidden one is shown in full.
    for (const a of members) state === "on" ? next.add(a.id) : next.delete(a.id);
    commit(next);
  };

  const toggleAccount = (id: string) => {
    const next = new Set(hidden);
    next.has(id) ? next.delete(id) : next.add(id);
    commit(next);
  };

  const hiddenCount = accounts.filter((a) => hidden.has(a.id)).length;

  // "Mine": accounts you own (alone or jointly) plus shared ones (no owner),
  // once you are linked to a member and some accounts belong only to others.
  const myMemberId = useSession().me?.member_id ?? null;
  const notMine = useMemo(
    () =>
      myMemberId
        ? accounts.filter(
            (a) => (a.owner_member_ids?.length ?? 0) > 0 && !(a.owner_member_ids ?? []).includes(myMemberId)
          )
        : [],
    [accounts, myMemberId]
  );
  const showMine = !!myMemberId && notMine.length > 0 && notMine.length < accounts.length;
  const mineOnly =
    showMine &&
    notMine.every((a) => hidden.has(a.id)) &&
    accounts.every((a) => notMine.includes(a) || !hidden.has(a.id));

  // Accounts menu, portaled so no card's overflow or stacking clips it.
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      setMenuPos({
        top: rect.bottom + 6,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        maxHeight: Math.max(200, window.innerHeight - rect.bottom - 24),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (accounts.length === 0) return null;

  return (
    <div role="group" aria-label="Accounts on the dashboard" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={hiddenCount === 0}
        onClick={() => commit(new Set())}
        className={`${pill} ${hiddenCount === 0 ? pillOn : pillOff}`}
      >
        All accounts
      </button>

      {showMine && (
        <button
          type="button"
          aria-pressed={mineOnly}
          title="Your accounts and shared ones without an owner"
          onClick={() => commit(mineOnly ? new Set() : new Set(notMine.map((a) => a.id)))}
          className={`${pill} ${mineOnly ? pillOn : pillOff}`}
        >
          Mine
        </button>
      )}

      {families.length > 1 &&
        families.map(({ id, label, members, state }) => (
          <button
            key={id}
            type="button"
            aria-pressed={state === "on" ? true : state === "off" ? false : "mixed"}
            onClick={() => toggleFamily(members, state)}
            className={`${pill} ${state === "on" ? pillOn : state === "partial" ? pillPartial : pillOff}`}
          >
            {label}
            <span className="text-sm tabular-nums opacity-80">{members.length}</span>
          </button>
        ))}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((o) => !o)}
        className={`${pill} ${pillOff}`}
      >
        {hiddenCount === 0 ? "Accounts" : `${accounts.length - hiddenCount} of ${accounts.length} accounts`}
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} strokeWidth={1.5} />
      </button>

      {isOpen &&
        menuPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
            <div
              role="menu"
              aria-label="Choose accounts"
              style={{ position: "fixed", top: menuPos.top, left: menuPos.left, maxHeight: menuPos.maxHeight }}
              className={`z-[101] w-72 overflow-y-auto rounded-lg ${raised} p-1 animate-in fade-in zoom-in-95`}
            >
              {accounts.map((a) => {
                const shown = !hidden.has(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={shown}
                    onClick={() => toggleAccount(a.id)}
                    className="w-full flex items-center gap-3 px-2 min-h-12 py-1.5 rounded-lg text-left bg-surface-hover transition-colors cursor-pointer"
                  >
                    <span
                      className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                        shown ? "bg-accent-main border-[var(--accent-primary)] text-accent-contrast" : "border-default"
                      }`}
                    >
                      {shown && <Check className="w-3 h-3" strokeWidth={2.5} />}
                    </span>
                    <AccountIcon type={a.type} icon={a.icon} color={a.color} size="sm" />
                    <span className="min-w-0">
                      <span className={`block text-base md:text-sm break-words ${shown ? "text-main" : "text-sub"}`}>{a.name}</span>
                      {a.institution && <span className="block text-sm text-sub break-words">{a.institution}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </div>
  );
};
