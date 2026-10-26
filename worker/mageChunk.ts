// Mage Siege run verification, without Workers APIs: what the MageRun Durable
// Object does with uploads, polls and alarms.
//
// Workers' free plan gives about 10 ms of CPU per invocation and 100,000 SQLite
// rows written per day (account-wide), so:
// - an upload only queues its chunk (in the run row) after cheap checks;
// - the sim is advanced through the queue in slices of a fixed amount of work,
//   one per upload, poll or alarm, so the final result is confirmed with a delay;
// - a slice that stays inside a chunk writes nothing (the sim lives in memory);
//   the sim is checkpointed only at a verified chunk end, and a cold instance
//   restarts from the last checkpoint (deterministic, so only work is repeated).
//
// The decisions (decideUpload, planAlarm, planSlice, runSlice, alarmJob) are pure;
// MageRunCore runs them over an injected RunStore, so the orchestration and its
// storage writes are tested here and MageRun only adapts Durable Object storage.

import { MAX_ACTIONS, advanceSome, chunkBoundsError, outcomeOf, simToJson, validateActions } from "../shared/games/mages/chunk";
import { TICK_HZ } from "../shared/games/mages/data";
import type { Progress } from "../shared/games/mages/progress";
import { hashSim, type Outcome } from "../shared/games/mages/replay";
import { createSim, type Action, type Sim, type SimConfig } from "../shared/games/mages/sim";

/** What a finished run writes to D1 (once, keyed by runId). */
export interface Finish {
  mode: SimConfig["mode"];
  stage: SimConfig["stage"];
  team: SimConfig["team"];
  outcome: Outcome;
  durationMs: number;
  /** "stage": save the won stage's stars; "endless": record the score; "none": record nothing. */
  record: "stage" | "endless" | "none";
}

/** The answer to an upload or a poll (see MageRun for the client contract). */
export interface MageChunkResult {
  ok: boolean;
  error?: string;
  /** True while uploaded chunks (or the recording of the result) are still waiting for the server. */
  pending?: boolean;
  /** Tick the server's verification has reached, and the end of the last uploaded chunk. */
  verifiedTo?: number;
  queuedTo?: number;
  finished?: boolean;
  outcome?: Outcome;
  progress?: Progress;
  /** Endless only: the player's best Endless score and its leaderboard rank. */
  best?: number;
  rank?: number;
}

/** An uploaded chunk waiting for verification (its actions already validated). */
export interface QueuedChunk {
  upTo: number;
  actions: Action[];
  h: number;
  final: boolean;
}

/** A run as stored (its sim checkpoint and map are stored beside it). */
export interface RunData {
  runId: string;
  userId: string;
  createdAt: number;
  cfg: SimConfig;
  /** Actions uploaded so far, across all chunks (at most MAX_ACTIONS). */
  actions: number;
  /** End, hash and final flag of the last uploaded chunk (0, the starting hash and false before any). */
  queuedTo: number;
  queuedHash: number;
  queuedFinal: boolean;
  /** Uploaded chunks waiting for verification, oldest first. */
  queue: QueuedChunk[];
  /** Tick of the stored sim checkpoint: the end of the last verified chunk. */
  simTo: number;
  /** Cold slices begun since the last one that ended (one that never ended died, e.g. out of CPU). */
  attempts: number;
  /** When the run is discarded, unless chunks are still waiting for verification. */
  abandonAt: number;
  invalid: boolean;
  /** Why the run failed verification (answered to every later request). */
  error: string | null;
  done: boolean;
  /** Set when the run is done: what to record. */
  finish: Finish | null;
  /** Set once the D1 writes succeeded: the final response, replayed to later requests. */
  result: MageChunkResult | null;
}

