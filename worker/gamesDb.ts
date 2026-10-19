// D1 helpers for Snake Arena, 2048, Minesweeper Rush, Connect Four, Chess and Game of the Generals.

import type { GameId, GameSummaries, HistoryEntry, RatingEntry, ScoreEntry } from "../shared/protocol";
import { DIFFICULTIES, type Difficulty } from "../shared/games/mines";

const ELO_K = 32;
const START = 1000;

/** Minesweeper scores are times — lower is better. Everything else: higher is better. */
const lowerIsBetter = (game: string) => game === "mines";

export async function recordScore(
  db: D1Database,
  userId: string,
  game: GameId,
  mode: string,
  score: number,
  durationMs: number,
  data?: unknown,
): Promise<{ best: number; rank: number }> {
  await db
    .prepare(`INSERT INTO game_scores (user_id, game, mode, score, duration_ms, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(userId, game, mode, Math.round(score), Math.round(durationMs), data === undefined ? null : JSON.stringify(data), Date.now())
    .run();
  const low = lowerIsBetter(game);
  const agg = low ? "MIN" : "MAX";
  const best =
    (await db
      .prepare(`SELECT ${agg}(score) AS b FROM game_scores WHERE user_id = ? AND game = ? AND mode = ?`)
      .bind(userId, game, mode)
      .first<number>("b")) ?? score;
  const rank =
    ((await db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT ${agg}(score) AS s FROM game_scores WHERE game = ? AND mode = ? GROUP BY user_id)
         WHERE s ${low ? "<" : ">"} ?`,
      )
      .bind(game, mode, best)
      .first<number>("n")) ?? 0) + 1;
  return { best, rank };
}

export async function topScores(db: D1Database, game: GameId, mode: string, limit = 50): Promise<ScoreEntry[]> {
  const low = lowerIsBetter(game);
  const { results } = await db
    .prepare(
      `SELECT s.user_id, u.display_name, u.avatar, u.color, ${low ? "MIN" : "MAX"}(s.score) AS score, s.duration_ms, s.created_at
       FROM game_scores s JOIN users u ON u.id = s.user_id
       WHERE s.game = ? AND s.mode = ?
       GROUP BY s.user_id ORDER BY score ${low ? "ASC" : "DESC"} LIMIT ?`,
    )
    .bind(game, mode, limit)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    playerId: r.user_id as string,
    name: r.display_name as string,
    avatar: r.avatar as string,
    color: r.color as string,
    score: r.score as number,
    durationMs: r.duration_ms as number,
    ts: r.created_at as number,
  }));
}

