/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { THEMES } from "../context/ThemeContext";

// The stylesheet as written (a CSS import would be processed, not raw text).
// Vitest runs from frontend/.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

/**
 * Every theme's text colours must stay readable on every background they sit
 * on. Body, secondary and muted text reach WCAG AAA (7:1) everywhere, so
 * supporting text never reads as greyed out; accents and gain/loss/warning
 * colours reach AA (4.5:1), or AAA in the High contrast theme.
 * Hover backgrounds are left out: they are momentary.
 */
const PLAIN_TEXT_TOKENS = ["text-primary", "text-secondary", "text-muted", "fin-neutral"] as const;
const COLOURED_TEXT_TOKENS = [
  "accent-primary",
  "accent-subtle-text",
  "fin-positive",
  "fin-negative",
  "fin-warning",
] as const;
const BACKGROUNDS = ["bg-canvas", "bg-surface", "bg-surface-subtle", "bg-sidebar"] as const;

const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function themeTokens(theme: string, mode: string): Record<string, string> {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\[data-mode="${mode}"\\]\\s*\\{([^}]*)\\}`));
  if (!block) throw new Error(`no ${theme} ${mode} block in index.css`);
  return Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

const cases = THEMES.flatMap((t) => (["dark", "light"] as const).map((mode) => [t.id, mode] as const));

describe("theme contrast", () => {
  it.each(cases)("%s (%s): text is readable on every background", (theme, mode) => {
    const tokens = themeTokens(theme, mode);
    const target = theme === "high-contrast" ? 7 : 4.5;
    const failures: string[] = [];
    const check = (fg: string, min: number) => {
      for (const bg of BACKGROUNDS) {
        const ratio = contrast(tokens[fg], tokens[bg]);
        if (ratio < min) failures.push(`--${fg} ${tokens[fg]} on --${bg} ${tokens[bg]}: ${ratio.toFixed(2)}`);
      }
    };
    for (const fg of PLAIN_TEXT_TOKENS) check(fg, 7);
    for (const fg of COLOURED_TEXT_TOKENS) check(fg, target);
    const onAccent = contrast(tokens["accent-contrast"], tokens["accent-primary"]);
    if (onAccent < target) failures.push(`--accent-contrast on --accent-primary: ${onAccent.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it("High contrast borders stand out from the surfaces (3:1)", () => {
    for (const mode of ["dark", "light"]) {
      const t = themeTokens("high-contrast", mode);
      expect(contrast(t["border-default"], t["bg-surface"])).toBeGreaterThanOrEqual(3);
    }
  });
});
