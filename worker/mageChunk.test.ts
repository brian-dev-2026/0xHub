import { describe, expect, it } from "vitest";
import { MAX_ACTIONS, simFromJson, simToJson } from "../shared/games/mages/chunk";
import { makeRng } from "../shared/games/mages/rng";
import { COST_SCRIPT, STRONG, endlessCfg, play, stageCfg } from "../shared/games/mages/play.testutil";
import { replay } from "../shared/games/mages/replay";
import { createSim, type SimConfig } from "../shared/games/mages/sim";
import {
  ABANDON_AFTER_MS,
  BACKSTOP_MS,
  CHUNK_WORK,
  DRIVEN_RECENTLY_MS,
  MAX_CHUNK_ACTIONS,
  MAX_QUEUE_BYTES,
  MAX_SLICE_DEATHS,
  MIN_SLICE_WORK,
  RECORD_RETRY_MS,
  SLICE_EVERY_MS,
  SLICE_WORK,
  WARMUP_RATIO,
  alarmJob,
  decideUpload,
  newRun,
  nextAlarm,
  planAlarm,
  planSlice,
  runSlice,
  sliceBudget,
  statusOf,
  type RunData,
} from "./mageChunk";
import { Harness, T0, USER, chunk, playRun } from "./mageRun.testutil";

/** Long enough after the start that no chunk is ahead of real time. */
const LATE = T0 + 1e9;

function expectKind<D extends { kind: string }, K extends D["kind"]>(d: D, kind: K): Extract<D, { kind: K }> {
  expect(d.kind).toBe(kind);
  return d as Extract<D, { kind: K }>;
}

/** A harness with its run started, its clock late enough for any chunk. */
async function started(cfg: SimConfig, isolateWork?: number): Promise<Harness> {
  const h = new Harness(isolateWork);
  await h.init(cfg);
  h.now = LATE;
  return h;
}

/** Drives a run's verification to the end with polls (page open). */
async function drain(h: Harness) {
  for (let k = 0; k < 10_000 && h.data.queue.length && !h.data.invalid && !h.data.done; k++) {
    h.now += 2000;
    await h.poll();
  }
}

const cfg = stageCfg();
const win = play(cfg, STRONG);
const last = win.waveEnds[win.waveEnds.length - 1];

