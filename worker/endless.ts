import { DurableObject } from "cloudflare:workers";
import { STEP_MS } from "../shared/tetris/engine";
import { PlayerSim, decodeEvents, runBatch, type SimState } from "../shared/tetris/sim";
import { recordEndless } from "./db";
import type { Env } from "./env";
import { clearStorage } from "./storage";

interface RunData {
  userId: string;
  seed: number;
  startLevel: number;
  createdAt: number;
  sim: SimState;
  invalid: boolean;
  done: boolean;
}

export interface ChunkResult {
  ok: boolean;
  error?: string;
  finished?: boolean;
  score?: number;
  lines?: number;
  level?: number;
  best?: number;
  rank?: number;
}

const ABANDON_AFTER_MS = 60 * 60 * 1000; // runs with no input for an hour are discarded
const CLOCK_TOLERANCE_MS = 3000;

/**
 * Server-side verification for one endless run. The server picks the seed;
 * the client streams its inputs in chunks while playing, and this object
 * replays them on the shared deterministic engine. The score that gets
 * recorded is the one computed here — never a number the client sent.
 */
export class EndlessRun extends DurableObject<Env> {
  private data: RunData | null = null;
  private sim: PlayerSim | null = null;

  private load(): RunData | null {
    if (this.data) return this.data;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const row = this.ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = 'run'`).toArray()[0];
    if (!row) return null;
    this.data = JSON.parse(row.v as string) as RunData;
    this.sim = PlayerSim.deserialize(this.data.sim, {});
    return this.data;
  }

  private save() {
    if (!this.data || !this.sim) return;
    this.data.sim = this.sim.serialize();
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('run', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(this.data),
    );
  }

  async init(userId: string, startLevel: number): Promise<{ seed: number }> {
    if (this.load()) throw new Error("run already exists");
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.sim = new PlayerSim({ mode: "endless", seed, startLevel });
    this.data = { userId, seed, startLevel, createdAt: Date.now(), sim: this.sim.serialize(), invalid: false, done: false };
    this.save();
    await this.ctx.storage.setAlarm(Date.now() + ABANDON_AFTER_MS);
    return { seed };
  }

  async input(userId: string, batch: Record<string, unknown>): Promise<ChunkResult> {
    const data = this.load();
    const sim = this.sim;
    if (!data || !sim) return { ok: false, error: "Unknown run" };
    if (data.userId !== userId) return { ok: false, error: "Not your run" };
    if (data.done) return { ok: false, error: "Run already finished" };
    if (data.invalid) return { ok: false, error: "Run failed verification" };

    const upTo = batch.upTo;
    if (typeof upTo !== "number" || !Number.isInteger(upTo) || upTo < sim.steps) return { ok: false, error: "Bad batch" };
    // The game can't have run longer than the wall clock since the run started.
    if (upTo * STEP_MS > Date.now() - data.createdAt + CLOCK_TOLERANCE_MS) return this.reject("Run is ahead of real time");
    const events = decodeEvents(batch.ev, sim.steps, upTo, 200_000);
    if (!events) return this.reject("Malformed input");

    runBatch(sim, events, upTo);
    if (batch.h !== sim.engine.hash()) return this.reject("Run failed verification");

    await this.ctx.storage.setAlarm(Date.now() + ABANDON_AFTER_MS);
    if (!sim.finished && batch.final !== true) {
      this.save();
      return { ok: true };
    }

    // Game over (or the player quit): record the server-computed result.
    data.done = true;
    const e = sim.engine;
    const result = { score: e.score, lines: e.lines, level: e.level, durationMs: Math.round(sim.steps * STEP_MS) };
    const { best, rank } = await recordEndless(this.env.DB, data.userId, result);
    await clearStorage(this.ctx.storage);
    this.data = null;
    this.sim = null;
    return { ok: true, finished: true, ...result, best, rank };
  }

  private reject(error: string): ChunkResult {
    if (this.data) {
      this.data.invalid = true;
      this.save();
    }
    return { ok: false, error };
  }

  async alarm() {
    await clearStorage(this.ctx.storage); // abandoned run
    this.data = null;
    this.sim = null;
  }
}
