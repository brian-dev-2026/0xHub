import { describe, expect, it } from "vitest";
import { secs } from "./data";
import { CHUNK_SECS, advance, outcomeOf, restoreSim, serializeSim, validateActions } from "./chunk";
import { COST_SCRIPT, STRONG, endlessCfg, play, rankedTiles, stageCfg } from "./play.testutil";
import { MAX_ACTIONS, hashSim, maxTicksFor, replay } from "./replay";
import { restoreRng, makeRng } from "./rng";
import { createSim, spawnForTest, step, type Action, type Sim } from "./sim";

// hashSim after every waveEnd, recorded before the Task 9b optimisations; they must never change.
const PINNED_STAGE = [3601999107, 1188798360, 4106379626, 179245956, 2662650875, 4217634880, 249232307, 1173117219, 2874727905, 1290134735];
const PINNED_COST = [
  3352686040, 240505946, 672427469, 3322958229, 3290635155, 911106497, 1084268685, 151215908, 4179492026, 2712223502, 1237959825, 1608248984,
  1875746316, 1328541775, 3928480562, 160022460, 397047408, 3223786170, 3100014500, 2198354000, 2689696569, 735439716, 967625006, 2988661482,
  1609215629, 3027407664, 3688419395, 3252146608, 651793006, 2166552760,
];

const win = play(stageCfg(), STRONG);
const cost = play(endlessCfg({ __noLeak: true }), COST_SCRIPT, { untilWave: 30 });

/** Restores through a JSON string, as the server stores it. */
const roundTrip = (sim: Sim): Sim => restoreSim(JSON.parse(JSON.stringify(serializeSim(sim))));

const byTick = new WeakMap<Action[], Map<number, Action[]>>();
/** The recorded actions of tick `t`. */
function at(actions: Action[], t: number): Action[] {
  let m = byTick.get(actions);
  if (!m) {
    m = new Map();
    for (const a of actions) m.set(a.t, [...(m.get(a.t) ?? []), a]);
    byTick.set(actions, m);
  }
  return m.get(t) ?? [];
}

/** Steps `sim` with the recorded actions until tick `until` (exclusive). */
function stepTo(sim: Sim, actions: Action[], until: number): void {
  while (sim.tick < until && sim.phase !== "won" && sim.phase !== "lost") step(sim, at(actions, sim.tick));
}