export async function topRatings(db: D1Database, game: GameId, by: "rating" | "wins", limit = 50): Promise<RatingEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, u.display_name, u.avatar, u.color FROM game_ratings r JOIN users u ON u.id = r.user_id
       WHERE r.game = ? AND r.played > 0
       ORDER BY ${by === "wins" ? "r.wins DESC, r.played ASC" : "r.rating DESC, r.wins DESC"} LIMIT ?`,
    )
    .bind(game, limit)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    playerId: r.user_id as string,
    name: r.display_name as string,
    avatar: r.avatar as string,
    color: r.color as string,
    rating: r.rating as number,
    played: r.played as number,
    wins: r.wins as number,
    losses: r.losses as number,
    draws: r.draws as number,
  }));
}

async function insertMatch(db: D1Database, game: GameId, room: string, reason: string, durationMs: number): Promise<number> {
  const row = await db
    .prepare(`INSERT INTO game_matches (game, room, reason, duration_ms, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id`)
    .bind(game, room, reason, Math.round(durationMs), Date.now())
    .first<{ id: number }>();
  return row!.id;
}

function ratingUpsert(db: D1Database, userId: string, game: GameId, delta: number, w: number, l: number, d: number) {
  return db
    .prepare(
      `INSERT INTO game_ratings (user_id, game, rating, played, wins, losses, draws) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)
       ON CONFLICT(user_id, game) DO UPDATE SET rating = MAX(0, rating + ?7), played = played + 1,
         wins = wins + ?4, losses = losses + ?5, draws = draws + ?6`,
    )
    .bind(userId, game, START + delta, w, l, d, delta);
}

export interface DuelSide {
  userId: string;
  score: number;
  data?: unknown;
}

/** Record a finished 1v1 (2048 duel, Connect Four) with Elo. Returns rating deltas. */
export async function recordDuel(
  db: D1Database,
  game: GameId,
  room: string,
  a: DuelSide,
  b: DuelSide,
  outcome: "a" | "b" | "draw",
  reason: string,
  durationMs: number,
): Promise<{ a: number; b: number }> {
  if (a.userId === b.userId) return { a: 0, b: 0 };
  const rows = await db
    .prepare(`SELECT user_id, rating FROM game_ratings WHERE game = ? AND user_id IN (?, ?)`)
    .bind(game, a.userId, b.userId)
    .all<{ user_id: string; rating: number }>();
  const ra = rows.results.find((r) => r.user_id === a.userId)?.rating ?? START;
  const rb = rows.results.find((r) => r.user_id === b.userId)?.rating ?? START;
  const exp = 1 / (1 + 10 ** ((rb - ra) / 400));
  const sa = outcome === "a" ? 1 : outcome === "draw" ? 0.5 : 0;
  const da = Math.round(ELO_K * (sa - exp));
  const dbd = -da;
  const matchId = await insertMatch(db, game, room, reason, durationMs);
  const placeA = outcome === "b" ? 2 : 1;
  const placeB = outcome === "a" ? 2 : 1;
  await db.batch([
    db
      .prepare(`INSERT INTO game_match_players (match_id, user_id, place, score, rating_delta, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(matchId, a.userId, placeA, a.score, da, a.data ? JSON.stringify(a.data) : null),
    db
      .prepare(`INSERT INTO game_match_players (match_id, user_id, place, score, rating_delta, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(matchId, b.userId, placeB, b.score, dbd, b.data ? JSON.stringify(b.data) : null),
    ratingUpsert(db, a.userId, game, da, outcome === "a" ? 1 : 0, outcome === "b" ? 1 : 0, outcome === "draw" ? 1 : 0),
    ratingUpsert(db, b.userId, game, dbd, outcome === "b" ? 1 : 0, outcome === "a" ? 1 : 0, outcome === "draw" ? 1 : 0),
  ]);
  return { a: da, b: dbd };
}

/** Record a Snake Arena round for the human players (bots aren't stored). */
export async function recordSnakeRound(
  db: D1Database,
  room: string,
  humans: { userId: string; place: number; score: number; kills: number; deaths: number; best: number }[],
  totalPlayers: number,
  durationMs: number,
): Promise<void> {
  if (!humans.length) return;
  const matchId = await insertMatch(db, "snake", room, "time", durationMs);
  const stmts: D1PreparedStatement[] = [];
  for (const h of humans) {
    const data = JSON.stringify({ kills: h.kills, deaths: h.deaths, best: h.best, of: totalPlayers });
    stmts.push(
      db
        .prepare(`INSERT INTO game_match_players (match_id, user_id, place, score, rating_delta, data) VALUES (?, ?, ?, ?, 0, ?)`)
        .bind(matchId, h.userId, h.place, h.score, data),
      ratingUpsert(db, h.userId, "snake", 0, h.place === 1 ? 1 : 0, h.place === 1 ? 0 : 1, 0),
      db
        .prepare(`INSERT INTO game_scores (user_id, game, mode, score, duration_ms, data, created_at) VALUES (?, 'snake', 'arena', ?, ?, ?, ?)`)
        .bind(h.userId, h.score, Math.round(durationMs), data, Date.now()),
    );
  }
  await db.batch(stmts);
}

export async function gameSummaries(db: D1Database, userId: string): Promise<GameSummaries> {
  const [ratings, bests, minesWon] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT * FROM game_ratings WHERE user_id = ?`).bind(userId),
    db
      .prepare(
        `SELECT game, mode, CASE WHEN game = 'mines' THEN MIN(score) ELSE MAX(score) END AS best
         FROM game_scores WHERE user_id = ? GROUP BY game, mode`,
      )
      .bind(userId),
    db.prepare(`SELECT COUNT(*) AS n FROM game_scores WHERE user_id = ? AND game = 'mines'`).bind(userId),
  ]);
  const r = (g: string) => ratings.results.find((x) => x.game === g) ?? {};
  const best = (g: string, m: string) => (bests.results.find((x) => x.game === g && x.mode === m)?.best as number | undefined) ?? null;
  const snake = r("snake") as Record<string, number>;
  const duel = r("2048") as Record<string, number>;
  const duelStats = (g: string) => {
    const x = r(g) as Record<string, number>;
    return { played: x.played ?? 0, wins: x.wins ?? 0, losses: x.losses ?? 0, draws: x.draws ?? 0, rating: x.rating ?? START };
  };
  return {
    snake: { played: snake.played ?? 0, wins: snake.wins ?? 0, bestScore: best("snake", "arena") ?? 0 },
    "2048": {
      bestScore: best("2048", "solo") ?? 0,
      duelPlayed: duel.played ?? 0,
      duelWins: duel.wins ?? 0,
      duelLosses: duel.losses ?? 0,
      rating: duel.rating ?? START,
    },
    mines: {
      beginner: best("mines", "beginner"),
      intermediate: best("mines", "intermediate"),
      expert: best("mines", "expert"),
      won: (minesWon.results[0]?.n as number) ?? 0,
    },
    connect4: duelStats("connect4"),
    chess: duelStats("chess"),
    generals: duelStats("generals"),
  };
}

