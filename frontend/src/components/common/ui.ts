/**
 * Shared control styles. Phones (below `md`) get 44px targets and 16px+ text
 * (iOS zooms into anything smaller on focus); from `md` up the controls keep
 * their compact desktop size. Touch tablets (`pointer-coarse`) get a little
 * more room without the phone layout.
 */

export const iconButton =
  "size-11 md:size-8 pointer-coarse:md:size-10 shrink-0 inline-flex items-center justify-center rounded-lg text-muted hover:text-main active:text-main bg-surface-hover transition-colors cursor-pointer disabled:opacity-50";

export const dangerIconButton = `${iconButton} hover:text-negative`;

export const primaryButton =
  "h-11 md:h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-base md:text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer";

export const secondaryButton =
  "h-11 md:h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg border border-default bg-surface bg-surface-hover text-main text-base md:text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer";

export const inputClass =
  "w-full h-11 md:h-9 px-3 rounded-lg border border-default bg-input text-base md:text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]";

export const selectClass = inputClass;

/** A smaller select for table cells; still 44px and 16px on phones. */
export const compactSelectClass =
  "h-11 md:h-8 px-2 rounded-lg border border-default bg-input text-base md:text-xs text-main focus:outline-none focus:border-[var(--accent-primary)]";

export const checkboxClass =
  "size-5 md:size-4 rounded border-default bg-input text-accent-main focus:ring-accent-main";

export const card = "rounded-xl bg-surface border border-subtle";

export const segmentTrack = "flex flex-wrap items-center gap-0.5 p-0.5 rounded-lg bg-surface-subtle border border-default";

export const segmentButton = (active: boolean) =>
  `h-11 md:h-7 px-3 rounded-md text-sm md:text-xs transition-colors cursor-pointer ${
    active ? "bg-surface text-main" : "text-muted hover:text-main"
  }`;

/** Wrapping tab chips: never a sideways-scrolling strip. */
export const chipTab = (active: boolean) =>
  `h-11 md:h-9 px-3 inline-flex items-center gap-2 rounded-lg text-base md:text-sm transition-colors cursor-pointer ${
    active ? "bg-surface-subtle text-main font-medium" : "text-sub hover:text-main bg-surface-hover"
  }`;

/** Modal backdrop: a bottom sheet on phones, a centred dialog from `md` up. */
export const modalOverlay =
  "fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 bg-black/60 animate-in fade-in";

/** Modal panel; add a `md:max-w-*` width. Scrolls inside on short screens. */
export const modalPanel =
  "w-full max-h-[92dvh] md:max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-xl bg-surface border border-default shadow-xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:p-6 animate-in sheet-enter";

export const fieldLabel = "block text-sm md:text-xs text-sub mb-1";

/** On phones, let text wrap in full; from `md` up, keep one line with an ellipsis. */
export const wrapOnPhone = "break-words md:truncate";
