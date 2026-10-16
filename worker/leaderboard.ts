import { DurableObject } from "cloudflare:workers";
import type { BattleEntry, EndlessEntry, PlayerInfo } from "../shared/protocol";
import type { Env } from "./env";

const START_RATING = 1000;
const ELO_K = 32;

/**
 * Global leaderboard backed by the Durable Object's built-in SQLite database.
 * A single instance ("global") serialises all writes, so no locking is needed.
 */
export class Leaderboard extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS endless (
        player_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT NOT NULL,
        score INTEGER NOT NULL,
        lines INTEGER NOT NULL,
        level INTEGER NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS endless_score ON endless(score DESC);
      CREATE TABLE IF NOT EXISTS battle (
        player_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0,
        kos INTEGER NOT NULL DEFAULT 0,
        rating INTEGER NOT NULL DEFAULT ${START_RATING}
      );
      CREATE INDEX IF NOT EXISTS battle_rating ON battle(rating DESC);
    `);
  }

  topEndless(limit: number): EndlessEntry[] {
    return this.sql
      .exec(
        `SELECT player_id, name, avatar, score, lines, level, ts FROM endless ORDER BY score DESC LIMIT ?`,
        limit,
      )
      .toArray()
      .map((r) => ({
        playerId: r.player_id as string,
        name: r.name as string,
        avatar: r.avatar as string,
        score: r.score as number,
        lines: r.lines as number,
        level: r.level as number,
        ts: r.ts as number,
      }));
  }

  topBattle(limit: number): BattleEntry[] {
    return this.sql
      .exec(
        `SELECT player_id, name, avatar, wins, losses, draws, kos, rating FROM battle
         ORDER BY rating DESC, wins DESC LIMIT ?`,
        limit,
      )
      .toArray()
      .map((r) => ({
        playerId: r.player_id as string,
        name: r.name as string,
        avatar: r.avatar as string,
        wins: r.wins as number,
        losses: r.losses as number,
        draws: r.draws as number,
        kos: r.kos as number,
        rating: r.rating as number,
      }));
  }

  submitEndless(body: Record<string, unknown>): { ok: boolean; error?: string; rank?: number; best?: number } {
    const playerId = typeof body.playerId === "string" ? body.playerId.slice(0, 64) : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 20) : "";
    const avatar = typeof body.avatar === "string" ? body.avatar.slice(0, 8) : "🎮";
    const score = Math.floor(Number(body.score));
    const lines = Math.floor(Number(body.lines));
    const level = Math.floor(Number(body.level));
    if (!playerId || !name) return { ok: false, error: "Missing player" };
    if (![score, lines, level].every((n) => Number.isFinite(n) && n >= 0)) return { ok: false, error: "Bad numbers" };
    // Plausibility check: even an all-T-spin-triple, max-combo game can't
    // average more than a few thousand points per line per level.
    if (score > (lines + 1) * (level + 1) * 4000) return { ok: false, error: "Score rejected" };

    const existing = this.sql.exec(`SELECT score FROM endless WHERE player_id = ?`, playerId).toArray()[0];
    const prevBest = (existing?.score as number | undefined) ?? -1;
    if (score > prevBest) {
      this.sql.exec(
        `INSERT INTO endless (player_id, name, avatar, score, lines, level, ts) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar,
           score=excluded.score, lines=excluded.lines, level=excluded.level, ts=excluded.ts`,
        playerId, name, avatar, score, lines, level, Date.now(),
      );
    } else {
      this.sql.exec(`UPDATE endless SET name = ?, avatar = ? WHERE player_id = ?`, name, avatar, playerId);
    }
    const best = Math.max(score, prevBest);
    const rank = (this.sql.exec(`SELECT COUNT(*) AS n FROM endless WHERE score > ?`, best).one().n as number) + 1;
    return { ok: true, rank, best };
  }

  playerSummary(playerId: string) {
    const endless = this.sql.exec(`SELECT score FROM endless WHERE player_id = ?`, playerId).toArray()[0];
    const battle = this.sql
      .exec(`SELECT wins, losses, draws, kos, rating FROM battle WHERE player_id = ?`, playerId)
      .toArray()[0];
    return {
      bestScore: (endless?.score as number | undefined) ?? null,
      battle: battle ?? null,
    };
  }

  recordBattle(
    a: { player: PlayerInfo; kos: number },
    b: { player: PlayerInfo; kos: number },
    outcome: "a" | "b" | "draw",
  ): { a: number; b: number } {
    if (a.player.id === b.player.id) return { a: 0, b: 0 };
    const ratingOf = (id: string) =>
      (this.sql.exec(`SELECT rating FROM battle WHERE player_id = ?`, id).toArray()[0]?.rating as number) ??
      START_RATING;
    const ra = ratingOf(a.player.id);
    const rb = ratingOf(b.player.id);
    const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
    const scoreA = outcome === "a" ? 1 : outcome === "draw" ? 0.5 : 0;
    const deltaA = Math.round(ELO_K * (scoreA - expectedA));
    const deltaB = -deltaA;

    const upsert = (p: PlayerInfo, kos: number, delta: number, res: "win" | "loss" | "draw") => {
      this.sql.exec(
        `INSERT INTO battle (player_id, name, avatar, wins, losses, draws, kos, rating)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar,
           wins = wins + excluded.wins, losses = losses + excluded.losses, draws = draws + excluded.draws,
           kos = kos + excluded.kos, rating = rating + ?`,
        p.id, p.name, p.avatar,
        res === "win" ? 1 : 0, res === "loss" ? 1 : 0, res === "draw" ? 1 : 0,
        kos, START_RATING + delta, delta,
      );
    };
    upsert(a.player, a.kos, deltaA, outcome === "a" ? "win" : outcome === "draw" ? "draw" : "loss");
    upsert(b.player, b.kos, deltaB, outcome === "b" ? "win" : outcome === "draw" ? "draw" : "loss");
    return { a: deltaA, b: deltaB };
  }
}
