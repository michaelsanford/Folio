import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface SheetAction {
  label: string;
  icon?: React.ElementType;
  onSelect: () => void;
  /** Shown last, in red, set apart from the others. */
  destructive?: boolean;
  disabled?: boolean;
  /** Keep the sheet open after the action (e.g. a toggle). */
  keepOpen?: boolean;
  /** Extra text on the right, such as "On" for a toggle. */
  detail?: string;
}

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  /** Details shown above the actions (complete, wrapped information). */
  children?: React.ReactNode;
  actions?: SheetAction[];
}

const actionRow =
  "w-full min-h-[3.25rem] px-4 flex items-center gap-3 text-left text-base transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-surface-hover active:bg-[var(--bg-surface-hover)]";

/**
 * A bottom sheet for a row's details and its less common actions, used on
 * phones where rows stay read-only. Closes on Escape or a tap outside, and
 * gives focus back to whatever opened it.
 */
export const ActionSheet: React.FC<ActionSheetProps> = ({ open, onClose, title, subtitle, children, actions = [] }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Held in a ref so a caller's inline arrow doesn't re-run the effect (which
  // would bounce focus out of a field inside the sheet on every render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const regular = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);

  const renderAction = (a: SheetAction) => {
    const Icon = a.icon;
    return (
      <li key={a.label}>
        <button
          type="button"
          disabled={a.disabled}
          onClick={() => {
            if (!a.keepOpen) onClose();
            a.onSelect();
          }}
          className={`${actionRow} ${a.destructive ? "text-negative" : "text-main"}`}
        >
          {Icon && <Icon className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
          <span className="flex-1 min-w-0 break-words">{a.label}</span>
          {a.detail && <span className="text-sub text-sm shrink-0">{a.detail}</span>}
        </button>
      </li>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 bg-black/60 animate-in fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="action-sheet-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full md:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-surface elevation-3 pb-[env(safe-area-inset-bottom)] focus:outline-none animate-in sheet-enter"
      >
        <div className="md:hidden flex justify-center pt-2" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-[var(--border-strong)]" />
        </div>
        <div className="flex items-start gap-3 px-4 pt-3 pb-3">
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="font-display text-xl font-semibold text-main break-words">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 text-sm text-sub break-words">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-11 shrink-0 -mr-2 -mt-1 inline-flex items-center justify-center rounded-full text-sub hover:text-main bg-surface-hover cursor-pointer"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>
        {children && <div className="px-4 pb-4">{children}</div>}
        {regular.length > 0 && (
          <ul className="border-t border-subtle divide-y divide-subtle">{regular.map(renderAction)}</ul>
        )}
        {destructive.length > 0 && (
          <ul className="mt-2 border-t border-subtle divide-y divide-subtle">{destructive.map(renderAction)}</ul>
        )}
      </div>
    </div>,
    document.body
  );
};

/** A label/value grid for complete details inside a sheet or phone card. */
export const DetailList: React.FC<{ items: Array<[React.ReactNode, React.ReactNode] | null | false> }> = ({ items }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
    {items.filter(Boolean).map((item, i) => {
      const [label, value] = item as [React.ReactNode, React.ReactNode];
      return (
        <React.Fragment key={i}>
          <dt className="text-sub">{label}</dt>
          <dd className="text-main text-right break-words min-w-0">{value}</dd>
        </React.Fragment>
      );
    })}
  </dl>
);
