import { DurableObject } from "cloudflare:workers";
import { applyOutcome, type Progress } from "../shared/games/mages/progress";
import type { SimConfig } from "../shared/games/mages/sim";
import type { Env } from "./env";
import { recordScoreOnce } from "./gamesDb";
import { decideChunk, newRun, type Finish, type MageChunkResult, type RunData } from "./mageChunk";
import { clearStorage } from "./storage";

export type { MageChunkResult } from "./mageChunk";

// ---------- progress (D1 mage_progress) ----------

const freshProgress = (): Progress => ({ cleared: {}, endlessBest: 0 });

/** The player's campaign progress; a player with no row has fresh progress. */
export async function getProgress(db: D1Database, userId: string): Promise<Progress> {
  const data = await db.prepare(`SELECT data FROM mage_progress WHERE user_id = ?`).bind(userId).first<string>("data");
  return data ? (JSON.parse(data) as Progress) : freshProgress();
}

export async function saveProgress(db: D1Database, userId: string, p: Progress): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mage_progress (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(p), Date.now())
    .run();
}

// ---------- verified runs ----------

export interface MageChunk {
  /** The tick the chunk runs to (exclusive): the client's sim.tick when it sent the chunk. */
  upTo: number;
  /** The chunk's actions, each with `t` in [previous upTo, upTo), sorted by `t`. */
  actions: unknown;
  /** hashSim of the client's sim at `upTo`. */
  h: number;
  /** Ends the run now: quitting Endless records its score (once a wave was cleared), quitting a stage records nothing. */
  final?: boolean;
}

const ABANDON_AFTER_MS = 60 * 60 * 1000; // runs with no input for an hour are discarded

/**
 * Server-side verification for one Mage Siege run. The server picks the seed and
 * the config; the client streams its actions in chunks while playing, and this
 * object advances its own copy of the shared deterministic sim with them
 * (decideChunk in mageChunk.ts). Only results computed here are ever recorded.
 *
 * Client contract (POST /api/mages/runs/:id/input, body = MageChunk):
 * - post a chunk at every `waveEnd`, or after every secs(120) of sim time,
 *   whichever comes first (a chunk may never cover more than secs(150));
 *   `upTo` is the client's sim.tick right after the step that ended the wave;
 * - post a final chunk when the run ends: `upTo` = the tick right after the step
 *   that won or lost the game, or `final: true` to quit (Endless records its
 *   score once a wave was cleared; a quit stage records nothing);
 * - send `h` = hashSim of the client's sim at `upTo`. A hash mismatch, a malformed
 *   chunk, too many actions or a game ahead of 2x real time kill the run for good.
 * - Retries are safe: resending the last accepted chunk is acknowledged again, an
 *   older chunk is refused without harm, and a resent final chunk gets the same
 *   final result (kept for an hour).
 */
export class MageRun extends DurableObject<Env> {
  private data: RunData | null = null;

  private load(): RunData | null {
    if (this.data) return this.data;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const row = this.ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = 'run'`).toArray()[0];
    this.data = row ? (JSON.parse(row.v as string) as RunData) : null;
    return this.data;
  }

  /** Writes the run to storage, and only then caches it. */
  private store(data: RunData) {
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('run', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(data),
    );
    this.data = data;
  }

  async init(runId: string, userId: string, cfg: Omit<SimConfig, "seed">): Promise<{ seed: number }> {
    if (this.load()) throw new Error("run already exists");
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.store(newRun(runId, userId, { ...cfg, seed }, Date.now()));
    await this.ctx.storage.setAlarm(Date.now() + ABANDON_AFTER_MS);
    return { seed };
  }

  async input(userId: string, batch: Record<string, unknown>): Promise<MageChunkResult> {
    const d = decideChunk(this.load(), userId, batch, Date.now());
    switch (d.kind) {
      case "reply":
        return d.res;
      case "kill":
        this.store({ ...this.data!, invalid: true });
        return d.res;
      case "accept":
        this.store(d.data);
        await this.ctx.storage.setAlarm(Date.now() + ABANDON_AFTER_MS);
        return { ok: true };
      case "finish":
        // Done is stored before any D1 write, so a crash mid-recording can only lead to a
        // retried recording, which is idempotent per run.
        this.store(d.data);
        await this.ctx.storage.setAlarm(Date.now() + ABANDON_AFTER_MS);
        return this.record(d.data);
      case "record":
        return this.record(d.data);
    }
  }

  /** Writes a done run's result to D1 (safe to repeat) and keeps the response for retries. */
  private async record(data: RunData): Promise<MageChunkResult> {
    const f = data.finish as Finish;
    const db = this.env.DB;
    let progress = await getProgress(db, data.userId);
    let ranked: { best: number; rank: number } | undefined;
    if (f.record === "endless") {
      const o = f.outcome;
      ranked = await recordScoreOnce(db, data.userId, "mages", "endless", o.score, f.durationMs, {
        runId: data.runId,
        waves: o.wavesCleared,
        lives: o.lives,
        team: f.team,
      });
    }
    if (f.record !== "none") {
      // applyOutcome keeps the best stars / score, so applying it twice changes nothing.
      progress = applyOutcome(progress, f.mode, f.stage, f.outcome);
      await saveProgress(db, data.userId, progress);
    }
    const result: MageChunkResult = { ok: true, finished: true, outcome: f.outcome, progress, ...ranked };
    this.store({ ...data, result });
    return result;
  }

  async alarm() {
    await clearStorage(this.ctx.storage); // abandoned run, or a finished one's kept result
    this.data = null;
  }
}
