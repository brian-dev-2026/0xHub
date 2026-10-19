// Cosmetic looks for the non-Tetris games (Tetris skins live in tetris/skins.ts).
// Each choice is a string id in the player's settings; unknown ids fall back
// to the first entry, so removing a look never breaks a saved profile.

// ---------- Snake Arena ----------

/** How a snake body is drawn. Snakes keep their player color in every style. */
export type SnakeStyle = "round" | "pixel" | "neon" | "candy" | "scales" | "outline";

export interface SnakeSkin {
  id: string;
  name: string;
  style: SnakeStyle;
}

export const SNAKE_SKINS: SnakeSkin[] = [
  { id: "classic", name: "Classic", style: "round" },
  { id: "pixel", name: "8-Bit", style: "pixel" },
  { id: "neon", name: "Neon", style: "neon" },
  { id: "candy", name: "Candy", style: "candy" },
  { id: "scales", name: "Scales", style: "scales" },
  { id: "wire", name: "Wireframe", style: "outline" },
];

export interface SnakeArena {
  id: string;
  name: string;
  bg: string;
  /** Checker / grid color; "" for none. */
  grid: string;
  gridStyle: "checker" | "lines" | "dots" | "none";
  food: string;
  foodGlow: string;
  frame: string;
}

export const SNAKE_ARENAS: SnakeArena[] = [
  { id: "meadow", name: "Meadow", bg: "#0b1410", grid: "rgba(74,222,128,0.05)", gridStyle: "checker", food: "#f43f5e", foodGlow: "#fda4af", frame: "rgba(16,185,129,0.25)" },
  { id: "midnight", name: "Midnight", bg: "#0b0b16", grid: "rgba(255,255,255,0.05)", gridStyle: "lines", food: "#facc15", foodGlow: "#fef08a", frame: "rgba(139,92,246,0.35)" },
  { id: "synthwave", name: "Synthwave", bg: "#1a0526", grid: "rgba(244,114,182,0.14)", gridStyle: "lines", food: "#22d3ee", foodGlow: "#a5f3fc", frame: "rgba(244,114,182,0.45)" },
  { id: "lcd", name: "Handheld", bg: "#8bac0f", grid: "rgba(15,56,15,0.10)", gridStyle: "dots", food: "#0f380f", foodGlow: "#306230", frame: "rgba(15,56,15,0.6)" },
  { id: "ocean", name: "Ocean", bg: "#04131a", grid: "rgba(34,211,238,0.07)", gridStyle: "dots", food: "#fb923c", foodGlow: "#fed7aa", frame: "rgba(34,211,238,0.35)" },
  { id: "sand", name: "Desert", bg: "#2a1d0e", grid: "rgba(251,191,36,0.06)", gridStyle: "checker", food: "#ef4444", foodGlow: "#fca5a5", frame: "rgba(217,119,6,0.4)" },
  { id: "void", name: "Void", bg: "#000000", grid: "", gridStyle: "none", food: "#f4f4f5", foodGlow: "#71717a", frame: "rgba(255,255,255,0.15)" },
];

// ---------- 2048 ----------

export interface TileSet {
  id: string;
  name: string;
  board: string;
  empty: string;
  /** Tile background for 2, 4, 8 … 2048 (11 entries); bigger tiles use the last. */
  tiles: string[];
  /** Text color for the same tiles. */
  text: string[];
  /** Outlined, glowing tiles instead of filled ones. */
  neon?: boolean;
  /** Square corners and a pixel font feel. */
  pixel?: boolean;
  radius: number;
}

const DARK_TEXT = (n: number, dark: string, light = "#fff") => Array.from({ length: 11 }, (_, i) => (i < n ? dark : light));

