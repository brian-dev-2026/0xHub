import { DurableObject } from "cloudflare:workers";
import { MAX_ACTIONS, advance, outcomeOf, restoreSim, serializeSim, validateActions, type SimSnapshot } from "../shared/games/mages/chunk";
import { TICK_HZ } from "../shared/games/mages/data";
import { applyOutcome, type Progress } from "../shared/games/mages/progress";
import { hashSim, type Outcome } from "../shared/games/mages/replay";
import { createSim, type SimConfig } from "../shared/games/mages/sim";
import type { Env } from "./env";
import { recordScore } from "./gamesDb";
import { clearStorage } from "./storage";

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

interface RunData {
  userId: string;
  createdAt: number;
  /** The sim after the last accepted chunk (its cfg holds the seed, mode, stage and team); dropped once the run is done. */
  sim: SimSnapshot | null;
  /** Actions accepted so far, across all chunks. */
  actions: number;
  invalid: boolean;
  done: boolean;
}

export interface MageChunk {
  /** The tick the chunk runs to (exclusive): the client's sim.tick when it sent the chunk. */
  upTo: number;
  /** The chunk's actions, each with `t` in [previous upTo, upTo), sorted by `t`. */
  actions: unknown;
  /** hashSim of the client's sim at `upTo`. */
  h: number;
  /** Ends the run now: quitting Endless records its score, quitting a stage records nothing. */
  final?: boolean;
}

export interface MageChunkResult {
  ok: boolean;
  error?: string;
  finished?: boolean;
  outcome?: Outcome;
  progress?: Progress;
  /** Endless only: the player's best Endless score and its leaderboard rank. */
  best?: number;
  rank?: number;
}

const ABANDON_AFTER_MS = 60 * 60 * 1000; // runs with no input for an hour are discarded
const CLOCK_TOLERANCE_MS = 3000;
/** The client may play at up to 2x speed. */
const MAX_GAME_SPEED = 2;

/**
 * Server-side verification for one Mage Siege run. The server picks the seed and
 * the config; the client streams its actions in chunks while playing, and this
 * object advances its own copy of the shared deterministic sim with them. Only
 * results computed here are ever recorded.
 *
 * Client contract (POST /api/mages/runs/:id/input, body = MageChunk):
 * - post a chunk at every `waveEnd`, or after every secs(120) of sim time,
 *   whichever comes first (a chunk may never cover more than secs(150));
 *   `upTo` is the client's sim.tick right after the step that ended the wave;
 * - post a final chunk when the run ends: `upTo` = the tick right after the step
 *   that won or lost the game, or `final: true` to quit (Endless records its
 *   score; a quit stage records nothing);
 * - send `h` = hashSim of the client's sim at `upTo`. Any mismatch or illegal
 *   chunk kills the run for good. A retried final chunk gets "Run already
 *   finished" (for an hour) because the result was already recorded.
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

  private save() {
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('run', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(this.data),
    );
  }

  async init(userId: string, cfg: Omit<SimConfig, "seed">): Promise<{ seed: number }> {
    if (this.load()) throw new Error("run already exists");
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const sim = createSim({ ...cfg, seed });
    this.data = { userId, createdAt: Date.now(), sim: serializeSim(sim), actions: 0, invalid: false, done: false };
    this.save();
    await this.ctx.storage.setAlarm(Date.now() + ABANDON_AFTER_MS);
    return { seed };
  }

  async input(userId: string, batch: Record<string, unknown>): Promise<MageChunkResult> {
    const data = this.load();
    if (!data) return { ok: false, error: "Unknown run" };
    if (data.userId !== userId) return { ok: false, error: "Not your run" };
    if (data.done) return { ok: false, error: "Run already finished" };
    if (data.invalid || !data.sim) return { ok: false, error: "Run failed verification" };

    const sim = restoreSim(data.sim);
    const upTo = batch.upTo;
    if (typeof upTo !== "number" || !Number.isInteger(upTo) || upTo < sim.tick) return this.reject("Bad batch");
    // The game can't have run faster than 2x the wall clock since the run started.
    if ((upTo / TICK_HZ) * 1000 > MAX_GAME_SPEED * (Date.now() - data.createdAt) + CLOCK_TOLERANCE_MS) return this.reject("Run is ahead of real time");
    const actions = validateActions(batch.actions, sim.tick, upTo, MAX_ACTIONS - data.actions);
    if (typeof actions === "string") return this.reject(actions === "too many actions" ? "Too many actions" : `Malformed input: ${actions}`);
    const res = advance(sim, actions, upTo);
    if (!res.ok) return this.reject(`Run failed verification: ${res.error}`);
    if (batch.h !== hashSim(sim)) return this.reject("Run failed verification");

    data.actions += actions.length;
    data.sim = serializeSim(sim);
    await this.ctx.storage.setAlarm(Date.now() + ABANDON_AFTER_MS);
    const ended = sim.phase === "won" || sim.phase === "lost";
    if (!ended && batch.final !== true) {
      this.save();
      return { ok: true };
    }

    // The game is over (or the player quit): record the server-computed result once.
    data.done = true;
    const { mode, stage } = sim.cfg;
    const outcome = outcomeOf(sim);
    let progress = await getProgress(this.env.DB, data.userId);
    let ranked: { best: number; rank: number } | undefined;
    if (mode === "endless") {
      const durationMs = Math.round((outcome.ticks / TICK_HZ) * 1000);
      ranked = await recordScore(this.env.DB, data.userId, "mages", "endless", outcome.score, durationMs, {
        waves: outcome.wavesCleared,
        lives: outcome.lives,
        team: sim.cfg.team,
      });
      progress = applyOutcome(progress, mode, stage, outcome);
      await saveProgress(this.env.DB, data.userId, progress);
    } else if (outcome.won) {
      progress = applyOutcome(progress, mode, stage, outcome);
      await saveProgress(this.env.DB, data.userId, progress);
    }
    // Keep only a "done" marker (the abandon alarm erases it) so a retried final chunk
    // is told the run already finished instead of being treated as unknown.
    data.sim = null;
    this.save();
    return { ok: true, finished: true, outcome, progress, ...ranked };
  }

  /** Marks the run invalid for good. */
  private reject(error: string): MageChunkResult {
    if (this.data) {
      this.data.invalid = true;
      this.save();
    }
    return { ok: false, error };
  }

  async alarm() {
    await clearStorage(this.ctx.storage); // abandoned run
    this.data = null;
  }
}
