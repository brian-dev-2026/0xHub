import { ACCENTS, AVATARS } from "../shared/protocol";
import type {
  BattleEntry,
  EndlessEntry,
  HighScore,
  HistoryEntry,
  PlayerInfo,
  PublicUser,
  UserStats,
} from "../shared/protocol";

export { ACCENTS, AVATARS };

export const START_RATING = 1000;
const ELO_K = 32;


export interface UserRow {
  id: string;
  username: string | null;
  password_hash: string | null;
  is_guest: number;
  display_name: string;
  avatar: string;
  color: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  created_at: number;
  last_seen_at: number;
}

export function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    isGuest: !!u.is_guest,
    displayName: u.display_name,
    avatar: u.avatar,
    color: u.color,
    rating: u.rating,
    createdAt: u.created_at,
  };
}

export function toPlayerInfo(u: UserRow, skin: string): PlayerInfo {
  return { id: u.id, name: u.display_name, avatar: u.avatar, color: u.color, skin, rating: u.rating };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomGuestName(): string {
  const a = ["Swift", "Neon", "Pixel", "Shadow", "Turbo", "Cosmic", "Lucky", "Iron", "Frost", "Blaze"];
  const b = ["Fox", "Block", "Spinner", "Stacker", "Comet", "Ninja", "Wolf", "Drop", "Titan", "Owl"];
  return `${pick(a)}${pick(b)}${Math.floor(Math.random() * 90 + 10)}`;
}

export async function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).bind(username).first<UserRow>();
}

export async function createUser(
  db: D1Database,
  opts: { username?: string; passwordHash?: string; displayName?: string },
): Promise<UserRow> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const isGuest = opts.username ? 0 : 1;
  const displayName = opts.displayName ?? opts.username ?? randomGuestName();
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_guest, display_name, avatar, color, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, opts.username ?? null, opts.passwordHash ?? null, isGuest, displayName, pick(AVATARS), pick(ACCENTS), now, now)
    .run();
  return (await getUser(db, id))!;
}

/** Turn a guest into a full account, keeping all their stats. */
export async function upgradeGuest(db: D1Database, id: string, username: string, passwordHash: string): Promise<void> {
  await db
    .prepare(`UPDATE users SET username = ?, password_hash = ?, is_guest = 0 WHERE id = ? AND is_guest = 1`)
    .bind(username, passwordHash, id)
    .run();
}

export async function updateProfile(
  db: D1Database,
  id: string,
  patch: { displayName?: string; avatar?: string; color?: string },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.displayName !== undefined) (sets.push("display_name = ?"), vals.push(patch.displayName));
  if (patch.avatar !== undefined) (sets.push("avatar = ?"), vals.push(patch.avatar));
  if (patch.color !== undefined) (sets.push("color = ?"), vals.push(patch.color));
  if (!sets.length) return;
  await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
}

export async function touchUser(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(Date.now(), id).run();
}