export type UploadDecision =
  /** Answer without changing the run. */
  | { kind: "reply"; res: MageChunkResult }
  /** Store the dead run (its queue and sim dropped) and answer. */
  | { kind: "kill"; data: RunData; res: MageChunkResult }
  /** The run is done but its recording never completed: record data.finish again. */
  | { kind: "record"; data: RunData }
  /** Store the run with the chunk queued, then visit it as an upload. */
  | { kind: "queue"; data: RunData }
  /** A poll or a resent chunk: visit the run as a poll. */
  | { kind: "slice" };

export type SliceOutcome =
  /**
   * The sim moved on (in memory). `checkpoint` is set when a chunk end was verified:
   * store its sim and run (both at that chunk end); otherwise nothing needs storing.
   */
  | { kind: "progress"; checkpoint: { data: RunData; sim: string } | null; work: number }
  /** Store the dead run (queue and sim dropped). */
  | { kind: "kill"; data: RunData; work: number }
  /** Store the done run (queue and sim dropped, data.finish set, no result yet), then record data.finish. */
  | { kind: "finish"; data: RunData; work: number };

export const CLOCK_TOLERANCE_MS = 3000;
/** The client may play at up to 2x speed. */
export const MAX_GAME_SPEED = 2;
/** Most actions one chunk may carry (bounds the cost of an upload and of a slice). */
export const MAX_CHUNK_ACTIONS = 2000;
/** An idle run (no upload for this long, nothing waiting) is discarded; a finished one keeps its result this long. */
export const ABANDON_AFTER_MS = 60 * 60 * 1000;
/** Each upload arms the alarm this far ahead, so verification goes on if the page goes away. */
export const BACKSTOP_MS = 15_000;
/** An alarm finding a slice driven by a request this recently leaves the work to the requests. */
export const DRIVEN_RECENTLY_MS = 5_000;
/** While the alarm drives verification (no requests), it runs a slice this often. */
export const SLICE_EVERY_MS = 1000;
/** A done run whose recording failed is retried this often (until its abandon deadline). */
export const RECORD_RETRY_MS = 60 * 1000;

/**
 * Work units of one warm slice (tickWork per tick, one per action, CHUNK_WORK per
 * chunk end). Calibrated with the bundled bench over the worst late-Endless waves
 * so the slowest warm slice stays under about 4 ms (Task 14b report).
 */
export const SLICE_WORK = 6000;
/** A chunk end costs about this much: the hash check and the checkpoint snapshot. */
export const CHUNK_WORK = 1000;
/**
 * The smallest budget, and what a slice gets in an isolate that has not verified
 * anything yet: code that has not run is interpreted and compiled as it goes (the
 * bench measured a cold quarter budget at 10-13 ms on its own, and full slices
 * at 3-12 ms until about 100k units had run), so a slice may do at most
 * 1/WARMUP_RATIO of the work the isolate has done so far, up to SLICE_WORK.
 */
export const MIN_SLICE_WORK = Math.floor(SLICE_WORK / 32);
export const WARMUP_RATIO = 8;
/** A slice that has to restore the sim from storage first gets this fraction. */
const RESTORE_DIVISOR = 4;
/**
 * After this many cold slices in a row that died, the run is given up. Below
 * Cloudflare's 6 retries of a failed alarm, so the run is given up (and later
 * discarded) even if only those retries are left to drive it.
 */
export const MAX_SLICE_DEATHS = 5;

export function newRun(runId: string, userId: string, cfg: SimConfig, now: number): { data: RunData; sim: Sim } {
  const sim = createSim(cfg);
  const data: RunData = {
    runId, userId, createdAt: now, cfg, actions: 0, queuedTo: 0, queuedHash: hashSim(sim), queuedFinal: false,
    queue: [], simTo: 0, attempts: 0, abandonAt: now + ABANDON_AFTER_MS,
    invalid: false, error: null, done: false, finish: null, result: null,
  };
  return { data, sim };
}

/** Chunks wait and the run is alive. */
export const isRunnable = (data: RunData): boolean => !data.invalid && !data.done && data.queue.length > 0;

