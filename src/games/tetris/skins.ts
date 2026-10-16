// Block skins and board (panel) themes. Skins decide how a single block is
// painted; themes decide the playfield background, grid and frame.

export type SkinStyle = "bevel" | "flat" | "neon" | "glass" | "pixel" | "candy" | "gem" | "outline";

export interface BlockSkin {
  id: string;
  name: string;
  style: SkinStyle;
  /** Colors for I O T S Z J L, then garbage. */
  colors: [string, string, string, string, string, string, string, string];
}

const GUIDELINE: BlockSkin["colors"] = ["#22d3ee", "#facc15", "#a855f7", "#4ade80", "#f43f5e", "#3b82f6", "#fb923c", "#6b7280"];

export const SKINS: BlockSkin[] = [
  { id: "classic", name: "Classic", style: "bevel", colors: GUIDELINE },
  { id: "flat", name: "Flat", style: "flat", colors: GUIDELINE },
  { id: "neon", name: "Neon", style: "neon", colors: ["#00f0ff", "#ffe600", "#d500ff", "#39ff14", "#ff0055", "#2979ff", "#ff9100", "#8b8b9e"] },
  { id: "glass", name: "Glass", style: "glass", colors: ["#67e8f9", "#fde68a", "#c4b5fd", "#86efac", "#fda4af", "#93c5fd", "#fdba74", "#9ca3af"] },
  { id: "pixel", name: "8-Bit", style: "pixel", colors: ["#3cbcfc", "#f8b800", "#b853f8", "#58d854", "#f83800", "#0058f8", "#fc7460", "#7c7c7c"] },
  { id: "candy", name: "Candy", style: "candy", colors: ["#7dd3fc", "#fde047", "#f0abfc", "#86efac", "#fb7185", "#a5b4fc", "#fdba74", "#a1a1aa"] },
  { id: "gem", name: "Gems", style: "gem", colors: ["#06b6d4", "#eab308", "#9333ea", "#16a34a", "#dc2626", "#2563eb", "#ea580c", "#52525b"] },
  { id: "wire", name: "Wireframe", style: "outline", colors: GUIDELINE },
  { id: "mono", name: "Monochrome", style: "bevel", colors: ["#f4f4f5", "#d4d4d8", "#a1a1aa", "#e4e4e7", "#71717a", "#52525b", "#c4c4cc", "#3f3f46"] },
  { id: "sunset", name: "Sunset", style: "candy", colors: ["#f472b6", "#fbbf24", "#c084fc", "#fb923c", "#ef4444", "#8b5cf6", "#f97316", "#78716c"] },
];

export type GridStyle = "lines" | "dots" | "checker" | "none";

export interface BoardTheme {
  id: string;
  name: string;
  /** Canvas background gradient, top to bottom. */
  bg: [string, string];
  grid: string;
  gridStyle: GridStyle;
  /** CSS for the frame around the board. */
  frame: string;
  glow: string;
  ghostAlpha: number;
  text: string;
}

export const THEMES: BoardTheme[] = [
  { id: "midnight", name: "Midnight", bg: ["#0b0b16", "#11111f"], grid: "rgba(255,255,255,0.05)", gridStyle: "lines", frame: "#2a2a44", glow: "rgba(139,92,246,0.35)", ghostAlpha: 0.22, text: "#e4e4f0" },
  { id: "aurora", name: "Aurora", bg: ["#04131a", "#0d1b2a"], grid: "rgba(34,211,238,0.08)", gridStyle: "dots", frame: "#155e75", glow: "rgba(34,211,238,0.4)", ghostAlpha: 0.25, text: "#cffafe" },
  { id: "synthwave", name: "Synthwave", bg: ["#1a0526", "#2d0b3a"], grid: "rgba(244,114,182,0.14)", gridStyle: "lines", frame: "#be185d", glow: "rgba(244,114,182,0.45)", ghostAlpha: 0.25, text: "#fce7f3" },
  { id: "matrix", name: "Matrix", bg: ["#010a03", "#03140a"], grid: "rgba(74,222,128,0.10)", gridStyle: "lines", frame: "#166534", glow: "rgba(74,222,128,0.35)", ghostAlpha: 0.22, text: "#dcfce7" },
  { id: "battle", name: "Arcade Blue", bg: ["#0c1e3c", "#081428"], grid: "rgba(147,197,253,0.10)", gridStyle: "checker", frame: "#3b82f6", glow: "rgba(96,165,250,0.45)", ghostAlpha: 0.3, text: "#dbeafe" },
  { id: "ember", name: "Ember", bg: ["#1c0a04", "#120604"], grid: "rgba(251,146,60,0.08)", gridStyle: "dots", frame: "#9a3412", glow: "rgba(251,146,60,0.4)", ghostAlpha: 0.22, text: "#ffedd5" },
  { id: "void", name: "Void", bg: ["#000000", "#000000"], grid: "rgba(255,255,255,0)", gridStyle: "none", frame: "#27272a", glow: "rgba(255,255,255,0.08)", ghostAlpha: 0.18, text: "#fafafa" },
  { id: "paper", name: "Paper", bg: ["#f5f5f4", "#e7e5e4"], grid: "rgba(0,0,0,0.07)", gridStyle: "lines", frame: "#a8a29e", glow: "rgba(0,0,0,0.12)", ghostAlpha: 0.28, text: "#1c1917" },
];

export function getSkin(id: string): BlockSkin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
export function getTheme(id: string): BoardTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
