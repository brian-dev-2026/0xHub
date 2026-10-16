// Pure Tetris engine following Tetris Battle / guideline rules:
// SRS rotation + wall kicks, 7-bag randomizer, hold (once per piece),
// 5-piece preview, ghost, move-reset lock delay, 3-corner T-spin detection
// (with minis), combos, back-to-back, perfect clears, and garbage with
// cancelling. No DOM access — rendering and input live elsewhere.

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

const SPAWN_X = 3;
const SPAWN_Y = BUFFER_ROWS - 1; // flat side lands on the top visible row

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

export interface EngineOptions {
  seed?: number;
  /** "endless": guideline level speed-up. "battle": speed rises with match time. */
  mode: "endless" | "battle";
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

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seconds per row at a given level (guideline gravity curve). */
export function gravityForLevel(level: number): number {
  const l = Math.min(level, 20) - 1;
  return Math.pow(0.8 - l * 0.007, l);
}

export function pieceIndex(t: PieceType): number {
  return PIECES.indexOf(t) + 1;
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
  private rng: () => number;
  private readonly opts: EngineOptions;
  events: EngineEvents;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.events = opts.events ?? {};
    this.rng = mulberry32(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
    this.level = opts.startLevel ?? 1;
    this.board = TetrisEngine.emptyBoard();
    this.refillQueue();
    this.spawn();
  }

  static emptyBoard(): Cell[][] {
    return Array.from({ length: ROWS }, () => new Array<Cell>(COLS).fill(0));
  }

  // ---------- queue / spawning ----------

  private refillQueue() {
    while (this.queue.length < NEXT_COUNT + 1) {
      const bag = [...PIECES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
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
    this.lowestY = piece.y;
    this.lastMoveWasRotate = false;
    if (this.collides(piece)) {
      // Guideline: try one row higher before declaring block out.
      piece.y -= 1;
      if (this.collides(piece)) {
        this.active = piece;
        this.topOut();
        return false;
      }
    }
    this.active = piece;
    // Spawn then immediately drop one row if possible (guideline behaviour).
    if (!this.collides({ ...piece, y: piece.y + 1 })) piece.y += 1;
    this.lowestY = piece.y;
    return true;
  }

  private topOut() {
    this.gameOver = true;
    this.events.onTopOut?.();
  }

  // ---------- collision helpers ----------

  cellsOf(p: ActivePiece): Pt[] {
    return SHAPES[p.type][p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy] as Pt);
  }

  private occupied(x: number, y: number): boolean {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y < 0) return false;
    return this.board[y][x] !== 0;
  }

  collides(p: ActivePiece): boolean {
    for (const [x, y] of this.cellsOf(p)) if (this.occupied(x, y)) return true;
    return false;
  }

  private onGround(): boolean {
    return !!this.active && this.collides({ ...this.active, y: this.active.y + 1 });
  }

  ghostY(): number {
    if (!this.active) return 0;
    let y = this.active.y;
    while (!this.collides({ ...this.active, y: y + 1 })) y++;
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
    if (!this.active || this.gameOver) return false;
    const p = { ...this.active, x: this.active.x + dx };
    if (this.collides(p)) return false;
    this.active = p;
    this.lastMoveWasRotate = false;
    this.afterManipulation();
    this.events.onMove?.();
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    if (!this.active || this.gameOver) return false;
    const a = this.active;
    if (a.type === "O") return false;
    const to = (a.rot + dir + 4) % 4;
    const table = a.type === "I" ? I_KICKS : JLSTZ_KICKS;
    const kicks = table[`${a.rot}>${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      const p = { ...a, rot: to, x: a.x + kx, y: a.y - ky };
      if (!this.collides(p)) {
        this.active = p;
        this.lastMoveWasRotate = true;
        this.lastKickIndex = i;
        this.afterManipulation();
        this.events.onRotate?.(this.detectTSpin());
        return true;
      }
    }
    return false;
  }

  /** Soft drop by one row. Returns false if it couldn't move. */
  softDrop(): boolean {
    if (!this.active || this.gameOver) return false;
    const p = { ...this.active, y: this.active.y + 1 };
    if (this.collides(p)) return false;
    this.active = p;
    this.lastMoveWasRotate = false;
    this.fall = 0;
    this.score += 1;
    this.afterManipulation();
    return true;
  }

  hardDrop() {
    if (!this.active || this.gameOver) return;
    const y = this.ghostY();
    const dist = y - this.active.y;
    if (dist > 0) this.lastMoveWasRotate = false;
    this.score += dist * 2;
    this.active = { ...this.active, y };
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
    if (lines > 0) this.incoming.push(lines);
  }

  get incomingTotal(): number {
    return this.incoming.reduce((a, b) => a + b, 0);
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
      const hole = Math.floor(this.rng() * COLS);
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
      if (this.board.slice(0, BUFFER_ROWS - 2).some((r) => r.some((c) => c !== 0))) this.topOut();
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
      const difficult = n === 4 || (tspin !== "none" && n > 0);
      const b2bBonus = difficult && this.b2b;
      this.b2b = difficult ? true : false;
      const perfectClear = this.board.every((r) => r.every((c) => c === 0));

      let attack =
        tspin === "full" ? ATTACK_TABLE.tspin[n] : tspin === "mini" ? ATTACK_TABLE.mini[n] ?? 0 : ATTACK_TABLE.normal[n];
      if (b2bBonus) attack += 1;
      attack += COMBO_TABLE[Math.min(this.combo, COMBO_TABLE.length - 1)];
      if (perfectClear) attack += PERFECT_CLEAR_ATTACK;

      let pts =
        tspin === "full" ? SCORE_TABLE.tspin[n] : tspin === "mini" ? SCORE_TABLE.mini[n] ?? 0 : SCORE_TABLE.normal[n];
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

      if (this.opts.mode === "endless") {
        const newLevel = Math.max(this.opts.startLevel ?? 1, Math.floor(this.lines / 10) + 1);
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
    if (this.opts.mode === "battle") {
      // Tetris Battle speeds up as the round goes on.
      const lvl = 1 + Math.floor(this.elapsedMs / 20_000);
      return gravityForLevel(lvl);
    }
    return gravityForLevel(this.level);
  }

  /** Advance the simulation. `softDropping` applies the soft drop factor instead of gravity. */
  tick(dtMs: number, softDropFactor = 0) {
    if (this.gameOver || !this.active) return;
    this.elapsedMs += dtMs;
    const secPerRow = this.currentGravity();
    const speed = softDropFactor > 0 ? softDropFactor : 1;
    this.fall += (dtMs / 1000 / secPerRow) * speed;

    while (this.fall >= 1 && this.active) {
      this.fall -= 1;
      const p: ActivePiece = { ...this.active, y: this.active.y + 1 };
      if (this.collides(p)) {
        this.fall = 0;
        break;
      }
      this.active = p;
      this.lastMoveWasRotate = false;
      if (softDropFactor > 0) this.score += 1;
      if (p.y > this.lowestY) {
        this.lowestY = p.y;
        this.lockResets = 0;
      }
    }

    if (this.onGround()) {
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
  const names = ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS"];
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
