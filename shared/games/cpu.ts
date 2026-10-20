// Games against the computer (Chess, Game of the Generals, 8-Ball Pool) run in
// the browser. Their results are self-reported, so these rules decide what the
// server accepts and how many leaderboard points a win is worth.

export type CpuGame = "chess" | "generals" | "pool";
export type CpuOutcome = "win" | "loss" | "draw";

/** Computer levels per game; a win against a level scores its points. */
export const CPU_LEVELS: Record<CpuGame, { id: string; label: string; points: number }[]> = {
  chess: [
    { id: "1", label: "Beginner", points: 1 },
    { id: "2", label: "Casual", points: 2 },
    { id: "3", label: "Club", points: 3 },
    { id: "4", label: "Strong", points: 4 },
  ],
  generals: [{ id: "standard", label: "Computer", points: 2 }],
  pool: [
    { id: "easy", label: "Easy", points: 1 },
    { id: "normal", label: "Normal", points: 2 },
    { id: "hard", label: "Hard", points: 3 },
  ],
};

/** Wins faster than this can't be real games. */
export const CPU_MIN_WIN_MS: Record<CpuGame, number> = { chess: 15_000, generals: 30_000, pool: 20_000 };

export interface CpuResult {
  game: CpuGame;
  gameId: string;
  level: string;
  result: CpuOutcome;
  durationMs: number;
  points: number;
}

const isCpuGame = (g: unknown): g is CpuGame => g === "chess" || g === "generals" || g === "pool";

/** Validate a reported result. Returns the result with its points, or an error message. */
export function parseCpuResult(b: Record<string, unknown>): CpuResult | string {
  const { game, gameId, level, result, durationMs } = b;
  if (!isCpuGame(game)) return "Unknown game.";
  if (typeof gameId !== "string" || !/^[0-9a-f-]{36}$/.test(gameId)) return "Bad game id.";
  const lv = CPU_LEVELS[game].find((l) => l.id === level);
  if (!lv) return "Unknown level.";
  if (result !== "win" && result !== "loss" && result !== "draw") return "Bad result.";
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 6 * 3600_000) return "Bad duration.";
  if (result === "win" && durationMs < CPU_MIN_WIN_MS[game]) return "That game was too short to count.";
  return { game, gameId, level: lv.id, result, durationMs: Math.round(durationMs), points: result === "win" ? lv.points : 0 };
}

/** Label of the hardest level a player has beaten, from the best points they scored in one win. */
export function cpuLevelLabel(game: CpuGame, points: number): string {
  return CPU_LEVELS[game].find((l) => l.points === points)?.label ?? "—";
}
