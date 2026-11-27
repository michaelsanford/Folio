import React from "react";
import { FolioMark } from "./FolioMark";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { loneText, secondaryButton } from "./ui";

/** Past this, the server is starting up after a quiet spell; say so. */
export const WAKING_DELAY_MS = 1500;
export const WAKING_MESSAGE = "Folio is waking up…";

interface StartupSplashProps {
  /** The server could not be reached; offer to try again. */
  unreachable?: boolean;
  onRetry?: () => void;
}

/** Shown while the first session check is pending, before anything else can be drawn. */
export const StartupSplash: React.FC<StartupSplashProps> = ({ unreachable = false, onRetry }) => {
  const waking = useDelayedFlag(!unreachable, WAKING_DELAY_MS);

  if (unreachable) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4 px-4 text-center">
        <FolioMark className="w-14 h-14" />
        <p role="alert" className="text-lg md:text-xl text-main">
          Folio isn&rsquo;t responding.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className={secondaryButton}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    // Same mark, same place as the placeholder in index.html, so the hand-over is seamless.
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="relative">
        <FolioMark className="w-14 h-14" label="Folio" />
        <p
          role="status"
          className={`absolute top-full left-1/2 -translate-x-1/2 mt-6 whitespace-nowrap text-lg md:text-xl text-sub transition-opacity duration-500 ${
            waking ? "opacity-100" : "opacity-0"
          }`}
        >
          {waking ? WAKING_MESSAGE : ""}
        </p>
      </div>
    </div>
  );
};

/** In the app shell while its data is still on the way: "Loading…", then the waking cue. */
export const ShellLoading: React.FC = () => {
  const waking = useDelayedFlag(true, WAKING_DELAY_MS);
  return (
    <div role="status" className={`min-h-[60vh] py-16 px-4 flex items-center justify-center gap-4 text-center ${loneText}`}>
      <span
        className="animate-spin rounded-full h-6 w-6 shrink-0 border-2 border-[var(--border-default)] border-t-[var(--accent-primary)]"
        aria-hidden="true"
      />
      {waking ? WAKING_MESSAGE : "Loading…"}
    </div>
  );
};
