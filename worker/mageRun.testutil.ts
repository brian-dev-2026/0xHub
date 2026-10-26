// Test helper (not shipped): MageRunCore on an in-memory store that counts the
// rows a Durable Object would write, with a virtual clock and alarm, and a
// client that plays a recorded game at the R46 cadence. Shared by
// mageChunk.test.ts and the Task 14b bench.

import { simFromJson } from "../shared/games/mages/chunk";
import { hashSim } from "../shared/games/mages/replay";
import { createSim, step, type Action, type SimConfig } from "../shared/games/mages/sim";
import { MageRunCore, type MageChunkResult, type RunData, type RunStore } from "./mageChunk";

/** RunStore in memory. `rows` counts rows written as Durable Object SQLite bills them (WITHOUT ROWID table: one per row; one per setAlarm). */
export class FakeStore implements RunStore {
  run: string | null = null;
  sim: string | null = null;
  map: string | null = null;
  alarm: number | null = null;
  rows = 0;
  /** Storage operations and slices, in order. */
  log: string[] = [];
  recorded: RunData[] = [];
  failRecord = false;
  /** Emulates a slice running out of CPU: the invocation dies just as the slice starts. */
  dieOnSlice = false;
  constructor(private clock: () => number) {}

  loadRun(): RunData | null {
    return this.run ? (JSON.parse(this.run) as RunData) : null;
  }
  saveRun(data: RunData) {
    this.run = JSON.stringify(data);
    this.rows++;
    this.log.push(`run a${data.attempts}`);
  }
  createRun(data: RunData, sim: string, map: string) {
    this.run = JSON.stringify(data);
    this.sim = sim;
    this.map = map;
    this.rows += 3;
    this.log.push("create");
  }
  loadSim() {
    this.log.push("restore");
    return simFromJson(this.sim as string, JSON.parse(this.map as string));
  }
  saveCheckpoint(sim: string, data: RunData) {
    this.sim = sim;
    this.run = JSON.stringify(data);
    this.rows += 2;
    this.log.push("checkpoint");
  }
  saveOver(data: RunData) {
    this.rows += 1 + (this.sim ? 1 : 0) + (this.map ? 1 : 0);
    this.sim = this.map = null;
    this.run = JSON.stringify(data);
    this.log.push("over");
  }
  async setAlarm(at: number) {
    this.alarm = at;
    this.rows++;
    this.log.push(`arm +${at - this.clock()}`);
  }
  async sync() {
    this.log.push("sync");
  }
  async clear() {
    this.run = this.sim = this.map = null;
    this.alarm = null;
    this.rows++; // deleteAlarm (the table drop is free of row writes)
    this.log.push("clear");
  }
  async record(data: RunData): Promise<MageChunkResult> {
    if (this.failRecord) throw new Error("D1 down");
    this.recorded.push(data);
    this.log.push("record");
    return { ok: true, finished: true, outcome: data.finish!.outcome };
  }
  trace() {
    this.log.push("slice");
    if (this.dieOnSlice) throw new Error("exceeded CPU");
  }
}

export const USER = "u1";
export const T0 = 1_000_000;

/** One run on a FakeStore: a virtual clock, its alarm, and instance resets (eviction, or death out of CPU). */
export class Harness {
  now = T0;
  store = new FakeStore(() => this.now);
  /** Starts warm (as a busy isolate) unless told otherwise. */
  warmth: { work: number };
  core: MageRunCore;
  requests = 0;
  alarms = 0;
  constructor(isolateWork = 1e9) {
    this.warmth = { work: isolateWork };
    this.core = this.fresh();
  }
  private fresh() {
    return new MageRunCore(this.store, this.warmth, () => this.now);
  }
  /** The instance is gone (evicted, or reset after running out of CPU): only storage is left. */
  reset(isolateWork?: number) {
    if (isolateWork !== undefined) this.warmth.work = isolateWork;
    this.core = this.fresh();
  }
  async init(cfg: SimConfig) {
    this.requests++;
    await this.core.init("r1", USER, cfg);
  }
  async send(batch: Record<string, unknown>): Promise<MageChunkResult> {
    this.requests++;
    return this.core.input(USER, batch);
  }
  poll() {
    return this.send({ poll: true });
  }
  get data(): RunData {
    return this.store.loadRun() as RunData;
  }
  /** Fires the alarm (moving the clock to it) if it is due by `until`; returns whether it fired. */
  async fireAlarm(until = Infinity): Promise<boolean> {
    const at = this.store.alarm;
    if (at === null || at > until) return false;
    this.now = Math.max(this.now, at);
    this.store.alarm = null; // a fired alarm is gone unless the handler sets a new one
    this.requests++;
    this.alarms++;
    await this.core.alarm();
    return true;
  }
}