/** The run marked dead: nothing waits any more, and every later request gets `error`. */
function killed(data: RunData, error: string, now: number): RunData {
  return { ...data, invalid: true, error, queue: [], attempts: 0, abandonAt: now + ABANDON_AFTER_MS };
}

/** What the run answers now: its error, its final result, or how far verification has come (`simTick`: the live sim's tick). */
export function statusOf(data: RunData, simTick = 0): MageChunkResult {
  if (data.invalid) return { ok: false, error: data.error ?? "Run failed verification" };
  if (data.done && data.result) return data.result;
  const pending = data.done || data.queue.length > 0;
  return { ok: true, pending, verifiedTo: data.done ? data.simTo : Math.max(data.simTo, simTick), queuedTo: data.queuedTo };
}

/**
 * Decides what an upload (or a `{ poll: true }`) does to a run. Only cheap checks
 * run here; the chunk is simulated later, in slices. Duplicate and older chunks
 * (R34) are judged against the last *uploaded* chunk.
 */
export function decideUpload(data: RunData | null, userId: string, batch: Record<string, unknown>, now: number): UploadDecision {
  const reply = (error: string): UploadDecision => ({ kind: "reply", res: { ok: false, error } });
  if (!data) return reply("Unknown run");
  if (data.userId !== userId) return reply("Not your run");
  if (data.invalid) return { kind: "reply", res: statusOf(data) };
  if (data.done) {
    if (data.result) return { kind: "reply", res: data.result };
    return data.finish ? { kind: "record", data } : reply("Run already finished");
  }
  if (batch.poll === true) return { kind: "slice" };

  const kill = (error: string): UploadDecision => ({ kind: "kill", data: killed(data, error, now), res: { ok: false, error } });
  const { upTo, h } = batch;
  const final = batch.final === true;
  if (typeof upTo !== "number" || !Number.isInteger(upTo) || typeof h !== "number") return kill("Bad batch");
  // A resent chunk (its response was lost) is acknowledged again; an older one is refused without harm.
  if (upTo === data.queuedTo && h === data.queuedHash && (!final || data.queuedFinal)) return { kind: "slice" };
  if (upTo < data.queuedTo) return reply("Chunk already received");
  if (data.queuedFinal) return reply("Run already finished");
  // The sim at one tick has one hash: a different one for the last uploaded tick contradicts it.
  if (upTo === data.queuedTo && h !== data.queuedHash) return kill("Run failed verification");
  // The game can't have run faster than 2x the wall clock since the run started.
  if ((upTo / TICK_HZ) * 1000 > MAX_GAME_SPEED * (now - data.createdAt) + CLOCK_TOLERANCE_MS) return kill("Run is ahead of real time");
  const bounds = chunkBoundsError(data.cfg, data.queuedTo, upTo);
  if (bounds) return kill(`Run failed verification: ${bounds}`);
  const max = Math.min(MAX_CHUNK_ACTIONS, MAX_ACTIONS - data.actions);
  const actions = validateActions(batch.actions, data.queuedTo, upTo, max);
  if (typeof actions === "string") return kill(actions === "too many actions" ? "Too many actions" : `Malformed input: ${actions}`);

  const next: RunData = {
    ...data, actions: data.actions + actions.length, queuedTo: upTo, queuedHash: h, queuedFinal: final,
    queue: [...data.queue, { upTo, actions, h, final }], abandonAt: now + ABANDON_AFTER_MS,
  };
  return { kind: "queue", data: next };
}

/**
 * Budget of one slice: up to 1/WARMUP_RATIO of the work this isolate has already
 * done (its JIT warms up as it works) and at most SLICE_WORK; a quarter of that
 * when the sim must be restored first; halved for every earlier cold slice that
 * died; never below MIN_SLICE_WORK.
 */
