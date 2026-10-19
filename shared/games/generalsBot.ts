// Computer opponent for Game of the Generals. It plays fair: it only reads
// `game.viewFor(side)` (enemy ranks hidden), the public pendingFlag, and its
// own memory of challenge outcomes it has seen.

import {
  ARMY,
  GG_COLS,
  GG_ROWS,
  RANK_INFO,
  RANKS,
  challenge,
  colOf,
  goalRow,
  neighbors,
  rowOf,
  setupZone,
} from "./generals";
import type { GeneralsGame, GGMoveResult, Placement, Rank, Side } from "./generals";

/** Bounds on an enemy piece's power (RANK_INFO scale), learned from challenges it survived. */
export interface BotMemory {
  [pieceId: number]: { minPower?: number; maxPower?: number };
}

const pick = <T>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

function take<T>(arr: T[], rng: () => number): T {
  return arr.splice(Math.floor(rng() * arr.length), 1)[0];
}

/** A sensible setup: flag on the back row shielded by pieces, spies off the front line, privates spread to bait spies. */
export function botSetup(side: Side, rng: () => number): Placement {
  const zone = setupZone(side);
  // Zone rows relative to this side: 0 = back, 1 = middle, 2 = front.
  const rel = (cell: number) => (side === 0 ? rowOf(cell) : GG_ROWS - 1 - rowOf(cell));
  const at = (r: number, c: number) => zone.find((x) => rel(x) === r && colOf(x) === c)!;
  const free = new Set(zone);
  const pool = [...ARMY];
  const out: Placement = [];
  const put = (cell: number, rank: Rank) => {
    free.delete(cell);
    pool.splice(pool.indexOf(rank), 1);
    out.push({ cell, rank });
  };

  const fc = 1 + Math.floor(rng() * (GG_COLS - 2));
  put(at(0, fc), "FLG");
  // Guards: sturdy mid officers and a private beside and in front of the flag.
  const guards: Rank[] = ["LTC", "MAJ", "CPT", "1LT", "2LT", "SGT", "PVT"];
  for (const cell of [at(0, fc - 1), at(0, fc + 1), at(1, fc)]) put(cell, take(guards, rng));
  for (let i = 0; i < 2; i++) put(pick([...free].filter((c) => rel(c) === 1), rng), "SPY");
  for (let n = pool.filter((r) => r === "PVT").length - 2; n > 0; n--) {
    put(pick([...free].filter((c) => rel(c) === 2), rng), "PVT");
  }
  // Generals favour the front and middle rows; the rest go anywhere.
  for (const r of ["G5", "G4", "G3"] as Rank[]) put(pick([...free].filter((c) => rel(c) >= 1), rng), r);
  const rest = [...free];
  while (pool.length) put(take(rest, rng), pool[0]);
  return out;
}

/** Rough worth of a piece, for trading decisions. */
const VALUE: Record<Rank, number> = {
  G5: 60,
  G4: 45,
  G3: 36,
  G2: 30,
  G1: 25,
  COL: 21,
  LTC: 18,
  MAJ: 15,
  CPT: 12,
  "1LT": 10,
  "2LT": 8,
  SGT: 6,
  PVT: 4,
  SPY: 30,
  FLG: 1000,
};

/** Ranks an unknown enemy piece may be, weighted by how many exist, filtered by memory. */
function candidates(known: BotMemory[number] | undefined): [Rank, number][] {
  const lo = known?.minPower ?? 0;
  const hi = known?.maxPower ?? 99;
  const out = RANKS.filter((r) => RANK_INFO[r].power >= lo && RANK_INFO[r].power <= hi).map(
    (r) => [r, RANK_INFO[r].count] as [Rank, number],
  );
  return out.length ? out : RANKS.map((r) => [r, RANK_INFO[r].count] as [Rank, number]);
}

/** Expected gain of attacking an unknown enemy with `mine`. */
function attackValue(mine: Rank, known: BotMemory[number] | undefined): number {
  const cands = candidates(known);
  const total = cands.reduce((s, [, n]) => s + n, 0);
  let ev = 0;
  for (const [r, n] of cands) {
    const c = challenge(mine, r);
    const gain = c === "attacker" ? VALUE[r] : c === "defender" ? -VALUE[mine] : VALUE[r] - VALUE[mine];
    ev += (gain * n) / total;
  }
  return ev;
}

/** Probability (0..1) that an unknown enemy beats `mine` if it attacks. */
function threat(mine: Rank, known: BotMemory[number] | undefined): number {
  const cands = candidates(known);
  const total = cands.reduce((s, [, n]) => s + n, 0);
  let p = 0;
  for (const [r, n] of cands) if (challenge(r, mine) !== "defender") p += n / total;
  return p;
}

