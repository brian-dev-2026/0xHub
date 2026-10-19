import { SNAKE_H, SNAKE_W, type SnakeSnapshot } from "../../../shared/games/snake";
import type { SnakeArena, SnakeSkin } from "../looks";

/** Darken a #rrggbb color by a fraction (canvas-safe; no color-mix). */
export function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * (1 - f));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function lighten(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v + (255 - v) * f);
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const xy = (c: number): [number, number] => [c % SNAKE_W, Math.floor(c / SNAKE_W)];

function drawBackground(ctx: CanvasRenderingContext2D, arena: SnakeArena, cell: number) {
  const W = SNAKE_W * cell;
  const H = SNAKE_H * cell;
  ctx.fillStyle = arena.bg;
  ctx.fillRect(0, 0, W, H);
  if (arena.gridStyle === "none" || !arena.grid) return;
  ctx.fillStyle = arena.grid;
  ctx.strokeStyle = arena.grid;
  if (arena.gridStyle === "checker") {
    for (let x = 0; x < SNAKE_W; x++) for (let y = 0; y < SNAKE_H; y++) if ((x + y) % 2) ctx.fillRect(x * cell, y * cell, cell, cell);
  } else if (arena.gridStyle === "dots") {
    for (let x = 0; x < SNAKE_W; x++) for (let y = 0; y < SNAKE_H; y++) ctx.fillRect(x * cell + cell / 2 - 1, y * cell + cell / 2 - 1, 2, 2);
  } else {
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < SNAKE_W; x++) (ctx.moveTo(x * cell + 0.5, 0), ctx.lineTo(x * cell + 0.5, H));
    for (let y = 1; y < SNAKE_H; y++) (ctx.moveTo(0, y * cell + 0.5), ctx.lineTo(W, y * cell + 0.5));
    ctx.stroke();
  }
}

function drawFood(ctx: CanvasRenderingContext2D, food: number[], arena: SnakeArena, cell: number, pixel: boolean) {
  for (const f of food) {
    const [fx, fy] = xy(f);
    const cx = fx * cell + cell / 2;
    const cy = fy * cell + cell / 2;
    if (pixel) {
      ctx.fillStyle = arena.food;
      ctx.fillRect(fx * cell + cell * 0.2, fy * cell + cell * 0.2, cell * 0.6, cell * 0.6);
      continue;
    }
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, cell * 0.6);
    g.addColorStop(0, arena.foodGlow);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(fx * cell - cell / 2, fy * cell - cell / 2, cell * 2, cell * 2);
    ctx.fillStyle = arena.food;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** One snake, as points in cell units (fractional while interpolating), head first. */
function drawSnake(ctx: CanvasRenderingContext2D, pts: number[][], color: string, skin: SnakeSkin, cell: number, mine: boolean, eyes: string) {
  const n = pts.length;
  for (let i = n - 1; i >= 0; i--) {
    const [x, y] = pts[i];
    const px = x * cell;
    const py = y * cell;
    const head = i === 0;
    switch (skin.style) {
      case "pixel":
        ctx.fillStyle = head ? color : i % 2 ? darken(color, 0.25) : darken(color, 0.1);
        ctx.fillRect(Math.round(px) + 1, Math.round(py) + 1, cell - 2, cell - 2);
        break;
      case "neon":
        ctx.shadowColor = color;
        ctx.shadowBlur = head ? cell * 0.9 : cell * 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, cell * 0.14);
        ctx.beginPath();
        ctx.roundRect(px + cell * 0.18, py + cell * 0.18, cell * 0.64, cell * 0.64, cell * 0.2);
        ctx.stroke();
        if (head) {
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        break;
      case "candy": {
        ctx.fillStyle = i % 2 ? lighten(color, 0.55) : color;
        ctx.beginPath();
        ctx.roundRect(px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.45);
        ctx.fill();
        break;
      }
      case "scales": {
        const r = cell * (head ? 0.5 : 0.46 - (i / n) * 0.08);
        const g = ctx.createRadialGradient(px + cell * 0.35, py + cell * 0.3, r * 0.1, px + cell / 2, py + cell / 2, r);
        g.addColorStop(0, lighten(color, 0.45));
        g.addColorStop(0.6, color);
        g.addColorStop(1, darken(color, 0.4));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px + cell / 2, py + cell / 2, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "outline":
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, cell * 0.1);
        ctx.strokeRect(px + cell * 0.15, py + cell * 0.15, cell * 0.7, cell * 0.7);
        if (head) {
          ctx.fillStyle = color;
          ctx.fillRect(px + cell * 0.15, py + cell * 0.15, cell * 0.7, cell * 0.7);
        }
        break;
      default: {
        const pad = head ? 0.04 : 0.1 + (i / n) * 0.12;
        ctx.fillStyle = head ? color : darken(color, Math.min(0.45, i * 0.02));
        ctx.beginPath();
        ctx.roundRect(px + cell * pad, py + cell * pad, cell * (1 - pad * 2), cell * (1 - pad * 2), cell * 0.3);
        ctx.fill();
      }
    }
  }
  const [hx, hy] = pts[0];
  ctx.fillStyle = eyes;
  ctx.beginPath();
  ctx.arc(hx * cell + cell * 0.33, hy * cell + cell * 0.38, cell * 0.1, 0, Math.PI * 2);
  ctx.arc(hx * cell + cell * 0.67, hy * cell + cell * 0.38, cell * 0.1, 0, Math.PI * 2);
  ctx.fill();
  if (mine) {
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(hx * cell, hy * cell, cell, cell);
  }
}

/**
 * Draw a frame of the arena. `t` (0–1) interpolates snakes between the
 * previous and current server ticks.
 */
export function drawArena(
  ctx: CanvasRenderingContext2D,
  opts: { prev: SnakeSnapshot | null; cur: SnakeSnapshot | null; t: number; cell: number; meId: string; skin: SnakeSkin; arena: SnakeArena },
) {
  const { prev, cur, t, cell, meId, skin, arena } = opts;
  drawBackground(ctx, arena, cell);
  if (!cur) return;
  drawFood(ctx, cur.food, arena, cell, skin.style === "pixel");
  for (const p of cur.players) {
    if (!p.alive || !p.body.length) continue;
    const old = prev?.players.find((q) => q.id === p.id);
    const pts = p.body.map((c, i) => {
      const [x, y] = xy(c);
      const oc = old?.alive ? (old.body[i] ?? old.body[old.body.length - 1]) : undefined;
      if (oc === undefined) return [x, y];
      const [ox, oy] = xy(oc);
      if (Math.abs(ox - x) + Math.abs(oy - y) > 1) return [x, y];
      return [ox + (x - ox) * t, oy + (y - oy) * t];
    });
    drawSnake(ctx, pts, p.color, skin, cell, p.id === meId, arena.bg);
  }
}
