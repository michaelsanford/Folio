import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Folio never scrolls sideways, at any screen size: content wraps, and tables
// hide or fold columns instead. This guards against a scrolling strip creeping back.
const SRC = join(__dirname, "..");
const FORBIDDEN = /overflow-x-(auto|scroll)|overflow-(auto|scroll)\b(?!-)|overflow-x:\s*(auto|scroll)/;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

describe("no horizontal scrolling", () => {
  it("has no sideways-scrolling containers in the source", () => {
    const offenders = files(SRC).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, i) => (FORBIDDEN.test(line) ? `${relative(SRC, path)}:${i + 1}: ${line.trim()}` : null))
        .filter((x): x is string => x !== null)
    );
    expect(offenders).toEqual([]);
  });
});
