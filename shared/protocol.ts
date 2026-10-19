// Wire protocol shared by the browser client and the Cloudflare Worker.
// Every message is a JSON object with a `t` discriminator.

export const MATCH_DURATION_MS = 120_000; // Battle 2P: 2 minute rounds
export const COUNTDOWN_MS = 3_000;
export const ROOM_CODE_LENGTH = 5;

export interface PlayerInfo {
  id: string;
  name: string;
  avatar: string; // emoji
  color: string; // accent hex
  skin: string; // block skin id, so the opponent board renders in their style
  rating?: number;
}

/** Snapshot of a player's visible field, sent to the opponent for spectating. */
export interface BoardSnapshot {
  /** 20 visible rows x 10 cols, row-major, one char per cell: '.', IOTSZJL, or 'G' (garbage). */
  cells: string;
  active: { type: string; x: number; y: number; rot: number } | null;
  hold: string | null;
  next: string[];
  incoming: number;
  linesSent: number;
  lines: number;
  combo: number;
}

/** Input batch: events since the last batch, as flat [step, code, arg] triplets (see shared/tetris/sim.ts). */
export interface InputBatch {
  /** Bumped by the server on every resync; batches from an older epoch are ignored. */
  epoch: number;
  /** The client's sim has simulated exactly this many steps when the batch was cut. */
  upTo: number;
  ev: number[];
  /** engine.hash() at upTo, so the server can detect divergence. */
  h: number;
}

export type ClientMsg =
  | { t: "hello"; skin: string }
  | ({ t: "input" } & InputBatch)
  | { t: "rematch" }
  | { t: "leave" }
  | { t: "ping"; at: number };

export interface MatchResultStats {
  kos: number;
  linesSent: number;
}

export interface PendingGarbage {
  id: number;
  lines: number;
}

export type MatchPhase = "waiting" | "countdown" | "playing" | "ended";

export type ServerMsg =
  | { t: "waiting" }
  | { t: "matched"; room: string }
  | { t: "opponent"; player: PlayerInfo }
  | { t: "opponentStatus"; connected: boolean }
  | { t: "countdown"; in: number; duration: number; seed: number; epoch: number }
  | {
      /** Sent on (re)connect to a room that already has a match going. */
      t: "resume";
      phase: MatchPhase;
      msUntilStart: number;
      msRemaining: number;
      kos: { you: number; opponent: number };
      sim: unknown | null; // SimState — authoritative copy of your game
      epoch: number;
      pending: PendingGarbage[];
    }
  | {
      /** The server's copy of your game disagreed with yours; adopt this one. */
      t: "resync";
      sim: unknown; // SimState
      epoch: number;
      pending: PendingGarbage[];
    }
  | { t: "opState"; s: BoardSnapshot }
  | { t: "garbage"; id: number; lines: number; label?: string }
  | { t: "ko"; victim: "you" | "opponent"; you: number; opponent: number }
  | {
      t: "end";
      result: "win" | "lose" | "draw";
      reason: "time" | "forfeit";
      you: MatchResultStats;
      opponent: MatchResultStats;
      ratingDelta?: number;
    }
  | { t: "rematchRequested" }
  | { t: "opponentLeft" }
  | { t: "replaced" }
  | { t: "error"; message: string; fatal?: boolean }
  | { t: "pong"; at: number };

/** Grace period to reconnect before a disconnected player forfeits. */
export const RECONNECT_GRACE_MS = 15_000;
/** Garbage must be applied by the receiver within this many steps of being sent. */
export const GARBAGE_ACK_STEPS = 120;
/** A player's game is pushed forward by the server if it falls this far behind real time. */
export const MAX_LAG_STEPS = 180;
/** How far ahead of real time a client may claim to be. */
export const MAX_LEAD_STEPS = 90;

export interface EndlessEntry {
  playerId: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  lines: number;
  level: number;
  ts: number;
}

export interface BattleEntry {
  playerId: string;
  name: string;
  avatar: string;
  color: string;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  rating: number;
}

export function isValidRoomCode(code: string): boolean {
  return new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`).test(code);
}

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomRoomCode(): string {
  let s = "";
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(buf);
  for (const n of buf) s += ROOM_ALPHABET[n % ROOM_ALPHABET.length];
  return s;
}

// ---------- REST API types ----------

export interface PublicUser {
  id: string;
  username: string | null;
  isGuest: boolean;
  /** Whether the account has a recovery code for resetting a forgotten password. */
  hasRecoveryCode: boolean;
  displayName: string;
  avatar: string;
  color: string;
  rating: number;
  createdAt: number;
}

export interface UserStats {
  endlessGames: number;
  bestScore: number;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  totalLines: number;
  playTimeMs: number;
}

export interface HistoryEntry {
  /** Which game; absent means Tetris (older entries). */
  game?: "tetris" | GameId;
  mode: string;
  /** Pre-formatted text for non-Tetris games. */
  label?: string;
  detail?: string;
  ts: number;
  durationMs: number;
  lines: number;
  score?: number;
  level?: number;
  result?: "win" | "lose" | "draw";
  opponent?: string;
  kos?: number;
  linesSent?: number;
  ratingDelta?: number;
}

export interface HighScore {
  score: number;
  lines: number;
  level: number;
  ts: number;
}

export interface MeResponse {
  user: PublicUser;
  stats: UserStats;
  history: HistoryEntry[];
  highScores: HighScore[];
  settings: Record<string, unknown> | null;
  games: GameSummaries;
}

// ---------- other games ----------

export type GameId = "snake" | "2048" | "mines" | "connect4";
export const GAME_IDS: GameId[] = ["snake", "2048", "mines", "connect4"];

export interface ScoreEntry {
  playerId: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  durationMs: number;
  ts: number;
}

export interface RatingEntry {
  playerId: string;
  name: string;
  avatar: string;
  color: string;
  rating: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface GameSummaries {
  snake: { played: number; wins: number; bestScore: number };
  "2048": { bestScore: number; duelPlayed: number; duelWins: number; duelLosses: number; rating: number };
  mines: { beginner: number | null; intermediate: number | null; expert: number | null; won: number };
  connect4: { played: number; wins: number; losses: number; draws: number; rating: number };
}

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;

export { AVATARS, NO_AVATAR } from "./avatars";
export const ACCENTS = ["#8b5cf6", "#22d3ee", "#f472b6", "#a3e635", "#fb923c", "#f43f5e", "#facc15", "#60a5fa"];
