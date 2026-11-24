import React from "react";

interface FolioMarkProps {
  /** Rendered width and height (Tailwind size classes). */
  className?: string;
  /** Accessible name; leave empty when the "Folio" wordmark sits beside it. */
  label?: string;
}

/**
 * The Folio app icon (wallet and cards), drawn from the same
 * /folio-icon.svg as the favicon and installed-app icons, so every place the
 * app shows its own icon stays in step with the one source file.
 */
export const FolioMark: React.FC<FolioMarkProps> = ({ className = "w-7 h-7", label = "" }) => (
  <img
    src="/folio-icon.svg"
    alt={label}
    aria-hidden={label ? undefined : true}
    width={28}
    height={28}
    draggable={false}
    className={`${className} shrink-0 select-none`}
  />
);
