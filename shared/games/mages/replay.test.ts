import { describe, expect, it } from "vitest";
import { COST_SCRIPT, STRONG, endlessCfg, play as playScript, rankedTiles, stageCfg } from "./play.testutil";
import { hashSim, replay, verifyRun } from "./replay";
import { createSim, type Action, type SimConfig } from "./sim";

/** Plays live and checks the script never made an illegal move. */
function play(...args: Parameters<typeof playScript>): ReturnType<typeof playScript> {
  const run = playScript(...args);
  expect(run.sim.rejected).toBe(0);
  return run;
}

/** Every wave-end hash of a replay. */
function replayHashes(cfg: SimConfig, actions: Action[]): number[] {
  const hashes: number[] = [];
  replay(cfg, actions, undefined, (sim, ev) => {
    if (ev.some((e) => e.type === "waveEnd")) hashes.push(hashSim(sim));
  });
  return hashes;
}

describe("mage siege replay", () => {
  const win = play(stageCfg(), STRONG);

  it("replay is deterministic", () => {
    const kinds = new Set(win.actions.map((a) => a.type));
    for (const k of ["place", "merge", "cast", "trap", "spell", "startWave"]) expect(kinds).toContain(k);
    expect(win.hashes).toHaveLength(10);
    const a = replayHashes(stageCfg(), win.actions);
    const b = replayHashes(stageCfg(), win.actions);
    expect(a).toEqual(win.hashes);
    expect(b).toEqual(a);
  });

  it("hashSim changes with the state", () => {
    const sim = createSim(stageCfg());
    const h = hashSim(sim);
    expect(hashSim(createSim(stageCfg()))).toBe(h);
    sim.gold++;
    expect(hashSim(sim)).not.toBe(h);
  });

  it("different seed different result", () => {
    const other = replay(stageCfg({ seed: 4321 }), win.actions);
    const same = replay(stageCfg(), win.actions);
    if (other.rejected === 0) {
      const ha: number[] = [];
      replay(stageCfg({ seed: 4321 }), win.actions, undefined, (sim, ev) => {
        if (ev.some((e) => e.type === "end")) ha.push(hashSim(sim));
      });
      expect(ha[0]).not.toBe(win.hashes[win.hashes.length - 1]);
    } else expect(other.rejected).toBeGreaterThan(0);
    expect(same.rejected).toBe(0);
  });

  it("scripted run wins stage 1 with 3 stars", () => {
    expect(win.sim.phase).toBe("won");
    const r = replay(stageCfg(), win.actions);
    expect(r.finished).toBe(true);
    expect(r.rejected).toBe(0);
    expect(r.outcome).toMatchObject({ won: true, wavesCleared: 10, stars: 3, score: 0, lives: win.sim.lives, ticks: win.sim.tick });
  });

  it("verifyRun accepts the scripted win", () => {
    const v = verifyRun(stageCfg(), JSON.parse(JSON.stringify(win.actions)));
    expect(v).toEqual({ ok: true, outcome: replay(stageCfg(), win.actions).outcome });
  });

  describe("verifyRun rejects", () => {
    const sim = createSim(stageCfg());
    const ranked = rankedTiles(sim);
    const pathTile = sim.map.path[5];
    const bad = (error: string, actions: unknown, cfg = stageCfg()) => {
      expect(verifyRun(cfg, actions)).toEqual({ ok: false, error });
    };

    it("non-arrays and malformed actions", () => {
      bad("actions must be an array", null);
      bad("actions must be an array", { length: 0 });
      bad("actions must be an array", "[]");
      bad("action is not an object", [null]);
      bad("action is not an object", [[]]);
      bad("unknown action type", [{ t: 0, type: "dance" }]);
      bad("bad action tick", [{ t: 0.5, type: "startWave" }]);
      bad("bad action tick", [{ t: -1, type: "startWave" }]);
      bad("bad action tick", [{ t: "0", type: "startWave" }]);
      bad("bad place action", [{ t: 0, type: "place", mage: "fire", tile: 144 }]);
      bad("bad place action", [{ t: 0, type: "place", mage: "fire", tile: 1.5 }]);
      bad("bad place action", [{ t: 0, type: "place", mage: "dragon", tile: ranked[0] }]);
      bad("bad merge action", [{ t: 0, type: "merge", from: 1 }]);
      bad("bad cast action", [{ t: 0, type: "cast", tile: 1, target: -1 }]);
      bad("bad trap action", [{ t: 0, type: "trap", trap: "tar", tile: pathTile }]);
      bad("bad spell action", [{ t: 0, type: "spell", spell: "nuke" }]);
    });

    it("unsorted t", () => {
      bad("actions out of order", [...win.actions.slice(0, 5), { t: 0, type: "startWave" }, ...win.actions.slice(5)]);
    });

    it("20,001 actions", () => {
      bad("too many actions", Array.from({ length: 20_001 }, () => ({ t: 0, type: "startWave" })));
    });

    it("merging mismatched mages", () => {
      bad("illegal action", [
        { t: 0, type: "place", mage: "fire", tile: ranked[0] },
        { t: 0, type: "place", mage: "ice", tile: ranked[1] },
        { t: 1, type: "merge", from: ranked[0], to: ranked[1] },
        { t: 2, type: "startWave" },
      ]);
    });

    it("placing a mage not in the team", () => {
      bad("illegal action", [{ t: 0, type: "place", mage: "earth", tile: ranked[0] }, { t: 1, type: "startWave" }]);
    });

    it("casting an uncharged skill", () => {
      bad("illegal action", [{ t: 0, type: "place", mage: "fire", tile: ranked[0] }, { t: 1, type: "cast", tile: ranked[0], target: pathTile }, { t: 2, type: "startWave" }]);
    });

    it("actions after the game ended", () => {
      bad("illegal action", [...win.actions, { t: win.sim.tick + 10, type: "startWave" }]);
    });

    it("an unfinished game", () => {
      // Wave 1 never starts, so the game never ends.
      bad("game did not finish", []);
      bad("game did not finish", [{ t: 0, type: "place", mage: "fire", tile: ranked[0] }]);
    });

    it("a test-only config", () => {
      bad("test-only config", win.actions, stageCfg({ __noLeak: true }));
      bad("test-only config", win.actions, stageCfg({ __noLeak: false }));
      bad("test-only config", win.actions, stageCfg({ __noLeak: undefined }));
    });
  });

  it("endless score", () => {
    // One fire mage on seed 47 clears 7 waves with 4 lives left after wave 7, then loses wave 8.
    const cfg = endlessCfg({ seed: 47 });
    const run = play(cfg, { buy: ["fire"], maxMages: 1, maxPurchases: 1 });
    expect(run.sim.phase).toBe("lost");
    const v = verifyRun(cfg, run.actions);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.outcome).toMatchObject({ won: false, wavesCleared: 7, lives: 0, stars: 0, score: 704 });
  });

  // Slow: run with MAGES_COST=1 npx vitest run shared/games/mages/replay.test.ts -t "replay cost" --silent=false
  it.skipIf(!process.env.MAGES_COST)("endless replay cost", { timeout: 120_000 }, () => {
    const cfg = endlessCfg({ __noLeak: true });
    const run = play(cfg, COST_SCRIPT, { untilWave: 100 });
    expect(run.sim.wave).toBe(100);
    const waveEndTicks: number[] = [];
    const t0 = performance.now();
    const r = replay(cfg, run.actions, run.sim.tick, (sim, ev) => {
      if (ev.some((e) => e.type === "waveEnd")) waveEndTicks.push(performance.now() - t0);
    });
    const ms = performance.now() - t0;
    expect(r.rejected).toBe(0);
    expect(r.outcome.wavesCleared).toBe(100);
    // Later waves are at the size cap, so extrapolate with the cost of waves 51-100.
    const late = ms - waveEndTicks[49];
    // One chunk (a wave and the break before it) is what the server pays per request.
    const perWave = waveEndTicks.map((t, i) => t - (i > 0 ? waveEndTicks[i - 1] : 0));
    const worst = perWave.indexOf(Math.max(...perWave));
    const ticks = run.waveEnds.map((t, i) => t - (i > 0 ? run.waveEnds[i - 1] : 0));
    console.log(`endless 100-wave replay: ${ms.toFixed(0)} ms (${run.sim.tick} ticks); waves 51-100: ${late.toFixed(0)} ms; 300 waves ≈ ${(ms + 4 * late).toFixed(0)} ms; slowest wave: ${perWave[worst].toFixed(1)} ms (wave ${worst + 1}); longest wave: ${Math.max(...ticks)} ticks`);
  });
});
