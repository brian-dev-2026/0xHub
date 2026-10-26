import { DurableObject } from "cloudflare:workers";
import { applyOutcome, type Progress } from "../shared/games/mages/progress";
import { simFromJson, simToJson } from "../shared/games/mages/chunk";
import type { GameMap } from "../shared/games/mages/map";
import type { Sim, SimConfig } from "../shared/games/mages/sim";
import type { Env } from "./env";
import { recordScoreOnce } from "./gamesDb";
import {
  alarmJob,
  beginSlice,
  decideUpload,
  newRun,
  nextAlarm,
  runSlice,
  sliceBudget,
  statusOf,
  type Finish,
  type MageChunkResult,
  type QueuedChunk,
  type RunData,
} from "./mageChunk";
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
let isolateWork = 0;

/**
 * Server-side verification for one Mage Siege run. The server picks the seed and
 * the config; the client streams its actions in chunks while playing, and this
 * object advances its own copy of the shared deterministic sim with them. Only
 * results computed here are ever recorded.
 *
 * Workers' free plan allows about 10 ms of CPU per invocation, so verification is
 * deferred and sliced (decisions in mageChunk.ts): an upload is stored in a queue
 * after cheap checks only, and every upload, poll and alarm then runs one slice of
 * at most SLICE_WORK work units. While chunks wait, an alarm runs a slice every
 * second, so a run finishes verifying (and is recorded) even if the page closes.
 *
 * Client contract (POST /api/mages/runs/:id/input):
 * - body = MageChunk. Post one about every 2 s of real time while a wave runs, at
 *   every `waveEnd`, and never more than secs(150) of sim time after the previous
 *   one; finish with `final: true` (`upTo` = the tick right after the step that won
 *   or lost, or the current tick to quit).
 * - body = `{ poll: true }`: runs a slice and answers the status (about once a
 *   second while the final answer is pending).
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
  private data: RunData | null = null;
  /** The stored sim, kept between requests while this instance lives (at data.simTo). */
  private sim: Sim | null = null;

  private load(): RunData | null {
    if (this.data) return this.data;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const v = this.get("run");
    this.data = v ? (JSON.parse(v) as RunData) : null;
    return this.data;
  }

  private get(k: string): string | undefined {
    return this.ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = ?`, k).toArray()[0]?.v as string | undefined;
  }

  private put(k: string, v: string) {
    this.ctx.storage.sql.exec(`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v);
  }

  /** Writes the run to storage, and only then caches it. */
  private store(data: RunData) {
    this.put("run", JSON.stringify(data));
    this.data = data;
  }

  /** Stores a run that is over (dead or done): its queued chunks, sim and map are no longer needed. */
  private storeOver(data: RunData) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`DELETE FROM kv WHERE k IN ('sim', 'map') OR k LIKE 'q:%'`);
      this.store(data);
    });
    this.sim = null;
  }

  async init(runId: string, userId: string, cfg: Omit<SimConfig, "seed">): Promise<{ seed: number }> {
    if (this.load()) throw new Error("run already exists");
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const { data, sim } = newRun(runId, userId, { ...cfg, seed }, Date.now());
    this.ctx.storage.transactionSync(() => {
      // The map never changes; storing it saves regenerating it on every restore.
      this.put("map", JSON.stringify(sim.map));
      this.put("sim", simToJson(sim));
      this.store(data);
    });
    this.sim = sim;
    await this.schedule();
    return { seed };
  }

  async input(userId: string, batch: Record<string, unknown>): Promise<MageChunkResult> {
    const d = decideUpload(this.load(), userId, batch, Date.now());
    switch (d.kind) {
      case "reply":
        return d.res;
      case "kill":
        this.storeOver(d.data);
        await this.schedule();
        return d.res;
      case "queue":
        this.ctx.storage.transactionSync(() => {
          this.put(`q:${d.seq}`, JSON.stringify(d.chunk));
          this.store(d.data);
        });
        await this.slice();
        break;
      case "slice":
        await this.slice();
        break;
      case "record":
        break;
    }
    await this.recordIfDone();
    await this.schedule();
    // (Only an alarm discarding the run while this request waited leaves no run.)
    return this.data ? statusOf(this.data) : { ok: false, error: "Unknown run" };
  }

  /**
   * Runs one verification slice, if chunks wait. The attempt is counted durably
   * first, so a slice that dies (out of CPU) is known to the next one, which uses
   * a smaller budget (sliceBudget); everything the slice changes is then stored
   * in one transaction.
   */
  private async slice(): Promise<void> {
    const begun = beginSlice(this.load(), Date.now());
    if (!begun) return;
    if (begun.kind === "kill") return this.storeOver(begun.data);
    this.store(begun.data);
    await this.ctx.storage.sync();
    // Another request or the alarm may have run while this one waited for storage.
    const data = this.data;
    if (data !== begun.data) return;

    const cached = this.sim;
    this.sim = null; // dropped while it is stepped; kept again only once its state is stored
    const warm = cached !== null && cached.tick === data.simTo;
    const sim = warm ? cached : simFromJson(this.get("sim") as string, JSON.parse(this.get("map") as string) as GameMap);
    const chunkAt = (i: number): QueuedChunk | undefined => {
      const v = this.get(`q:${data.headSeq + i}`);
      return v ? (JSON.parse(v) as QueuedChunk) : undefined;
    };
    const budget = sliceBudget(warm, begun.died, isolateWork);
    const out = runSlice(data, chunkAt, sim, budget, Date.now());
    isolateWork += out.kind === "progress" ? out.work : budget;
    if (out.kind !== "progress") return this.storeOver(out.data);
    this.ctx.storage.transactionSync(() => {
      for (let i = 0; i < out.popped; i++) this.ctx.storage.sql.exec(`DELETE FROM kv WHERE k = ?`, `q:${data.headSeq + i}`);
      this.put("sim", simToJson(sim));
      this.store(out.data);
    });
    this.sim = sim;
  }

  /** A done run not yet recorded is recorded now; a failure is retried by a later request or the alarm. */
  private async recordIfDone(): Promise<void> {
    const data = this.data;
    if (!data?.done || data.result || !data.finish) return;
    try {
      await this.record(data);
    } catch (e) {
      console.error("mages: recording failed", data.runId, e);
    }
  }

  /** Writes a done run's result to D1 (safe to repeat) and keeps the response for retries. */
  private async record(data: RunData): Promise<void> {
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
    // Over the run as it is now (another event may have stored it while D1 was written).
    if (this.data) this.store({ ...this.data, result });
  }

  /** Points the single alarm at the next job: a slice, a recording retry or the abandon deadline. */
  private async schedule(): Promise<void> {
    if (this.data) await this.ctx.storage.setAlarm(nextAlarm(this.data, Date.now()));
  }

  async alarm() {
    const data = this.load();
    const job = data ? alarmJob(data, Date.now()) : "discard";
    if (job === "discard") {
      await clearStorage(this.ctx.storage); // abandoned or dead run, or a finished one's kept result
      this.data = null;
      this.sim = null;
      return;
    }
    if (job === "slice") await this.slice();
    await this.recordIfDone();
    await this.schedule();
  }
}