export function sliceBudget(simCached: boolean, died: number, isolateWork: number): number {
  const warmed = Math.min(SLICE_WORK, Math.max(MIN_SLICE_WORK, Math.floor(isolateWork / WARMUP_RATIO)));
  const base = simCached ? warmed : warmed / RESTORE_DIVISOR;
  return Math.max(MIN_SLICE_WORK, Math.floor(base / 2 ** Math.min(died, 30)));
}

export type VisitKind = "upload" | "poll" | "alarm";

/**
 * The alarm part of a visit to a runnable run, decided before anything risky:
 * `arm` is set durably first (null: leave the alarm as it is), then a slice runs
 * if `slice`.
 * - upload: arm the backstop BACKSTOP_MS ahead, and slice;
 * - poll: no write, and slice;
 * - alarm: if a request drove a slice in the last DRIVEN_RECENTLY_MS, only re-arm
 *   the backstop; otherwise the alarm drives verification: arm the next slice
 *   (SLICE_EVERY_MS ahead) before slicing, so a slice that dies (out of CPU) always
 *   has a successor.
 */
export function planAlarm(kind: VisitKind, now: number, lastDrivenAt: number): { arm: number | null; slice: boolean } {
  if (kind === "upload") return { arm: now + BACKSTOP_MS, slice: true };
  if (kind === "poll") return { arm: null, slice: true };
  if (now - lastDrivenAt < DRIVEN_RECENTLY_MS) return { arm: now + BACKSTOP_MS, slice: false };
  return { arm: now + SLICE_EVERY_MS, slice: true };
}

export type SlicePlan = { kind: "warm"; budget: number } | { kind: "cold"; counted: RunData; budget: number } | { kind: "kill"; data: RunData };

/**
 * How to run a slice now: null when nothing waits; warm (the sim is in memory: no
 * write at all); cold (the sim must be restored: store `counted`, the run with this
 * attempt counted, durably first, so if this slice dies the next one knows and
 * halves its budget); or kill, when MAX_SLICE_DEATHS cold slices died in a row.
 * A warm slice that dies takes the instance with it, so the next slice is cold
 * and counted.
 */
export function planSlice(data: RunData, simCached: boolean, isolateWork: number, now: number): SlicePlan | null {
  if (!isRunnable(data)) return null;
  if (simCached) return { kind: "warm", budget: sliceBudget(true, 0, isolateWork) };
  if (data.attempts >= MAX_SLICE_DEATHS) return { kind: "kill", data: killed(data, "Run could not be verified", now) };
  return { kind: "cold", counted: { ...data, attempts: data.attempts + 1 }, budget: sliceBudget(false, data.attempts, isolateWork) };
}

/**
 * One verification slice: steps `sim` (the caller's, at or after data.simTo inside
 * the first waiting chunk) through the waiting chunks until `budget` work units are
 * spent, checking the hash at every chunk end. The last chunk end reached becomes
 * the checkpoint. A run whose game ends (or whose final chunk is reached)
 * finishes; chunks queued after that are dropped.
 */
export function runSlice(data: RunData, sim: Sim, budget: number, now: number): SliceOutcome {
  let left = budget;
  const spent = () => budget - left;
  const kill = (error: string): SliceOutcome => ({ kind: "kill", data: killed(data, error, now), work: spent() });
  let checkpoint: { data: RunData; sim: string } | null = null;
  for (let i = 0; i < data.queue.length; ) {
    const c = data.queue[i];
    const r = advanceSome(sim, c.actions, c.upTo, left);
    if (!r.ok) return kill(`Run failed verification: ${r.error}`);
    left -= r.work;
    if (!r.reached) break;
    left -= CHUNK_WORK;
    if (hashSim(sim) !== c.h) return kill("Run failed verification");
    i++;
    if (sim.phase === "won" || sim.phase === "lost" || c.final) return { kind: "finish", data: finished(data, sim, now), work: spent() };
    checkpoint = { data: { ...data, queue: data.queue.slice(i), simTo: sim.tick, attempts: 0 }, sim: simToJson(sim) };
    if (left <= 0) break;
  }
  return { kind: "progress", checkpoint, work: spent() };
}