describe("mage siege uploads (cheap checks, queued against the last uploaded chunk)", () => {
  const start = newRun("r1", USER, cfg, T0).data;
  const c0 = chunk(cfg, win.actions, 0, win.waveEnds[0]);
  const queued = (data: RunData, batch: Record<string, unknown>) => expectKind(decideUpload(data, USER, batch, LATE), "queue").data;

  it("queues a chunk without simulating it, and pushes the abandon deadline back", () => {
    const d = queued(start, c0);
    expect(d).toMatchObject({ simTo: 0, queuedTo: c0.upTo, queuedHash: c0.h, queuedFinal: false, actions: c0.actions.length, abandonAt: LATE + ABANDON_AFTER_MS });
    expect(d.queue).toEqual([{ upTo: c0.upTo, actions: c0.actions, h: c0.h, final: false, size: JSON.stringify({ upTo: c0.upTo, actions: c0.actions, h: c0.h, final: false }).length }]);
    // The decision never changes the stored run it was given.
    expect(start.queue).toEqual([]);
    expect(statusOf(d)).toEqual({ ok: true, pending: true, verifiedTo: 0, queuedTo: c0.upTo });
    expect(statusOf(d, 100)).toMatchObject({ verifiedTo: 100 });
  });

  it("acknowledges a resent chunk, refuses an older one without killing, and treats a poll alike", () => {
    const d = queued(queued(start, c0), chunk(cfg, win.actions, win.waveEnds[0], win.waveEnds[1]));
    const c1 = chunk(cfg, win.actions, win.waveEnds[0], win.waveEnds[1]);
    expect(decideUpload(d, USER, c1, LATE)).toEqual({ kind: "slice" });
    expect(decideUpload(d, USER, { ...c1, actions: [{ t: 0, type: "bogus" }] }, LATE)).toEqual({ kind: "slice" });
    expect(decideUpload(d, USER, c0, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Chunk already received" } });
    expect(decideUpload(d, USER, { poll: true }, LATE)).toEqual({ kind: "slice" });
    // Before any chunk, the start (tick 0 and the starting hash) counts as the last uploaded chunk.
    expect(decideUpload(start, USER, { upTo: 0, actions: [], h: start.queuedHash }, LATE)).toEqual({ kind: "slice" });
  });

  it("kills malformed chunks, chunks too long and a hash that contradicts the last uploaded one", () => {
    const kill = (batch: Record<string, unknown>, data = start) => expectKind(decideUpload(data, USER, batch, LATE), "kill").res.error;
    expect(kill({ ...c0, upTo: 1.5 })).toBe("Bad batch");
    expect(kill({ ...c0, h: "x" })).toBe("Bad batch");
    expect(kill({ ...c0, actions: "x" })).toBe("Malformed input: actions must be an array");
    expect(kill({ upTo: 4600, actions: [], h: 1 })).toBe("Run failed verification: chunk too long");
    expect(kill({ ...c0, actions: [{ t: c0.upTo, type: "startWave" }] })).toBe("Malformed input: bad action tick");
    const d = queued(start, c0);
    expect(kill({ ...c0, h: c0.h ^ 1 }, d)).toBe("Run failed verification");
    expect(kill({ ...c0, h: c0.h ^ 1, final: true }, d)).toBe("Run failed verification");
    expect(expectKind(decideUpload(d, USER, { ...c0, h: c0.h ^ 1 }, LATE), "kill").data).toMatchObject({ invalid: true, queue: [], error: "Run failed verification" });
  });

  it("refuses an upload for now (retry) while the waiting chunks hold over MAX_QUEUE_BYTES of JSON", () => {
    const d = queued(start, c0);
    const full = { ...d, queue: [{ ...d.queue[0], size: MAX_QUEUE_BYTES }] };
    const c1 = chunk(cfg, win.actions, win.waveEnds[0], win.waveEnds[1]);
    expect(decideUpload(full, USER, c1, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Verification is behind: send this again later", retry: true } });
    expectKind(decideUpload(d, USER, c1, LATE), "queue");
  });

  it("kills a run ahead of 2x real time", () => {
    const earliest = Math.ceil(T0 + ((c0.upTo / 30) * 1000 - 3000) / 2);
    expect(expectKind(decideUpload(start, USER, c0, earliest - 1), "kill").res.error).toBe("Run is ahead of real time");
    expectKind(decideUpload(start, USER, c0, earliest), "queue");
  });

  it("kills a run over the action budget, per run and per chunk", () => {
    expect(c0.actions.length).toBeGreaterThan(1);
    expect(expectKind(decideUpload({ ...start, actions: MAX_ACTIONS - 1 }, USER, c0, LATE), "kill").res.error).toBe("Too many actions");
    expectKind(decideUpload({ ...start, actions: MAX_ACTIONS - c0.actions.length }, USER, c0, LATE), "queue");
    const many = Array.from({ length: MAX_CHUNK_ACTIONS + 1 }, () => ({ t: 0, type: "startWave" }));
    expect(expectKind(decideUpload(start, USER, { upTo: 1, actions: many, h: 0 }, LATE), "kill").res.error).toBe("Too many actions");
  });

  it("refuses unknown, other players' and dead runs; a done run answers its result or asks for the recording", () => {
    expect(decideUpload(null, USER, c0, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Unknown run" } });
    expect(decideUpload(start, "u2", { poll: true }, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Not your run" } });
    expect(decideUpload({ ...start, invalid: true }, USER, c0, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Run failed verification" } });
    const finish = { mode: "stage" as const, stage: 1 as const, team: cfg.team, outcome: replay(cfg, []).outcome, durationMs: 1, record: "none" as const };
    expectKind(decideUpload({ ...start, done: true, finish }, USER, { poll: true }, LATE), "record");
    const result = { ok: true, finished: true };
    expect(decideUpload({ ...start, done: true, finish, result }, USER, c0, LATE)).toEqual({ kind: "reply", res: result });
  });

  it("a final chunk at the last uploaded tick is queued (R36); nothing is queued after a final", () => {
    const d = queued(start, c0);
    const quit = { upTo: c0.upTo, actions: [], h: c0.h, final: true };
    const q = queued(d, quit);
    expect(q.queue).toHaveLength(2);
    expect(decideUpload(q, USER, quit, LATE)).toEqual({ kind: "slice" });
    expect(decideUpload(q, USER, c0, LATE)).toEqual({ kind: "slice" });
    expect(decideUpload(q, USER, chunk(cfg, win.actions, c0.upTo, win.waveEnds[1]), LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Run already finished" } });
  });
});

describe("mage siege slices", () => {
  /** The run with every wave-end chunk of the stage win queued (the last one final). */
  const all = (extra: Record<string, unknown>[] = []) => {
    let d = newRun("r1", USER, cfg, T0).data;
    for (const [k, upTo] of win.waveEnds.entries())
      d = expectKind(decideUpload(d, USER, chunk(cfg, win.actions, d.queuedTo, upTo, k === win.waveEnds.length - 1 ? { final: true } : {}), LATE), "queue").data;
    for (const b of extra) d = expectKind(decideUpload(d, USER, b, LATE), "queue").data;
    return d;
  };

  it("checkpoints only at verified chunk ends, and verifies a stage win to the same outcome as replay", () => {
    let d = all();
    const sim = createSim(cfg);
    let checkpoints = 0;
    for (;;) {
      const out = runSlice(d, sim, 700, LATE);
      if (out.kind === "finish") {
        expect(out.data).toMatchObject({ done: true, queue: [], simTo: last, finish: { record: "stage", outcome: { won: true, stars: 3, wavesCleared: 10 } } });
        expect(out.data.finish!.outcome).toEqual(replay(cfg, win.actions, last).outcome);
        break;
      }
      const p = expectKind(out, "progress");
      if (p.checkpoint) {
        checkpoints++;
        expect(p.checkpoint.data.simTo).toBe(win.waveEnds[10 - p.checkpoint.data.queue.length - 1]);
        expect(JSON.parse(p.checkpoint.sim).tick).toBe(p.checkpoint.data.simTo);
        d = p.checkpoint.data;
      }
    }
    expect(checkpoints).toBe(9);
  });

  it("charges each chunk end and each action", () => {
    // Zero-length chunks cost CHUNK_WORK each, so a budget stops at a few of them.
    let d = newRun("r1", USER, cfg, T0).data;
    const start = d.queuedHash;
    for (let k = 0; k < 10; k++) d = { ...d, queue: [...d.queue, { upTo: 0, actions: [], h: start, final: false, size: 0 }] };
    const out = expectKind(runSlice(d, createSim(cfg), 3 * CHUNK_WORK, LATE), "progress");
    expect(out.checkpoint!.data.queue).toHaveLength(7);
    // An action costs one unit on top of its tick.
    const one = { ...newRun("r1", USER, cfg, T0).data, queue: [{ upTo: 1, actions: [{ t: 0, type: "startWave" as const }], h: 0, final: false, size: 0 }] };
    const sim = createSim(cfg);
    const work = 1 + sim.enemies.length + sim.mages.length + sim.zones.length + 1;
    expect(runSlice(one, sim, 1, LATE)).toMatchObject({ kind: "kill", work: work + CHUNK_WORK });
  });

  it("a hash mismatch, tampered actions or a chunk past the end of the game kill the run", () => {
    const c0 = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    const base = newRun("r1", USER, cfg, T0).data;
    const run = (q: RunData["queue"]) => runSlice({ ...base, queue: q }, createSim(cfg), 1e9, LATE);
    expect(expectKind(run([{ ...c0, h: c0.h ^ 1, final: false, size: 0 }]), "kill").data).toMatchObject({ invalid: true, queue: [], error: "Run failed verification" });
    expectKind(run([{ ...c0, actions: c0.actions.slice(1), final: false, size: 0 }]), "kill");
    const d = all();
    const tail = d.queue[9];
    expect(expectKind(runSlice({ ...d, queue: [...d.queue.slice(0, 9), { ...tail, upTo: last + 30, final: false }] }, createSim(cfg), 1e9, LATE), "kill").data.error).toBe(
      "Run failed verification: chunk runs past the end of the game",
    );
  });

  it("chunks queued after the game ended are dropped when the run finishes", () => {
    const d = all();
    // (The last wave-end chunk is final already; an extra chunk can't be queued after it, so test the won game itself.)
    const notFinal = { ...d, queuedFinal: false, queue: d.queue.map((c) => ({ ...c, final: false })) };
    const more = expectKind(decideUpload(notFinal, USER, chunk(cfg, win.actions, last, last, { final: true }), LATE), "queue").data;
    expect(expectKind(runSlice(more, createSim(cfg), 1e9, LATE), "finish").data).toMatchObject({ queue: [], finish: { record: "stage" } });
  });

  it("slicing at random budgets with restores gives the same verdict as replay (stage and Endless)", () => {
    const rng = makeRng(77);
    const ecfg = endlessCfg({ __noLeak: true });
    for (const [c, run] of [[cfg, win], [ecfg, play(ecfg, COST_SCRIPT, { untilWave: 12 })]] as const) {
      let d = newRun("r1", USER, c, T0).data;
      let t = 0;
      for (const waveEnd of run.waveEnds) {
        while (t + 300 < waveEnd) d = expectKind(decideUpload(d, USER, chunk(c, run.actions, t, (t += 300)), LATE), "queue").data;
        const isLast = waveEnd === run.waveEnds[run.waveEnds.length - 1];
        d = expectKind(decideUpload(d, USER, chunk(c, run.actions, t, (t = waveEnd), isLast ? { final: true } : {}), LATE), "queue").data;
      }
      let snap = simToJson(createSim(c));
      let sim = createSim(c);
      for (let k = 0; ; k++) {
        // Sometimes the instance is lost: restart from the last checkpoint.
        if (rng.next() < 0.2) sim = simFromJson(snap);
        const out = runSlice(d, sim, 1 + Math.floor(rng.next() * 3000), LATE);
        if (out.kind === "finish") {
          expect(out.data.finish!.outcome).toEqual(replay(c, run.actions, run.sim.tick).outcome);
          break;
        }
        const p = expectKind(out, "progress");
        if (p.checkpoint) {
          d = p.checkpoint.data;
          snap = p.checkpoint.sim;
        }
        expect(k).toBeLessThan(100_000);
      }
    }
  });

  describe("Endless", () => {
    const ecfg = endlessCfg();
    const run = play(ecfg, COST_SCRIPT, { untilWave: 1 });
    const base = newRun("r2", USER, ecfg, T0).data;

    it("quitting with no wave cleared records nothing", () => {
      const d = expectKind(decideUpload(base, USER, { ...chunk(ecfg, [], 0, 30), final: true }, LATE), "queue").data;
      expect(expectKind(runSlice(d, createSim(ecfg), 1e9, LATE), "finish").data.finish).toMatchObject({ record: "none", outcome: { wavesCleared: 0 } });
    });

    it("quitting after a cleared wave records the score", () => {
      const d = expectKind(decideUpload(base, USER, chunk(ecfg, run.actions, 0, run.waveEnds[0], { final: true }), LATE), "queue").data;
      expect(expectKind(runSlice(d, createSim(ecfg), 1e9, LATE), "finish").data.finish).toMatchObject({
        record: "endless",
        outcome: { wavesCleared: 1, score: 100 + run.sim.lives },
      });
    });
  });
});

describe("mage siege budgets and plans", () => {
  it("the budget grows with the isolate's work, is a quarter when the sim must be restored, halves per death, down to a floor", () => {
    const warm = 1e9;
    expect(sliceBudget(true, 0, warm)).toBe(SLICE_WORK);
    expect(sliceBudget(false, 0, warm)).toBe(Math.floor(SLICE_WORK / 4));
    expect(sliceBudget(true, 1, warm)).toBe(Math.floor(SLICE_WORK / 2));
    expect(sliceBudget(false, 1, warm)).toBe(Math.floor(SLICE_WORK / 8));
    expect(sliceBudget(false, 30, warm)).toBe(MIN_SLICE_WORK);
    expect(sliceBudget(true, 0, 0)).toBe(MIN_SLICE_WORK);
    expect(sliceBudget(true, 0, 1000 * WARMUP_RATIO)).toBe(1000);
    expect(sliceBudget(false, 0, 1000 * WARMUP_RATIO)).toBe(250);
    let done = 0;
    const ramp: number[] = [];
    while (sliceBudget(true, 0, done) < SLICE_WORK) done += ramp[ramp.push(sliceBudget(true, 0, done)) - 1];
    expect(ramp.length).toBeGreaterThan(20);
    expect(ramp.length).toBeLessThan(50);
  });

  it("planAlarm: an upload arms the backstop, a poll writes nothing, an alarm re-arms or drives a slice armed first", () => {
    expect(planAlarm("upload", 100, 0)).toEqual({ arm: 100 + BACKSTOP_MS, slice: true });
    expect(planAlarm("poll", 100, 0)).toEqual({ arm: null, slice: true });
    const now = T0 + 60_000;
    expect(planAlarm("alarm", now, now - DRIVEN_RECENTLY_MS + 1)).toEqual({ arm: now + BACKSTOP_MS, slice: false });
    expect(planAlarm("alarm", now, now - DRIVEN_RECENTLY_MS)).toEqual({ arm: now + SLICE_EVERY_MS, slice: true });
  });

  it("planSlice: warm slices count nothing; cold slices count their attempt first and halve per death; too many deaths kill", () => {
    const d = { ...newRun("r1", USER, cfg, T0).data, queue: [{ upTo: 30, actions: [], h: 0, final: false, size: 0 }] };
    expect(planSlice({ ...d, queue: [] }, true, 1e9, LATE)).toBeNull();
    expect(planSlice({ ...d, invalid: true }, true, 1e9, LATE)).toBeNull();
    expect(planSlice(d, true, 1e9, LATE)).toEqual({ kind: "warm", budget: SLICE_WORK });
    expect(planSlice(d, false, 1e9, LATE)).toEqual({ kind: "cold", counted: { ...d, attempts: 1 }, budget: SLICE_WORK / 4 });
    expect(planSlice({ ...d, attempts: 2 }, false, 1e9, LATE)).toMatchObject({ kind: "cold", counted: { attempts: 3 }, budget: SLICE_WORK / 16 });
    expect(expectKind(planSlice({ ...d, attempts: MAX_SLICE_DEATHS }, false, 1e9, LATE)!, "kill").data).toMatchObject({
      invalid: true,
      queue: [],
      error: "Run could not be verified",
    });
    // Within Cloudflare's 6 retries of a failed alarm.
    expect(MAX_SLICE_DEATHS).toBeLessThan(6);
  });

  it("alarmJob and nextAlarm: a backlog keeps the run past its deadline; idle and dead runs are discarded; results are kept", () => {
    const base = newRun("r1", USER, cfg, T0).data;
    const behind = { ...base, queue: [{ upTo: 30, actions: [], h: 0, final: false, size: 0 }] };
    expect(alarmJob(base, T0 + 10)).toBe("wait");
    expect(nextAlarm(base, T0 + 10)).toBe(base.abandonAt);
    expect(alarmJob(base, base.abandonAt)).toBe("discard");
    expect(alarmJob(behind, base.abandonAt + 5 * ABANDON_AFTER_MS)).toBe("visit");
    expect(alarmJob({ ...behind, invalid: true, queue: [] }, base.abandonAt)).toBe("discard");
    const finish = { mode: "stage" as const, stage: 1 as const, team: cfg.team, outcome: replay(cfg, []).outcome, durationMs: 1, record: "none" as const };
    const unrecorded = { ...base, done: true, finish };
    expect(alarmJob(unrecorded, T0 + 10)).toBe("record");
    expect(nextAlarm(unrecorded, T0 + 10)).toBe(T0 + 10 + RECORD_RETRY_MS);
    expect(nextAlarm(unrecorded, base.abandonAt - 1)).toBe(base.abandonAt);
    expect(alarmJob({ ...unrecorded, result: { ok: true } }, T0 + 10)).toBe("wait");
  });
});

describe("mage siege run orchestration (MageRunCore on a counting store)", () => {
  const c0 = chunk(cfg, win.actions, 0, win.waveEnds[0]);
  const big = chunk(cfg, win.actions, 0, win.waveEnds[3]);

  it("an upload stores its run and arms the backstop; a warm poll inside a chunk writes nothing", async () => {
    const h = await started(cfg, 300 * WARMUP_RATIO); // small slices: a poll stays inside the chunk
    h.store.log.length = 0;
    const rows = h.store.rows;
    const res = await h.send(big);
    expect(h.store.log.slice(0, 3)).toEqual(["run a0", `arm +${BACKSTOP_MS}`, "slice"]);
    expect(h.store.rows).toBe(rows + 2);
    expect(res).toMatchObject({ ok: true, pending: true, queuedTo: big.upTo });
    expect(res.verifiedTo).toBeGreaterThan(0);
    h.store.log.length = 0;
    const before = h.store.rows;
    const p = await h.poll();
    expect(h.store.log).toEqual(["slice"]);
    expect(h.store.rows).toBe(before);
    expect(p.verifiedTo).toBeGreaterThan(res.verifiedTo!);
  });

  it("with no requests, the alarm drives verification, arming the next alarm before each slice, and records the run", async () => {
    const h = await started(cfg);
    // Every chunk uploaded, none verified yet (as if the page closed right after the final upload), the instance gone.
    let d = h.data;
    for (const [k, upTo] of win.waveEnds.entries())
      d = expectKind(decideUpload(d, USER, chunk(cfg, win.actions, d.queuedTo, upTo, k === 9 ? { final: true } : {}), LATE), "queue").data;
    h.store.run = JSON.stringify(d);
    h.store.alarm = h.now + BACKSTOP_MS;
    h.reset();
    h.store.log.length = 0;
    while (!h.store.recorded.length) expect(await h.fireAlarm()).toBe(true);
    const log = h.store.log;
    // Every slice the alarm ran had its successor armed first.
    for (let i = 0; i < log.length; i++) if (log[i] === "slice") expect(log.slice(0, i).reverse().find((x) => x.startsWith("arm"))).toBe(`arm +${SLICE_EVERY_MS}`);
    expect(log.indexOf("restore")).toBeGreaterThan(-1);
    expect(h.data).toMatchObject({ done: true, finish: { record: "stage", outcome: { won: true, stars: 3 } }, result: { ok: true, finished: true } });
    expect(h.store.recorded).toHaveLength(1);
    // Then it keeps the result for an hour, and discards it.
    expect(h.store.alarm).toBe(h.data.abandonAt);
    expect(await h.poll()).toMatchObject({ ok: true, finished: true });
    await h.fireAlarm();
    expect(h.store.run).toBeNull();
    expect(h.store.recorded).toHaveLength(1);
  });

  it("an alarm right after a request only re-arms the backstop", async () => {
    const h = await started(cfg, 300 * WARMUP_RATIO);
    await h.send(big);
    h.now += 1000;
    await h.poll();
    h.store.log.length = 0;
    h.now += 2000;
    h.store.alarm = h.now; // fire now: a poll drove a slice 2 s ago
    await h.fireAlarm();
    expect(h.store.log).toEqual([`arm +${BACKSTOP_MS}`]);
  });

  it("a cold slice counts its attempt durably first and clears it once it ended", async () => {
    const h = await started(cfg, 300 * WARMUP_RATIO);
    await h.send(big);
    h.reset(); // evicted
    h.store.log.length = 0;
    await h.poll();
    // The count stays until a checkpoint clears it (a slice merely surviving doesn't).
    expect(h.store.log).toEqual(["run a1", "sync", "restore", "slice"]);
    expect(h.data.attempts).toBe(1);
    for (let k = 0; k < 100 && h.data.attempts > 0; k++) await h.poll();
    expect(h.store.log).toContain("checkpoint");
    expect(h.data.attempts).toBe(0);
  });

  it("after eviction, verification restarts from the last checkpoint and still verifies the game", async () => {
    const h = await started(cfg, 2000 * WARMUP_RATIO);
    for (const [k, upTo] of win.waveEnds.entries()) await h.send(chunk(cfg, win.actions, h.data.queuedTo, upTo, k === 9 ? { final: true } : {}));
    for (let k = 0; !h.data.done && !h.data.invalid && k < 10_000; k++) {
      if (k % 10 === 9) h.reset();
      h.now += 2000;
      await h.poll();
    }
    expect(h.data.invalid).toBe(false);
    expect(h.data.finish!.outcome).toEqual(replay(cfg, win.actions, last).outcome);
    expect(h.store.recorded).toHaveLength(1);
  });

  it("slices that die heal: each dead cold slice halves the next budget, a successor alarm always exists, and too many deaths kill", async () => {
    const h = await started(cfg);
    h.store.dieOnSlice = true;
    await expect(h.send(big)).rejects.toThrow();
    h.reset();
    h.now += DRIVEN_RECENTLY_MS + BACKSTOP_MS;
    for (let k = 0; k < MAX_SLICE_DEATHS; k++) {
      expect(h.store.alarm).not.toBeNull();
      await expect(h.fireAlarm()).rejects.toThrow("exceeded CPU");
      expect(h.data.attempts).toBe(k + 1);
      h.reset();
    }
    expect(h.store.alarm).not.toBeNull();
    await h.fireAlarm();
    expect(h.data).toMatchObject({ invalid: true, error: "Run could not be verified" });
    expect(await h.poll()).toEqual({ ok: false, error: "Run could not be verified" });
    // The dead run is discarded at its deadline.
    while (await h.fireAlarm());
    expect(h.store.run).toBeNull();
  });

  /** Drives a run by alarms only (page closed), resetting the instance (isolate kept) whenever a slice dies. */
  async function alarmsOnly(h: Harness, limit: number) {
    let fired = 0;
    for (; fired < limit && !h.data.done && !h.data.invalid; fired++) {
      if (h.store.alarm === null) break;
      try {
        await h.fireAlarm();
      } catch {
        h.reset(); // the instance was reset after running out of CPU; the isolate (and its warmth) survives
      }
    }
    return fired;
  }

  it("warm slices that die (cold ones survive) can't loop: halved budgets reach checkpoints and the run is verified, with bounded rows", async () => {
    const h = await started(cfg);
    // Every chunk uploaded, none verified yet, the page closed.
    let d = h.data;
    for (const [k, upTo] of win.waveEnds.entries())
      d = expectKind(decideUpload(d, USER, chunk(cfg, win.actions, d.queuedTo, upTo, k === 9 ? { final: true } : {}), LATE), "queue").data;
    h.store.run = JSON.stringify(d);
    h.store.alarm = h.now + BACKSTOP_MS;
    h.reset();
    // Full-budget warm slices run out of CPU; halved ones and cold ones fit.
    h.store.dieWhen = ({ cold, budget }) => !cold && budget > SLICE_WORK / 2;
    const rows = h.store.rows;
    const fired = await alarmsOnly(h, 2000);
    expect(h.data).toMatchObject({ done: true, invalid: false });
    expect(h.data.finish!.outcome).toEqual(replay(cfg, win.actions, last).outcome);
    expect(h.store.deaths).toBeGreaterThan(0);
    // Every death was followed by progress to a checkpoint: deaths are bounded by the chunks, and so are rows.
    expect(h.store.deaths).toBeLessThanOrEqual(10);
    expect(h.store.rows - rows).toBeLessThan(10 * fired);
    expect(fired).toBeLessThan(500);
  });

  it("warm slices that always die are given up after MAX_SLICE_DEATHS cold slices without a checkpoint", async () => {
    const h = await started(cfg);
    await h.send(big); // one long chunk: small cold slices can't reach its end
    h.reset();
    h.store.dieWhen = ({ cold }) => !cold;
    const rows = h.store.rows;
    const fired = await alarmsOnly(h, 1000);
    expect(h.data).toMatchObject({ invalid: true, error: "Run could not be verified" });
    expect(h.store.deaths).toBeLessThanOrEqual(MAX_SLICE_DEATHS + 1);
    expect(fired).toBeLessThan(30);
    expect(h.store.rows - rows).toBeLessThan(40);
  });

  it("a hash mismatch found in a later slice kills the run; later uploads and polls get ok: false", async () => {
    const h = await started(cfg);
    await h.send(c0);
    const c1 = chunk(cfg, win.actions, win.waveEnds[0], win.waveEnds[1]);
    // The upload itself is accepted: nothing is simulated on upload beyond one slice.
    const up = await h.send({ ...c1, h: (c1.h ^ 1) >>> 0 });
    if (up.ok) await drain(h);
    expect(h.data).toMatchObject({ invalid: true, queue: [] });
    expect(h.store.sim).toBeNull();
    expect(await h.poll()).toEqual({ ok: false, error: "Run failed verification" });
    expect(await h.send(chunk(cfg, win.actions, win.waveEnds[1], win.waveEnds[2]))).toEqual({ ok: false, error: "Run failed verification" });
  });

  it("recording happens once; a failed recording is retried by a request or the alarm", async () => {
    const h = await started(cfg);
    h.store.failRecord = true;
    for (const [k, upTo] of win.waveEnds.entries()) await h.send(chunk(cfg, win.actions, h.data.queuedTo, upTo, k === 9 ? { final: true } : {}));
    await drain(h);
    expect(h.data).toMatchObject({ done: true, result: null });
    expect(await h.poll()).toMatchObject({ ok: true, pending: true });
    h.store.failRecord = false;
    h.store.alarm = h.now;
    await h.fireAlarm();
    expect(h.store.recorded).toHaveLength(1);
    expect(await h.poll()).toMatchObject({ ok: true, finished: true });
    expect(h.store.recorded).toHaveLength(1);
  });

  it("rows written for the stage win at the R46 cadence (uploads every 10 s, polls every 2 s), page open or closed", async () => {
    for (const closeAfterFinal of [false, true])
      for (const speed of [1, 2]) {
        const s = await playRun(new Harness(0), cfg, win.actions, { speed, uploadEveryMs: 10_000, pollEveryMs: 2000, closeAfterFinal });
        expect(s.result).not.toBeNull();
        // About two rows per upload (run + backstop) and two per verified chunk end (sim + run).
        expect(s.rows).toBeLessThanOrEqual(4 * s.uploads + 12);
        expect(s.resultDelayMs).toBeLessThan(30_000);
      }
  });
});