export const TILE_SETS: TileSet[] = [
  {
    id: "classic",
    name: "Classic",
    board: "#3a3229",
    empty: "rgba(238,228,218,0.08)",
    tiles: ["#eee4da", "#ede0c8", "#f2b179", "#f59563", "#f67c5f", "#f65e3b", "#edcf72", "#edcc61", "#edc850", "#a78bfa", "#8b5cf6"],
    text: DARK_TEXT(2, "#776e65"),
    radius: 8,
  },
  {
    id: "midnight",
    name: "Midnight",
    board: "#111827",
    empty: "rgba(255,255,255,0.05)",
    tiles: ["#1e293b", "#273449", "#1d4ed8", "#2563eb", "#4f46e5", "#6d28d9", "#7c3aed", "#9333ea", "#c026d3", "#db2777", "#f43f5e"],
    text: DARK_TEXT(2, "#cbd5e1"),
    radius: 8,
  },
  {
    id: "neon",
    name: "Neon",
    board: "#07070d",
    empty: "rgba(255,255,255,0.04)",
    tiles: ["#22d3ee", "#38bdf8", "#a3e635", "#4ade80", "#facc15", "#fb923c", "#f472b6", "#e879f9", "#c084fc", "#f43f5e", "#ffffff"],
    text: ["#22d3ee", "#38bdf8", "#a3e635", "#4ade80", "#facc15", "#fb923c", "#f472b6", "#e879f9", "#c084fc", "#f43f5e", "#ffffff"],
    neon: true,
    radius: 10,
  },
  {
    id: "pastel",
    name: "Pastel",
    board: "#e9e3f5",
    empty: "rgba(120,100,160,0.10)",
    tiles: ["#fdf2f8", "#fce7f3", "#fbcfe8", "#f9a8d4", "#ddd6fe", "#c4b5fd", "#bfdbfe", "#93c5fd", "#a7f3d0", "#6ee7b7", "#fde68a"],
    text: DARK_TEXT(11, "#5b4b7a"),
    radius: 12,
  },
  {
    id: "ocean",
    name: "Ocean",
    board: "#0c2a3a",
    empty: "rgba(186,230,253,0.07)",
    tiles: ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#14b8a6", "#0d9488", "#10b981", "#059669", "#fbbf24"],
    text: DARK_TEXT(3, "#0c4a6e"),
    radius: 8,
  },
  {
    id: "ember",
    name: "Ember",
    board: "#1c0a04",
    empty: "rgba(251,146,60,0.07)",
    tiles: ["#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#f97316", "#ea580c", "#dc2626", "#b91c1c", "#991b1b", "#fafafa"],
    text: [...DARK_TEXT(5, "#78350f").slice(0, 10), "#991b1b"],
    radius: 8,
  },
  {
    id: "mono",
    name: "Monochrome",
    board: "#18181b",
    empty: "rgba(255,255,255,0.05)",
    tiles: ["#f4f4f5", "#e4e4e7", "#d4d4d8", "#a1a1aa", "#8a8a93", "#71717a", "#5f5f68", "#52525b", "#3f3f46", "#27272a", "#000000"],
    text: DARK_TEXT(4, "#18181b"),
    radius: 6,
  },
  {
    id: "pixel",
    name: "8-Bit",
    board: "#202020",
    empty: "#2c2c2c",
    tiles: ["#fcfcfc", "#bcbcbc", "#f8b800", "#f87858", "#f83800", "#d800cc", "#6844fc", "#0078f8", "#00b800", "#58f898", "#fce0a8"],
    text: ["#202020", "#202020", "#202020", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#202020", "#202020"],
    pixel: true,
    radius: 0,
  },
];

export function tileColors(set: TileSet, v: number): [string, string] {
  const i = Math.max(0, Math.min(set.tiles.length - 1, Math.log2(v) - 1));
  return [set.tiles[i], set.text[i]];
}

// ---------- Minesweeper ----------

export interface MinesTheme {
  id: string;
  name: string;
  grid: string;
  closed: string;
  closedHover: string;
  open: string;
  /** "bevel" draws raised 3D cells; "flat" plain tiles. */
  style: "bevel" | "flat";
  /** Colors for the numbers 1–8. */
  numbers: string[];
  boom: string;
  radius: number;
}

export const MINES_THEMES: MinesTheme[] = [
  { id: "modern", name: "Modern", grid: "#27272a", closed: "#52525b", closedHover: "#71717a", open: "#18181b", style: "bevel", numbers: ["#60a5fa", "#4ade80", "#f87171", "#a78bfa", "#fb923c", "#22d3ee", "#e4e4e7", "#a1a1aa"], boom: "#e11d48", radius: 0 },
  { id: "classic", name: "Classic", grid: "#7b7b7b", closed: "#c0c0c0", closedHover: "#d0d0d0", open: "#bdbdbd", style: "bevel", numbers: ["#0000ff", "#008000", "#ff0000", "#000080", "#800000", "#008080", "#000000", "#808080"], boom: "#ff0000", radius: 0 },
  { id: "neon", name: "Neon", grid: "#0b0b16", closed: "#1e1b4b", closedHover: "#312e81", open: "#07070d", style: "flat", numbers: ["#22d3ee", "#a3e635", "#f472b6", "#c084fc", "#facc15", "#38bdf8", "#f4f4f5", "#94a3b8"], boom: "#f43f5e", radius: 4 },
  { id: "paper", name: "Paper", grid: "#d6d3d1", closed: "#a8a29e", closedHover: "#bcb6b1", open: "#fafaf9", style: "flat", numbers: ["#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#b45309", "#0891b2", "#1c1917", "#57534e"], boom: "#ef4444", radius: 3 },
  { id: "forest", name: "Forest", grid: "#14261a", closed: "#3f7d4f", closedHover: "#4d9461", open: "#d9c9a3", style: "bevel", numbers: ["#1d4ed8", "#15803d", "#b91c1c", "#6d28d9", "#9a3412", "#0e7490", "#1c1917", "#44403c"], boom: "#dc2626", radius: 0 },
  { id: "ocean", name: "Ocean", grid: "#082f49", closed: "#0e7490", closedHover: "#0891b2", open: "#0c1e2b", style: "flat", numbers: ["#7dd3fc", "#6ee7b7", "#fca5a5", "#c4b5fd", "#fdba74", "#67e8f9", "#f1f5f9", "#94a3b8"], boom: "#f43f5e", radius: 4 },
];

// ---------- Connect Four ----------

export interface DiscSet {
  id: string;
  name: string;
  /** Colors for player 1 (goes first) and player 2. */
  colors: [string, string];
  style: "glossy" | "flat" | "neon" | "gem";
}

export const DISC_SETS: DiscSet[] = [
  { id: "classic", name: "Classic", colors: ["#f43f5e", "#facc15"], style: "glossy" },
  { id: "neon", name: "Neon", colors: ["#ff2bd6", "#22f5ff"], style: "neon" },
  { id: "candy", name: "Candy", colors: ["#fb7185", "#6ee7b7"], style: "flat" },
  { id: "gems", name: "Gems", colors: ["#10b981", "#8b5cf6"], style: "gem" },
  { id: "sunset", name: "Sunset", colors: ["#f97316", "#a855f7"], style: "glossy" },
  { id: "mono", name: "Mono", colors: ["#f4f4f5", "#27272a"], style: "glossy" },
];

export interface C4Board {
  id: string;
  name: string;
  /** Board gradient, top to bottom. */
  bg: [string, string];
  hole: string;
  glow: string;
}

export const C4_BOARDS: C4Board[] = [
  { id: "blue", name: "Classic blue", bg: ["#2563eb", "#1e40af"], hole: "rgba(23,37,84,0.8)", glow: "rgba(37,99,235,0.7)" },
  { id: "midnight", name: "Midnight", bg: ["#1e1b4b", "#0f0d2e"], hole: "rgba(3,3,12,0.85)", glow: "rgba(139,92,246,0.5)" },
  { id: "emerald", name: "Emerald", bg: ["#059669", "#065f46"], hole: "rgba(2,44,34,0.82)", glow: "rgba(16,185,129,0.55)" },
  { id: "wood", name: "Wood", bg: ["#a16207", "#713f12"], hole: "rgba(41,22,6,0.85)", glow: "rgba(161,98,7,0.5)" },
  { id: "synthwave", name: "Synthwave", bg: ["#be185d", "#6b0f3d"], hole: "rgba(26,5,38,0.85)", glow: "rgba(244,114,182,0.55)" },
  { id: "steel", name: "Steel", bg: ["#64748b", "#334155"], hole: "rgba(15,23,42,0.85)", glow: "rgba(148,163,184,0.4)" },
];

// ---------- Chess ----------

export interface ChessBoardTheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  /** Highlight for the last move and the selected square. */
  highlight: string;
  /** Coordinates text on light / dark squares. */
  coordLight: string;
  coordDark: string;
}

