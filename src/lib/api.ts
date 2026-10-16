import type { BattleEntry, EndlessEntry } from "../../shared/protocol";

export async function fetchLeaderboard(mode: "endless"): Promise<EndlessEntry[]>;
export async function fetchLeaderboard(mode: "battle"): Promise<BattleEntry[]>;
export async function fetchLeaderboard(mode: "endless" | "battle") {
  const res = await fetch(`/api/leaderboard?mode=${mode}`);
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`);
  return res.json();
}

export async function submitEndless(entry: {
  playerId: string;
  name: string;
  avatar: string;
  score: number;
  lines: number;
  level: number;
}): Promise<{ ok: boolean; rank?: number; best?: number; error?: string }> {
  try {
    const res = await fetch("/api/leaderboard/endless", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "offline" };
  }
}

export async function fetchPlayerSummary(id: string): Promise<{
  bestScore: number | null;
  battle: { wins: number; losses: number; draws: number; kos: number; rating: number } | null;
}> {
  const res = await fetch(`/api/player?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("failed");
  return res.json();
}

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}
