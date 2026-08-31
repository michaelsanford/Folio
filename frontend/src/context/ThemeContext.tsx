import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeId =
  | "folio-emerald"
  | "bloomberg"
  | "editorial"
  | "catppuccin"
  | "nord"
  | "gruvbox"
  | "tokyo-night"
  | "dracula";

export type ColorMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  category: "Financial" | "Developer";
  description: string;
  accentHex: string;
  darkCanvasHex: string;
  lightCanvasHex: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "folio-emerald",
    name: "Folio Emerald",
    category: "Financial",
    description: "British racing green & mint with graphite slate. Classic private wealth.",
    accentHex: "#10b981",
    darkCanvasHex: "#090d16",
    lightCanvasHex: "#f8fafc",
  },
  {
    id: "bloomberg",
    name: "Bloomberg Terminal",
    category: "Financial",
    description: "High-contrast obsidian black with sharp amber gold accents.",
    accentHex: "#f59e0b",
    darkCanvasHex: "#090a0f",
    lightCanvasHex: "#faf8f5",
  },
  {
    id: "editorial",
    name: "Financial Times",
    category: "Financial",
    description: "Iconic salmon paper pink-cream light mode & rich claret ink.",
    accentHex: "#990f3d",
    darkCanvasHex: "#141210",
    lightCanvasHex: "#fff1e5",
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    category: "Developer",
    description: "Warm, soothing pastel palette (Mocha dark & Latte light).",
    accentHex: "#94e2d5",
    darkCanvasHex: "#11111b",
    lightCanvasHex: "#eff1f5",
  },
  {
    id: "nord",
    name: "Nord",
    category: "Developer",
    description: "Scandinavian icy frost cyan & polar night slate.",
    accentHex: "#88c0d0",
    darkCanvasHex: "#242933",
    lightCanvasHex: "#eceff4",
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    category: "Developer",
    description: "Retro warm earth tones & parchment. Classic ledger feel.",
    accentHex: "#689d6a",
    darkCanvasHex: "#1d2021",
    lightCanvasHex: "#fbf1c7",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    category: "Developer",
    description: "Deep midnight obsidian with crisp electric cyan highlights.",
    accentHex: "#7dcfff",
    darkCanvasHex: "#16161e",
    lightCanvasHex: "#e1e2e7",
  },
  {
    id: "dracula",
    name: "Dracula",
    category: "Developer",
    description: "High-contrast iconic dark theme with punchy emerald highlights.",
    accentHex: "#50fa7b",
    darkCanvasHex: "#1e1f29",
    lightCanvasHex: "#f8f8f2",
  },
];

export interface ThemeContextType {
  theme: ThemeId;
  mode: ColorMode;
  colorMode: ColorMode;
  resolvedMode: ResolvedMode;
  setTheme: (theme: ThemeId) => void;
  setMode: (mode: ColorMode) => void;
  setColorMode: (mode: ColorMode) => void;
  toggleMode: () => void;
  toggleColorMode: () => void;
  activeThemeDef: ThemeDefinition;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "folio-theme";
const MODE_STORAGE_KEY = "folio-color-mode";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeId;
  defaultMode?: ColorMode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultTheme,
  defaultMode,
}) => {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (defaultTheme) return defaultTheme;
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId;
    if (stored && THEMES.some((t) => t.id === stored)) {
      return stored;
    }
    return "folio-emerald";
  });

  const [mode, setModeState] = useState<ColorMode>(() => {
    if (defaultMode) return defaultMode;
    const stored = localStorage.getItem(MODE_STORAGE_KEY) as ColorMode;
    if (stored && (stored === "light" || stored === "dark" || stored === "system")) {
      return stored;
    }
    return "system";
  });

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return true;
  });

  // Watch for system color-scheme changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const resolvedMode: ResolvedMode = mode === "system" ? (systemIsDark ? "dark" : "light") : mode;

  // Synchronize with DOM attributes
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-mode", resolvedMode);

    if (resolvedMode === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
  }, [theme, resolvedMode]);

  const setTheme = (newTheme: ThemeId) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
  };

  const setMode = (newMode: ColorMode) => {
    setModeState(newMode);
    localStorage.setItem(MODE_STORAGE_KEY, newMode);
  };

  const toggleMode = () => {
    const nextMode: ColorMode = resolvedMode === "dark" ? "light" : "dark";
    setMode(nextMode);
  };

  const activeThemeDef = THEMES.find((t) => t.id === theme) || THEMES[0];

  return (
    <ThemeContext.Provider
      value={{
        theme,
        mode,
        colorMode: mode,
        resolvedMode,
        setTheme,
        setMode,
        setColorMode: setMode,
        toggleMode,
        toggleColorMode: toggleMode,
        activeThemeDef,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
