import { describe, expect, it } from "vitest";
import { MAX_ACTIONS } from "../shared/games/mages/chunk";
import { COST_SCRIPT, STRONG, endlessCfg, play, stageCfg } from "../shared/games/mages/play.testutil";
import { hashSim } from "../shared/games/mages/replay";
import { createSim, step, type Action, type SimConfig } from "../shared/games/mages/sim";
import { decideChunk, newRun, type Decision, type RunData } from "./mageChunk";

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

function expectKind<K extends Decision["kind"]>(d: Decision, kind: K): Extract<Decision, { kind: K }> {
  expect(d.kind).toBe(kind);
  return d as Extract<Decision, { kind: K }>;
}

/** Feeds chunks ending at `ends`, expecting each to be accepted; returns the run after them. */
function feed(data: RunData, cfg: SimConfig, actions: Action[], ends: number[]): RunData {
  for (const upTo of ends) data = expectKind(decideChunk(data, USER, chunk(cfg, actions, data.lastUpTo, upTo), LATE), "accept").data;
  return data;
}

describe("mage siege chunk decisions", () => {
  const cfg = stageCfg();
  const win = play(cfg, STRONG);
  const start = newRun("r1", USER, cfg, T0);

  it("verifies a scripted stage win wave by wave and records the stars", () => {
    const data = feed(start, cfg, win.actions, win.waveEnds.slice(0, -1));
    const last = win.waveEnds[win.waveEnds.length - 1];
    expect(last).toBe(win.sim.tick);
    const d = expectKind(decideChunk(data, USER, chunk(cfg, win.actions, data.lastUpTo, last), LATE), "finish");
    expect(d.data).toMatchObject({ done: true, sim: null, result: null, actions: win.actions.length });
    expect(d.data.finish).toMatchObject({ record: "stage", mode: "stage", stage: 1, outcome: { won: true, stars: 3, wavesCleared: 10 } });
    // The decision never changes the stored run it was given.
    expect(data.done).toBe(false);
  });

  it("acknowledges a resent chunk without changing the run", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    const after = expectKind(decideChunk(start, USER, c, LATE), "accept").data;
    expect(decideChunk(after, USER, c, LATE)).toEqual({ kind: "reply", res: { ok: true } });
    // Its actions are ignored, even if they differ.
    expect(decideChunk(after, USER, { ...c, actions: [{ t: 0, type: "bogus" }] }, LATE)).toEqual({ kind: "reply", res: { ok: true } });
  });

  it("refuses an older chunk without killing the run", () => {
    const after = feed(start, cfg, win.actions, win.waveEnds.slice(0, 2));
    const old = decideChunk(after, USER, chunk(cfg, win.actions, 0, win.waveEnds[0]), LATE);
    expect(old).toEqual({ kind: "reply", res: { ok: false, error: "Chunk already verified" } });
    feed(after, cfg, win.actions, [win.waveEnds[2]]);
  });

  it("kills the run on a tampered hash, also at the last accepted tick", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    expect(expectKind(decideChunk(start, USER, { ...c, h: c.h ^ 1 }, LATE), "kill").res).toEqual({ ok: false, error: "Run failed verification" });
    const after = expectKind(decideChunk(start, USER, c, LATE), "accept").data;
    expectKind(decideChunk(after, USER, { ...c, h: c.h ^ 1 }, LATE), "kill");
  });

  it("kills malformed chunks and tampered actions", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    expectKind(decideChunk(start, USER, { ...c, upTo: 1.5 }, LATE), "kill");
    expectKind(decideChunk(start, USER, { ...c, actions: "x" }, LATE), "kill");
    // Dropping an action changes the game, so the client's hash no longer matches.
    expectKind(decideChunk(start, USER, { ...c, actions: c.actions.slice(1) }, LATE), "kill");
  });

  it("kills a run ahead of 2x real time", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    // Earliest wall-clock time the chunk is allowed: 2x speed plus 3 s of tolerance.
    const earliest = Math.ceil(T0 + ((win.waveEnds[0] / 30) * 1000 - 3000) / 2);
    expect(expectKind(decideChunk(start, USER, c, earliest - 1), "kill").res.error).toBe("Run is ahead of real time");
    expectKind(decideChunk(start, USER, c, earliest), "accept");
  });

  it("kills a run over the action budget", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    expect(c.actions.length).toBeGreaterThan(1);
    const nearlyFull = { ...start, actions: MAX_ACTIONS - 1 };
    expect(expectKind(decideChunk(nearlyFull, USER, c, LATE), "kill").res.error).toBe("Too many actions");
    expectKind(decideChunk({ ...start, actions: MAX_ACTIONS - c.actions.length }, USER, c, LATE), "accept");
  });

  it("answers a finished run with its stored result, or records it again if recording never completed", () => {
    const done = { ...start, sim: null, done: true };
    const result = { ok: true, finished: true, outcome: { won: true, wavesCleared: 10, lives: 20, stars: 3 as const, score: 0, ticks: 1 } };
    const finish = { mode: "stage" as const, stage: 1 as const, team: cfg.team, outcome: result.outcome, durationMs: 1, record: "stage" as const };
    expect(decideChunk({ ...done, finish, result }, USER, { upTo: 1, actions: [], h: 0 }, LATE)).toEqual({ kind: "reply", res: result });
    expectKind(decideChunk({ ...done, finish, result: null }, USER, { upTo: 1, actions: [], h: 0, final: true }, LATE), "record");
  });

  it("refuses unknown, other players' and dead runs", () => {
    const c = chunk(cfg, win.actions, 0, win.waveEnds[0]);
    expect(decideChunk(null, USER, c, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Unknown run" } });
    expect(decideChunk(start, "u2", c, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Not your run" } });
    expect(decideChunk({ ...start, invalid: true }, USER, c, LATE)).toEqual({ kind: "reply", res: { ok: false, error: "Run failed verification" } });
  });

  it("quitting a stage records nothing", () => {
    const after = feed(start, cfg, win.actions, [win.waveEnds[0]]);
    const quit = { upTo: after.lastUpTo, actions: [], h: after.lastHash, final: true };
    const d = expectKind(decideChunk(after, USER, quit, LATE), "finish");
    expect(d.data.finish).toMatchObject({ record: "none", outcome: { won: false } });
  });

  describe("Endless", () => {
    const ecfg = endlessCfg();
    const run = play(ecfg, COST_SCRIPT, { untilWave: 1 });
    const estart = newRun("r2", USER, ecfg, T0);

    it("quitting with no wave cleared records nothing", () => {
      const d = expectKind(decideChunk(estart, USER, { ...chunk(ecfg, [], 0, 30), final: true }, LATE), "finish");
      expect(d.data.finish).toMatchObject({ record: "none", outcome: { wavesCleared: 0 } });
    });

    it("quitting after a cleared wave records the score", () => {
      const end = run.waveEnds[0];
      const d = expectKind(decideChunk(estart, USER, chunk(ecfg, run.actions, 0, end, { final: true }), LATE), "finish");
      expect(d.data.finish).toMatchObject({ record: "endless", outcome: { wavesCleared: 1, score: 100 + run.sim.lives } });
    });
  });
});