export const CHESS_BOARDS: ChessBoardTheme[] = [
  { id: "wood", name: "Wood", light: "#f0d9b5", dark: "#b58863", highlight: "rgba(250,204,21,0.45)", coordLight: "#b58863", coordDark: "#f0d9b5" },
  { id: "green", name: "Tournament", light: "#eeeed2", dark: "#769656", highlight: "rgba(246,246,105,0.55)", coordLight: "#769656", coordDark: "#eeeed2" },
  { id: "blue", name: "Ice", light: "#dee3e6", dark: "#8ca2ad", highlight: "rgba(56,189,248,0.45)", coordLight: "#8ca2ad", coordDark: "#dee3e6" },
  { id: "slate", name: "Slate", light: "#71717a", dark: "#3f3f46", highlight: "rgba(167,139,250,0.5)", coordLight: "#3f3f46", coordDark: "#a1a1aa" },
  { id: "synthwave", name: "Synthwave", light: "#3b1450", dark: "#1a0526", highlight: "rgba(244,114,182,0.5)", coordLight: "#f472b6", coordDark: "#c084fc" },
  { id: "marble", name: "Marble", light: "#f5f5f4", dark: "#a8a29e", highlight: "rgba(245,158,11,0.45)", coordLight: "#a8a29e", coordDark: "#f5f5f4" },
];

