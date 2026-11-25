import React from "react";
import { FolioMark } from "./FolioMark";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

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
        <FolioMark className="w-10 h-10" />
        <p role="alert" className="text-sm text-main">
          Folio isn&rsquo;t responding.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
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
        <FolioMark className="w-10 h-10" label="Folio" />
        <p
          role="status"
          className={`absolute top-full left-1/2 -translate-x-1/2 mt-4 whitespace-nowrap text-sm text-muted transition-opacity duration-500 ${
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
    <div role="status" className="py-16 flex items-center justify-center gap-3 text-sm text-muted">
      <span
        className="animate-spin rounded-full h-4 w-4 border-2 border-[var(--border-default)] border-t-[var(--accent-primary)]"
        aria-hidden="true"
      />
      {waking ? WAKING_MESSAGE : "Loading…"}
    </div>
  );
};
