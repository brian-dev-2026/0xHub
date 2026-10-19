// Game of the Generals (Salpakan) rules, 9 columns x 8 rows. The server is the
// arbiter: it resolves challenges and never reveals ranks, only which pieces
// were eliminated. Side 0 sets up in rows 0..2, side 1 in rows 5..7.

export const GG_COLS = 9;
export const GG_ROWS = 8;
const CELLS = GG_COLS * GG_ROWS;

/** Index = row * 9 + col. Row 0 is side 0's back row, row 7 is side 1's. */
export type Side = 0 | 1;
export type Rank =
  | "G5"
  | "G4"
  | "G3"
  | "G2"
  | "G1"
  | "COL"
  | "LTC"
  | "MAJ"
  | "CPT"
  | "1LT"
  | "2LT"
  | "SGT"
  | "PVT"
  | "SPY"
  | "FLG";

/** `power` orders ranks for display and plain challenges; Spy and Flag are special-cased in `challenge`. */
export const RANK_INFO: Record<Rank, { name: string; short: string; count: number; power: number }> = {
  G5: { name: "5-Star General", short: "5★", count: 1, power: 15 },
  G4: { name: "4-Star General", short: "4★", count: 1, power: 14 },
  G3: { name: "3-Star General", short: "3★", count: 1, power: 13 },
  G2: { name: "2-Star General", short: "2★", count: 1, power: 12 },
  G1: { name: "1-Star General", short: "1★", count: 1, power: 11 },
  COL: { name: "Colonel", short: "Col", count: 1, power: 10 },
  LTC: { name: "Lieutenant Colonel", short: "Lt Col", count: 1, power: 9 },
  MAJ: { name: "Major", short: "Maj", count: 1, power: 8 },
  CPT: { name: "Captain", short: "Capt", count: 1, power: 7 },
  "1LT": { name: "1st Lieutenant", short: "1st Lt", count: 1, power: 6 },
  "2LT": { name: "2nd Lieutenant", short: "2nd Lt", count: 1, power: 5 },
  SGT: { name: "Sergeant", short: "Sgt", count: 1, power: 4 },
  PVT: { name: "Private", short: "Pvt", count: 6, power: 3 },
  SPY: { name: "Spy", short: "Spy", count: 2, power: 2 },
  FLG: { name: "Flag", short: "Flag", count: 1, power: 1 },
};

export const RANKS = Object.keys(RANK_INFO) as Rank[];

/** The 21 pieces of one army, strongest first. */
export const ARMY: Rank[] = RANKS.flatMap((r) => new Array<Rank>(RANK_INFO[r].count).fill(r));

export const rowOf = (cell: number) => Math.floor(cell / GG_COLS);
export const colOf = (cell: number) => cell % GG_COLS;
const isCell = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < CELLS;

/** The row a side's flag must reach: the opponent's back row. */
export const goalRow = (side: Side) => (side === 0 ? GG_ROWS - 1 : 0);

/** Orthogonal neighbours of a cell. */
export function neighbors(cell: number): number[] {
  const r = rowOf(cell);
  const c = colOf(cell);
  const out: number[] = [];
  if (r > 0) out.push(cell - GG_COLS);
  if (r < GG_ROWS - 1) out.push(cell + GG_COLS);
  if (c > 0) out.push(cell - 1);
  if (c < GG_COLS - 1) out.push(cell + 1);
  return out;
}

/** The 27 cells a side may set up in. */
export function setupZone(side: Side): number[] {
  const first = side === 0 ? 0 : GG_ROWS - 3;
  const cells: number[] = [];
  for (let i = first * GG_COLS; i < (first + 3) * GG_COLS; i++) cells.push(i);
  return cells;
}

export type Placement = { cell: number; rank: Rank }[];

export function validateSetup(side: Side, placement: unknown): placement is Placement {
  if (!Array.isArray(placement) || placement.length !== ARMY.length) return false;
  const zone = new Set(setupZone(side));
  const used = new Set<number>();
  const counts = new Map<Rank, number>();
  for (const p of placement as unknown[]) {
    if (!p || typeof p !== "object") return false;
    const { cell, rank } = p as { cell: unknown; rank: unknown };
    if (!isCell(cell) || !zone.has(cell) || used.has(cell)) return false;
    if (typeof rank !== "string" || !Object.hasOwn(RANK_INFO, rank)) return false;
    used.add(cell);
    counts.set(rank as Rank, (counts.get(rank as Rank) ?? 0) + 1);
  }
  return RANKS.every((r) => counts.get(r) === RANK_INFO[r].count);
}

export function randomSetup(side: Side, rng: () => number): Placement {
  const cells = setupZone(side);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return ARMY.map((rank, i) => ({ cell: cells[i], rank }));
}

export type ChallengeResult = "attacker" | "defender" | "both";

export function challenge(attacker: Rank, defender: Rank): ChallengeResult {
  if (defender === "FLG") return "attacker"; // includes flag vs flag
  if (attacker === "FLG") return "defender";
  if (attacker === defender) return "both";
  if (attacker === "SPY") return defender === "PVT" ? "defender" : "attacker";
  if (defender === "SPY") return attacker === "PVT" ? "attacker" : "defender";
  return RANK_INFO[attacker].power > RANK_INFO[defender].power ? "attacker" : "defender";
}

export interface GGPiece {
  id: number;
  side: Side;
  rank: Rank;
}

