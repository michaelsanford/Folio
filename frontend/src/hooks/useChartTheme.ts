import { useTheme } from "../context/ThemeContext";

export interface ChartThemeTokens {
  isDark: boolean;
  textColor: string;
  subtleTextColor: string;
  gridLineColor: string;
  axisLineColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  accentColor: string;
  accentGradient: {
    start: string;
    end: string;
  };
  positiveColor: string;
  negativeColor: string;
  neutralColor: string;
  palette: string[];
}

export const useChartTheme = (): ChartThemeTokens => {
  const { theme, resolvedMode } = useTheme();
  const isDark = resolvedMode === "dark";

  switch (theme) {
    case "bloomberg":
      return {
        isDark,
        textColor: isDark ? "#cbd5e1" : "#44403c",
        subtleTextColor: isDark ? "#64748b" : "#78716c",
        gridLineColor: isDark ? "rgba(71, 85, 105, 0.25)" : "rgba(216, 205, 178, 0.6)",
        axisLineColor: isDark ? "#334155" : "#d8cdb2",
        tooltipBg: isDark ? "#11131a" : "#ffffff",
        tooltipBorder: isDark ? "#f59e0b" : "#d8cdb2",
        tooltipText: isDark ? "#f8fafc" : "#1c1917",
        accentColor: isDark ? "#f59e0b" : "#b45309",
        accentGradient: {
          start: isDark ? "rgba(245, 158, 11, 0.45)" : "rgba(180, 83, 9, 0.35)",
          end: isDark ? "rgba(245, 158, 11, 0.0)" : "rgba(180, 83, 9, 0.0)",
        },
        positiveColor: isDark ? "#10b981" : "#059669",
        negativeColor: isDark ? "#f43f5e" : "#e11d48",
        neutralColor: isDark ? "#64748b" : "#78716c",
        palette: isDark
          ? ["#f59e0b", "#10b981", "#38bdf8", "#fbbf24", "#f43f5e", "#a855f7", "#34d399", "#94a3b8"]
          : ["#b45309", "#059669", "#0284c7", "#d97706", "#e11d48", "#7e22ce", "#0d9488", "#64748b"],
      };

    case "editorial":
      return {
        isDark,
        textColor: isDark ? "#e7e5e4" : "#111827",
        subtleTextColor: isDark ? "#a8a29e" : "#6b7280",
        gridLineColor: isDark ? "rgba(120, 113, 108, 0.25)" : "rgba(220, 194, 174, 0.6)",
        axisLineColor: isDark ? "#44403c" : "#dcc2ae",
        tooltipBg: isDark ? "#1c1917" : "#ffffff",
        tooltipBorder: isDark ? "#990f3d" : "#dcc2ae",
        tooltipText: isDark ? "#f5f5f4" : "#111827",
        accentColor: isDark ? "#fb7185" : "#990f3d",
        accentGradient: {
          start: isDark ? "rgba(251, 113, 133, 0.45)" : "rgba(153, 15, 61, 0.35)",
          end: isDark ? "rgba(251, 113, 133, 0.0)" : "rgba(153, 15, 61, 0.0)",
        },
        positiveColor: isDark ? "#34d399" : "#006644",
        negativeColor: isDark ? "#f43f5e" : "#cc0000",
        neutralColor: isDark ? "#a8a29e" : "#6b7280",
        palette: isDark
          ? ["#fb7185", "#34d399", "#38bdf8", "#fbbf24", "#c084fc", "#f43f5e", "#2dd4bf", "#a8a29e"]
          : ["#990f3d", "#006644", "#0f5499", "#b35b00", "#593380", "#cc0000", "#008075", "#6b7280"],
      };

    case "catppuccin":
      return {
        isDark,
        textColor: isDark ? "#cdd6f4" : "#4c4f69",
        subtleTextColor: isDark ? "#a6adc8" : "#6c6f85",
        gridLineColor: isDark ? "rgba(49, 50, 68, 0.7)" : "rgba(204, 208, 218, 0.7)",
        axisLineColor: isDark ? "#45475a" : "#bcc0cc",
        tooltipBg: isDark ? "#181825" : "#ffffff",
        tooltipBorder: isDark ? "#45475a" : "#ccd0da",
        tooltipText: isDark ? "#cdd6f4" : "#4c4f69",
        accentColor: isDark ? "#94e2d5" : "#179299",
        accentGradient: {
          start: isDark ? "rgba(148, 226, 213, 0.45)" : "rgba(23, 146, 153, 0.35)",
          end: isDark ? "rgba(148, 226, 213, 0.0)" : "rgba(23, 146, 153, 0.0)",
        },
        positiveColor: isDark ? "#a6e3a1" : "#40a02b",
        negativeColor: isDark ? "#f38ba8" : "#d20f39",
        neutralColor: isDark ? "#9399b2" : "#7c7f93",
        palette: isDark
          ? ["#94e2d5", "#a6e3a1", "#89b4fa", "#fab387", "#f38ba8", "#cba6f7", "#f9e2af", "#9399b2"]
          : ["#179299", "#40a02b", "#1e66f5", "#fe640b", "#d20f39", "#8839ef", "#df8e1d", "#7c7f93"],
      };

    case "nord":
      return {
        isDark,
        textColor: isDark ? "#d8dee9" : "#2e3440",
        subtleTextColor: isDark ? "#9da5b4" : "#4c566a",
        gridLineColor: isDark ? "rgba(76, 86, 106, 0.4)" : "rgba(216, 222, 233, 0.8)",
        axisLineColor: isDark ? "#4c566a" : "#c0c8d4",
        tooltipBg: isDark ? "#2e3440" : "#ffffff",
        tooltipBorder: isDark ? "#4c566a" : "#d8dee9",
        tooltipText: isDark ? "#eceff4" : "#2e3440",
        accentColor: isDark ? "#88c0d0" : "#5e81ac",
        accentGradient: {
          start: isDark ? "rgba(136, 192, 208, 0.45)" : "rgba(94, 129, 172, 0.35)",
          end: isDark ? "rgba(136, 192, 208, 0.0)" : "rgba(94, 129, 172, 0.0)",
        },
        positiveColor: isDark ? "#a3be8c" : "#4c8d5c",
        negativeColor: isDark ? "#bf616a" : "#993240",
        neutralColor: isDark ? "#d8dee9" : "#4c566a",
        palette: isDark
          ? ["#88c0d0", "#81a1c1", "#a3be8c", "#ebcb8b", "#bf616a", "#b48ead", "#8fbcbb", "#d8dee9"]
          : ["#5e81ac", "#88c0d0", "#4c8d5c", "#d08770", "#993240", "#b48ead", "#5e81ac", "#4c566a"],
      };

    case "gruvbox":
      return {
        isDark,
        textColor: isDark ? "#ebdbb2" : "#3c3836",
        subtleTextColor: isDark ? "#a89984" : "#7c6f64",
        gridLineColor: isDark ? "rgba(80, 73, 69, 0.6)" : "rgba(213, 196, 161, 0.8)",
        axisLineColor: isDark ? "#504945" : "#bdae93",
        tooltipBg: isDark ? "#282828" : "#fbf1c7",
        tooltipBorder: isDark ? "#689d6a" : "#bdae93",
        tooltipText: isDark ? "#fbf1c7" : "#282828",
        accentColor: isDark ? "#689d6a" : "#427b58",
        accentGradient: {
          start: isDark ? "rgba(104, 157, 106, 0.45)" : "rgba(66, 123, 88, 0.35)",
          end: isDark ? "rgba(104, 157, 106, 0.0)" : "rgba(66, 123, 88, 0.0)",
        },
        positiveColor: isDark ? "#b8bb26" : "#79740e",
        negativeColor: isDark ? "#fb4934" : "#cc241d",
        neutralColor: isDark ? "#a89984" : "#7c6f64",
        palette: isDark
          ? ["#689d6a", "#b8bb26", "#83a598", "#fabd2f", "#fb4934", "#d3869b", "#8ec07c", "#a89984"]
          : ["#427b58", "#79740e", "#076678", "#b57614", "#cc241d", "#8f3f71", "#427b58", "#7c6f64"],
      };

    case "tokyo-night":
      return {
        isDark,
        textColor: isDark ? "#c0caf5" : "#343b58",
        subtleTextColor: isDark ? "#7a88cf" : "#565a6e",
        gridLineColor: isDark ? "rgba(41, 46, 66, 0.8)" : "rgba(207, 213, 226, 0.8)",
        axisLineColor: isDark ? "#414868" : "#cfd5e2",
        tooltipBg: isDark ? "#1f2335" : "#ffffff",
        tooltipBorder: isDark ? "#7dcfff" : "#cfd5e2",
        tooltipText: isDark ? "#c0caf5" : "#343b58",
        accentColor: isDark ? "#7dcfff" : "#006cb8",
        accentGradient: {
          start: isDark ? "rgba(125, 207, 255, 0.45)" : "rgba(0, 108, 184, 0.35)",
          end: isDark ? "rgba(125, 207, 255, 0.0)" : "rgba(0, 108, 184, 0.0)",
        },
        positiveColor: isDark ? "#73daca" : "#38a89d",
        negativeColor: isDark ? "#f7768e" : "#8c4351",
        neutralColor: isDark ? "#565f89" : "#565a6e",
        palette: isDark
          ? ["#7dcfff", "#73daca", "#7aa2f7", "#e0af68", "#f7768e", "#bb9af7", "#2ac3de", "#9aa5ce"]
          : ["#006cb8", "#38a89d", "#2e5cb8", "#8f5e15", "#8c4351", "#7847ba", "#118294", "#565a6e"],
      };

    case "dracula":
      return {
        isDark,
        textColor: isDark ? "#f8f8f2" : "#282a36",
        subtleTextColor: isDark ? "#6272a4" : "#6272a4",
        gridLineColor: isDark ? "rgba(68, 71, 90, 0.6)" : "rgba(216, 216, 210, 0.7)",
        axisLineColor: isDark ? "#6272a4" : "#b8b8b0",
        tooltipBg: isDark ? "#282a36" : "#ffffff",
        tooltipBorder: isDark ? "#6272a4" : "#b8b8b0",
        tooltipText: isDark ? "#f8f8f2" : "#282a36",
        accentColor: isDark ? "#50fa7b" : "#28a745",
        accentGradient: {
          start: isDark ? "rgba(80, 250, 123, 0.45)" : "rgba(40, 167, 69, 0.35)",
          end: isDark ? "rgba(80, 250, 123, 0.0)" : "rgba(40, 167, 69, 0.0)",
        },
        positiveColor: isDark ? "#50fa7b" : "#28a745",
        negativeColor: isDark ? "#ff5555" : "#dc3545",
        neutralColor: isDark ? "#6272a4" : "#6272a4",
        palette: isDark
          ? ["#50fa7b", "#8be9fd", "#f1fa8c", "#ffb86c", "#ff5555", "#bd93f9", "#ff79c6", "#6272a4"]
          : ["#28a745", "#17a2b8", "#d39e00", "#e07a10", "#dc3545", "#6f42c1", "#e83e8c", "#6272a4"],
      };

    case "folio-emerald":
    default:
      return {
        isDark,
        textColor: isDark ? "#94a3b8" : "#475569",
        subtleTextColor: isDark ? "#64748b" : "#64748b",
        gridLineColor: isDark ? "rgba(51, 65, 85, 0.35)" : "rgba(203, 213, 225, 0.6)",
        axisLineColor: isDark ? "#334155" : "#cbd5e1",
        tooltipBg: isDark ? "#0f172a" : "#ffffff",
        tooltipBorder: isDark ? "#334155" : "#cbd5e1",
        tooltipText: isDark ? "#f8fafc" : "#0f172a",
        accentColor: isDark ? "#10b981" : "#059669",
        accentGradient: {
          start: isDark ? "rgba(16, 185, 129, 0.45)" : "rgba(5, 150, 105, 0.35)",
          end: isDark ? "rgba(16, 185, 129, 0.0)" : "rgba(5, 150, 105, 0.0)",
        },
        positiveColor: isDark ? "#10b981" : "#059669",
        negativeColor: isDark ? "#f43f5e" : "#e11d48",
        neutralColor: isDark ? "#64748b" : "#64748b",
        palette: isDark
          ? ["#10b981", "#38bdf8", "#f59e0b", "#34d399", "#f43f5e", "#a855f7", "#06b6d4", "#94a3b8"]
          : ["#059669", "#0284c7", "#d97706", "#0d9488", "#e11d48", "#7e22ce", "#0891b2", "#64748b"],
      };
  }
};