export interface ChessPieceSet {
  id: string;
  name: string;
  /** Fill and outline for white and black pieces. */
  white: { fill: string; stroke: string; detail: string };
  black: { fill: string; stroke: string; detail: string };
  /** Outlined, glowing pieces. */
  neon?: boolean;
}

export const CHESS_PIECE_SETS: ChessPieceSet[] = [
  { id: "classic", name: "Classic", white: { fill: "#ffffff", stroke: "#1c1917", detail: "#1c1917" }, black: { fill: "#262626", stroke: "#0a0a0a", detail: "#e7e5e4" } },
  { id: "ivory", name: "Ivory & Ebony", white: { fill: "#fdf6e3", stroke: "#78350f", detail: "#78350f" }, black: { fill: "#3b2314", stroke: "#1c0f07", detail: "#d6b48a" } },
  { id: "flat", name: "Flat", white: { fill: "#f8fafc", stroke: "#f8fafc", detail: "#94a3b8" }, black: { fill: "#1e293b", stroke: "#1e293b", detail: "#64748b" } },
  { id: "neon", name: "Neon", white: { fill: "#22d3ee", stroke: "#22d3ee", detail: "#cffafe" }, black: { fill: "#f472b6", stroke: "#f472b6", detail: "#fce7f3" }, neon: true },
  { id: "gold", name: "Gold & Silver", white: { fill: "#e5e7eb", stroke: "#4b5563", detail: "#4b5563" }, black: { fill: "#ca8a04", stroke: "#713f12", detail: "#fef3c7" } },
];

// ---------- Game of the Generals ----------

export interface GGPieceSet {
  id: string;
  name: string;
  /** Tile, outline and insignia colors for your army and the opponent's. */
  mine: { tile: string; edge: string; mark: string };
  theirs: { tile: string; edge: string; mark: string };
}

export const GG_PIECE_SETS: GGPieceSet[] = [
  { id: "classic", name: "Classic", mine: { tile: "#f5f5f4", edge: "#a8a29e", mark: "#1c1917" }, theirs: { tile: "#27272a", edge: "#09090b", mark: "#e7e5e4" } },
  { id: "army", name: "Field army", mine: { tile: "#4d7c0f", edge: "#365314", mark: "#fef08a" }, theirs: { tile: "#a16207", edge: "#713f12", mark: "#fef3c7" } },
  { id: "navy", name: "Navy", mine: { tile: "#1e40af", edge: "#1e3a8a", mark: "#fde68a" }, theirs: { tile: "#991b1b", edge: "#7f1d1d", mark: "#fecaca" } },
  { id: "neon", name: "Neon", mine: { tile: "#082f49", edge: "#22d3ee", mark: "#67e8f9" }, theirs: { tile: "#2e1065", edge: "#e879f9", mark: "#f5d0fe" } },
];

export interface GGBoardTheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  line: string;
}

export const GG_BOARDS: GGBoardTheme[] = [
  { id: "field", name: "Field", light: "#3f6212", dark: "#365314", line: "rgba(0,0,0,0.35)" },
  { id: "wood", name: "Wood", light: "#c8a26b", dark: "#b88f58", line: "rgba(60,30,10,0.45)" },
  { id: "slate", name: "Slate", light: "#3f3f46", dark: "#33333a", line: "rgba(0,0,0,0.5)" },
  { id: "sand", name: "Desert", light: "#d6b77a", dark: "#caa968", line: "rgba(90,60,20,0.4)" },
];

function pick<T extends { id: string }>(list: T[], id: string): T {
  return list.find((x) => x.id === id) ?? list[0];
}
export const getSnakeSkin = (id: string) => pick(SNAKE_SKINS, id);
export const getSnakeArena = (id: string) => pick(SNAKE_ARENAS, id);
export const getTileSet = (id: string) => pick(TILE_SETS, id);
export const getMinesTheme = (id: string) => pick(MINES_THEMES, id);
export const getDiscSet = (id: string) => pick(DISC_SETS, id);
export const getC4Board = (id: string) => pick(C4_BOARDS, id);
export const getChessBoard = (id: string) => pick(CHESS_BOARDS, id);
export const getChessPieces = (id: string) => pick(CHESS_PIECE_SETS, id);
export const getGGPieces = (id: string) => pick(GG_PIECE_SETS, id);
export const getGGBoard = (id: string) => pick(GG_BOARDS, id);
