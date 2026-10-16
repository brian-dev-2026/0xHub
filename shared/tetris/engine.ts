// Pure, deterministic Tetris engine following Tetris Battle / guideline rules:
// SRS rotation + wall kicks, 7-bag randomizer, hold (once per piece),
// 5-piece preview, ghost, move-reset lock delay, 3-corner T-spin detection
// (with minis), combos, back-to-back, perfect clears, and garbage with
// cancelling.
//
// The same code runs in the browser and on the server. Given the same seed
// and the same sequence of actions at the same steps, both produce exactly
// the same game — which is how the server verifies play. To keep that true:
// no Math.random / Math.pow / Date here, and time only advances via tick().

export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export const PIECES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

/** 0 = empty, 1..7 = piece (index into PIECES + 1), 8 = garbage. */
export type Cell = number;
export const GARBAGE = 8;

export const COLS = 10;
export const VISIBLE_ROWS = 20;
export const BUFFER_ROWS = 20;
export const ROWS = VISIBLE_ROWS + BUFFER_ROWS;
export const NEXT_COUNT = 5;

/** Fixed simulation step. Clients and server both advance in these steps. */
export const STEP_MS = 1000 / 60;

const SPAWN_X = 3;
const SPAWN_Y = BUFFER_ROWS - 1;

export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;

type Pt = readonly [number, number];

/** Spawn-orientation cells inside each piece's bounding box (y grows downward). */
const BASE: Record<PieceType, { size: number; cells: Pt[] }> = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 3, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

/** SHAPES[type][rot] -> cells, precomputed by rotating clockwise. */
export const SHAPES: Record<PieceType, Pt[][]> = Object.fromEntries(
  PIECES.map((t) => {
    const { size, cells } = BASE[t];
    const rots: Pt[][] = [cells];
    for (let r = 1; r < 4; r++) {
      const prev = rots[r - 1];
      rots.push(t === "O" ? prev : prev.map(([x, y]) => [size - 1 - y, x] as Pt));
    }
    return [t, rots];
  }),
) as Record<PieceType, Pt[][]>;

// SRS kick data, written in guideline notation (x right, y UP) and converted.
type KickTable = Record<string, Pt[]>;
const JLSTZ_KICKS: KickTable = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const I_KICKS: KickTable = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

export interface ActivePiece {
  type: PieceType;
  x: number;
  y: number;
  rot: number;
}

export type TSpin = "none" | "mini" | "full";

export interface ClearEvent {
  lines: number;
  tspin: TSpin;
  b2b: boolean; // this clear was boosted by back-to-back
  combo: number; // 0 for the first clear in a chain
  perfectClear: boolean;
  attack: number; // garbage generated before cancelling
  sent: number; // garbage left after cancelling incoming
  score: number;
  label: string; // e.g. "T-SPIN DOUBLE", "TETRIS"
  rows: number[]; // visible-field row indices that were cleared (before collapse)
}

export interface EngineEvents {
  onMove?(): void;
  onRotate?(tspin: TSpin): void;
  onLock?(): void;
  onClear?(e: ClearEvent): void;
  onHold?(): void;
  onGarbageIn?(lines: number): void;
  onTopOut?(): void;
  onLevelUp?(level: number): void;
}

export type EngineMode = "endless" | "battle";

export interface EngineOptions {
  seed: number;
  /** "endless": guideline level speed-up. "battle": speed rises with match time. */
  mode: EngineMode;
  startLevel?: number;
  events?: EngineEvents;
}

