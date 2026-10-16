import { COLS, SHAPES, VISIBLE_ROWS, type Cell, type PieceType, PIECES } from "../../../shared/tetris/engine";
import type { BlockSkin, BoardTheme } from "./skins";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Paint one block of the given skin into a size x size square at (0,0). */
function paintBlock(ctx: CanvasRenderingContext2D, skin: BlockSkin, color: string, s: number) {
  const p = Math.max(1, Math.round(s * 0.06)); // inner padding
  switch (skin.style) {
    case "bevel": {
      // Tetris Battle-style: bright face, light top-left bevel, dark bottom-right.
      const b = Math.max(2, Math.round(s * 0.14));
      ctx.fillStyle = shade(color, -0.35);
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = shade(color, 0.45);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(s - b, b); ctx.lineTo(b, b); ctx.lineTo(b, s - b); ctx.lineTo(0, s);
      ctx.fill();
      const g = ctx.createLinearGradient(0, b, 0, s - b);
      g.addColorStop(0, shade(color, 0.12));
      g.addColorStop(1, shade(color, -0.12));
      ctx.fillStyle = g;
      ctx.fillRect(b, b, s - 2 * b, s - 2 * b);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(b, b, s - 2 * b, Math.max(1, (s - 2 * b) * 0.28));
      break;
    }
    case "flat": {
      ctx.fillStyle = color;
      roundRect(ctx, p, p, s - 2 * p, s - 2 * p, s * 0.12);
      ctx.fill();
      break;
    }
    case "neon": {
      ctx.fillStyle = rgba(color, 0.12);
      roundRect(ctx, p * 2, p * 2, s - 4 * p, s - 4 * p, s * 0.15);
      ctx.fill();
      ctx.shadowColor = color;
      ctx.shadowBlur = s * 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, s * 0.09);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = Math.max(0.5, s * 0.025);
      ctx.stroke();
      break;
    }
    case "glass": {
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, rgba(color, 0.85));
      g.addColorStop(1, rgba(color, 0.35));
      ctx.fillStyle = g;
      roundRect(ctx, p, p, s - 2 * p, s - 2 * p, s * 0.18);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(ctx, p * 2.5, p * 2.5, s * 0.5, s * 0.18, s * 0.09);
      ctx.fill();
      break;
    }
    case "pixel": {
      const u = s / 8;
      ctx.fillStyle = shade(color, -0.45);
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = color;
      ctx.fillRect(u, u, s - 2 * u, s - 2 * u);
      ctx.fillStyle = "#fff";
      ctx.fillRect(u, u, u, u);
      ctx.fillRect(u * 2, u, u, u);
      ctx.fillRect(u, u * 2, u, u);
      ctx.fillStyle = shade(color, -0.25);
      ctx.fillRect(s - 2 * u, u * 2, u, s - 3 * u);
      ctx.fillRect(u * 2, s - 2 * u, s - 3 * u, u);
      break;
    }
    case "candy": {
      const g = ctx.createRadialGradient(s * 0.35, s * 0.3, s * 0.05, s * 0.5, s * 0.5, s * 0.75);
      g.addColorStop(0, shade(color, 0.55));
      g.addColorStop(0.6, color);
      g.addColorStop(1, shade(color, -0.3));
      ctx.fillStyle = g;
      roundRect(ctx, p, p, s - 2 * p, s - 2 * p, s * 0.32);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.ellipse(s * 0.34, s * 0.28, s * 0.14, s * 0.08, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "gem": {
      const i = s * 0.25;
      ctx.fillStyle = shade(color, 0.35); // top
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(s - i, i); ctx.lineTo(i, i); ctx.fill();
      ctx.fillStyle = shade(color, 0.1); // left
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(i, i); ctx.lineTo(i, s - i); ctx.lineTo(0, s); ctx.fill();
      ctx.fillStyle = shade(color, -0.25); // right
      ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s, s); ctx.lineTo(s - i, s - i); ctx.lineTo(s - i, i); ctx.fill();
      ctx.fillStyle = shade(color, -0.45); // bottom
      ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(i, s - i); ctx.lineTo(s - i, s - i); ctx.lineTo(s, s); ctx.fill();
      const g = ctx.createLinearGradient(i, i, s - i, s - i);
      g.addColorStop(0, shade(color, 0.25));
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      ctx.fillRect(i, i, s - 2 * i, s - 2 * i);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(i, i, (s - 2 * i) * 0.35, (s - 2 * i) * 0.35);
      break;
    }
    case "outline": {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      roundRect(ctx, p * 2, p * 2, s - 4 * p, s - 4 * p, s * 0.1);
      ctx.stroke();
      ctx.fillStyle = rgba(color, 0.18);
      ctx.fill();
      break;
    }
  }
}

const spriteCache = new Map<string, HTMLCanvasElement>();

