import { vi } from "vitest";

export type Viewport = "phone" | "tablet" | "desktop";

const WIDTHS: Record<Viewport, number> = { phone: 390, tablet: 820, desktop: 1440 };

/** Evaluates simple `(min-width: N)` / `(max-width: N)` queries (rem or px) against `width`. */
const matches = (query: string, width: number): boolean => {
  const parts = [...query.matchAll(/\((min|max)-width:\s*([\d.]+)(rem|px)\)/g)];
  if (parts.length === 0) return false;
  return parts.every(([, kind, value, unit]) => {
    const px = parseFloat(value) * (unit === "rem" ? 16 : 1);
    return kind === "min" ? width >= px : width <= px;
  });
};

/** Stubs `window.matchMedia` as if the screen were a phone, tablet or desktop. */
export function mockViewport(viewport: Viewport): void {
  const width = WIDTHS[viewport];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: matches(query, width),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
}
