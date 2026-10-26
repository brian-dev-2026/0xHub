// Mage Siege run verification, without any storage: what the MageRun Durable
// Object does with an uploaded chunk, with one verification slice and with its
// alarm. Pure: the functions take the stored run and return decisions, never
// mutating it (runSlice steps the Sim it is handed, which the caller owns).
//
// Workers on the free plan get about 10 ms of CPU per invocation, so an upload
// only queues its chunk after cheap checks, and the sim is advanced through the
// queue in slices of a fixed amount of work (SLICE_WORK), one per request,
// poll or alarm. The final result is therefore confirmed with a short delay.

import { MAX_ACTIONS, advanceSome, chunkBoundsError, outcomeOf, tickWork, validateActions } from "../shared/games/mages/chunk";
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

/**
 * A run as stored (the sim snapshot and the queued chunks are stored beside it:
 * chunk number `headSeq + i` is the i-th one waiting).
 */
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
  /** Sequence number of the oldest chunk waiting, and how many wait. */
  headSeq: number;
  waiting: number;
  /** Tick the stored sim has reached; every chunk end up to it passed its hash check. */
  simTo: number;
  /** Slices begun since the last one that committed (one that never committed died, e.g. out of CPU). */
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
  /** Store `chunk` as number `seq` with the updated run, then run a slice and answer with the status. */
  | { kind: "queue"; data: RunData; chunk: QueuedChunk; seq: number }
  /** A poll or a resent chunk: run a slice and answer with the status. */
  | { kind: "slice" };

export type SliceOutcome =
  /** Store the advanced sim, drop the first `popped` chunks (verified) and store the run; `work` was spent. */
  | { kind: "progress"; data: RunData; popped: number; work: number }
  /** Store the dead run (queue and sim dropped). */
  | { kind: "kill"; data: RunData }
  /** Store the done run (queue and sim dropped, data.finish set, no result yet), then record data.finish. */
  | { kind: "finish"; data: RunData };

export const CLOCK_TOLERANCE_MS = 3000;
/** The client may play at up to 2x speed. */
export const MAX_GAME_SPEED = 2;
/** Most actions one chunk may carry (bounds the cost of an upload and of loading a chunk in a slice). */
export const MAX_CHUNK_ACTIONS = 2000;
/** An idle run (no upload for this long, nothing waiting) is discarded; a finished one keeps its result this long. */
export const ABANDON_AFTER_MS = 60 * 60 * 1000;
/** While chunks wait, the alarm runs a slice this often. */
export const SLICE_EVERY_MS = 1000;
/** A done run whose recording failed is retried this often (until its abandon deadline). */
export const RECORD_RETRY_MS = 60 * 1000;

/**
 * Work units (tickWork per tick, plus one tick's worth per hash check) of one warm
 * slice. Calibrated with the bundled bench over the worst late-Endless waves so the
 * slowest warm slice, serialization included, stays under about 4 ms (Task 14b report).
 */
export const SLICE_WORK = 6000;
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
/** After this many slices in a row that died without committing, the run is given up. */
export const MAX_SLICE_DEATHS = 8;

export function newRun(runId: string, userId: string, cfg: SimConfig, now: number): { data: RunData; sim: Sim } {
  const sim = createSim(cfg);
  const data: RunData = {
    runId, userId, createdAt: now, cfg, actions: 0, queuedTo: 0, queuedHash: hashSim(sim), queuedFinal: false,
    headSeq: 0, waiting: 0, simTo: 0, attempts: 0, abandonAt: now + ABANDON_AFTER_MS,
    invalid: false, error: null, done: false, finish: null, result: null,
  };
  return { data, sim };
}

/** The run marked dead: nothing waits any more, and every later request gets `error`. */
function killed(data: RunData, error: string, now: number): RunData {
  return { ...data, invalid: true, error, headSeq: data.headSeq + data.waiting, waiting: 0, attempts: 0, abandonAt: now + ABANDON_AFTER_MS };
}

/** What the run answers now: its error, its final result, or how far verification has come. */
export function statusOf(data: RunData): MageChunkResult {
  if (data.invalid) return { ok: false, error: data.error ?? "Run failed verification" };
  if (data.done && data.result) return data.result;
  const pending = data.done || data.waiting > 0;
  return { ok: true, pending, verifiedTo: data.simTo, queuedTo: data.queuedTo };
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

  const seq = data.headSeq + data.waiting;
  const next: RunData = {
    ...data, actions: data.actions + actions.length, queuedTo: upTo, queuedHash: h, queuedFinal: final,
    waiting: data.waiting + 1, abandonAt: now + ABANDON_AFTER_MS,
  };
  return { kind: "queue", data: next, chunk: { upTo, actions, h, final }, seq };
}

