// Chess rules engine shared by browser and server: legal move generation,
// FEN, SAN/UCI, and the FIDE game-ending rules (mate, stalemate, dead
// positions, repetition, 50/75-move rules). No randomness, no dependencies.

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export interface Piece {
  color: Color;
  type: PieceType;
}
export type Promotion = "q" | "r" | "b" | "n";

export interface Move {
  from: number;
  to: number;
  piece: PieceType;
  color: Color;
  captured?: PieceType;
  promotion?: Promotion;
  /** "n" normal, "c" capture, "e" en passant, "k" kingside castle, "q" queenside castle, "b" double pawn push, "p" promotion — may combine, e.g. "cp". */
  flags: string;
  /** Full SAN incl. disambiguation, "=Q", "+" / "#", "O-O", "O-O-O". */
  san: string;
  /** e.g. "e2e4", "e7e8q". */
  uci: string;
}

export type DrawReason =
  | "stalemate"
  | "insufficient"
  | "fivefold"
  | "seventyfive"
  | "threefold"
  | "fifty"
  | "agreement"
  | "timeout-vs-insufficient";
export interface Outcome {
  winner: Color | null;
  reason: "checkmate" | DrawReason;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = "abcdefgh";

/** Squares are 0..63: index = rank * 8 + file, with a1 = 0, h1 = 7, a8 = 56, h8 = 63. */
export function sqName(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i > 63) return "";
  return FILES[i & 7] + String((i >> 3) + 1);
}

/** "e4" -> 28, -1 if invalid. */
export function sqIndex(name: string): number {
  if (typeof name !== "string" || !/^[a-h][1-8]$/.test(name)) return -1;
  return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
}

const other = (c: Color): Color => (c === "w" ? "b" : "w");

// Shared immutable piece objects (board squares point at these).
const PIECES = {} as Record<Color, Record<PieceType, Piece>>;
for (const color of ["w", "b"] as Color[]) {
  PIECES[color] = {} as Record<PieceType, Piece>;
  for (const type of ["p", "n", "b", "r", "q", "k"] as PieceType[]) {
    PIECES[color][type] = Object.freeze({ color, type });
  }
}

// Precomputed targets: knight/king steps and sliding rays (dirs 0-3 orthogonal, 4-7 diagonal).
const KNIGHT: number[][] = [];
const KING: number[][] = [];
const RAYS: number[][][] = [];
const DIRS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const KNIGHT_D = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7;
  const r = sq >> 3;
  const on = (ff: number, rr: number) => ff >= 0 && ff < 8 && rr >= 0 && rr < 8;
  KNIGHT[sq] = KNIGHT_D.filter(([df, dr]) => on(f + df, r + dr)).map(([df, dr]) => (r + dr) * 8 + f + df);
  KING[sq] = DIRS.filter(([df, dr]) => on(f + df, r + dr)).map(([df, dr]) => (r + dr) * 8 + f + df);
  RAYS[sq] = DIRS.map(([df, dr]) => {
    const ray: number[] = [];
    for (let ff = f + df, rr = r + dr; on(ff, rr); ff += df, rr += dr) ray.push(rr * 8 + ff);
    return ray;
  });
}

// Internal move encoding.
const F_CAP = 1;
const F_EP = 2;
const F_K = 4;
const F_Q = 8;
const F_BIG = 16;
const F_PROMO = 32;
const PROMOS: Promotion[] = ["q", "r", "b", "n"];

interface Raw {
  from: number;
  to: number;
  flags: number;
  promo?: Promotion;
}

interface Saved {
  raw: Raw;
  piece: Piece;
  captured: Piece | null;
  castling: string;
  ep: number;
  halfmove: number;
}

function flagStr(fl: number): string {
  let s = "";
  if (fl & F_EP) s += "e";
  else if (fl & F_CAP) s += "c";
  if (fl & F_BIG) s += "b";
  if (fl & F_K) s += "k";
  if (fl & F_Q) s += "q";
  if (fl & F_PROMO) s += "p";
  return s || "n";
}