/** The chunk [from, upTo) of a recorded run, with the hash a client would send. */
export function chunk(cfg: SimConfig, actions: Action[], from: number, upTo: number, extra: Record<string, unknown> = {}) {
  const sim = createSim(cfg);
  let i = 0;
  while (sim.tick < upTo) {
    const now: Action[] = [];
    while (i < actions.length && actions[i].t === sim.tick) now.push(actions[i++]);
    step(sim, now);
  }
  const part = JSON.parse(JSON.stringify(actions.filter((a) => a.t >= from && a.t < upTo)));
  return { upTo, actions: part, h: hashSim(sim), ...extra };
}

export interface Cadence {
  /** Game speed (1 or 2). */
  speed: number;
  /** Real-time spacing of uploads and polls (R46: 10 s and 2 s). */
  uploadEveryMs: number;
  pollEveryMs: number;
  /** Optional faster polls: while the last answer lagged by more than `behindTicks`, and after the final upload. */
  pollBehindMs?: number;
  behindTicks?: number;
  pollAfterFinalMs?: number;
  /** After the final upload: keep polling until the result (page open), or stop (page closed). */
  closeAfterFinal: boolean;
  /** Stop the game after this many ticks (quitting with a final chunk). */
  maxTicks?: number;
}

export interface PlayStats {
  uploads: number;
  polls: number;
  /** Alarm invocations, and the requests the run cost in all (init + uploads + polls + alarms). */
  alarms: number;
  requests: number;
  /** Rows written (SQLite rows and setAlarm calls). */
  rows: number;
  ticks: number;
  /** Real time the game took, and from the final upload to the recorded result. */
  playMs: number;
  resultDelayMs: number;
  result: MageChunkResult | null;
  maxLag: number;
}

/**
 * Plays a recorded game in virtual real time: the client uploads its actions every
 * uploadEveryMs and at every wave end (and the final chunk), polls every
 * pollEveryMs, and the run's alarm fires whenever it is due.
 */
export async function playRun(h: Harness, cfg: SimConfig, actions: Action[], c: Cadence): Promise<PlayStats> {
  await h.init(cfg);
  const start = h.now;
  const sim = createSim(cfg);
  const tickMs = 1000 / (30 * c.speed);
  let i = 0;
  let acts: Action[] = [];
  let lastUpload = start;
  let lastPoll = start;
  let uploads = 0;
  let polls = 0;
  let maxLag = 0;
  let lag = 0;
  let res: MageChunkResult | null = null;
  const endTick = c.maxTicks ?? Infinity;
  const due = async (t: number) => {
    while (await h.fireAlarm(t));
    h.now = Math.max(h.now, t);
  };
  for (;;) {
    const now: Action[] = [];
    while (i < actions.length && actions[i].t === sim.tick) now.push(actions[i++]);
    acts.push(...now);
    const ev = step(sim, now);
    const t = start + Math.ceil(sim.tick * tickMs);
    const over = sim.phase === "won" || sim.phase === "lost" || sim.tick >= endTick;
    await due(t);
    if (over || ev.some((e) => e.type === "waveEnd") || t - lastUpload >= c.uploadEveryMs) {
      res = await h.send({ upTo: sim.tick, actions: acts, h: hashSim(sim), ...(over ? { final: true } : {}) });
      acts = [];
      uploads++;
      lastUpload = lastPoll = t;
    } else if (t - lastPoll >= (c.pollBehindMs !== undefined && lag > (c.behindTicks ?? 0) ? c.pollBehindMs : c.pollEveryMs)) {
      res = await h.poll();
      polls++;
      lastPoll = t;
    }
    if (res && !res.ok) throw new Error(`refused: ${res.error}`);
    if (res && res.queuedTo !== undefined) maxLag = Math.max(maxLag, (lag = res.queuedTo - (res.verifiedTo ?? 0)));
    if (over) break;
  }
  const playMs = h.now - start;
  const finalAt = h.now;
  // After the final upload: poll until the result (page open), or let the alarm chain do it (page closed).
  for (let k = 0; !h.store.recorded.length && k < 100_000; k++) {
    if (!c.closeAfterFinal && (res === null || !res.finished)) {
      const next = h.now + (c.pollAfterFinalMs ?? c.pollEveryMs);
      await due(next);
      if (h.store.recorded.length) break;
      res = await h.poll();
      polls++;
    } else if (!(await h.fireAlarm())) break;
  }
  const resultDelayMs = h.now - finalAt;
  // The rest of the run's life: the alarm that keeps the result, then discards it.
  while (await h.fireAlarm());
  return {
    uploads, polls, alarms: h.alarms, requests: h.requests, rows: h.store.rows, ticks: sim.tick,
    playMs, resultDelayMs, result: h.store.recorded.length ? (res?.finished ? res : { ok: true, finished: true }) : null, maxLag,
  };
}