/** Garbage per clear type, matching Tetris Battle. */
export const ATTACK_TABLE = {
  normal: [0, 0, 1, 2, 4],
  tspin: [0, 2, 4, 6],
  mini: [0, 0, 1],
};
/** Bonus garbage for combo n (index = combo count, 0 = first clear). */
export const COMBO_TABLE = [0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
export const PERFECT_CLEAR_ATTACK = 10;

const SCORE_TABLE = {
  normal: [0, 100, 300, 500, 800],
  tspin: [400, 800, 1200, 1600],
  mini: [100, 200, 400],
};
const PC_SCORE = [0, 800, 1200, 1800, 2000];

/**
 * Seconds per row by level (guideline curve (0.8 - (l-1)*0.007)^(l-1)),
 * written out as literals so every JS engine uses identical values.
 */
const GRAVITY = [
  1, 0.793, 0.617796, 0.472729, 0.355197, 0.262004, 0.189677, 0.134735, 0.093882, 0.064152, 0.042976, 0.028218,
  0.018153, 0.011439, 0.007059, 0.004264, 0.00252, 0.001457, 0.000824, 0.000455,
];

export function gravityForLevel(level: number): number {
  return GRAVITY[Math.max(1, Math.min(level, GRAVITY.length)) - 1];
}

/** Serializable mulberry32 PRNG. */
export class Rng {
  constructor(public s: number) {
    this.s = s >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export function pieceIndex(t: PieceType): number {
  return PIECES.indexOf(t) + 1;
}

/** Everything needed to restore an engine exactly. */
export interface EngineState {
  mode: EngineMode;
  startLevel: number;
  board: string;
  active: ActivePiece | null;
  hold: PieceType | null;
  holdUsed: boolean;
  queue: string;
  incoming: number[];
  score: number;
  lines: number;
  level: number;
  combo: number;
  b2b: boolean;
  linesSent: number;
  piecesPlaced: number;
  elapsedMs: number;
  gameOver: boolean;
  fall: number;
  lockTimer: number;
  lockResets: number;
  lowestY: number;
  lastMoveWasRotate: boolean;
  lastKickIndex: number;
  rng: number;
}

export class TetrisEngine {
  board: Cell[][];
  active: ActivePiece | null = null;
  hold: PieceType | null = null;
  holdUsed = false;
  queue: PieceType[] = [];
  incoming: number[] = []; // pending garbage chunks, oldest first

  score = 0;
  lines = 0;
  level: number;
  combo = -1;
  b2b = false;
  linesSent = 0;
  piecesPlaced = 0;
  elapsedMs = 0;
  gameOver = false;
  lastClear: ClearEvent | null = null;

  /** Fractional rows of gravity accumulated. */
  private fall = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private lowestY = 0;
  private lastMoveWasRotate = false;
  private lastKickIndex = 0;
  private rng: Rng;
  readonly mode: EngineMode;
  readonly startLevel: number;
  events: EngineEvents;

  constructor(opts: EngineOptions) {
    this.mode = opts.mode;
    this.startLevel = opts.startLevel ?? 1;
    this.events = opts.events ?? {};
    this.rng = new Rng(opts.seed);
    this.level = this.startLevel;
    this.board = TetrisEngine.emptyBoard();
    this.refillQueue();
    this.spawn();
  }

  static emptyBoard(): Cell[][] {
    return Array.from({ length: ROWS }, () => new Array<Cell>(COLS).fill(0));
  }

  // ---------- serialization ----------

  serialize(): EngineState {
    let board = "";
    for (const row of this.board) for (const c of row) board += String(c);
    return {
      mode: this.mode,
      startLevel: this.startLevel,
      board,
      active: this.active ? { ...this.active } : null,
      hold: this.hold,
      holdUsed: this.holdUsed,
      queue: this.queue.join(""),
      incoming: [...this.incoming],
      score: this.score,
      lines: this.lines,
      level: this.level,
      combo: this.combo,
      b2b: this.b2b,
      linesSent: this.linesSent,
      piecesPlaced: this.piecesPlaced,
      elapsedMs: this.elapsedMs,
      gameOver: this.gameOver,
      fall: this.fall,
      lockTimer: this.lockTimer,
      lockResets: this.lockResets,
      lowestY: this.lowestY,
      lastMoveWasRotate: this.lastMoveWasRotate,
      lastKickIndex: this.lastKickIndex,
      rng: this.rng.s,
    };
  }

  static deserialize(s: EngineState, events?: EngineEvents): TetrisEngine {
    const e = new TetrisEngine({ mode: s.mode, startLevel: s.startLevel, seed: 0, events });
    e.board = [];
    for (let y = 0; y < ROWS; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < COLS; x++) row.push(Number(s.board[y * COLS + x]) || 0);
      e.board.push(row);
    }
    e.active = s.active ? { ...s.active } : null;
    e.hold = s.hold;
    e.holdUsed = s.holdUsed;
    e.queue = [...s.queue] as PieceType[];
    e.incoming = [...s.incoming];
    e.score = s.score;
    e.lines = s.lines;
    e.level = s.level;
    e.combo = s.combo;
    e.b2b = s.b2b;
    e.linesSent = s.linesSent;
    e.piecesPlaced = s.piecesPlaced;
    e.elapsedMs = s.elapsedMs;
    e.gameOver = s.gameOver;
    e.fall = s.fall;
    e.lockTimer = s.lockTimer;
    e.lockResets = s.lockResets;
    e.lowestY = s.lowestY;
    e.lastMoveWasRotate = s.lastMoveWasRotate;
    e.lastKickIndex = s.lastKickIndex;
    e.rng = new Rng(s.rng);
    return e;
  }

  /** Cheap FNV-1a fingerprint of the game state, used to detect client/server divergence. */
  hash(): number {
    let h = 0x811c9dc5;
    const mix = (n: number) => {
      h ^= n & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    for (const row of this.board) for (const c of row) mix(c);
    const a = this.active;
    if (a) {
      mix(pieceIndex(a.type));
      mix(a.x + 16);
      mix(a.y + 16);
      mix(a.rot);
    }
    mix(this.hold ? pieceIndex(this.hold) : 0);
    for (let i = 0; i < 6 && i < this.queue.length; i++) mix(pieceIndex(this.queue[i]));
    mix(this.piecesPlaced);
    mix(this.piecesPlaced >> 8);
    mix(this.lines);
    mix(this.incomingTotal);
    mix(this.combo + 1);
    mix(this.lockResets);
    return h >>> 0;
  }

  // ---------- queue / spawning ----------

  private refillQueue() {
    while (this.queue.length < NEXT_COUNT + 1) {
      const bag = [...PIECES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng.next() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.queue.push(...bag);
    }
  }

  get next(): PieceType[] {
    return this.queue.slice(0, NEXT_COUNT);
  }

  private spawn(type?: PieceType): boolean {
    if (!type) {
      type = this.queue.shift()!;
      this.refillQueue();
    }
    const piece: ActivePiece = { type, x: SPAWN_X, y: SPAWN_Y, rot: 0 };
    this.fall = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lastMoveWasRotate = false;
    if (!this.fits(type, 0, piece.x, piece.y)) {
      // Guideline: try one row higher before declaring block out.
      piece.y -= 1;
      if (!this.fits(type, 0, piece.x, piece.y)) {
        this.active = piece;
        this.lowestY = piece.y;
        this.topOut();
        return false;
      }
    }
    // Spawn then immediately drop one row if possible (guideline behaviour).
    if (this.fits(type, 0, piece.x, piece.y + 1)) piece.y += 1;
    this.active = piece;
    this.lowestY = piece.y;
    return true;
  }

  private topOut() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.events.onTopOut?.();
  }

  // ---------- collision helpers ----------

  /** Allocation-free collision test. */
  fits(type: PieceType, rot: number, x: number, y: number): boolean {
    const cells = SHAPES[type][rot];
    for (let i = 0; i < 4; i++) {
      const cx = x + cells[i][0];
      const cy = y + cells[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS) return false;
      if (cy >= 0 && this.board[cy][cx] !== 0) return false;
    }
    return true;
  }

  cellsOf(p: ActivePiece): Pt[] {
    return SHAPES[p.type][p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy] as Pt);
  }

  private occupied(x: number, y: number): boolean {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y < 0) return false;
    return this.board[y][x] !== 0;
  }

  collides(p: ActivePiece): boolean {
    return !this.fits(p.type, p.rot, p.x, p.y);
  }

  private onGround(): boolean {
    const a = this.active;
    return !!a && !this.fits(a.type, a.rot, a.x, a.y + 1);
  }

  ghostY(): number {
    const a = this.active;
    if (!a) return 0;
    let y = a.y;
    while (this.fits(a.type, a.rot, a.x, y + 1)) y++;
    return y;
  }

  /** Lock-delay move reset: any successful move/rotate on the ground resets the timer, up to a cap. */
  private afterManipulation() {
    if (!this.active) return;
    if (this.active.y > this.lowestY) {
      this.lowestY = this.active.y;
      this.lockResets = 0;
    }
    if (this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      if (this.onGround()) this.lockResets++;
    }
  }

  // ---------- player actions ----------

  move(dx: number): boolean {
    const a = this.active;
    if (!a || this.gameOver) return false;
    if (!this.fits(a.type, a.rot, a.x + dx, a.y)) return false;
    a.x += dx;
    this.lastMoveWasRotate = false;
    this.afterManipulation();
    this.events.onMove?.();
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    const a = this.active;
    if (!a || this.gameOver) return false;
    if (a.type === "O") return false;
    const to = (a.rot + dir + 4) % 4;
    const table = a.type === "I" ? I_KICKS : JLSTZ_KICKS;
    const kicks = table[`${a.rot}>${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (this.fits(a.type, to, a.x + kx, a.y - ky)) {
        a.rot = to;
        a.x += kx;
        a.y -= ky;
        this.lastMoveWasRotate = true;
        this.lastKickIndex = i;
        this.afterManipulation();
        this.events.onRotate?.(this.detectTSpin());
        return true;
      }
    }
    return false;
  }

  hardDrop() {
    const a = this.active;
    if (!a || this.gameOver) return;
    const y = this.ghostY();
    const dist = y - a.y;
    if (dist > 0) this.lastMoveWasRotate = false;
    this.score += dist * 2;
    a.y = y;
    this.lock();
  }

  holdPiece(): boolean {
    if (!this.active || this.holdUsed || this.gameOver) return false;
    const current = this.active.type;
    const swap = this.hold;
    this.hold = current;
    this.holdUsed = true;
    this.events.onHold?.();
    this.spawn(swap ?? undefined);
    return true;
  }

  // ---------- garbage ----------

  /** Queue incoming garbage; it rises when the next piece locks without clearing. */
  receiveGarbage(lines: number) {
    if (lines > 0 && !this.gameOver) this.incoming.push(lines);
  }

  get incomingTotal(): number {
    let t = 0;
    for (const n of this.incoming) t += n;
    return t;
  }

  private cancelIncoming(attack: number): number {
    while (attack > 0 && this.incoming.length) {
      const take = Math.min(attack, this.incoming[0]);
      this.incoming[0] -= take;
      attack -= take;
      if (this.incoming[0] === 0) this.incoming.shift();
    }
    return attack;
  }

  private riseGarbage() {
    let total = 0;
    for (const chunk of this.incoming) {
      // Each attack's lines share one hole column, as in Tetris Battle.
      const hole = Math.floor(this.rng.next() * COLS);
      for (let i = 0; i < chunk; i++) {
        this.board.shift();
        const row = new Array<Cell>(COLS).fill(GARBAGE);
        row[hole] = 0;
        this.board.push(row);
      }
      total += chunk;
    }
    this.incoming = [];
    if (total) {
      this.events.onGarbageIn?.(total);
      // Garbage pushing blocks into the top buffer is a top out.
      for (let y = 0; y < BUFFER_ROWS - 2; y++)
        if (this.board[y].some((c) => c !== 0)) {
          this.topOut();
          break;
        }
    }
  }

  // ---------- locking & clears ----------

  detectTSpin(): TSpin {
    const a = this.active;
    if (!a || a.type !== "T" || !this.lastMoveWasRotate) return "none";
    const corners: Pt[] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    const filled = corners.map(([cx, cy]) => this.occupied(a.x + cx, a.y + cy));
    const count = filled.filter(Boolean).length;
    if (count < 3) return "none";
    // Front corners are the two on the side the T points to.
    const front: Record<number, [number, number]> = { 0: [0, 1], 1: [1, 2], 2: [2, 3], 3: [3, 0] };
    const [f1, f2] = front[a.rot];
    const frontFilled = (filled[f1] ? 1 : 0) + (filled[f2] ? 1 : 0);
    if (frontFilled === 2 || this.lastKickIndex === 4) return "full";
    return "mini";
  }

  private lock() {
    const a = this.active;
    if (!a) return;
    const tspin = this.detectTSpin();
    const cells = this.cellsOf(a);
    for (const [x, y] of cells) if (y >= 0) this.board[y][x] = pieceIndex(a.type);
    this.active = null;
    this.piecesPlaced++;
    this.holdUsed = false;
    this.events.onLock?.();

    // Lock out: piece locked completely above the visible field.
    const lockOut = cells.every(([, y]) => y < BUFFER_ROWS);

    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) if (this.board[y].every((c) => c !== 0)) full.push(y);
    for (const y of full) {
      this.board.splice(y, 1);
      this.board.unshift(new Array<Cell>(COLS).fill(0));
    }
    const n = full.length;

    if (n > 0) {
      this.combo++;
      const difficult = n === 4 || tspin !== "none";
      const b2bBonus = difficult && this.b2b;
      this.b2b = difficult;
      const perfectClear = this.board.every((r) => r.every((c) => c === 0));

      let attack =
        tspin === "full" ? ATTACK_TABLE.tspin[n] : tspin === "mini" ? (ATTACK_TABLE.mini[n] ?? 0) : ATTACK_TABLE.normal[n];
      if (b2bBonus) attack += 1;
      attack += COMBO_TABLE[Math.min(this.combo, COMBO_TABLE.length - 1)];
      if (perfectClear) attack += PERFECT_CLEAR_ATTACK;

      let pts =
        tspin === "full" ? SCORE_TABLE.tspin[n] : tspin === "mini" ? (SCORE_TABLE.mini[n] ?? 0) : SCORE_TABLE.normal[n];
      if (b2bBonus) pts = Math.floor(pts * 1.5);
      pts += 50 * this.combo;
      if (perfectClear) pts += PC_SCORE[n];
      pts *= this.level;
      this.score += pts;

      const sent = this.cancelIncoming(attack);
      this.linesSent += sent;
      this.lines += n;

      const event: ClearEvent = {
        lines: n,
        tspin,
        b2b: b2bBonus,
        combo: this.combo,
        perfectClear,
        attack,
        sent,
        score: pts,
        label: clearLabel(n, tspin, b2bBonus, perfectClear),
        rows: full.map((y) => y - BUFFER_ROWS),
      };
      this.lastClear = event;
      this.events.onClear?.(event);

      if (this.mode === "endless") {
        const newLevel = Math.max(this.startLevel, Math.floor(this.lines / 10) + 1);
        if (newLevel > this.level) {
          this.level = newLevel;
          this.events.onLevelUp?.(newLevel);
        }
      }
    } else {
      this.combo = -1;
      if (tspin !== "none") {
        // T-spin with no lines still scores.
        this.score += (tspin === "full" ? SCORE_TABLE.tspin[0] : SCORE_TABLE.mini[0]) * this.level;
      }
      this.riseGarbage();
    }

    if (this.gameOver) return;
    if (lockOut && n === 0) {
      this.topOut();
      return;
    }
    this.spawn();
  }

  // ---------- time ----------

  private currentGravity(): number {
    if (this.mode === "battle") {
      // Tetris Battle speeds up as the round goes on.
      return gravityForLevel(1 + Math.floor(this.elapsedMs / 20_000));
    }
    return gravityForLevel(this.level);
  }

  /** Advance the simulation by dtMs. softDropFactor > 0 multiplies gravity while soft dropping. */
  tick(dtMs: number, softDropFactor = 0) {
    const a = this.active;
    if (this.gameOver || !a) return;
    this.elapsedMs += dtMs;
    const speed = softDropFactor > 0 ? softDropFactor : 1;
    this.fall += (dtMs / 1000 / this.currentGravity()) * speed;

    while (this.fall >= 1) {
      this.fall -= 1;
      if (!this.fits(a.type, a.rot, a.x, a.y + 1)) {
        this.fall = 0;
        break;
      }
      a.y += 1;
      this.lastMoveWasRotate = false;
      if (softDropFactor > 0) this.score += 1;
      if (a.y > this.lowestY) {
        this.lowestY = a.y;
        this.lockResets = 0;
      }
    }

    if (!this.fits(a.type, a.rot, a.x, a.y + 1)) {
      this.lockTimer += dtMs;
      // Out of move resets: the piece locks as soon as it touches down.
      if (this.lockTimer >= LOCK_DELAY_MS || this.lockResets >= MAX_LOCK_RESETS) this.lock();
    } else {
      this.lockTimer = 0;
    }
  }

  /** Clear the field after a KO in battle, keeping the queue going. */
  resetAfterKO() {
    this.board = TetrisEngine.emptyBoard();
    this.incoming = [];
    this.combo = -1;
    this.b2b = false;
    this.hold = null;
    this.holdUsed = false;
    this.gameOver = false;
    this.spawn();
  }

  /** Visible 20x10 field encoded for the network ('.' empty, IOTSZJL, 'G'). */
  encodeVisible(): string {
    let s = "";
    for (let y = BUFFER_ROWS; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const c = this.board[y][x];
        s += c === 0 ? "." : c === GARBAGE ? "G" : PIECES[c - 1];
      }
    return s;
  }
}

export function clearLabel(lines: number, tspin: TSpin, b2b: boolean, pc: boolean): string {
  const names = ["", "SINGLE", "DOUBLE", "TRIPLE", "QUAD"];
  let label = tspin === "full" ? `T-SPIN ${names[lines]}` : tspin === "mini" ? `T-SPIN MINI ${names[lines]}` : names[lines];
  if (b2b) label = `B2B ${label}`;
  if (pc) label = `PERFECT CLEAR`;
  return label.trim();
}

export function decodeCell(ch: string): Cell {
  if (ch === "G") return GARBAGE;
  const i = PIECES.indexOf(ch as PieceType);
  return i < 0 ? 0 : i + 1;
}