/** Drop castling rights touched by a move from/to a king or rook home square. */
function stripRights(c: string, from: number, to: number): string {
  for (const sq of [from, to]) {
    if (sq === 4) c = c.replace("K", "").replace("Q", "");
    else if (sq === 60) c = c.replace("k", "").replace("q", "");
    else if (sq === 0) c = c.replace("Q", "");
    else if (sq === 7) c = c.replace("K", "");
    else if (sq === 56) c = c.replace("q", "");
    else if (sq === 63) c = c.replace("k", "");
  }
  return c === "" ? "-" : c;
}

function invalid(fen: string, why: string): never {
  throw new Error(`Invalid FEN (${why}): ${fen}`);
}

export class Chess {
  board: (Piece | null)[] = new Array(64).fill(null);
  turn: Color = "w";
  castling = "KQkq";
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  history: Move[] = [];
  private stack: Saved[] = [];
  /** Position keys since the starting FEN; keys[i] is the position before history[i]. */
  private keys: string[] = [];
  private kings: Record<Color, number> = { w: -1, b: -1 };
  private startTurn: Color = "w";
  private startFull = 1;

  constructor(fen: string = START_FEN) {
    this.load(fen);
  }

  private load(fen: string): void {
    const parts = String(fen).trim().split(/\s+/);
    if (parts.length !== 6 && parts.length !== 4) invalid(fen, "field count");
    const [place, turn, castling, ep] = parts;
    const rows = place.split("/");
    if (rows.length !== 8) invalid(fen, "ranks");
    const board: (Piece | null)[] = new Array(64).fill(null);
    const kings: Record<Color, number> = { w: -1, b: -1 };
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= "1" && ch <= "8") {
          file += Number(ch);
          continue;
        }
        const color: Color = ch === ch.toUpperCase() ? "w" : "b";
        const type = ch.toLowerCase() as PieceType;
        if (!"pnbrqk".includes(type) || file > 7) invalid(fen, "placement");
        if (type === "p" && (rank === 0 || rank === 7)) invalid(fen, "pawn on back rank");
        if (type === "k") {
          if (kings[color] >= 0) invalid(fen, "two kings");
          kings[color] = rank * 8 + file;
        }
        board[rank * 8 + file] = PIECES[color][type];
        file++;
      }
      if (file !== 8) invalid(fen, "rank length");
    }
    if (kings.w < 0 || kings.b < 0) invalid(fen, "missing king");
    if (turn !== "w" && turn !== "b") invalid(fen, "side to move");
    if (!/^(-|K?Q?k?q?)$/.test(castling) || castling === "") invalid(fen, "castling");
    let epSq = -1;
    if (ep !== "-") {
      epSq = sqIndex(ep);
      if (epSq < 0 || epSq >> 3 !== (turn === "w" ? 5 : 2)) invalid(fen, "en passant");
    }
    const half = parts.length === 6 ? Number(parts[4]) : 0;
    const full = parts.length === 6 ? Number(parts[5]) : 1;
    if (!Number.isInteger(half) || half < 0 || !Number.isInteger(full) || full < 1) invalid(fen, "counters");

    this.board = board;
    this.kings = kings;
    this.turn = turn;
    this.castling = castling;
    this.ep = epSq;
    this.halfmove = half;
    this.fullmove = full;
    if (this.attacked(kings[other(turn)], turn)) invalid(fen, "side not to move is in check");
    this.history = [];
    this.stack = [];
    this.keys = [this.key()];
    this.startTurn = turn;
    this.startFull = full;
  }

  private placement(): string {
    let s = "";
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) {
          s += empty;
          empty = 0;
        }
        s += p.color === "w" ? p.type.toUpperCase() : p.type;
      }
      if (empty) s += empty;
      if (r) s += "/";
    }
    return s;
  }

  fen(): string {
    const ep = this.ep < 0 ? "-" : sqName(this.ep);
    return `${this.placement()} ${this.turn} ${this.castling} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  /** Repetition key: en passant only counts when a capture is actually legal. */
  private key(): string {
    return `${this.placement()} ${this.turn} ${this.castling} ${this.epLegal() ? this.ep : "-"}`;
  }

  private epLegal(): boolean {
    if (this.ep < 0) return false;
    const behind = this.ep - (this.turn === "w" ? 8 : -8);
    for (const df of [-1, 1]) {
      const f = (this.ep & 7) + df;
      if (f < 0 || f > 7) continue;
      const from = behind + df;
      const p = this.board[from];
      if (p && p.color === this.turn && p.type === "p" && this.legal({ from, to: this.ep, flags: F_CAP | F_EP })) {
        return true;
      }
    }
    return false;
  }

  private attacked(sq: number, by: Color): boolean {
    const b = this.board;
    for (const s of KNIGHT[sq]) {
      const p = b[s];
      if (p && p.color === by && p.type === "n") return true;
    }
    for (const s of KING[sq]) {
      const p = b[s];
      if (p && p.color === by && p.type === "k") return true;
    }
    const f = sq & 7;
    const pawn = (s: number) => {
      const p = b[s];
      return !!p && p.color === by && p.type === "p";
    };
    if (by === "w") {
      if (sq >= 8 && ((f > 0 && pawn(sq - 9)) || (f < 7 && pawn(sq - 7)))) return true;
    } else if (sq < 56 && ((f > 0 && pawn(sq + 7)) || (f < 7 && pawn(sq + 9)))) return true;
    const rays = RAYS[sq];
    for (let d = 0; d < 8; d++) {
      const slider = d < 4 ? "r" : "b";
      for (const s of rays[d]) {
        const p = b[s];
        if (!p) continue;
        if (p.color === by && (p.type === "q" || p.type === slider)) return true;
        break;
      }
    }
    return false;
  }

  /** Pseudo-legal moves for the side to move (optionally from one square). */
  private pseudo(onlyFrom = -1): Raw[] {
    const out: Raw[] = [];
    const b = this.board;
    const us = this.turn;
    const lo = onlyFrom < 0 ? 0 : onlyFrom;
    const hi = onlyFrom < 0 ? 63 : onlyFrom;
    for (let from = lo; from <= hi; from++) {
      const p = b[from];
      if (!p || p.color !== us) continue;
      if (p.type === "p") this.pawnMoves(from, out);
      else if (p.type === "n" || p.type === "k") {
        for (const to of p.type === "n" ? KNIGHT[from] : KING[from]) {
          const t = b[to];
          if (!t) out.push({ from, to, flags: 0 });
          else if (t.color !== us) out.push({ from, to, flags: F_CAP });
        }
        if (p.type === "k") this.castleMoves(from, out);
      } else {
        const d0 = p.type === "b" ? 4 : 0;
        const d1 = p.type === "r" ? 4 : 8;
        for (let d = d0; d < d1; d++) {
          for (const to of RAYS[from][d]) {
            const t = b[to];
            if (!t) out.push({ from, to, flags: 0 });
            else {
              if (t.color !== us) out.push({ from, to, flags: F_CAP });
              break;
            }
          }
        }
      }
    }
    return out;
  }

  private pawnMoves(from: number, out: Raw[]): void {
    const b = this.board;
    const us = this.turn;
    const fwd = us === "w" ? 8 : -8;
    const last = us === "w" ? 7 : 0;
    const add = (to: number, flags: number) => {
      if (to >> 3 === last) for (const promo of PROMOS) out.push({ from, to, flags: flags | F_PROMO, promo });
      else out.push({ from, to, flags });
    };
    const one = from + fwd;
    if (!b[one]) {
      add(one, 0);
      if (from >> 3 === (us === "w" ? 1 : 6) && !b[one + fwd]) out.push({ from, to: one + fwd, flags: F_BIG });
    }
    const f = from & 7;
    for (const df of [-1, 1]) {
      if (f + df < 0 || f + df > 7) continue;
      const to = one + df;
      const t = b[to];
      if (t) {
        if (t.color !== us) add(to, F_CAP);
      } else if (to === this.ep) {
        const victim = b[to - fwd];
        if (victim && victim.color !== us && victim.type === "p") out.push({ from, to, flags: F_CAP | F_EP });
      }
    }
  }

  private castleMoves(from: number, out: Raw[]): void {
    const us = this.turn;
    const home = us === "w" ? 4 : 60;
    if (from !== home || this.castling === "-") return;
    const b = this.board;
    const them = other(us);
    const rook = (sq: number) => {
      const p = b[sq];
      return !!p && p.color === us && p.type === "r";
    };
    const [kc, qc] = us === "w" ? ["K", "Q"] : ["k", "q"];
    if (
      this.castling.includes(kc) &&
      rook(home + 3) &&
      !b[home + 1] &&
      !b[home + 2] &&
      !this.attacked(home, them) &&
      !this.attacked(home + 1, them) &&
      !this.attacked(home + 2, them)
    ) {
      out.push({ from, to: home + 2, flags: F_K });
    }
    if (
      this.castling.includes(qc) &&
      rook(home - 4) &&
      !b[home - 1] &&
      !b[home - 2] &&
      !b[home - 3] &&
      !this.attacked(home, them) &&
      !this.attacked(home - 1, them) &&
      !this.attacked(home - 2, them)
    ) {
      out.push({ from, to: home - 2, flags: F_Q });
    }
  }

  private make(m: Raw): void {
    const b = this.board;
    const us = this.turn;
    const piece = b[m.from]!;
    const fwd = us === "w" ? 8 : -8;
    const capSq = m.flags & F_EP ? m.to - fwd : m.to;
    const captured = b[capSq];
    this.stack.push({ raw: m, piece, captured, castling: this.castling, ep: this.ep, halfmove: this.halfmove });
    b[capSq] = null;
    b[m.to] = m.promo ? PIECES[us][m.promo] : piece;
    b[m.from] = null;
    if (m.flags & F_K) {
      b[m.to - 1] = b[m.to + 1];
      b[m.to + 1] = null;
    } else if (m.flags & F_Q) {
      b[m.to + 1] = b[m.to - 2];
      b[m.to - 2] = null;
    }
    if (piece.type === "k") this.kings[us] = m.to;
    if (this.castling !== "-") this.castling = stripRights(this.castling, m.from, m.to);
    this.ep = m.flags & F_BIG ? m.from + fwd : -1;
    this.halfmove = piece.type === "p" || captured ? 0 : this.halfmove + 1;
    if (us === "b") this.fullmove++;
    this.turn = other(us);
  }

  private unmake(): void {
    const s = this.stack.pop()!;
    const m = s.raw;
    const us = s.piece.color;
    const b = this.board;
    this.turn = us;
    if (us === "b") this.fullmove--;
    this.castling = s.castling;
    this.ep = s.ep;
    this.halfmove = s.halfmove;
    b[m.from] = s.piece;
    b[m.to] = null;
    if (s.captured) b[m.flags & F_EP ? m.to - (us === "w" ? 8 : -8) : m.to] = s.captured;
    if (m.flags & F_K) {
      b[m.to + 1] = b[m.to - 1];
      b[m.to - 1] = null;
    } else if (m.flags & F_Q) {
      b[m.to - 2] = b[m.to + 1];
      b[m.to + 1] = null;
    }
    if (s.piece.type === "k") this.kings[us] = m.from;
  }

  private legal(m: Raw): boolean {
    const us = this.turn;
    this.make(m);
    const ok = !this.attacked(this.kings[us], this.turn);
    this.unmake();
    return ok;
  }

  private legalRaw(): Raw[] {
    return this.pseudo().filter((m) => this.legal(m));
  }

  private hasLegal(): boolean {
    for (const m of this.pseudo()) if (this.legal(m)) return true;
    return false;
  }

  /** SAN of a legal move; `others` must include every legal move that could make it ambiguous. */
  private san(m: Raw, others: Raw[]): string {
    const b = this.board;
    const p = b[m.from]!;
    let s: string;
    if (m.flags & F_K) s = "O-O";
    else if (m.flags & F_Q) s = "O-O-O";
    else if (p.type === "p") {
      s = m.flags & F_CAP ? FILES[m.from & 7] + "x" + sqName(m.to) : sqName(m.to);
      if (m.promo) s += "=" + m.promo.toUpperCase();
    } else {
      let ambiguous = false;
      let sameFile = false;
      let sameRank = false;
      for (const o of others) {
        if (o.to !== m.to || o.from === m.from || b[o.from]!.type !== p.type) continue;
        ambiguous = true;
        if ((o.from & 7) === (m.from & 7)) sameFile = true;
        if (o.from >> 3 === m.from >> 3) sameRank = true;
      }
      let dis = "";
      if (ambiguous) dis = !sameFile ? FILES[m.from & 7] : !sameRank ? String((m.from >> 3) + 1) : sqName(m.from);
      s = p.type.toUpperCase() + dis + (m.flags & F_CAP ? "x" : "") + sqName(m.to);
    }
    this.make(m);
    if (this.attacked(this.kings[this.turn], other(this.turn))) s += this.hasLegal() ? "+" : "#";
    this.unmake();
    return s;
  }

  private toMove(m: Raw, others: Raw[]): Move {
    const p = this.board[m.from]!;
    const mv: Move = {
      from: m.from,
      to: m.to,
      piece: p.type,
      color: p.color,
      flags: flagStr(m.flags),
      san: this.san(m, others),
      uci: sqName(m.from) + sqName(m.to) + (m.promo ?? ""),
    };
    if (m.flags & F_CAP) mv.captured = m.flags & F_EP ? "p" : this.board[m.to]!.type;
    if (m.promo) mv.promotion = m.promo;
    return mv;
  }

  /** Legal moves of the same piece type to the same square (for SAN disambiguation). */
  private rivals(m: Raw): Raw[] {
    const b = this.board;
    const type = b[m.from]!.type;
    if (type === "p" || type === "k") return [];
    return this.pseudo().filter((o) => o.to === m.to && o.from !== m.from && b[o.from]!.type === type && this.legal(o));
  }

  /** All legal moves for the side to move. */
  moves(): Move[] {
    const legal = this.legalRaw();
    return legal.map((m) => this.toMove(m, legal));
  }

  movesFrom(sq: number): Move[] {
    const p = this.board[sq];
    if (!p || p.color !== this.turn) return [];
    const legal = this.legalRaw();
    return legal.filter((m) => m.from === sq).map((m) => this.toMove(m, legal));
  }

  private find(from: number, to: number, promo?: string): Raw | null {
    if (!Number.isInteger(from) || from < 0 || from > 63 || !Number.isInteger(to)) return null;
    for (const m of this.pseudo(from)) {
      if (m.to !== to) continue;
      if (m.promo && m.promo !== promo) continue;
      if (this.legal(m)) return m;
    }
    return null;
  }

  private parse(input: string): Raw | null {
    const u = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(input);
    if (u) return this.find(sqIndex(u[1]), sqIndex(u[2]), u[3]);
    const s = input.replace(/[+#!?]+$/, "").replace(/0/g, "O");
    if (s === "O-O" || s === "O-O-O") {
      const flag = s === "O-O" ? F_K : F_Q;
      return this.legalRaw().find((m) => m.flags & flag) ?? null;
    }
    const r = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBNqrbn]))?$/.exec(s);
    if (!r) return null;
    const type = (r[1] ?? "P").toLowerCase();
    const to = sqIndex(r[4]);
    const promo = r[5]?.toLowerCase();
    const file = r[2] ? r[2].charCodeAt(0) - 97 : type === "p" ? to & 7 : -1;
    const rank = r[3] ? Number(r[3]) - 1 : -1;
    const found = this.legalRaw().filter(
      (m) =>
        m.to === to &&
        this.board[m.from]!.type === type &&
        (file < 0 || (m.from & 7) === file) &&
        (rank < 0 || m.from >> 3 === rank) &&
        m.promo === promo,
    );
    return found.length === 1 ? found[0] : null;
  }

  /** Play a legal move given {from,to,promotion?}, a UCI string or a SAN string. Returns null if illegal (state unchanged); a promotion without a piece is illegal. */
  move(input: { from: number; to: number; promotion?: Promotion } | string): Move | null {
    let raw: Raw | null = null;
    if (typeof input === "string") raw = this.parse(input.trim());
    else if (input && typeof input === "object") raw = this.find(input.from, input.to, input.promotion);
    if (!raw) return null;
    const mv = this.toMove(raw, this.rivals(raw));
    this.make(raw);
    this.history.push(mv);
    this.keys.push(this.key());
    return mv;
  }

  undo(): Move | null {
    const mv = this.history.pop();
    if (!mv) return null;
    this.unmake();
    this.keys.pop();
    return mv;
  }

  inCheck(): boolean {
    return this.attacked(this.kings[this.turn], other(this.turn));
  }

  isCheckmate(): boolean {
    return this.inCheck() && !this.hasLegal();
  }

  isStalemate(): boolean {
    return !this.inCheck() && !this.hasLegal();
  }

  /** FIDE dead positions: K v K, K+B v K, K+N v K, and kings + bishops all on one square color. */
  isInsufficientMaterial(): boolean {
    let knights = 0;
    let bishops = 0;
    const shades = new Set<number>();
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (!p || p.type === "k") continue;
      if (p.type === "p" || p.type === "r" || p.type === "q") return false;
      if (p.type === "n") knights++;
      else {
        bishops++;
        shades.add(((sq >> 3) + (sq & 7)) & 1);
      }
    }
    if (knights === 0) return shades.size <= 1;
    return knights === 1 && bishops === 0;
  }

  /** Occurrences of the current position (placement, side to move, castling, legal en passant). */
  repetitionCount(): number {
    const k = this.keys[this.keys.length - 1];
    let n = 0;
    for (const x of this.keys) if (x === k) n++;
    return n;
  }

  canClaimThreefold(): boolean {
    return this.repetitionCount() >= 3;
  }

  canClaimFifty(): boolean {
    return this.halfmove >= 100;
  }

  /** Automatic game end per FIDE; null if the game goes on. */
  outcome(): Outcome | null {
    if (!this.hasLegal()) {
      return this.inCheck() ? { winner: other(this.turn), reason: "checkmate" } : { winner: null, reason: "stalemate" };
    }
    if (this.isInsufficientMaterial()) return { winner: null, reason: "insufficient" };
    if (this.repetitionCount() >= 5) return { winner: null, reason: "fivefold" };
    if (this.halfmove >= 150) return { winner: null, reason: "seventyfive" };
    return null;
  }

  /** Can this color possibly deliver mate? false only for a bare king, king + one knight, or king + same-shade bishops. */
  canMate(color: Color): boolean {
    let knights = 0;
    let bishops = 0;
    const shades = new Set<number>();
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (!p || p.color !== color || p.type === "k") continue;
      if (p.type === "p" || p.type === "r" || p.type === "q") return true;
      if (p.type === "n") knights++;
      else {
        bishops++;
        shades.add(((sq >> 3) + (sq & 7)) & 1);
      }
    }
    if (knights === 0) return shades.size > 1;
    return !(knights === 1 && bishops === 0);
  }

  clone(): Chess {
    const c = new Chess(this.fen());
    c.history = this.history.slice();
    c.stack = this.stack.slice();
    c.keys = this.keys.slice();
    c.startTurn = this.startTurn;
    c.startFull = this.startFull;
    return c;
  }

  /** PGN movetext like "1. e4 e5 2. Nf3 Nc6". */
  pgnMoves(): string {
    const out: string[] = [];
    let n = this.startFull;
    let color = this.startTurn;
    this.history.forEach((m, i) => {
      if (color === "w") out.push(`${n}. ${m.san}`);
      else {
        out.push(i === 0 ? `${n}... ${m.san}` : m.san);
        n++;
      }
      color = other(color);
    });
    return out.join(" ");
  }
}
