import React from "react";
import { Wallet, Palette } from "lucide-react";
import type { AccountType } from "../../types";
import { getAccountTypeMeta } from "../../constants/canadianAccountTypes";
import { ICON_MAP, getColorSwatch } from "../../constants/iconPalette";

interface AccountIconProps {
  type: AccountType;
  icon?: string | null;
  color?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showBackground?: boolean;
  editable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}

export const AccountIcon: React.FC<AccountIconProps> = ({
  type,
  icon,
  color,
  size = "md",
  className = "",
  showBackground = true,
  editable = false,
  onClick,
  title,
}) => {
  const meta = getAccountTypeMeta(type);
  const effectiveIconId = icon || meta.defaultIcon || "wallet";
  const effectiveColorHex = color || meta.defaultColor || "#6366F1";
  const swatch = getColorSwatch(effectiveColorHex);

  const IconComponent = ICON_MAP[effectiveIconId] || Wallet;

  const sizeClasses = {
    xs: { icon: "w-3 h-3", container: "p-1 rounded-md", badge: "w-2 h-2 p-0.5" },
    sm: { icon: "w-3.5 h-3.5", container: "p-1.5 rounded-lg", badge: "w-2.5 h-2.5 p-0.5" },
    md: { icon: "w-4 h-4", container: "p-2 rounded-xl", badge: "w-3 h-3 p-0.5" },
    lg: { icon: "w-5 h-5", container: "p-2.5 rounded-xl", badge: "w-3.5 h-3.5 p-0.5" },
    xl: { icon: "w-6 h-6", container: "p-3 rounded-2xl", badge: "w-4 h-4 p-1" },
  }[size];

  const defaultTitle = editable || onClick ? "Click to customize icon & color" : undefined;

  if (!showBackground) {
    return (
      <button
        type="button"
        disabled={!onClick && !editable}
        onClick={onClick}
        title={title || defaultTitle}
        className={`relative inline-flex items-center justify-center ${onClick || editable ? "cursor-pointer hover:opacity-80 transition-opacity" : ""} ${className}`}
      >
        <IconComponent
          className={sizeClasses.icon}
          style={{ color: effectiveColorHex }}
        />
      </button>
    );
  }

  const containerContent = (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 border transition-all ${
        sizeClasses.container
      } ${swatch.twBg} ${swatch.twBorder} ${
        onClick || editable
          ? "cursor-pointer group-hover:scale-105 group-hover:ring-2 group-hover:ring-indigo-500/50"
          : ""
      }`}
      style={{
        backgroundColor: `${effectiveColorHex}18`,
        borderColor: `${effectiveColorHex}30`,
      }}
    >
      <IconComponent
        className={sizeClasses.icon}
        style={{ color: effectiveColorHex }}
      />
      {editable && (
        <div
          className="absolute -bottom-1 -right-1 rounded-full bg-slate-900 border border-slate-700 text-indigo-400 p-0.5 shadow-xs transition-colors group-hover:bg-indigo-600 group-hover:text-white"
          title="Customize glyph & color"
        >
          <Palette className="w-2.5 h-2.5" />
        </div>
      )}
    </div>
  );

  if (onClick || editable) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title || defaultTitle}
        className={`group relative inline-flex shrink-0 transition-transform ${className}`}
      >
        {containerContent}
      </button>
    );
  }

  return <div className={`inline-flex shrink-0 ${className}`}>{containerContent}</div>;
};
