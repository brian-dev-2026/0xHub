import type { CSSProperties } from "react";
import type { C4Board, DiscSet, MinesTheme } from "./looks";

// Style helpers shared by the games and the look pickers' previews.

// ---------- Connect Four ----------

/** Color of disc 1 (first player) or 2. */
export function discColor(set: DiscSet, disc: number): string {
  return set.colors[disc === 2 ? 1 : 0];
}

export function discStyle(set: DiscSet, disc: number): CSSProperties {
  const c = discColor(set, disc);
  switch (set.style) {
    case "flat":
      return { background: c, boxShadow: "inset 0 0 0 4px rgba(255,255,255,0.35)" };
    case "neon":
      return { background: "rgba(0,0,0,0.55)", border: `3px solid ${c}`, boxShadow: `0 0 12px ${c}, inset 0 0 10px ${c}` };
    case "gem":
      return {
        background: `conic-gradient(from 45deg, color-mix(in srgb, ${c} 55%, white), ${c}, color-mix(in srgb, ${c} 60%, black), ${c}, color-mix(in srgb, ${c} 55%, white))`,
        boxShadow: `inset 0 0 0 3px color-mix(in srgb, ${c} 50%, white)`,
      };
    default:
      return {
        background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${c} 40%, white), ${c} 55%, color-mix(in srgb, ${c} 70%, black))`,
      };
  }
}

export function c4BoardStyle(b: C4Board): CSSProperties {
  return { background: `linear-gradient(180deg, ${b.bg[0]}, ${b.bg[1]})`, boxShadow: `0 20px 60px -20px ${b.glow}` };
}

// ---------- Minesweeper ----------

/** CSS variables a board's cells read their colors from. */
export function minesVars(t: MinesTheme): CSSProperties {
  return { background: t.grid, ["--mc" as string]: t.closed, ["--mch" as string]: t.closedHover, ["--mo" as string]: t.open, ["--mb" as string]: t.boom };
}

export function minesCellClass(t: MinesTheme, open: boolean, boom: boolean): string {
  const base = "relative grid place-items-center font-mono font-bold";
  if (boom) return `${base} bg-[var(--mb)]`;
  if (open) return `${base} bg-[var(--mo)]`;
  const bevel = t.style === "bevel" ? " shadow-[inset_2px_2px_0_rgba(255,255,255,0.35),inset_-2px_-2px_0_rgba(0,0,0,0.3)]" : "";
  return `${base} bg-[var(--mc)] hover:bg-[var(--mch)]${bevel}`;
}
