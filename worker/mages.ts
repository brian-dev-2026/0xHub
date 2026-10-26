import { DurableObject } from "cloudflare:workers";
import { applyOutcome, type Progress } from "../shared/games/mages/progress";
import { simFromJson } from "../shared/games/mages/chunk";
import type { GameMap } from "../shared/games/mages/map";
import type { SimConfig } from "../shared/games/mages/sim";
import type { Env } from "./env";
import { recordScoreOnce } from "./gamesDb";
import { MageRunCore, type Finish, type MageChunkResult, type RunData, type RunStore } from "./mageChunk";
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
  /** The chunk's actions, each with `t` in [previous upTo, upTo), sorted by `t` (at most MAX_CHUNK_ACTIONS). */
  actions: unknown;
  /** hashSim of the client's sim at `upTo`. */
  h: number;
  /** Ends the run: quitting Endless records its score (once a wave was cleared), quitting a stage records nothing. */
  final?: boolean;
}

/**
 * Verification work done in this isolate so far (all runs): its JIT warms up as
 * it works, so slice budgets start small in a fresh isolate (sliceBudget).
 */
const warmth = { work: 0 };

/**
 * Server-side verification for one Mage Siege run. The server picks the seed and
 * the config; the client streams its actions in chunks while playing, and this
 * object advances its own copy of the shared deterministic sim with them. Only
 * results computed here are ever recorded.
 *
 * Workers' free plan allows about 10 ms of CPU per invocation and 100,000 rows
 * written per day, so verification is deferred and sliced (MageRunCore in
 * mageChunk.ts): an upload is queued after cheap checks only; every upload, poll
 * and alarm then runs one slice of at most SLICE_WORK work units; a slice that
 * stays inside a chunk writes nothing, and the sim is checkpointed only at
 * verified chunk ends. Each upload arms an alarm 15 s ahead: if the page goes
 * away, the alarm takes over (a slice a second) and the run is still verified
 * and recorded.
 *
 * Client contract (POST /api/mages/runs/:id/input):
 * - body = MageChunk. Upload one about every 10 s of real time, at every
 *   `waveEnd`, and never more than secs(150) of sim time after the previous one;
 *   finish with `final: true` (`upTo` = the tick right after the step that won or
 *   lost, or the current tick to quit).
 * - body = `{ poll: true }`: runs a slice and answers the status. Poll about every
 *   2 s while playing and after the final chunk until the answer is final.
 * - Answers: `{ ok: true, pending, verifiedTo, queuedTo }` while the run goes on
 *   or its verification is behind (`pending: true`); once the final chunk is
 *   verified and recorded, `{ ok: true, finished: true, outcome, progress, best?,
 *   rank? }` to every upload and poll (kept for an hour); `{ ok: false, error }`
 *   once the run failed verification. A hash mismatch, a malformed chunk, too many
 *   actions or a game ahead of 2x real time kill the run for good.
 * - Retries are safe: resending the last uploaded chunk is acknowledged again (it
 *   just drives a slice); an older chunk is refused without harm.
 */
export class MageRun extends DurableObject<Env> {
  private core = new MageRunCore(this.runStore(), warmth, () => Date.now());

  async init(runId: string, userId: string, cfg: Omit<SimConfig, "seed">): Promise<{ seed: number }> {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    await this.core.init(runId, userId, { ...cfg, seed });
    return { seed };
  }

  input(userId: string, batch: Record<string, unknown>): Promise<MageChunkResult> {
    return this.core.input(userId, batch);
  }

  alarm(): Promise<void> {
    return this.core.alarm();
  }

  /** The run's storage: rows run, sim and map in a WITHOUT ROWID table (no index rows to write). */
  private runStore(): RunStore {
    const storage = this.ctx.storage;
    const sql = storage.sql;
    const table = () => sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`);
    const get = (k: string) => sql.exec(`SELECT v FROM kv WHERE k = ?`, k).toArray()[0]?.v as string | undefined;
    const put = (k: string, v: string) => sql.exec(`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v);
    const env = this.env;
    return {
      loadRun() {
        table();
        const v = get("run");
        return v ? (JSON.parse(v) as RunData) : null;
      },
      saveRun: (data) => put("run", JSON.stringify(data)),
      createRun(data, sim, map) {
        table();
        storage.transactionSync(() => {
          put("map", map);
          put("sim", sim);
          put("run", JSON.stringify(data));
        });
      },
      loadSim: () => simFromJson(get("sim") as string, JSON.parse(get("map") as string) as GameMap),
      saveCheckpoint(sim, data) {
        storage.transactionSync(() => {
          put("sim", sim);
          put("run", JSON.stringify(data));
        });
      },
      saveOver(data) {
        storage.transactionSync(() => {
          sql.exec(`DELETE FROM kv WHERE k IN ('sim', 'map')`);
          put("run", JSON.stringify(data));
        });
      },
      setAlarm: (at) => storage.setAlarm(at),
      sync: () => storage.sync(),
      clear: () => clearStorage(storage),
      record: (data) => recordRun(env.DB, data),
    };
  }
}

/** Writes a done run's result to D1 (safe to repeat: recordScoreOnce, max-merging applyOutcome) and returns the final response. */
async function recordRun(db: D1Database, data: RunData): Promise<MageChunkResult> {
  const f = data.finish as Finish;
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
  return { ok: true, finished: true, outcome: f.outcome, progress, ...ranked };
}
