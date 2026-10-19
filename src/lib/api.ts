import type { BattleEntry, EndlessEntry } from "../../shared/protocol";

export async function fetchLeaderboard(mode: "endless"): Promise<EndlessEntry[]>;
export async function fetchLeaderboard(mode: "battle"): Promise<BattleEntry[]>;
export async function fetchLeaderboard(mode: "endless" | "battle") {
  const res = await fetch(`/api/leaderboard?mode=${mode}`);
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`);
  return res.json();
}

let connCounter = 0;

/**
 * WebSocket URL with an increasing connection sequence number (`c`). The
 * server lets a newer connection take over a seat (a second tab), but closes
 * a stale one that arrives late — e.g. an abandoned attempt racing a retry.
 */
export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const seq = Date.now() * 1000 + (connCounter++ % 1000);
  return `${proto}//${location.host}${path}${path.includes("?") ? "&" : "?"}c=${seq}`;
}

/** Close code the server uses for a connection superseded by a newer one. */
export const CLOSE_STALE = 4002;