const GAME_TITLE: Record<GameId, string> = {
  snake: "Snake Arena",
  "2048": "2048",
  mines: "Minesweeper Rush",
  connect4: "Connect Four",
  chess: "Chess",
  generals: "Game of the Generals",
};
/** How a chess / Generals game ended, for history lines. */
const REASON_TEXT: Record<string, string> = {
  checkmate: "checkmate",
  resign: "resignation",
  timeout: "time",
  forfeit: "opponent left",
  stalemate: "stalemate",
  insufficient: "insufficient material",
  threefold: "threefold repetition",
  fivefold: "fivefold repetition",
  fifty: "50-move rule",
  seventyfive: "75-move rule",
  agreement: "agreement",
  "timeout-vs-insufficient": "time vs insufficient material",
  "flag-captured": "flag captured",
  "flag-reached": "flag reached the end",
  "no-moves": "no moves left",
};
const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(ms < 100_000 ? 2 : 1)}s`;
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export async function gameHistory(db: D1Database, userId: string, limit = 20): Promise<HistoryEntry[]> {
  const [matches, solos] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT m.game, m.reason, m.created_at, m.duration_ms, p.place, p.score, p.rating_delta, p.data,
           (SELECT GROUP_CONCAT(u.display_name, ', ') FROM game_match_players o JOIN users u ON u.id = o.user_id
            WHERE o.match_id = m.id AND o.user_id != p.user_id) AS opponents,
           (SELECT COUNT(*) FROM game_match_players o WHERE o.match_id = m.id AND o.place = p.place) AS tied
         FROM game_match_players p JOIN game_matches m ON m.id = p.match_id
         WHERE p.user_id = ? ORDER BY m.created_at DESC LIMIT ?`,
      )
      .bind(userId, limit),
    db
      .prepare(
        `SELECT game, mode, score, duration_ms, created_at FROM game_scores
         WHERE user_id = ? AND game IN ('2048', 'mines') ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(userId, limit),
  ]);
  const out: HistoryEntry[] = [];
  for (const m of matches.results) {
    const game = m.game as GameId;
    const place = m.place as number;
    const data = m.data ? JSON.parse(m.data as string) : {};
    const opp = (m.opponents as string | null) ?? "";
    const result: "win" | "lose" | "draw" = place === 1 ? ((m.tied as number) > 1 ? "draw" : "win") : "lose";
    let label: string;
    let detail: string;
    if (game === "snake") {
      label = `${GAME_TITLE.snake} · ${ordinal(place)} of ${data.of ?? "?"}`;
      detail = `${m.score} pts · ${data.kills ?? 0} kills`;
    } else {
      label = `${GAME_TITLE[game]} · ${result === "win" ? "Won" : result === "lose" ? "Lost" : "Drew"}${opp ? ` vs ${opp}` : ""}`;
      const delta = `${(m.rating_delta as number) >= 0 ? "+" : ""}${m.rating_delta} rating`;
      const why = REASON_TEXT[m.reason as string];
      detail = game === "2048" ? `${m.score} pts` : game === "chess" || game === "generals" ? `${why ? `by ${why} · ` : ""}${delta}` : delta;
    }
    out.push({ game, mode: "match", ts: m.created_at as number, durationMs: m.duration_ms as number, lines: 0, result, label, detail, ratingDelta: m.rating_delta as number });
  }
  for (const s of solos.results) {
    const game = s.game as GameId;
    const mines = game === "mines";
    out.push({
      game,
      mode: s.mode as string,
      ts: s.created_at as number,
      durationMs: s.duration_ms as number,
      lines: 0,
      score: s.score as number,
      label: mines ? `${GAME_TITLE.mines} · ${DIFFICULTIES[s.mode as Difficulty]?.label ?? s.mode}` : "2048 · Solo",
      detail: mines ? `Cleared in ${fmtSecs(s.score as number)}` : `${s.score} pts`,
    });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
}
