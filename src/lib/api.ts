import type { BattleEntry, EndlessEntry } from "../../shared/protocol";

export async function fetchLeaderboard(mode: "endless"): Promise<EndlessEntry[]>;
export async function fetchLeaderboard(mode: "battle"): Promise<BattleEntry[]>;
export async function fetchLeaderboard(mode: "endless" | "battle") {
  const res = await fetch(`/api/leaderboard?mode=${mode}`);
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`);
  return res.json();
}

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}
