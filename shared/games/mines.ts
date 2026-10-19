// Minesweeper rules. The board (mine positions) only ever exists on the
// server; clients receive revealed cells one action at a time, so reading the
// client can't reveal where the mines are.

import { Rng } from "../tetris/engine";

export type Difficulty = "beginner" | "intermediate" | "expert";

export const DIFFICULTIES: Record<Difficulty, { w: number; h: number; mines: number; label: string }> = {
  beginner: { w: 9, h: 9, mines: 10, label: "Beginner" },
  intermediate: { w: 16, h: 16, mines: 40, label: "Intermediate" },
  expert: { w: 30, h: 16, mines: 99, label: "Expert" },
};

export function isDifficulty(d: unknown): d is Difficulty {
  return d === "beginner" || d === "intermediate" || d === "expert";
}

/** A revealed cell: [index, adjacent mine count]. */
export type RevealedCell = [number, number];

export interface MinesState {
  w: number;
  h: number;
  mineCount: number;
  seed: number;
  mines: number[] | null; // generated on the first reveal
  revealed: number[];
  boom: number; // index of the mine that was hit, or -1
}

export class MinesBoard {
  readonly w: number;
  readonly h: number;
  readonly mineCount: number;
  private seed: number;
  private mines: Set<number> | null = null;
  private revealed = new Set<number>();
  boom = -1;

  constructor(w: number, h: number, mineCount: number, seed: number) {
    this.w = w;
    this.h = h;
    this.mineCount = mineCount;
    this.seed = seed;
  }

  get started(): boolean {
    return this.mines !== null;
  }
  get lost(): boolean {
    return this.boom >= 0;
  }
  get won(): boolean {
    return !this.lost && this.revealed.size === this.w * this.h - this.mineCount;
  }
  get revealedCount(): number {
    return this.revealed.size;
  }

  private neighbors(i: number): number[] {
    const x = i % this.w;
    const y = Math.floor(i / this.w);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h) out.push(ny * this.w + nx);
      }
    return out;
  }

  /** Place mines avoiding the first click and its neighbours (always opens an area). */
  private generate(first: number) {
    const safe = new Set([first, ...this.neighbors(first)]);
    const pool: number[] = [];
    for (let i = 0; i < this.w * this.h; i++) if (!safe.has(i)) pool.push(i);
    const rng = new Rng(this.seed);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.mines = new Set(pool.slice(0, this.mineCount));
  }

  count(i: number): number {
    let n = 0;
    for (const j of this.neighbors(i)) if (this.mines!.has(j)) n++;
    return n;
  }

  private valid(i: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < this.w * this.h;
  }

  /** Reveal a cell (flood-filling zeros). Returns newly revealed cells; sets `boom` on a mine. */
  reveal(i: number): RevealedCell[] {
    if (!this.valid(i) || this.lost || this.won || this.revealed.has(i)) return [];
    if (!this.mines) this.generate(i);
    if (this.mines!.has(i)) {
      this.boom = i;
      return [];
    }
    const out: RevealedCell[] = [];
    const stack = [i];
    while (stack.length) {
      const c = stack.pop()!;
      if (this.revealed.has(c) || this.mines!.has(c)) continue;
      this.revealed.add(c);
      const n = this.count(c);
      out.push([c, n]);
      if (n === 0) for (const j of this.neighbors(c)) if (!this.revealed.has(j)) stack.push(j);
    }
    return out;
  }

  /**
   * Chord on a revealed number: if the player has flagged exactly that many
   * neighbours, reveal all the other neighbours (a wrong flag means a mine).
   */
  chord(i: number, flags: Set<number>): RevealedCell[] {
    if (!this.valid(i) || !this.revealed.has(i) || this.lost) return [];
    const nbs = this.neighbors(i);
    const flagged = nbs.filter((j) => flags.has(j)).length;
    if (flagged !== this.count(i)) return [];
    const out: RevealedCell[] = [];
    for (const j of nbs) {
      if (flags.has(j) || this.revealed.has(j)) continue;
      out.push(...this.reveal(j));
      if (this.lost) break;
    }
    return out;
  }

  mineList(): number[] {
    return this.mines ? [...this.mines] : [];
  }

  serialize(): MinesState {
    return {
      w: this.w,
      h: this.h,
      mineCount: this.mineCount,
      seed: this.seed,
      mines: this.mines ? [...this.mines] : null,
      revealed: [...this.revealed],
      boom: this.boom,
    };
  }

  static deserialize(s: MinesState): MinesBoard {
    const b = new MinesBoard(s.w, s.h, s.mineCount, s.seed);
    b.mines = s.mines ? new Set(s.mines) : null;
    b.revealed = new Set(s.revealed);
    b.boom = s.boom;
    return b;
  }
}