export async function getSettings(db: D1Database, id: string): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`SELECT data FROM settings WHERE user_id = ?`).bind(id).first<{ data: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function saveSettings(db: D1Database, id: string, data: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .bind(id, data, Date.now())
    .run();
}

export async function getStats(db: D1Database, u: UserRow): Promise<UserStats> {
  const [endless, battle] = await db.batch<Record<string, number | null>>([
    db
      .prepare(
        `SELECT COUNT(*) AS games, MAX(score) AS best, SUM(lines) AS lines, SUM(duration_ms) AS time
         FROM endless_runs WHERE user_id = ?`,
      )
      .bind(u.id),
    db
      .prepare(
        `SELECT COUNT(*) AS games,
                SUM(CASE WHEN player_a = ?1 THEN a_lines ELSE b_lines END) AS lines,
                SUM(duration_ms) AS time
         FROM battles WHERE player_a = ?1 OR player_b = ?1`,
      )
      .bind(u.id),
  ]);
  const e = endless.results[0] ?? {};
  const b = battle.results[0] ?? {};
  return {
    endlessGames: e.games ?? 0,
    bestScore: e.best ?? 0,
    battles: b.games ?? 0,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    kos: u.kos,
    totalLines: (e.lines ?? 0) + (b.lines ?? 0),
    playTimeMs: (e.time ?? 0) + (b.time ?? 0),
  };
}

export async function getHistory(db: D1Database, userId: string, limit = 20): Promise<HistoryEntry[]> {
  const [runs, battles] = await db.batch<Record<string, unknown>>([
    db
      .prepare(`SELECT score, lines, level, duration_ms, created_at FROM endless_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(userId, limit),
    db
      .prepare(
        `SELECT b.*, ua.display_name AS a_name, ub.display_name AS b_name
         FROM battles b
         JOIN users ua ON ua.id = b.player_a
         JOIN users ub ON ub.id = b.player_b
         WHERE b.player_a = ?1 OR b.player_b = ?1
         ORDER BY b.created_at DESC LIMIT ?2`,
      )
      .bind(userId, limit),
  ]);
  const out: HistoryEntry[] = [];
  for (const r of runs.results) {
    out.push({
      mode: "endless",
      ts: r.created_at as number,
      durationMs: r.duration_ms as number,
      lines: r.lines as number,
      score: r.score as number,
      level: r.level as number,
    });
  }
  for (const r of battles.results) {
    const me = r.player_a === userId ? "a" : "b";
    const them = me === "a" ? "b" : "a";
    out.push({
      mode: "battle",
      ts: r.created_at as number,
      durationMs: r.duration_ms as number,
      lines: r[`${me}_lines`] as number,
      result: r.winner === "draw" ? "draw" : r.winner === me ? "win" : "lose",
      opponent: r[`${them}_name`] as string,
      kos: r[`${me}_kos`] as number,
      linesSent: r[`${me}_sent`] as number,
      ratingDelta: r[`${me}_delta`] as number,
    });
  }
  return out.sort((x, y) => y.ts - x.ts).slice(0, limit);
}

export async function getHighScores(db: D1Database, userId: string): Promise<HighScore[]> {
  const { results } = await db
    .prepare(`SELECT score, lines, level, created_at AS ts FROM endless_runs WHERE user_id = ? ORDER BY score DESC LIMIT 10`)
    .bind(userId)
    .all<HighScore>();
  return results;
}

export async function recordEndless(
  db: D1Database,
  userId: string,
  run: { score: number; lines: number; level: number; durationMs: number },
): Promise<{ best: number; rank: number }> {
  await db
    .prepare(`INSERT INTO endless_runs (user_id, score, lines, level, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(userId, run.score, run.lines, run.level, run.durationMs, Date.now())
    .run();
  const best = (await db.prepare(`SELECT MAX(score) AS best FROM endless_runs WHERE user_id = ?`).bind(userId).first<number>("best")) ?? 0;
  const rank =
    ((await db
      .prepare(`SELECT COUNT(*) AS n FROM (SELECT MAX(score) AS s FROM endless_runs GROUP BY user_id) WHERE s > ?`)
      .bind(best)
      .first<number>("n")) ?? 0) + 1;
  return { best, rank };
}

export async function topEndless(db: D1Database, limit: number): Promise<EndlessEntry[]> {
  // SQLite returns the other columns from the row that holds MAX(score).
  const { results } = await db
    .prepare(
      `SELECT r.user_id, u.display_name, u.avatar, u.color, MAX(r.score) AS score, r.lines, r.level, r.created_at
       FROM endless_runs r JOIN users u ON u.id = r.user_id
       GROUP BY r.user_id ORDER BY score DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    playerId: r.user_id as string,
    name: r.display_name as string,
    avatar: r.avatar as string,
    color: r.color as string,
    score: r.score as number,
    lines: r.lines as number,
    level: r.level as number,
    ts: r.created_at as number,
  }));
}

export async function topBattle(db: D1Database, limit: number): Promise<BattleEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT id, display_name, avatar, color, wins, losses, draws, kos, rating FROM users
       WHERE (wins + losses + draws) > 0 ORDER BY rating DESC, wins DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    playerId: r.id as string,
    name: r.display_name as string,
    avatar: r.avatar as string,
    color: r.color as string,
    wins: r.wins as number,
    losses: r.losses as number,
    draws: r.draws as number,
    kos: r.kos as number,
    rating: r.rating as number,
  }));
}

// ---------- rate limiting ----------

/**
 * Count one hit against `key` in a fixed window. Returns how many seconds to
 * wait if the limit is exceeded, or 0 if the request is allowed.
 */
export async function rateLimit(db: D1Database, key: string, limit: number, windowMs: number): Promise<number> {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
       RETURNING count, reset_at`,
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number; reset_at: number }>();
  if (!row || row.count <= limit) return 0;
  return Math.max(1, Math.ceil((row.reset_at - now) / 1000));
}

// ---------- account management ----------

export async function setPassword(db: D1Database, id: string, passwordHash: string): Promise<void> {
  await db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(passwordHash, id).run();
}

/** Revoke every session for a user except (optionally) one token hash. */
export async function revokeSessions(db: D1Database, id: string, keepTokenHash?: string): Promise<void> {
  if (keepTokenHash)
    await db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`).bind(id, keepTokenHash).run();
  else await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id).run();
}

/**
 * Delete an account. Personal data, settings, sessions and endless runs are
 * removed. Battle rows are kept (they're also the opponent's history) but the
 * user is anonymised so nothing identifies them.
 */
export async function deleteAccount(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
    db.prepare(`DELETE FROM settings WHERE user_id = ?`).bind(id),
    db.prepare(`DELETE FROM endless_runs WHERE user_id = ?`).bind(id),
    db.prepare(`DELETE FROM game_scores WHERE user_id = ?`).bind(id),
    db.prepare(`DELETE FROM game_ratings WHERE user_id = ?`).bind(id),
    db
      .prepare(
        `UPDATE users SET username = NULL, password_hash = NULL, is_guest = 1, display_name = 'Deleted player',
         avatar = 'none', color = '#6b7280', rating = 1000, wins = 0, losses = 0, draws = 0, kos = 0 WHERE id = ?`,
      )
      .bind(id),
  ]);
}

/** Nightly housekeeping (Cron Trigger). */
export async function cleanup(db: D1Database): Promise<void> {
  const now = Date.now();
  const staleGuest = now - 30 * 24 * 60 * 60 * 1000;
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM rate_limits WHERE reset_at < ?`).bind(now),
    // Guests inactive for 30 days who never finished a game.
    db
      .prepare(
        `DELETE FROM users WHERE is_guest = 1 AND last_seen_at < ?
         AND NOT EXISTS (SELECT 1 FROM endless_runs r WHERE r.user_id = users.id)
         AND NOT EXISTS (SELECT 1 FROM battles b WHERE b.player_a = users.id OR b.player_b = users.id)
         AND NOT EXISTS (SELECT 1 FROM game_match_players p WHERE p.user_id = users.id)
         AND NOT EXISTS (SELECT 1 FROM game_scores g WHERE g.user_id = users.id)`,
      )
      .bind(staleGuest),
  ]);
}

export interface BattleSide {
  userId: string;
  kos: number;
  sent: number;
  lines: number;
}

/** Store a finished battle and apply Elo + win/loss counters atomically. */
export async function recordBattle(
  db: D1Database,
  room: string,
  a: BattleSide,
  b: BattleSide,
  winner: "a" | "b" | "draw",
  reason: "time" | "forfeit",
  durationMs: number,
): Promise<{ a: number; b: number }> {
  if (a.userId === b.userId) return { a: 0, b: 0 };
  const ratings = await db
    .prepare(`SELECT id, rating FROM users WHERE id IN (?, ?)`)
    .bind(a.userId, b.userId)
    .all<{ id: string; rating: number }>();
  const ra = ratings.results.find((r) => r.id === a.userId)?.rating ?? START_RATING;
  const rb = ratings.results.find((r) => r.id === b.userId)?.rating ?? START_RATING;
  const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
  const scoreA = winner === "a" ? 1 : winner === "draw" ? 0.5 : 0;
  const da = Math.round(ELO_K * (scoreA - expectedA));
  const db_ = -da;

  const upd = (id: string, delta: number, res: "w" | "l" | "d", kos: number) =>
    db
      .prepare(
        `UPDATE users SET rating = MAX(0, rating + ?), wins = wins + ?, losses = losses + ?, draws = draws + ?, kos = kos + ? WHERE id = ?`,
      )
      .bind(delta, res === "w" ? 1 : 0, res === "l" ? 1 : 0, res === "d" ? 1 : 0, kos, id);

  await db.batch([
    db
      .prepare(
        `INSERT INTO battles (room, player_a, player_b, winner, reason, a_kos, b_kos, a_sent, b_sent, a_lines, b_lines, a_delta, b_delta, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(room, a.userId, b.userId, winner, reason, a.kos, b.kos, a.sent, b.sent, a.lines, b.lines, da, db_, durationMs, Date.now()),
    upd(a.userId, da, winner === "a" ? "w" : winner === "draw" ? "d" : "l", a.kos),
    upd(b.userId, db_, winner === "b" ? "w" : winner === "draw" ? "d" : "l", b.kos),
  ]);
  return { a: da, b: db_ };
}