/** Choose a move for `side`, or null if it has none. */
export function botMove(
  game: GeneralsGame,
  side: Side,
  memory: BotMemory,
  rng: () => number,
): { from: number; to: number } | null {
  const moves = game.legalMoves(side);
  if (!moves.length) return null;
  const view = game.viewFor(side);
  const enemy = (1 - side) as Side;
  const fwd = side === 0 ? 1 : -1;
  const isEnemy = (c: number) => view[c]?.side === enemy;
  const myFlag = view.findIndex((p) => p?.side === side && p.rank === "FLG");
  const pending = game.pendingFlag;
  // Later in the game, push harder so games end.
  const urgency = 1 + game.moves / 300;
  const enemyCells: number[] = [];
  view.forEach((p, i) => p?.side === enemy && enemyCells.push(i));
  const nearest = (c: number) =>
    enemyCells.reduce((d, e) => Math.min(d, Math.abs(rowOf(e) - rowOf(c)) + Math.abs(colOf(e) - colOf(c))), 99);

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const mine = view[m.from]!.rank!;
    const target = view[m.to];
    let score = rng() * 2;

    if (target) {
      const id = target.id;
      if (pending && pending.side === enemy && pending.cell === m.to) score += 100000; // any piece beats a flag
      else {
        score += attackValue(mine, memory[id]) * urgency;
        // Enemies next to our flag must go.
        if (myFlag >= 0 && neighbors(myFlag).includes(m.to)) score += 40;
        // Unknown pieces on their back row may be the flag.
        if (rowOf(m.to) === goalRow(side) && mine !== "FLG") score += 5;
        if (mine === "FLG") score -= 5000;
      }
    } else if (mine === "FLG") {
      const enemyNear = (c: number) => neighbors(c).some(isEnemy);
      if (rowOf(m.to) === goalRow(side) && !enemyNear(m.to)) score += 50000;
      else if (enemyNear(m.from) && !enemyNear(m.to)) score += 300;
      else if (enemyNear(m.to)) score -= 2000;
      else if (nearest(m.to) >= 3) score += 20 * (rowOf(m.to) - rowOf(m.from)) * fwd + 5;
      else score -= 60;
    } else {
      // Advance a little; avoid stepping next to enemies that likely beat us.
      score += (rowOf(m.to) - rowOf(m.from)) * fwd * (mine === "PVT" ? 3 : 2) * urgency;
      // Hunt: close in on the nearest enemy (keeps pieces from idling on the far row).
      const hunt = attackValue(mine, undefined) > 0 ? 1.5 : 0.6;
      score += (nearest(m.from) - nearest(m.to)) * hunt * urgency;
      // Clear the way for our own flag.
      if (myFlag >= 0 && m.from === myFlag + fwd * GG_COLS) score += 3 * urgency;
      for (const n of neighbors(m.to)) {
        if (isEnemy(n)) score -= threat(mine, memory[view[n]!.id]) * VALUE[mine] * 0.5;
      }
      for (const n of neighbors(m.from)) {
        if (isEnemy(n)) score += threat(mine, memory[view[n]!.id]) * VALUE[mine] * 0.4;
      }
      // Keep a guard next to the flag.
      if (myFlag >= 0 && neighbors(myFlag).includes(m.from) && !neighbors(myFlag).includes(m.to)) {
        score -= neighbors(myFlag).some(isEnemy) ? 60 : 12;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return { from: best.from, to: best.to };
}

/** Update memory after a move result, using only public information plus our own ranks. */
export function botObserve(
  memory: BotMemory,
  game: GeneralsGame,
  side: Side,
  result: GGMoveResult,
  attackerId: number,
  defenderId: number | null,
): void {
  if (!result.challenge || defenderId === null) return;
  const mineId = result.side === side ? attackerId : defenderId;
  const theirId = result.side === side ? defenderId : attackerId;
  const mine =
    game.cells.find((p) => p?.id === mineId && p.side === side) ?? game.captured[side].find((p) => p.id === mineId);
  if (!mine) return;
  const r = mine.rank;
  const p = RANK_INFO[r].power;
  const theirSurvived =
    result.challenge === (result.side === side ? "defender" : "attacker");
  const set = (lo: number, hi: number) => {
    const k = memory[theirId] ?? {};
    memory[theirId] = { minPower: Math.max(k.minPower ?? 0, lo), maxPower: Math.min(k.maxPower ?? 99, hi) };
  };
  if (result.challenge === "both") return; // both gone
  if (!theirSurvived) {
    delete memory[theirId];
    return;
  }
  // Their piece beat ours.
  if (r === "SPY") set(3, 3); // only a private beats a spy
  else if (r === "PVT") set(4, 15); // an officer
  else if (r === "G5") set(2, 2); // only a spy beats the 5-star
  else if (r !== "FLG") set(p + 1, 15); // a higher officer (or a spy; we treat it as strong)
}
