import React from "react";
import {
  Wallet,
  PiggyBank,
  Landmark,
  Banknote,
  Coins,
  DollarSign,
  Receipt,
  Sparkles,
  ShieldCheck,
  Umbrella,
  GraduationCap,
  HeartHandshake,
  Home,
  Lock,
  Clock,
  CalendarClock,
  Briefcase,
  TrendingUp,
  BarChart3,
  LineChart,
  PieChart,
  CircleDollarSign,
  Layers,
  CreditCard,
  Scale,
  Building2,
  Car,
  BookOpen,
  FileSpreadsheet,
  Gem,
  Package,
  Key,
  Boxes,
  Percent,
} from "lucide-react";

export interface IconOption {
  id: string;
  name: string;
  category: "banking" | "registered" | "growth" | "debt" | "assets";
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

export const ICON_PALETTE: IconOption[] = [
  // Banking & Cash
  { id: "wallet", name: "Wallet", category: "banking", icon: Wallet },
  { id: "piggy-bank", name: "Piggy Bank", category: "banking", icon: PiggyBank },
  { id: "landmark", name: "Bank / Institution", category: "banking", icon: Landmark },
  { id: "banknote", name: "Banknote / Cash", category: "banking", icon: Banknote },
  { id: "coins", name: "Coins / Savings", category: "banking", icon: Coins },
  { id: "dollar-sign", name: "Dollar Sign", category: "banking", icon: DollarSign },
  { id: "receipt", name: "Receipt / Ledger", category: "banking", icon: Receipt },

  // Registered & Tax-Sheltered (Canada)
  { id: "sparkles", name: "Sparkles (TFSA)", category: "registered", icon: Sparkles },
  { id: "umbrella", name: "Umbrella (RRSP)", category: "registered", icon: Umbrella },
  { id: "home", name: "Home (FHSA / Real Estate)", category: "registered", icon: Home },
  { id: "graduation-cap", name: "Graduation (RESP)", category: "registered", icon: GraduationCap },
  { id: "heart-handshake", name: "Heart Handshake (RDSP)", category: "registered", icon: HeartHandshake },
  { id: "shield-check", name: "Shield Check (Protected)", category: "registered", icon: ShieldCheck },
  { id: "lock", name: "Lock (LIRA Locked-in)", category: "registered", icon: Lock },
  { id: "clock", name: "Clock (RRIF Retirement)", category: "registered", icon: Clock },
  { id: "calendar-clock", name: "Calendar Clock (LIF Payout)", category: "registered", icon: CalendarClock },
  { id: "briefcase", name: "Briefcase (IPP Corporate)", category: "registered", icon: Briefcase },

  // Investments & Growth
  { id: "trending-up", name: "Trending Up", category: "growth", icon: TrendingUp },
  { id: "bar-chart-3", name: "Bar Chart", category: "growth", icon: BarChart3 },
  { id: "line-chart", name: "Line Chart", category: "growth", icon: LineChart },
  { id: "pie-chart", name: "Pie Chart", category: "growth", icon: PieChart },
  { id: "circle-dollar-sign", name: "Circle Dollar", category: "growth", icon: CircleDollarSign },
  { id: "layers", name: "Layers (Crypto / Holdings)", category: "growth", icon: Layers },

  // Credit, Debt & Loans
  { id: "credit-card", name: "Credit Card", category: "debt", icon: CreditCard },
  { id: "building-2", name: "Building (Mortgage)", category: "debt", icon: Building2 },
  { id: "car", name: "Car (Auto Loan)", category: "debt", icon: Car },
  { id: "scale", name: "Scale (Line of Credit)", category: "debt", icon: Scale },
  { id: "book-open", name: "Book (Student Loan)", category: "debt", icon: BookOpen },
  { id: "file-spreadsheet", name: "Spreadsheet / Term Debt", category: "debt", icon: FileSpreadsheet },
  { id: "percent", name: "Percent / APR", category: "debt", icon: Percent },

  // Physical & Valued Assets
  { id: "gem", name: "Gem / Valuables", category: "assets", icon: Gem },
  { id: "package", name: "Package / Goods", category: "assets", icon: Package },
  { id: "key", name: "Key / Ownership", category: "assets", icon: Key },
  { id: "boxes", name: "Boxes / Inventory", category: "assets", icon: Boxes },
];

export const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> =
  ICON_PALETTE.reduce((acc, opt) => {
    acc[opt.id] = opt.icon;
    return acc;
  }, {} as Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>>);

export interface ColorSwatch {
  id: string;
  name: string;
  hex: string;
  twBg: string;
  twText: string;
  twBorder: string;
}

export const COLOR_SWATCHES: ColorSwatch[] = [
  { id: "emerald", name: "Emerald", hex: "#10B981", twBg: "bg-emerald-500/15", twText: "text-emerald-400", twBorder: "border-emerald-500/30" },
  { id: "green", name: "Green", hex: "#22C55E", twBg: "bg-green-500/15", twText: "text-green-400", twBorder: "border-green-500/30" },
  { id: "teal", name: "Teal", hex: "#14B8A6", twBg: "bg-teal-500/15", twText: "text-teal-400", twBorder: "border-teal-500/30" },
  { id: "cyan", name: "Cyan", hex: "#06B6D4", twBg: "bg-cyan-500/15", twText: "text-cyan-400", twBorder: "border-cyan-500/30" },
  { id: "blue", name: "Blue", hex: "#3B82F6", twBg: "bg-blue-500/15", twText: "text-blue-400", twBorder: "border-blue-500/30" },
  { id: "indigo", name: "Indigo", hex: "#6366F1", twBg: "bg-indigo-500/15", twText: "text-indigo-400", twBorder: "border-indigo-500/30" },
  { id: "violet", name: "Violet", hex: "#8B5CF6", twBg: "bg-violet-500/15", twText: "text-violet-400", twBorder: "border-violet-500/30" },
  { id: "purple", name: "Purple", hex: "#A855F7", twBg: "bg-purple-500/15", twText: "text-purple-400", twBorder: "border-purple-500/30" },
  { id: "pink", name: "Pink", hex: "#EC4899", twBg: "bg-pink-500/15", twText: "text-pink-400", twBorder: "border-pink-500/30" },
  { id: "rose", name: "Rose", hex: "#F43F5E", twBg: "bg-rose-500/15", twText: "text-rose-400", twBorder: "border-rose-500/30" },
  { id: "amber", name: "Amber", hex: "#F59E0B", twBg: "bg-amber-500/15", twText: "text-amber-400", twBorder: "border-amber-500/30" },
  { id: "slate", name: "Slate", hex: "#64748B", twBg: "bg-slate-500/15", twText: "text-slate-300", twBorder: "border-slate-500/30" },
];

export function getColorSwatch(hex?: string | null): ColorSwatch {
  if (!hex) return COLOR_SWATCHES[5]; // Indigo default
  const match = COLOR_SWATCHES.find((s) => s.hex.toLowerCase() === hex.toLowerCase());
  return (
    match || {
      id: "custom",
      name: "Custom",
      hex,
      twBg: "bg-slate-800",
      twText: "text-slate-200",
      twBorder: "border-slate-700",
    }
  );
}
