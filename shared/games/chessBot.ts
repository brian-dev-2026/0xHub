// Computer opponent: negamax alpha-beta over the public Chess API with
// material + piece-square evaluation, MVV-LVA ordering, quiescence search
// and iterative deepening under a time budget. Lower levels add noise.

import type { Chess, Move, PieceType } from "./chess";

export type BotLevel = 1 | 2 | 3 | 4;

export const BOT_LEVELS: { level: BotLevel; name: string }[] = [
  { level: 1, name: "Beginner" },
  { level: 2, name: "Casual" },
  { level: 3, name: "Club" },
  { level: 4, name: "Strong" },
];

interface LevelConfig {
  depth: number;
  quiesce: boolean;
  /** Random bonus (centipawns) added to root move scores. */
  noise: number;
  /** Chance of playing a random legal move instead. */
  blunder: number;
  budgetMs: number;
}

const CONFIG: Record<BotLevel, LevelConfig> = {
  1: { depth: 1, quiesce: false, noise: 150, blunder: 0.2, budgetMs: 300 },
  2: { depth: 2, quiesce: false, noise: 40, blunder: 0.03, budgetMs: 600 },
  3: { depth: 3, quiesce: true, noise: 12, blunder: 0, budgetMs: 900 },
  4: { depth: 8, quiesce: true, noise: 0, blunder: 0, budgetMs: 700 },
};

const VAL: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100_000;
const INF = 1_000_000;

// Piece-square tables from White's view, a8 first (row 0 = rank 8).
// prettier-ignore
const PST: Record<PieceType | "ke", number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
  ke: [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
  ],
};

/** Static evaluation in centipawns from the side to move's point of view. */
function evaluate(c: Chess): number {
  const kings = { w: -1, b: -1 };
  const mat = { w: 0, b: 0 };
  let queens = 0;
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = c.board[sq];
    if (!p) continue;
    if (p.type === "k") {
      kings[p.color] = sq;
      continue;
    }
    if (p.type === "q") queens++;
    if (p.type !== "p") mat[p.color] += VAL[p.type];
    const idx = p.color === "w" ? (7 - (sq >> 3)) * 8 + (sq & 7) : sq;
    const v = VAL[p.type] + PST[p.type][idx];
    score += p.color === "w" ? v : -v;
  }
  const endgame = queens === 0 || mat.w + mat.b <= 1800;
  for (const color of ["w", "b"] as const) {
    const sq = kings[color];
    if (sq < 0) continue;
    const idx = color === "w" ? (7 - (sq >> 3)) * 8 + (sq & 7) : sq;
    const v = PST[endgame ? "ke" : "k"][idx];
    score += color === "w" ? v : -v;
  }
  // Mop-up: with a big edge, drive the enemy king to the edge and bring ours closer.
  if (endgame && kings.w >= 0 && kings.b >= 0 && Math.abs(score) > 400) {
    const strong = score > 0 ? "w" : "b";
    const weak = kings[strong === "w" ? "b" : "w"];
    const own = kings[strong];
    const centre = Math.max(3 - (weak >> 3), (weak >> 3) - 4) + Math.max(3 - (weak & 7), (weak & 7) - 4);
    const dist = Math.abs((weak >> 3) - (own >> 3)) + Math.abs((weak & 7) - (own & 7));
    const bonus = centre * 10 + (14 - dist) * 4;
    score += strong === "w" ? bonus : -bonus;
  }
  return c.turn === "w" ? score : -score;
}

function orderKey(m: Move): number {
  let k = 0;
  if (m.captured) k += 10_000 + VAL[m.captured] * 10 - VAL[m.piece];
  if (m.promotion) k += 9_000 + VAL[m.promotion];
  if (m.san.endsWith("#")) k += 50_000;
  else if (m.san.endsWith("+")) k += 500;
  return k;
}

function ordered(ms: Move[]): Move[] {
  return ms
    .map((m) => ({ m, k: orderKey(m) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m);
}

class Searcher {
  nodes = 0;
  stopped = false;
  canStop = false;
  constructor(
    private c: Chess,
    private useQ: boolean,
    private deadline: number,
  ) {}

  private tick(): boolean {
    if ((++this.nodes & 127) === 0 && this.canStop && Date.now() > this.deadline) this.stopped = true;
    return this.stopped;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if (this.tick()) return 0;
    const c = this.c;
    if (c.repetitionCount() >= 2 || c.halfmove >= 100 || c.isInsufficientMaterial()) return 0;
    const ms = c.moves();
    if (ms.length === 0) return c.inCheck() ? -MATE + ply : 0;
    if (depth <= 0 && c.inCheck() && ply < 16) depth = 1; // check extension
    if (depth <= 0) return this.useQ ? this.quiesce(alpha, beta, ply, ms) : evaluate(c);
    let best = -INF;
    for (const m of ordered(ms)) {
      c.move(m);
      const s = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      c.undo();
      if (this.stopped) return 0;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  quiesce(alpha: number, beta: number, ply: number, ms?: Move[]): number {
    if (this.tick()) return 0;
    const c = this.c;
    const stand = evaluate(c);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    ms ??= c.moves();
    if (ms.length === 0) return c.inCheck() ? -MATE + ply : 0;
    const tactical = ordered(ms.filter((m) => m.captured || m.promotion === "q"));
    for (const m of tactical) {
      if (!m.promotion && stand + VAL[m.captured!] + 200 < alpha) continue; // delta pruning
      c.move(m);
      const s = -this.quiesce(-beta, -alpha, ply + 1);
      c.undo();
      if (this.stopped) return 0;
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }
}

/** Pick a move for the side to move. */
export function botMove(chess: Chess, level: BotLevel, rng: () => number = Math.random): Move {
  const cfg = CONFIG[level] ?? CONFIG[2];
  const c = chess.clone();
  const root = c.moves();
  if (root.length === 0) throw new Error("botMove: no legal moves");
  if (root.length === 1) return root[0];
  const pick = (m: Move) => root.find((r) => r.uci === m.uci)!;
  if (cfg.blunder > 0 && rng() < cfg.blunder) return root[Math.floor(rng() * root.length) % root.length];

  const start = Date.now();
  const s = new Searcher(c, cfg.quiesce, start + cfg.budgetMs);
  let order = ordered(root);
  let best: { m: Move; score: number } | null = null;
  for (let depth = 1; depth <= cfg.depth; depth++) {
    s.canStop = depth > 1;
    const scored: { m: Move; score: number }[] = [];
    let top = -INF;
    for (const m of order) {
      // Moves within `noise` of the best get exact scores so noise can choose between them.
      const floor = top - cfg.noise - 1;
      c.move(m);
      const v = -s.negamax(depth - 1, -INF, -floor, 1);
      c.undo();
      if (s.stopped) break;
      scored.push({ m, score: v });
      if (v > top) top = v;
    }
    if (s.stopped) break;
    scored.sort((a, b) => b.score - a.score);
    order = scored.map((x) => x.m);
    const mating = top > MATE - 1000;
    let choice = scored[0];
    if (cfg.noise > 0 && !mating) {
      let bestNoisy = -INF;
      for (const x of scored) {
        if (x.score < top - cfg.noise) break;
        const n = x.score + rng() * cfg.noise;
        if (n > bestNoisy) {
          bestNoisy = n;
          choice = x;
        }
      }
    }
    best = choice;
    if (mating) break;
    // A deeper iteration usually costs several times the last one.
    if (Date.now() - start > cfg.budgetMs * 0.35) break;
  }
  return pick(best!.m);
}
