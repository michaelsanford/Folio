/**
 * Shared styles. Folio is laid out like paper: sections sit directly on the
 * page and are told apart by space and headings, not by boxes. Only things
 * that float over the page (menus, toasts, dialogs, sheets) are raised, with a
 * shadow rather than an outline.
 *
 * Phones (below `md`) get 44px targets and 16px+ text (iOS zooms into anything
 * smaller on focus); from `md` up the controls keep a compact desktop size.
 * Touch tablets (`pointer-coarse`) get a little more room without the phone
 * layout.
 */

/* ---------- Page structure ---------- */

/** Vertical rhythm between the sections of a page. */
export const pageStack = "flex flex-col gap-12 md:gap-16";

/** An open section on the page: no box, just its content. */
export const section = "min-w-0";

/** Heading block of a section: title, optional subtitle, then space. */
export const sectionHeader = "mb-5";

export const sectionTitle = "font-display text-lg md:text-xl font-semibold text-main";

/** The line under a section title. Readable size, never greyed out. */
export const sectionSub = "mt-1 text-sm text-sub";

/** A label above a figure or field group. */
export const labelText = "text-sm text-sub";

/** A short message alone in an empty area (loading, empty states, errors). */
export const loneText = "text-base md:text-lg text-sub";

/** A list that scrolls inside the page: keeps its figures clear of the scrollbar. Phones overlay their scrollbars, so only `md` up needs the room. */
export const scrollList = "md:pr-4 md:[scrollbar-gutter:stable]";

/** Separates two dense blocks (lists, tables) inside or between sections. */
export const hairline = "border-t border-subtle";

/* ---------- Raised layers ---------- */

/** A raised sheet: menus, popovers, toasts. */
export const raised = "bg-surface elevation-2";

/** Modal backdrop: a bottom sheet on phones, a centred dialog from `md` up. */
export const modalOverlay =
  "fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 bg-black/60 animate-in fade-in";

/** Modal panel; add a `md:max-w-*` width. Scrolls inside on short screens. */
export const modalPanel =
  "w-full max-h-[92dvh] md:max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-surface elevation-3 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:p-8 animate-in sheet-enter";

/* ---------- Controls ---------- */

export const iconButton =
  "size-11 md:size-9 pointer-coarse:md:size-10 shrink-0 inline-flex items-center justify-center rounded-full text-sub hover:text-main active:text-main bg-surface-hover transition-colors cursor-pointer disabled:opacity-50";

export const dangerIconButton = `${iconButton} hover:text-negative`;

export const primaryButton =
  "h-11 md:h-10 px-5 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-base md:text-sm font-semibold transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer";

/** Material text button: no outline, the accent colour carries it. */
export const secondaryButton =
  "h-11 md:h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg text-accent-subtle hover:bg-accent-subtle text-base md:text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer";

/** Material filled field: a tinted well with an underline that turns accent on focus. */
export const inputClass =
  "w-full h-11 md:h-10 px-3 rounded-t-lg rounded-b-none border-0 border-b-2 border-default bg-surface-subtle text-base md:text-sm text-main placeholder:text-sub focus:outline-none focus:border-[var(--accent-primary)]";

export const selectClass = inputClass;

/** A smaller select for table cells; still 44px and 16px on phones. */
export const compactSelectClass =
  "h-11 md:h-9 px-2 rounded-t-lg rounded-b-none border-0 border-b-2 border-default bg-surface-subtle text-base md:text-sm text-main focus:outline-none focus:border-[var(--accent-primary)]";

export const checkboxClass =
  "size-5 md:size-4 rounded border-default bg-input text-accent-main focus:ring-accent-main";

/** Material tabs: a row on a hairline, the active one underlined in the accent colour. */
export const segmentTrack = "flex flex-wrap items-end gap-x-1 border-b border-subtle";

export const segmentButton = (active: boolean) =>
  `h-11 md:h-10 px-3 -mb-px border-b-2 text-base md:text-sm transition-colors cursor-pointer ${
    active ? "border-[var(--accent-primary)] text-main font-semibold" : "border-transparent text-sub hover:text-main"
  }`;

/** Wrapping tab chips: never a sideways-scrolling strip. Active one underlined. */
export const chipTab = (active: boolean) =>
  `min-h-11 md:min-h-10 px-3 py-1 inline-flex items-center gap-2 border-b-2 text-base md:text-sm transition-colors cursor-pointer ${
    active ? "border-[var(--accent-primary)] text-main font-semibold" : "border-transparent text-sub hover:text-main"
  }`;

export const fieldLabel = "block text-sm text-sub mb-1.5";

/** On phones, let text wrap in full; from `md` up, keep one line with an ellipsis. */
export const wrapOnPhone = "break-words md:truncate";