function sprite(skin: BlockSkin, colorIdx: number, size: number, dpr: number): HTMLCanvasElement {
  const key = `${skin.id}:${colorIdx}:${size}:${dpr}`;
  let c = spriteCache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = Math.ceil(size * dpr);
    c.height = Math.ceil(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    paintBlock(ctx, skin, skin.colors[colorIdx], size);
    spriteCache.set(key, c);
    if (spriteCache.size > 600) spriteCache.delete(spriteCache.keys().next().value!);
  }
  return c;
}

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  skin: BlockSkin,
  cell: Cell,
  x: number,
  y: number,
  size: number,
  alpha = 1,
) {
  if (!cell) return;
  const dpr = ctx.getTransform().a || 1;
  const img = sprite(skin, cell - 1, size, dpr);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, size, size);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

export interface FieldView {
  /** VISIBLE_ROWS x COLS */
  cells: Cell[][];
  active: { type: PieceType; x: number; y: number; rot: number } | null; // y relative to visible top
  ghostY: number | null;
  clearingRows?: number[];
  clearProgress?: number; // 0..1
  danger?: boolean;
}

export function drawField(
  ctx: CanvasRenderingContext2D,
  view: FieldView,
  skin: BlockSkin,
  theme: BoardTheme,
  cs: number,
  showGhost = true,
) {
  const w = COLS * cs;
  const h = VISIBLE_ROWS * cs;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, theme.bg[0]);
  bg.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (view.danger) {
    const d = ctx.createLinearGradient(0, 0, 0, h * 0.35);
    d.addColorStop(0, "rgba(244,63,94,0.25)");
    d.addColorStop(1, "rgba(244,63,94,0)");
    ctx.fillStyle = d;
    ctx.fillRect(0, 0, w, h * 0.35);
  }

  ctx.fillStyle = theme.grid;
  ctx.strokeStyle = theme.grid;
  if (theme.gridStyle === "lines") {
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) { ctx.moveTo(x * cs + 0.5, 0); ctx.lineTo(x * cs + 0.5, h); }
    for (let y = 1; y < VISIBLE_ROWS; y++) { ctx.moveTo(0, y * cs + 0.5); ctx.lineTo(w, y * cs + 0.5); }
    ctx.stroke();
  } else if (theme.gridStyle === "dots") {
    for (let x = 1; x < COLS; x++)
      for (let y = 1; y < VISIBLE_ROWS; y++) { ctx.beginPath(); ctx.arc(x * cs, y * cs, Math.max(1, cs * 0.05), 0, Math.PI * 2); ctx.fill(); }
  } else if (theme.gridStyle === "checker") {
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < VISIBLE_ROWS; y++) if ((x + y) % 2) ctx.fillRect(x * cs, y * cs, cs, cs);
  }

  for (let y = 0; y < VISIBLE_ROWS; y++) {
    const row = view.cells[y];
    const clearing = view.clearingRows?.includes(y);
    for (let x = 0; x < COLS; x++) {
      if (!row[x]) continue;
      drawBlock(ctx, skin, row[x], x * cs, y * cs, cs);
    }
    if (clearing) {
      ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - (view.clearProgress ?? 0))})`;
      ctx.fillRect(0, y * cs, w, cs);
    }
  }

  const a = view.active;
  if (a) {
    const shape = SHAPES[a.type][a.rot];
    const idx = PIECES.indexOf(a.type) + 1;
    if (showGhost && view.ghostY !== null && view.ghostY !== a.y) {
      for (const [cx, cy] of shape) {
        const gy = view.ghostY + cy;
        if (gy < 0) continue;
        drawBlock(ctx, skin, idx, (a.x + cx) * cs, gy * cs, cs, theme.ghostAlpha);
      }
    }
    for (const [cx, cy] of shape) {
      const py = a.y + cy;
      if (py < 0) continue;
      drawBlock(ctx, skin, idx, (a.x + cx) * cs, py * cs, cs);
    }
  }
}

/** Draw a centered piece preview (hold / next) into a w x h box at (ox, oy). */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  type: PieceType | null,
  skin: BlockSkin,
  ox: number,
  oy: number,
  w: number,
  h: number,
  cs: number,
  dim = false,
) {
  if (!type) return;
  const cells = SHAPES[type][0];
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pw = (maxX - minX + 1) * cs;
  const ph = (maxY - minY + 1) * cs;
  const sx = ox + (w - pw) / 2;
  const sy = oy + (h - ph) / 2;
  const idx = PIECES.indexOf(type) + 1;
  for (const [x, y] of cells) drawBlock(ctx, skin, idx, sx + (x - minX) * cs, sy + (y - minY) * cs, cs, dim ? 0.35 : 1);
}

/** Prepare a canvas for crisp HiDPI drawing; returns the 2D context scaled to CSS pixels. */
export function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