/**
 * The run done at `sim`: a won stage saves its stars, Endless records its score once a wave
 * was cleared, anything else (a lost or quit stage, Endless with no wave cleared) records nothing.
 */
function finished(data: RunData, sim: Sim, now: number): RunData {
  const { mode, stage, team } = sim.cfg;
  const outcome = outcomeOf(sim);
  const record = mode === "stage" ? (outcome.won ? "stage" : "none") : outcome.wavesCleared > 0 ? "endless" : "none";
  const finish: Finish = { mode, stage, team, outcome, durationMs: Math.round((outcome.ticks / TICK_HZ) * 1000), record };
  return { ...data, simTo: sim.tick, queue: [], attempts: 0, done: true, finish, result: null, abandonAt: now + ABANDON_AFTER_MS };
}

/** What the alarm does now: visit (verify or re-arm), retry the recording, discard the run, or re-arm for later. */
export function alarmJob(data: RunData, now: number): "visit" | "record" | "discard" | "wait" {
  // A run with chunks waiting is never discarded: the backlog is verified (or the run dies) first.
  if (isRunnable(data)) return "visit";
  if (now >= data.abandonAt) return "discard";
  return data.done && !data.result ? "record" : "wait";
}

/** When the alarm should fire for a run with nothing to verify: a recording retry or the abandon deadline. */
export function nextAlarm(data: RunData, now: number): number {
  if (isRunnable(data)) return now + SLICE_EVERY_MS;
  if (data.done && !data.result) return Math.min(data.abandonAt, now + RECORD_RETRY_MS);
  return data.abandonAt;
}

// ---------- orchestration over storage ----------

/** The storage MageRunCore runs on (Durable Object storage in MageRun, a fake in tests). */
export interface RunStore {
  loadRun(): RunData | null;
  /** One row. */
  saveRun(data: RunData): void;
  /** A new run with its sim and map (three rows, one transaction). */
  createRun(data: RunData, sim: string, map: string): void;
  /** The stored checkpoint, restored. */
  loadSim(): Sim;
  /** A verified chunk end: the sim and the run (two rows, one transaction). */
  saveCheckpoint(sim: string, data: RunData): void;
  /** A run that is over (dead or done): drops its sim and map and stores the run (one transaction). */
  saveOver(data: RunData): void;
  /** One row. */
  setAlarm(at: number): Promise<void>;
  /** Resolves once everything written so far is durable. */
  sync(): Promise<void>;
  /** Erases the run and its alarm. */
  clear(): Promise<void>;
  /** Writes a done run's result to D1 (safe to repeat) and returns the final response. */
  record(data: RunData): Promise<MageChunkResult>;
  /** Tests only: told just before a slice runs. */
  trace?(event: "slice"): void;
}

/**
 * One run's orchestration, kept in memory between invocations while the instance
 * lives: the stored run, the live sim (at or past the checkpoint, inside the first
 * waiting chunk), when a request last drove a slice, and the isolate's warmth.
 */
export class MageRunCore {
  private data: RunData | null | undefined = undefined;
  private sim: Sim | null = null;
  private lastDrivenAt = 0;
  /** A cold slice is waiting for its attempt to be stored: no other slice may start. */
  private coldSlice = false;

  constructor(
    private store: RunStore,
    /** Verification work done in this isolate (shared by all its runs). */
    private warmth: { work: number },
    private clock: () => number,
  ) {}

  private load(): RunData | null {
    if (this.data === undefined) this.data = this.store.loadRun();
    return this.data;
  }

  private save(data: RunData) {
    this.store.saveRun(data);
    this.data = data;
  }

  private over(data: RunData) {
    this.store.saveOver(data);
    this.data = data;
    this.sim = null;
  }

