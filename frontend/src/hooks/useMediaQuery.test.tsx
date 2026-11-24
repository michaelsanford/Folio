import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from "./useMediaQuery";

type ChangeListener = () => void;

function installMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<ChangeListener>();
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, l: ChangeListener) => listeners.add(l),
    removeEventListener: (_: string, l: ChangeListener) => listeners.delete(l),
  }));
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      matches = next;
      listeners.forEach((l) => l());
    },
  };
}

describe("useMediaQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches Tailwind's lg breakpoint", () => {
    expect(DESKTOP_MEDIA_QUERY).toBe("(min-width: 64rem)");
  });

  it("returns the current match and updates when it changes", () => {
    const media = installMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery(DESKTOP_MEDIA_QUERY));

    expect(result.current).toBe(false);
    expect(media.matchMedia).toHaveBeenCalledWith(DESKTOP_MEDIA_QUERY);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("returns the fallback when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useMediaQuery("(min-width: 1px)", true)).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery("(min-width: 1px)")).result.current).toBe(false);
  });
});
