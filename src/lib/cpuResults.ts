import type { CpuGame, CpuOutcome } from "../../shared/games/cpu";

/** Report a finished game against the computer for the "vs Computer" leaderboard. Best effort: failures are ignored. */
export function reportCpuResult(game: CpuGame, gameId: string, level: string, result: CpuOutcome, durationMs: number): void {
  fetch("/api/cpu-results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game, gameId, level, result, durationMs }),
  }).catch(() => {});
}