export interface GGMoveResult {
  from: number;
  to: number;
  side: Side;
  /** set when the move was a challenge; ranks are NOT included here (arbiter secrecy) */
  challenge?: ChallengeResult;
  winner?: Side;
  reason?: "flag-captured" | "flag-reached" | "no-moves";
  /** your flag reached the back row next to an enemy: it must survive one turn */
  flagPending?: boolean;
}

export interface GGState {
  cells: (GGPiece | null)[];
  turn: Side;
  winner: Side | null;
  reason: string | null;
  pendingFlag: { side: Side; cell: number } | null;
  moves: number;
  /** captured[s] = pieces OF side s that were eliminated */
  captured: [GGPiece[], GGPiece[]];
}

const copyPiece = (p: GGPiece | null): GGPiece | null => (p ? { ...p } : null);

export class GeneralsGame {
  cells: (GGPiece | null)[] = new Array(CELLS).fill(null);
  turn: Side = 0;
  winner: Side | null = null;
  reason: string | null = null;
  pendingFlag: { side: Side; cell: number } | null = null;
  moves = 0;
  captured: [GGPiece[], GGPiece[]] = [[], []];

  constructor(setup0: Placement, setup1: Placement, first: Side = 0) {
    if (!validateSetup(0, setup0)) throw new Error("invalid setup for side 0");
    if (!validateSetup(1, setup1)) throw new Error("invalid setup for side 1");
    // Ids follow cell order, so they leak nothing about ranks.
    for (const [side, setup] of [[0, setup0], [1, setup1]] as const) {
      [...setup]
        .sort((a, b) => a.cell - b.cell)
        .forEach((p, i) => (this.cells[p.cell] = { id: side * 100 + i, side, rank: p.rank }));
    }
    this.turn = first;
  }

  legalMoves(side: Side = this.turn): { from: number; to: number }[] {
    if (this.winner !== null || side !== this.turn) return [];
    const out: { from: number; to: number }[] = [];
    for (let from = 0; from < CELLS; from++) {
      if (this.cells[from]?.side !== side) continue;
      for (const to of neighbors(from)) if (this.cells[to]?.side !== side) out.push({ from, to });
    }
    return out;
  }

  /** Returns null (and changes nothing) if illegal: wrong turn, game over, not your piece, not orthogonally adjacent, off-board, onto own piece. */
  move(side: Side, from: number, to: number): GGMoveResult | null {
    if (this.winner !== null || side !== this.turn) return null;
    if (!isCell(from) || !isCell(to) || !neighbors(from).includes(to)) return null;
    const piece = this.cells[from];
    const target = this.cells[to];
    if (!piece || piece.side !== side || target?.side === side) return null;

    const enemy = (1 - side) as Side;
    const res: GGMoveResult = { from, to, side };
    this.moves++;
    this.cells[from] = null;
    let flagLost: Side | null = null;
    if (target) {
      const c = challenge(piece.rank, target.rank);
      res.challenge = c;
      if (c !== "defender") {
        this.captured[enemy].push(target);
        if (target.rank === "FLG") flagLost = enemy;
      }
      if (c !== "attacker") {
        this.captured[side].push(piece);
        if (piece.rank === "FLG") flagLost = side;
      }
      this.cells[to] = c === "attacker" ? piece : c === "defender" ? target : null;
    } else {
      this.cells[to] = piece;
    }

    if (flagLost !== null) return this.end(res, (1 - flagLost) as Side, "flag-captured");
    // The opponent's flag sat on our back row and survived this move.
    if (this.pendingFlag?.side === enemy) return this.end(res, enemy, "flag-reached");
    this.pendingFlag = null;

    if (piece.rank === "FLG" && this.cells[to] === piece && rowOf(to) === goalRow(side)) {
      if (!neighbors(to).some((n) => this.cells[n]?.side === enemy)) return this.end(res, side, "flag-reached");
      this.pendingFlag = { side, cell: to };
      res.flagPending = true;
    }

    this.turn = enemy;
    if (this.legalMoves(enemy).length === 0) return this.end(res, side, "no-moves");
    return res;
  }

  private end(res: GGMoveResult, winner: Side, reason: NonNullable<GGMoveResult["reason"]>): GGMoveResult {
    this.winner = winner;
    this.reason = reason;
    this.pendingFlag = null;
    res.winner = winner;
    res.reason = reason;
    return res;
  }

  /** What `side` may see: own pieces with ranks; enemy pieces as { id, side } without rank (unless revealAll, used after the game ends). */
  viewFor(side: Side, revealAll = false): ({ id: number; side: Side; rank?: Rank } | null)[] {
    return this.cells.map((p) => {
      if (!p) return null;
      return p.side === side || revealAll ? { ...p } : { id: p.id, side: p.side };
    });
  }

  serialize(): GGState {
    return {
      cells: this.cells.map(copyPiece),
      turn: this.turn,
      winner: this.winner,
      reason: this.reason,
      pendingFlag: this.pendingFlag ? { ...this.pendingFlag } : null,
      moves: this.moves,
      captured: [this.captured[0].map((p) => ({ ...p })), this.captured[1].map((p) => ({ ...p }))],
    };
  }

  static deserialize(s: GGState): GeneralsGame {
    const g = Object.create(GeneralsGame.prototype) as GeneralsGame;
    const c = JSON.parse(JSON.stringify(s)) as GGState;
    g.cells = c.cells;
    g.turn = c.turn;
    g.winner = c.winner;
    g.reason = c.reason;
    g.pendingFlag = c.pendingFlag;
    g.moves = c.moves;
    g.captured = c.captured;
    return g;
  }
}