describe("mage siege chunks", () => {
  it("restoreRng continues the stream", () => {
    const a = makeRng(42);
    for (let i = 0; i < 5; i++) a.next();
    const b = restoreRng(a.state());
    for (let i = 0; i < 20; i++) expect(b.next()).toBe(a.next());
  });

  it("serialize round-trip keeps the hash and the future", () => {
    for (const [cfg, run, mid] of [
      [stageCfg(), win, win.waveEnds[4] + secs(20)],
      [endlessCfg({ __noLeak: true }), cost, cost.waveEnds[11] + secs(30)],
    ] as const) {
      const a = createSim(cfg);
      stepTo(a, run.actions, mid);
      expect(a.enemies.length).toBeGreaterThan(0);
      const snap = serializeSim(a);
      // Plain JSON: nothing is lost or changed by a JSON round trip.
      expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
      const b = roundTrip(a);
      expect(hashSim(b)).toBe(hashSim(a));
      const end = run.sim.tick;
      while (a.tick < end) {
        const acts = at(run.actions, a.tick);
        step(a, acts);
        step(b, acts);
        if (a.tick % 97 === 0 || a.tick === end) expect(hashSim(b)).toBe(hashSim(a));
      }
      expect(hashSim(b)).toBe(hashSim(run.sim));
    }
  });

  it("advance in per-wave chunks equals one replay", () => {
    for (const [cfg, run] of [[stageCfg(), win], [endlessCfg({ __noLeak: true }), cost]] as const) {
      let sim = createSim(cfg);
      const hashes: number[] = [];
      for (const upTo of run.waveEnds) {
        const from = sim.tick;
        const sent = JSON.parse(JSON.stringify(run.actions.filter((a) => a.t >= from && a.t < upTo)));
        const acts = validateActions(sent, from, upTo, MAX_ACTIONS);
        if (typeof acts === "string") throw new Error(acts);
        expect(advance(sim, acts, upTo)).toEqual({ ok: true });
        hashes.push(hashSim(sim));
        sim = roundTrip(sim);
      }
      expect(hashes).toEqual(run.hashes);
      expect(outcomeOf(sim)).toEqual(replay(cfg, run.actions, run.sim.tick).outcome);
    }
    expect(outcomeOf(restoreSim(serializeSim(win.sim)))).toMatchObject({ won: true, wavesCleared: 10, stars: 3 });
  });

  it("outcomeOf keeps the endless score after a loss", () => {
    const cfg = endlessCfg({ seed: 47 });
    const run = play(cfg, { buy: ["fire"], maxMages: 1, maxPurchases: 1 });
    expect(run.sim.phase).toBe("lost");
    expect(outcomeOf(run.sim)).toEqual(replay(cfg, run.actions).outcome);
    expect(outcomeOf(run.sim)).toMatchObject({ wavesCleared: 7, lives: 0, score: 704 });
  });

  it("advance rejects a chunk longer than 150 s", () => {
    const limit = secs(CHUNK_SECS);
    // Wave 0 build: a lone far-future startWave cannot be reached in one chunk; idle time costs one bounded chunk per request.
    const idle = createSim(stageCfg());
    expect(advance(idle, [{ t: limit + 5, type: "startWave" }], limit + 6)).toEqual({ ok: false, error: "chunk too long" });
    expect(advance(idle, [], limit + 1)).toEqual({ ok: false, error: "chunk too long" });
    expect(advance(idle, [], limit)).toEqual({ ok: true });
    expect(advance(idle, [{ t: limit + 5, type: "startWave" }], 2 * limit + 1)).toEqual({ ok: false, error: "chunk too long" });

    // The limit counts from the chunk start, whatever the wave boundaries.
    const sim = createSim(stageCfg());
    expect(advance(sim, [{ t: 0, type: "startWave" }], 100)).toEqual({ ok: true });
    expect(advance(sim, [], 100 + limit + 1)).toEqual({ ok: false, error: "chunk too long" });
    expect(advance(sim, [], 200)).toEqual({ ok: true });

    const bad = createSim(stageCfg());
    expect(advance(bad, [], 1.5)).toEqual({ ok: false, error: "bad chunk end" });
    stepTo(bad, [], 10);
    expect(advance(bad, [], 9)).toEqual({ ok: false, error: "bad chunk end" });

    // Never past the tick limit of the mode.
    const max = maxTicksFor(stageCfg());
    const late = restoreSim({ ...serializeSim(createSim(stageCfg())), tick: max - 10 });
    expect(advance(late, [], max + 1)).toEqual({ ok: false, error: "chunk past the tick limit" });
    expect(advance(late, [], max)).toEqual({ ok: true });

    // Nor past the end of the game.
    const end = win.sim.tick;
    const short = createSim(stageCfg());
    stepTo(short, win.actions, win.waveEnds[8]);
    const lastActs = win.actions.filter((a) => a.t >= short.tick);
    const over = restoreSim(serializeSim(short));
    expect(advance(over, lastActs, end)).toEqual({ ok: true });
    expect(over.phase).toBe("won");
    expect(advance(over, [], end)).toEqual({ ok: true });
    expect(advance(over, [], end + 1)).toEqual({ ok: false, error: "chunk runs past the end of the game" });
    expect(advance(short, lastActs, end + 30)).toEqual({ ok: false, error: "chunk runs past the end of the game" });
  });

  it("a wave stalled past 150 s verifies in several chunks", () => {
    // A sapling never moves and nothing attacks it, so wave 1 never ends.
    const cfg = stageCfg({ __noLeak: true });
    const live = createSim(cfg);
    step(live, [{ t: 0, type: "startWave" }]);
    const stall = (s: Sim) => spawnForTest(s, "sapling", 5);
    stall(live);
    const end = secs(400);
    stepTo(live, [], end);
    expect(live.phase).toBe("wave");
    expect(live.wave).toBe(1);

    let sim = createSim(cfg);
    expect(advance(sim, [{ t: 0, type: "startWave" }], 1)).toEqual({ ok: true });
    stall(sim);
    // One chunk for the whole stall is too long...
    expect(advance(restoreSim(serializeSim(sim)), [], end)).toEqual({ ok: false, error: "chunk too long" });
    // ...but the client's chunks (every 120 s of sim time) verify it.
    while (sim.tick < end) {
      expect(advance(sim, [], Math.min(end, sim.tick + secs(120)))).toEqual({ ok: true });
      sim = roundTrip(sim);
    }
    expect(hashSim(sim)).toBe(hashSim(live));
  });

  it("chunks cut at every waveEnd or every 120 s equal one replay", () => {
    for (const [cfg, run] of [[stageCfg(), win], [endlessCfg({ __noLeak: true }), cost]] as const) {
      let sim = createSim(cfg);
      const hashes: number[] = [];
      for (const waveEnd of run.waveEnds)
        while (sim.tick < waveEnd) {
          const upTo = Math.min(waveEnd, sim.tick + secs(120));
          const acts = validateActions(run.actions.filter((a) => a.t >= sim.tick && a.t < upTo), sim.tick, upTo, MAX_ACTIONS);
          if (typeof acts === "string") throw new Error(acts);
          expect(advance(sim, acts, upTo)).toEqual({ ok: true });
          if (upTo === waveEnd) hashes.push(hashSim(sim));
          sim = roundTrip(sim);
        }
      expect(hashes).toEqual(run.hashes);
    }
  });

  it("advance rejects stale or out-of-range actions", () => {
    const ok = (raw: unknown, from: number, upTo: number, max = 100) => validateActions(raw, from, upTo, max);
    expect(ok([{ t: 5, type: "startWave" }], 5, 10)).toEqual([{ t: 5, type: "startWave" }]);
    expect(ok([{ t: 4, type: "startWave" }], 5, 10)).toBe("bad action tick");
    expect(ok([{ t: 10, type: "startWave" }], 5, 10)).toBe("bad action tick");
    expect(ok([{ t: 6, type: "startWave" }, { t: 5, type: "startWave" }], 5, 10)).toBe("actions out of order");
    expect(ok([{ t: 5, type: "startWave" }, { t: 5, type: "startWave" }], 5, 10, 1)).toBe("too many actions");
    expect(ok({}, 5, 10)).toBe("actions must be an array");
    expect(ok([{ t: 5, type: "startWave", extra: 1 }], 5, 10)).toEqual([{ t: 5, type: "startWave" }]);

    const sim = createSim(stageCfg());
    const tile = rankedTiles(sim)[0];
    stepTo(sim, [], 20);
    const before = hashSim(sim);
    expect(advance(sim, [{ t: 19, type: "startWave" }], 40)).toEqual({ ok: false, error: "action outside the chunk" });
    expect(advance(sim, [{ t: 40, type: "startWave" }], 40)).toEqual({ ok: false, error: "action outside the chunk" });
    expect(advance(sim, [{ t: 30, type: "startWave" }, { t: 25, type: "startWave" }], 40)).toEqual({ ok: false, error: "action outside the chunk" });
    // Bad action lists are refused before anything is simulated.
    expect(hashSim(sim)).toBe(before);
    expect(advance(sim, [{ t: 25, type: "place", mage: "earth", tile }], 40)).toEqual({ ok: false, error: "illegal action" });
  });

  it("per-wave hash sequence is pinned", () => {
    expect(win.sim.rejected).toBe(0);
    expect(cost.sim.rejected).toBe(0);
    expect(win.hashes).toEqual(PINNED_STAGE);
    expect(cost.hashes).toEqual(PINNED_COST);
  });
});
