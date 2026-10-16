// Wire protocol shared by the browser client and the Cloudflare Worker.
// Every message is a JSON object with a `t` discriminator.

export const MATCH_DURATION_MS = 120_000; // Tetris Battle 2P: 2 minute rounds
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

export type ClientMsg =
  | { t: "hello"; player: PlayerInfo }
  | { t: "state"; s: BoardSnapshot }
  | { t: "attack"; lines: number; label?: string }
  | { t: "ko" }
  | { t: "rematch" }
  | { t: "ping"; at: number };

export interface MatchResultStats {
  kos: number;
  linesSent: number;
}

export type ServerMsg =
  | { t: "waiting"; code: string }
  | { t: "matched"; room: string }
  | { t: "opponent"; player: PlayerInfo }
  | { t: "countdown"; in: number; duration: number }
  | { t: "opState"; s: BoardSnapshot }
  | { t: "garbage"; lines: number; label?: string }
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
  | { t: "error"; message: string }
  | { t: "pong"; at: number };

export interface EndlessEntry {
  playerId: string;
  name: string;
  avatar: string;
  score: number;
  lines: number;
  level: number;
  ts: number;
}

export interface BattleEntry {
  playerId: string;
  name: string;
  avatar: string;
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
