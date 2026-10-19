// 2048 engine shared by browser and server. Tile spawns come from a seeded
// RNG that only the server holds: the browser slides tiles itself (`slide`)
// and the server sends back where the new tile appears (`place`), so a
// client can't look ahead at upcoming tiles.

import { Rng } from "../tetris/engine";

export const SIZE = 4;
/** Directions: 0 up, 1 right, 2 down, 3 left. */
export type Dir = 0 | 1 | 2 | 3;
export const DUEL_MS = 5 * 60_000;
export const DUEL_TARGET = 2048;

/** What a player may see of a game: everything except the RNG. */
export interface G2048View {
  board: number[];
  score: number;
  moves: number;
  over: boolean;
}

/** The server's reply to one move. */
export interface G2048Spawn {
  /** Move number this spawn belongs to. */
  n: number;
  cell: number;
  value: number;
  over: boolean;
}

export interface G2048State {
  board: number[];
  score: number;
  moves: number;
  over: boolean;
  rng: number;
}

export class G2048 {
  board: number[] = new Array(SIZE * SIZE).fill(0);
  score = 0;
  moves = 0;
  over = false;
  private rng: Rng;
  /** Cells that merged on the last move (for animation). */
  lastMerged: number[] = [];
  /** Cell that spawned on the last move. */
  lastSpawn = -1;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.spawn();
    this.spawn();
    this.lastSpawn = -1;
  }

  get maxTile(): number {
    return Math.max(...this.board);
  }

  /** Server only: add a random tile. Returns its cell, or -1 if the board is full. */
  spawn(): number {
    const empty: number[] = [];
    for (let i = 0; i < this.board.length; i++) if (this.board[i] === 0) empty.push(i);
    if (!empty.length) return -1;
    const cell = empty[Math.floor(this.rng.next() * empty.length)];
    this.board[cell] = this.rng.next() < 0.9 ? 2 : 4;
    this.lastSpawn = cell;
    return cell;
  }

  /** Client: put the tile the server spawned. */
  place(cell: number, value: number) {
    if (cell >= 0 && cell < this.board.length) this.board[cell] = value;
    this.lastSpawn = cell;
    this.over = !this.canMove();
  }

  /** Indices of one line in the order tiles slide toward. */
  private line(dir: Dir, k: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < SIZE; i++) {
      if (dir === 0) out.push(i * SIZE + k); // up: top first
      else if (dir === 2) out.push((SIZE - 1 - i) * SIZE + k); // down: bottom first
      else if (dir === 3) out.push(k * SIZE + i); // left: left first
      else out.push(k * SIZE + (SIZE - 1 - i)); // right: right first
    }
    return out;
  }

  /** Apply a move and spawn a tile (server side). Returns false (and changes nothing) if no tile can move. */
  move(dir: Dir): boolean {
    if (!this.slide(dir)) return false;
    this.spawn();
    this.over = !this.canMove();
    return true;
  }

  /** Slide and merge without spawning. Returns false (and changes nothing) if no tile can move. */
  slide(dir: Dir): boolean {
    if (this.over || ![0, 1, 2, 3].includes(dir)) return false;
    let moved = false;
    this.lastMerged = [];
    for (let k = 0; k < SIZE; k++) {
      const idx = this.line(dir, k);
      const vals = idx.map((i) => this.board[i]).filter((v) => v !== 0);
      const out: number[] = [];
      for (let i = 0; i < vals.length; i++) {
        if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
          out.push(vals[i] * 2);
          this.score += vals[i] * 2;
          this.lastMerged.push(idx[out.length - 1]);
          i++;
        } else out.push(vals[i]);
      }
      while (out.length < SIZE) out.push(0);
      for (let i = 0; i < SIZE; i++) {
        if (this.board[idx[i]] !== out[i]) moved = true;
        this.board[idx[i]] = out[i];
      }
    }
    if (!moved) return false;
    this.moves++;
    this.lastSpawn = -1;
    return true;
  }

  canMove(): boolean {
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] === 0) return true;
      const x = i % SIZE;
      if (x < SIZE - 1 && this.board[i] === this.board[i + 1]) return true;
      if (i + SIZE < this.board.length && this.board[i] === this.board[i + SIZE]) return true;
    }
    return false;
  }

  hash(): number {
    let h = 0x811c9dc5;
    for (const v of this.board) {
      h ^= Math.log2(v || 1);
      h = Math.imul(h, 0x01000193);
    }
    h ^= this.moves & 0xffff;
    h = Math.imul(h, 0x01000193);
    return h >>> 0;
  }

  view(): G2048View {
    return { board: [...this.board], score: this.score, moves: this.moves, over: this.over };
  }

  /** Client copy of a game: no RNG, tiles arrive from the server. */
  static fromView(v: G2048View): G2048 {
    const g = new G2048(0);
    g.board = [...v.board];
    g.score = v.score;
    g.moves = v.moves;
    g.over = v.over;
    g.lastSpawn = -1;
    return g;
  }

  serialize(): G2048State {
    return { board: [...this.board], score: this.score, moves: this.moves, over: this.over, rng: this.rng.s };
  }

  static deserialize(s: G2048State): G2048 {
    const g = new G2048(0);
    g.board = [...s.board];
    g.score = s.score;
    g.moves = s.moves;
    g.over = s.over;
    g.rng = new Rng(s.rng);
    g.lastSpawn = -1;
    return g;
  }
}
