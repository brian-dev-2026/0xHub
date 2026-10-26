import { describe, expect, it } from "vitest";
import { MAX_ACTIONS, simFromJson, simToJson } from "../shared/games/mages/chunk";
import { makeRng } from "../shared/games/mages/rng";
import { COST_SCRIPT, STRONG, endlessCfg, play, stageCfg } from "../shared/games/mages/play.testutil";
import { hashSim, replay } from "../shared/games/mages/replay";
import { createSim, step, type Action, type SimConfig } from "../shared/games/mages/sim";
import {
  ABANDON_AFTER_MS,
  MAX_CHUNK_ACTIONS,
  MAX_SLICE_DEATHS,
  MIN_SLICE_WORK,
  SLICE_EVERY_MS,
  SLICE_WORK,
  WARMUP_RATIO,
  alarmJob,
  beginSlice,
  decideUpload,
  newRun,
  nextAlarm,
  runSlice,
  sliceBudget,
  statusOf,
  type QueuedChunk,
  type RunData,
  type UploadDecision,
} from "./mageChunk";

const T0 = 1_000_000;
/** Long enough after the start that no chunk is ahead of real time. */
const LATE = T0 + 1e9;
const USER = "u1";

/** The chunk [from, upTo) of a recorded run, with the hash a client would send. */
function chunk(cfg: SimConfig, actions: Action[], from: number, upTo: number, extra: Record<string, unknown> = {}) {
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

function expectKind<D extends { kind: string }, K extends D["kind"]>(d: D, kind: K): Extract<D, { kind: K }> {
  expect(d.kind).toBe(kind);
  return d as Extract<D, { kind: K }>;
}

/**
 * What MageRun keeps in storage, without the Durable Object: the run, the queued
 * chunks by sequence number and the sim snapshot as JSON (each slice restores it,
 * as a cold server would).
 */
class Store {
  data: RunData;
  rows = new Map<number, QueuedChunk>();
  sim: string;
  constructor(cfg: SimConfig, now = T0) {
    const r = newRun("r1", USER, cfg, now);
    this.data = r.data;
    this.sim = simToJson(r.sim);
  }
  /** Uploads a chunk as MageRun.input does (without the slice); returns the decision. */
  upload(batch: Record<string, unknown>, now = LATE): UploadDecision {
    const d = decideUpload(this.data, USER, batch, now);
    if (d.kind === "queue") {
      expect(this.rows.has(d.seq)).toBe(false);
      this.rows.set(d.seq, d.chunk);
      this.data = d.data;
    } else if (d.kind === "kill") this.drop(d.data);
    return d;
  }
  /** Runs one slice as MageRun.slice does; returns its outcome kind (or null when there was nothing to do). */
  slice(budget = SLICE_WORK, now = LATE): string | null {
    const begun = beginSlice(this.data, now);
    if (!begun) return null;
    if (begun.kind === "kill") {
      this.drop(begun.data);
      return "kill";
    }
    this.data = begun.data;
    const sim = simFromJson(this.sim);
    const head = this.data.headSeq;
    const out = runSlice(this.data, (i) => this.rows.get(head + i), sim, budget, now);
    if (out.kind === "progress") {
      for (let i = 0; i < out.popped; i++) this.rows.delete(head + i);
      this.sim = simToJson(sim);
      this.data = out.data;
    } else this.drop(out.data);
    return out.kind;
  }
  /** Slices until nothing is left; returns the number of slices. */
  drain(budget = SLICE_WORK): number {
    let n = 0;
    while (this.slice(budget) !== null) n++;
    return n;
  }
  private drop(data: RunData) {
    this.rows.clear();
    this.data = data;
  }
}

describe("mage siege queued verification", () => {
  const cfg = stageCfg();
  const win = play(cfg, STRONG);
  const last = win.waveEnds[win.waveEnds.length - 1];

  it("queues uploads without simulating, then verifies a stage win in slices and records the stars", () => {
    const s = new Store(cfg);
    for (const upTo of win.waveEnds.slice(0, -1)) expectKind(s.upload(chunk(cfg, win.actions, s.data.queuedTo, upTo)), "queue");
    // Nothing is simulated on upload.
    expect(s.data.simTo).toBe(0);
    expect(statusOf(s.data)).toEqual({ ok: true, pending: true, verifiedTo: 0, queuedTo: win.waveEnds[8] });
    const before = s.data;
    expectKind(s.upload(chunk(cfg, win.actions, s.data.queuedTo, last, { final: true })), "queue");
    // The decision never changes the stored run it was given.
    expect(before.queuedFinal).toBe(false);
    expect(s.data).toMatchObject({ queuedTo: last, queuedFinal: true, waiting: 10, actions: win.actions.length });

    const slices = s.drain(1000);
    expect(slices).toBeGreaterThan(10);
    expect(s.rows.size).toBe(0);
    expect(s.data).toMatchObject({ done: true, result: null, simTo: last, waiting: 0 });
    expect(s.data.finish).toMatchObject({ record: "stage", mode: "stage", stage: 1, outcome: { won: true, stars: 3, wavesCleared: 10 } });
    expect(s.data.finish!.outcome).toEqual(replay(cfg, win.actions, last).outcome);
    // Done but not yet recorded: still pending; a retried final asks for the recording again.
    expect(statusOf(s.data)).toMatchObject({ ok: true, pending: true });
    expectKind(s.upload(chunk(cfg, win.actions, win.waveEnds[8], last, { final: true })), "record");
    const result = { ok: true, finished: true, outcome: s.data.finish!.outcome };
    s.data = { ...s.data, result };
    expect(s.upload({ upTo: 5, actions: [], h: 0 })).toEqual({ kind: "reply", res: result });
    expect(s.upload({ poll: true })).toEqual({ kind: "reply", res: result });
  });

  it("acknowledges a resent chunk against the last queued one, and refuses an older one without killing", () => {
    const s = new Store(cfg);
    const c0 = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    const c1 = chunk(cfg, win.actions, win.waveEnds[0], win.waveEnds[1]);
    s.upload(c0);
    s.upload(c1);
    // Resending the last queued chunk (its actions ignored, even if they differ) only drives a slice.
    expect(s.upload(c1)).toEqual({ kind: "slice" });
    expect(s.upload({ ...c1, actions: [{ t: 0, type: "bogus" }] })).toEqual({ kind: "slice" });
    expect(s.data.waiting).toBe(2);
    // Older than the last queued chunk: refused, the run lives on.
    expect(s.upload(c0)).toEqual({ kind: "reply", res: { ok: false, error: "Chunk already received" } });
    s.upload(chunk(cfg, win.actions, win.waveEnds[1], win.waveEnds[2]));
    s.drain();
    expect(s.data).toMatchObject({ simTo: win.waveEnds[2], waiting: 0, invalid: false });
    expect(statusOf(s.data)).toEqual({ ok: true, pending: false, verifiedTo: win.waveEnds[2], queuedTo: win.waveEnds[2] });
    // Before any chunk, the start (tick 0 and the starting hash) counts as the last queued chunk.
    const fresh = new Store(cfg);
    expect(fresh.upload({ upTo: 0, actions: [], h: fresh.data.queuedHash })).toEqual({ kind: "slice" });
  });

  it("a polled run answers its status and drives a slice", () => {
    const s = new Store(cfg);
    expect(s.upload({ poll: true })).toEqual({ kind: "slice" });
    expect(decideUpload(s.data, "u2", { poll: true }, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Not your run" } });
    expect(decideUpload(null, USER, { poll: true }, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Unknown run" } });
  });

  it("a hash mismatch found in a later slice kills the run; later uploads and polls get ok: false", () => {
    const s = new Store(cfg);
    s.upload(chunk(cfg, win.actions, 0, win.waveEnds[0]));
    const bad = chunk(cfg, win.actions, win.waveEnds[0], win.waveEnds[1]);
    // The upload itself is accepted: nothing is simulated yet.
    expectKind(s.upload({ ...bad, h: bad.h ^ 1 }), "queue");
    s.upload(chunk(cfg, win.actions, win.waveEnds[1], win.waveEnds[2]));
    const kinds: (string | null)[] = [];
    for (let k; (k = s.slice(1500)) !== null; ) kinds.push(k);
    expect(kinds[kinds.length - 1]).toBe("kill");
    expect(s.data).toMatchObject({ invalid: true, error: "Run failed verification", waiting: 0 });
    expect(s.rows.size).toBe(0);
    expect(statusOf(s.data)).toEqual({ ok: false, error: "Run failed verification" });
    expect(s.upload({ poll: true })).toEqual({ kind: "reply", res: { ok: false, error: "Run failed verification" } });
    expect(s.upload(chunk(cfg, win.actions, win.waveEnds[2], win.waveEnds[3]))).toEqual({
      kind: "reply",
      res: { ok: false, error: "Run failed verification" },
    });
  });

  it("tampered actions are caught by the hash in a slice", () => {
    const s = new Store(cfg);
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    s.upload({ ...c, actions: c.actions.slice(1) });
    s.drain();
    expect(s.data.invalid).toBe(true);
  });

  it("kills malformed chunks, chunks too long and an uploaded hash that contradicts the queued one", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    const kill = (batch: Record<string, unknown>, data = new Store(cfg).data) => expectKind(decideUpload(data, USER, batch, LATE), "kill").res.error;
    expect(kill({ ...c, upTo: 1.5 })).toBe("Bad batch");
    expect(kill({ ...c, h: "x" })).toBe("Bad batch");
    expect(kill({ ...c, actions: "x" })).toBe("Malformed input: actions must be an array");
    expect(kill({ upTo: 4600, actions: [], h: 1 })).toBe("Run failed verification: chunk too long");
    expect(kill({ ...c, actions: [{ t: c.upTo, type: "startWave" }] })).toBe("Malformed input: bad action tick");
    // Same end as the last queued chunk with another hash: one of the two is wrong.
    const s = new Store(cfg);
    s.upload(c);
    expect(kill({ ...c, h: c.h ^ 1 }, s.data)).toBe("Run failed verification");
    expect(kill({ ...c, h: c.h ^ 1, final: true }, s.data)).toBe("Run failed verification");
    // A killed run drops its queue and answers with the error from then on.
    const d = expectKind(decideUpload(s.data, USER, { ...c, h: c.h ^ 1 }, LATE), "kill");
    expect(d.data).toMatchObject({ invalid: true, waiting: 0, error: "Run failed verification" });
  });

  it("kills a run ahead of 2x real time, checked against the queued chunk", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    const s = new Store(cfg);
    // Earliest wall-clock time the chunk is allowed: 2x speed plus 3 s of tolerance.
    const earliest = Math.ceil(T0 + ((win.waveEnds[0] / 30) * 1000 - 3000) / 2);
    expect(expectKind(decideUpload(s.data, USER, c, earliest - 1), "kill").res.error).toBe("Run is ahead of real time");
    expectKind(decideUpload(s.data, USER, c, earliest), "queue");
  });

  it("kills a run over the action budget, counted over queued chunks", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    expect(c.actions.length).toBeGreaterThan(1);
    const s = new Store(cfg);
    expect(expectKind(decideUpload({ ...s.data, actions: MAX_ACTIONS - 1 }, USER, c, LATE), "kill").res.error).toBe("Too many actions");
    expectKind(decideUpload({ ...s.data, actions: MAX_ACTIONS - c.actions.length }, USER, c, LATE), "queue");
    // One chunk may carry at most MAX_CHUNK_ACTIONS (it bounds the cost of one upload and one slice).
    const many = Array.from({ length: MAX_CHUNK_ACTIONS + 1 }, () => ({ t: 0, type: "startWave" }));
    expect(expectKind(decideUpload(s.data, USER, { upTo: 1, actions: many, h: 0 }, LATE), "kill").res.error).toBe("Too many actions");
  });

  it("refuses unknown, other players' and dead runs", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    const s = new Store(cfg);
    expect(decideUpload(null, USER, c, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Unknown run" } });
    expect(decideUpload(s.data, "u2", c, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Not your run" } });
    expect(decideUpload({ ...s.data, invalid: true }, USER, c, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Run failed verification" } });
  });

  it("a final chunk at the last queued tick finishes (R36), and nothing more is queued after a final", () => {
    const s = new Store(cfg);
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    s.upload(c);
    const quit = { upTo: c.upTo, actions: [], h: c.h, final: true };
    expectKind(s.upload(quit), "queue");
    // Resending the final is a duplicate now; a further chunk is refused without killing.
    expect(s.upload(quit)).toEqual({ kind: "slice" });
    expect(s.upload(c)).toEqual({ kind: "slice" });
    expect(s.upload(chunk(cfg, win.actions, c.upTo, win.waveEnds[1]))).toEqual({ kind: "reply", res: { ok: false, error: "Run already finished" } });
    s.drain();
    // Quitting a stage records nothing.
    expect(s.data.finish).toMatchObject({ record: "none", outcome: { won: false } });
  });

  it("chunks queued after the game ended are dropped when the run finishes", () => {
    const s = new Store(cfg);
    for (const upTo of win.waveEnds) s.upload(chunk(cfg, win.actions, s.data.queuedTo, upTo));
    // An old client posts its final chunk at the same tick as the last wave end.
    s.upload(chunk(cfg, win.actions, last, last, { final: true }));
    s.drain();
    expect(s.data).toMatchObject({ done: true, waiting: 0, finish: { record: "stage" } });
    expect(s.rows.size).toBe(0);
  });

  it("a chunk running past the end of the game kills the run", () => {
    const s = new Store(cfg);
    for (const upTo of win.waveEnds.slice(0, -1)) s.upload(chunk(cfg, win.actions, s.data.queuedTo, upTo));
    const c = chunk(cfg, win.actions, win.waveEnds[8], last);
    s.upload({ ...c, upTo: last + 30 });
    s.drain();
    expect(s.data).toMatchObject({ invalid: true, error: "Run failed verification: chunk runs past the end of the game" });
  });

  it("slicing at random budgets gives the same verdict as one replay", () => {
    const rng = makeRng(77);
    for (const [c, run] of [
      [cfg, win],
      [endlessCfg({ __noLeak: true }), play(endlessCfg({ __noLeak: true }), COST_SCRIPT, { untilWave: 12 })],
    ] as const) {
      const s = new Store(c);
      let t = 0;
      for (const waveEnd of run.waveEnds) {
        while (t + 120 < waveEnd) s.upload(chunk(c, run.actions, t, (t += 120)));
        s.upload(chunk(c, run.actions, t, (t = waveEnd), waveEnd === run.waveEnds[run.waveEnds.length - 1] ? { final: true } : {}));
        // Some slices between uploads, as posts and alarms interleave.
        for (let k = Math.floor(rng.next() * 3); k > 0; k--) s.slice(1 + Math.floor(rng.next() * 3000));
      }
      while (s.slice(1 + Math.floor(rng.next() * 3000)) !== null);
      expect(s.data.done).toBe(true);
      expect(s.data.finish!.outcome).toEqual(replay(c, run.actions, run.sim.tick).outcome);
    }
  });

  describe("Endless", () => {
    const ecfg = endlessCfg();
    const run = play(ecfg, COST_SCRIPT, { untilWave: 1 });

    it("quitting with no wave cleared records nothing", () => {
      const s = new Store(ecfg);
      s.upload({ ...chunk(ecfg, [], 0, 30), final: true });
      s.drain();
      expect(s.data.finish).toMatchObject({ record: "none", outcome: { wavesCleared: 0 } });
    });

    it("quitting after a cleared wave records the score", () => {
      const s = new Store(ecfg);
      s.upload(chunk(ecfg, run.actions, 0, run.waveEnds[0], { final: true }));
      s.drain();
      expect(s.data.finish).toMatchObject({ record: "endless", outcome: { wavesCleared: 1, score: 100 + run.sim.lives } });
    });
  });
});

describe("mage siege slice budget and self-healing", () => {
  it("the budget grows with the isolate's work, is a quarter when the sim must be restored, halves per death, down to a floor", () => {
    const warm = 1e9;
    expect(sliceBudget(true, 0, warm)).toBe(SLICE_WORK);
    expect(sliceBudget(false, 0, warm)).toBe(Math.floor(SLICE_WORK / 4));
    expect(sliceBudget(true, 1, warm)).toBe(Math.floor(SLICE_WORK / 2));
    expect(sliceBudget(true, 2, warm)).toBe(Math.floor(SLICE_WORK / 4));
    expect(sliceBudget(false, 1, warm)).toBe(Math.floor(SLICE_WORK / 8));
    expect(sliceBudget(false, 30, warm)).toBe(MIN_SLICE_WORK);
    expect(MIN_SLICE_WORK).toBeGreaterThan(0);
    // A fresh isolate starts at the floor; a slice may then do 1/WARMUP_RATIO of all the work before it.
    expect(sliceBudget(false, 0, 0)).toBe(MIN_SLICE_WORK);
    expect(sliceBudget(true, 0, 0)).toBe(MIN_SLICE_WORK);
    expect(sliceBudget(true, 0, 1000 * WARMUP_RATIO)).toBe(1000);
    expect(sliceBudget(false, 0, 1000 * WARMUP_RATIO)).toBe(250);
    expect(sliceBudget(true, 0, SLICE_WORK * WARMUP_RATIO - WARMUP_RATIO)).toBe(SLICE_WORK - 1);
    let done = 0;
    const ramp: number[] = [];
    while (sliceBudget(true, 0, done) < SLICE_WORK) done += ramp[ramp.push(sliceBudget(true, 0, done)) - 1];
    // About 40 slices (under a minute of posts and alarms) to full speed.
    expect(ramp.length).toBeGreaterThan(20);
    expect(ramp.length).toBeLessThan(50);
  });

  it("a progress slice reports the work it spent", () => {
    const s = new Store(stageCfg());
    s.upload({ upTo: 300, actions: [{ t: 0, type: "startWave" }], h: 0 });
    const begun = expectKind(beginSlice(s.data, LATE)!, "run");
    const out = expectKind(runSlice(begun.data, (i) => s.rows.get(i), createSim(stageCfg()), 100, LATE), "progress");
    expect(out.work).toBeGreaterThanOrEqual(100);
    expect(out.work).toBeLessThan(200);
  });

  it("beginSlice counts the attempt, a committed slice clears it, and too many deaths kill the run", () => {
    const s = new Store(stageCfg());
    expect(beginSlice(s.data, LATE)).toBeNull(); // nothing queued
    s.upload({ upTo: 30, actions: [{ t: 0, type: "startWave" }], h: 0 });
    const begun = expectKind(beginSlice(s.data, LATE)!, "run");
    expect(begun).toMatchObject({ died: 0, data: { attempts: 1 } });
    // The previous invocation died after counting its attempt: this one knows.
    expect(expectKind(beginSlice(begun.data, LATE)!, "run")).toMatchObject({ died: 1, data: { attempts: 2 } });
    // A slice that commits clears the counter.
    const sim = createSim(stageCfg());
    const out = runSlice(begun.data, () => s.rows.get(0), sim, 10, LATE);
    expect(expectKind(out, "progress").data.attempts).toBe(0);
    // A run whose slices keep dying, even at the floor budget, is given up.
    const dead = expectKind(beginSlice({ ...s.data, attempts: MAX_SLICE_DEATHS }, LATE)!, "kill");
    expect(dead.data).toMatchObject({ invalid: true, waiting: 0, error: "Run could not be verified" });
    // Done or dead runs have nothing to slice.
    expect(beginSlice({ ...s.data, invalid: true }, LATE)).toBeNull();
    expect(beginSlice({ ...s.data, done: true }, LATE)).toBeNull();
  });
});

describe("mage siege alarm", () => {
  const base = newRun("r1", USER, stageCfg(), T0).data;
  const idle = { ...base, abandonAt: T0 + ABANDON_AFTER_MS };
  const behind = { ...idle, waiting: 3 };

  it("an idle run waits for its abandon deadline, then is discarded", () => {
    expect(base.abandonAt).toBe(T0 + ABANDON_AFTER_MS);
    expect(alarmJob(idle, T0 + 10)).toBe("wait");
    expect(nextAlarm(idle, T0 + 10)).toBe(idle.abandonAt);
    expect(alarmJob(idle, idle.abandonAt)).toBe("discard");
  });

  it("a backlog runs a slice about every second and keeps the run past the abandon deadline", () => {
    expect(alarmJob(behind, T0 + 10)).toBe("slice");
    expect(nextAlarm(behind, T0 + 10)).toBe(T0 + 10 + SLICE_EVERY_MS);
    expect(alarmJob(behind, behind.abandonAt + 5 * ABANDON_AFTER_MS)).toBe("slice");
    // Once the run dies, the backlog no longer keeps it.
    const dead = { ...behind, invalid: true, waiting: 0 };
    expect(alarmJob(dead, dead.abandonAt)).toBe("discard");
  });

  it("a done run is recorded by the alarm when no request did it, and its result is kept until the deadline", () => {
    const finish = { mode: "stage" as const, stage: 1 as const, team: base.cfg.team, outcome: replay(base.cfg, []).outcome, durationMs: 1, record: "none" as const };
    const unrecorded = { ...idle, done: true, finish };
    expect(alarmJob(unrecorded, T0 + 10)).toBe("record");
    expect(nextAlarm(unrecorded, T0 + 10)).toBeLessThan(unrecorded.abandonAt);
    expect(nextAlarm(unrecorded, unrecorded.abandonAt - 1)).toBe(unrecorded.abandonAt);
    expect(alarmJob(unrecorded, unrecorded.abandonAt)).toBe("discard");
    const recorded = { ...unrecorded, result: { ok: true, finished: true } };
    expect(alarmJob(recorded, T0 + 10)).toBe("wait");
    expect(alarmJob(recorded, recorded.abandonAt)).toBe("discard");
  });

  it("each queued chunk pushes the abandon deadline back", () => {
    const s = new Store(stageCfg());
    const d = expectKind(s.upload({ upTo: 30, actions: [{ t: 0, type: "startWave" }], h: 0 }, LATE), "queue");
    expect(d.data.abandonAt).toBe(LATE + ABANDON_AFTER_MS);
  });
});