/**
 * Budget of one slice: up to 1/WARMUP_RATIO of the work this isolate has already
 * done (its JIT warms up as it works) and at most SLICE_WORK; a quarter of that when the sim
 * must be restored first; halved for every earlier attempt that died; never
 * below MIN_SLICE_WORK.
 */
export function sliceBudget(simCached: boolean, died: number, isolateWork: number): number {
  const warmed = Math.min(SLICE_WORK, Math.max(MIN_SLICE_WORK, Math.floor(isolateWork / WARMUP_RATIO)));
  const base = simCached ? warmed : warmed / RESTORE_DIVISOR;
  return Math.max(MIN_SLICE_WORK, Math.floor(base / 2 ** Math.min(died, 30)));
}

/**
 * Starts a slice: null when nothing waits (or the run is over), a kill when too
 * many slices died in a row, otherwise the run with this attempt counted (store
 * it durably before running the slice) and how many earlier attempts died.
 */
export function beginSlice(data: RunData | null, now: number): { kind: "run"; data: RunData; died: number } | { kind: "kill"; data: RunData } | null {
  if (!data || data.invalid || data.done || data.waiting === 0) return null;
  if (data.attempts >= MAX_SLICE_DEATHS) return { kind: "kill", data: killed(data, "Run could not be verified", now) };
  return { kind: "run", data: { ...data, attempts: data.attempts + 1 }, died: data.attempts };
}

/**
 * One verification slice: steps `sim` (at data.simTo; the caller's to mutate)
 * through the waiting chunks (`chunkAt(i)` is the i-th, loaded only when
 * reached) until `budget` work units are spent, checking the hash at every chunk
 * end. A run whose game ends (or whose final chunk is reached) finishes; chunks
 * queued after that are dropped.
 */
export function runSlice(data: RunData, chunkAt: (i: number) => QueuedChunk | undefined, sim: Sim, budget: number, now: number): SliceOutcome {
  const kill = (error: string): SliceOutcome => ({ kind: "kill", data: killed(data, error, now) });
  let left = budget;
  let popped = 0;
  while (popped < data.waiting) {
    const c = chunkAt(popped);
    if (!c) return kill("Run failed verification: lost chunk");
    const r = advanceSome(sim, c.actions, c.upTo, left);
    if (!r.ok) return kill(`Run failed verification: ${r.error}`);
    left -= r.work;
    if (!r.reached) break;
    left -= tickWork(sim); // the hash costs about one tick
    if (hashSim(sim) !== c.h) return kill("Run failed verification");
    popped++;
    if (sim.phase === "won" || sim.phase === "lost" || c.final) return { kind: "finish", data: finished(data, sim, now) };
    if (left <= 0) break;
  }
  return {
    kind: "progress",
    popped,
    work: budget - left,
    data: { ...data, simTo: sim.tick, headSeq: data.headSeq + popped, waiting: data.waiting - popped, attempts: 0 },
  };
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
  return {
    ...data, simTo: sim.tick, headSeq: data.headSeq + data.waiting, waiting: 0, attempts: 0,
    done: true, finish, result: null, abandonAt: now + ABANDON_AFTER_MS,
  };
}

/** What the alarm does now: verify a slice, retry the recording, discard the run, or nothing. */
export function alarmJob(data: RunData, now: number): "slice" | "record" | "discard" | "wait" {
  // A run with chunks waiting is never discarded: the backlog is verified (or the run dies) first.
  if (!data.invalid && !data.done && data.waiting > 0) return "slice";
  if (now >= data.abandonAt) return "discard";
  return data.done && !data.result ? "record" : "wait";
}

/** When the alarm should fire next: the single alarm slot serves slices, recording retries and the abandon timer. */
export function nextAlarm(data: RunData, now: number): number {
  if (!data.invalid && !data.done && data.waiting > 0) return now + SLICE_EVERY_MS;
  if (data.done && !data.result) return Math.min(data.abandonAt, now + RECORD_RETRY_MS);
  return data.abandonAt;
}