  async init(runId: string, userId: string, cfg: SimConfig): Promise<void> {
    if (this.load()) throw new Error("run already exists");
    const now = this.clock();
    const { data, sim } = newRun(runId, userId, cfg, now);
    // The map never changes; storing it saves regenerating it on every restore.
    this.store.createRun(data, simToJson(sim), JSON.stringify(sim.map));
    this.data = data;
    this.sim = sim;
    await this.store.setAlarm(nextAlarm(data, now));
  }

  async input(userId: string, batch: Record<string, unknown>): Promise<MageChunkResult> {
    const now = this.clock();
    const d = decideUpload(this.load(), userId, batch, now);
    switch (d.kind) {
      case "reply":
        return d.res;
      case "kill":
        this.over(d.data);
        await this.store.setAlarm(nextAlarm(d.data, now));
        return d.res;
      case "queue":
        this.save(d.data);
        await this.visit("upload", now);
        break;
      case "slice":
        await this.visit("poll", now);
        break;
      case "record":
        break;
    }
    await this.recordIfDone();
    // (Only an alarm discarding the run while this request waited leaves no run.)
    return this.data ? statusOf(this.data, this.sim?.tick) : { ok: false, error: "Unknown run" };
  }

  async alarm(): Promise<void> {
    const now = this.clock();
    const data = this.load();
    const job = data ? alarmJob(data, now) : "discard";
    if (job === "discard") {
      await this.store.clear(); // abandoned or dead run, or a finished one's kept result
      this.data = null;
      this.sim = null;
      return;
    }
    if (job === "visit") {
      await this.visit("alarm", now);
      // Still verifying: the alarm armed by the visit stands.
      if (this.data && isRunnable(this.data)) return;
    }
    await this.recordIfDone();
    if (this.data) await this.store.setAlarm(nextAlarm(this.data, this.clock()));
  }

  /** One visit to a run: arm the alarm as planned, then run at most one slice. */
  private async visit(kind: VisitKind, now: number): Promise<void> {
    if (!this.data || !isRunnable(this.data)) return;
    const { arm, slice } = planAlarm(kind, now, this.lastDrivenAt);
    if (arm !== null) await this.store.setAlarm(arm);
    if (!slice || this.coldSlice || !this.data) return;
    const plan = planSlice(this.data, this.sim !== null, this.warmth.work, now);
    if (!plan) return;
    if (plan.kind === "kill") return this.over(plan.data);
    if (plan.kind === "cold") {
      this.coldSlice = true;
      try {
        this.save(plan.counted);
        await this.store.sync();
      } finally {
        this.coldSlice = false;
      }
    }
    // Other events may have run while this one waited for storage (uploads only: no slice could start).
    const data = this.data;
    if (!data || !isRunnable(data)) return;
    const cold = this.sim === null;
    const sim = this.sim ?? this.store.loadSim();
    this.sim = null; // dropped while it is stepped; kept again once the slice has ended well
    this.store.trace?.("slice");
    const out = runSlice(data, sim, plan.budget, now);
    this.warmth.work += out.work;
    if (kind !== "alarm") this.lastDrivenAt = now;
    if (out.kind !== "progress") return this.over(out.data);
    if (out.checkpoint) {
      this.store.saveCheckpoint(out.checkpoint.sim, out.checkpoint.data);
      this.data = out.checkpoint.data;
    } else if (cold) this.save({ ...data, attempts: 0 }); // the cold slice survived
    this.sim = sim;
  }

  /** A done run not yet recorded is recorded now; a failure is retried by a later request or the alarm. */
  private async recordIfDone(): Promise<void> {
    const data = this.data;
    if (!data?.done || data.result || !data.finish) return;
    try {
      const result = await this.store.record(data);
      // Over the run as it is now (another event may have stored it while D1 was written).
      if (this.data) this.save({ ...this.data, result });
    } catch (e) {
      console.error("mages: recording failed", data.runId, e);
    }
  }
}
