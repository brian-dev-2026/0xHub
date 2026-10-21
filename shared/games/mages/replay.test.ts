import { describe, expect, it } from "vitest";
import { MAGES, SPELLS, TRAPS, W, type MageId, type TrapId } from "./data";
import { magePrice } from "./combat";
import { hashSim, replay, verifyRun } from "./replay";
import { createSim, step, type Action, type Sim, type SimConfig } from "./sim";

const stageCfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  seed: 1234,
  mode: "stage",
  stage: 1,
  team: ["fire", "ice", "lightning"],
  traps: ["spike"],
  spells: ["meteor"],
  ...over,
});

const endlessCfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  seed: 99,
  mode: "endless",
  stage: 1,
  team: ["fire", "ice", "lightning", "earth", "poison"],
  traps: ["spike", "barricade", "frost", "mine"],
  spells: ["meteor", "freeze", "surge"],
  ...over,
});

interface Script {
  /** Mages to buy, in a repeating cycle. */
  buy: MageId[];
  /** Most mages on the board at once. */
  maxMages: number;
  /** Trap kind and how many to keep on the path. */
  trap?: TrapId;
  maxTraps?: number;
  /** Traps come before mage purchases from this wave on. */
  trapFrom?: number;
  meteor?: boolean;
  /** Stop buying after this many purchases. */
  maxPurchases?: number;
}

/** Buildable tiles ranked by how many path tiles lie within 2.5 tiles (best first, ties by index). */
function rankedTiles(sim: Sim): number[] {
  const near = (t: number): number =>
    sim.map.path.filter((p) => {
      const dx = (p % W) - (t % W);
      const dy = Math.floor(p / W) - Math.floor(t / W);
      return dx * dx + dy * dy <= 6.25;
    }).length;
  return sim.map.tiles
    .map((tile, i) => ({ i, ok: tile.kind === "build" && tile.terrain !== "blocked", n: near(i) }))
    .filter((x) => x.ok)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.i);
}

/** Path tile under the enemy furthest along, or null when the board is empty. */
function leadTile(sim: Sim): number | null {
  let best = -1;
  for (const e of sim.enemies) if (e.hp > 0 && e.d > best) best = e.d;
  if (best < 0) return null;
  return sim.map.path[Math.min(sim.map.path.length - 1, Math.floor(best + 0.5))];
}

/**
 * A scripted player: observes the sim and returns this tick's actions. Casts
 * charged actives at the lead enemy, then makes at most one gold or board move
 * (merge, buy, trap, meteor), and starts the next wave as soon as it can.
 */
function policy(s: Script): (sim: Sim, ranked: number[]) => Action[] {
  return (sim, ranked) => {
    const t = sim.tick;
    const out: Action[] = [];
    const lead = leadTile(sim);
    if (lead !== null)
      for (const m of sim.mages)
        if (m.charge >= 1 && m.stunT === 0) out.push(MAGES[m.kind].activeTargeted ? { t, type: "cast", tile: m.tile, target: lead } : { t, type: "cast", tile: m.tile });

    const rank = (tile: number): number => ranked.indexOf(tile);
    let move: Action | null = null;
    for (const a of sim.mages) {
      if (move) break;
      for (const b of sim.mages)
        if (a !== b && a.kind === b.kind && a.level === b.level && a.level < 5 && a.stunT === 0 && b.stunT === 0 && rank(a.tile) > rank(b.tile)) {
          move = { t, type: "merge", from: a.tile, to: b.tile };
          break;
        }
    }
    if (!move && s.trap && sim.wave >= (s.trapFrom ?? 0) && sim.traps.length < (s.maxTraps ?? 0) && sim.gold >= TRAPS[s.trap].price) {
      const spot = sim.map.path.slice(4).find((p) => !sim.traps.some((x) => x.tile === p));
      if (spot !== undefined) move = { t, type: "trap", trap: s.trap, tile: spot };
    }
    const free = ranked.find((tile) => !sim.mages.some((m) => m.tile === tile));
    if (!move && free !== undefined && sim.mages.length < s.maxMages && sim.purchases < (s.maxPurchases ?? Infinity) && sim.gold >= magePrice(sim))
      move = { t, type: "place", mage: s.buy[sim.purchases % s.buy.length], tile: free };
    if (!move && s.meteor && lead !== null && sim.enemies.length >= 4 && sim.spellCd.meteor === 0 && sim.gold >= SPELLS.meteor.cost)
      move = { t, type: "spell", spell: "meteor", target: lead };
    if (move) out.push(move);
    if (sim.phase === "build") out.push({ t, type: "startWave" });
    return out;
  };
}

/** Plays `cfg` live with a script, recording every action, until the game ends or `untilWave` is cleared. */
function play(cfg: SimConfig, s: Script, opts: { maxTicks?: number; untilWave?: number } = {}): { actions: Action[]; sim: Sim; hashes: number[] } {
  const sim = createSim(cfg);
  const ranked = rankedTiles(sim);
  const decide = policy(s);
  const actions: Action[] = [];
  const hashes: number[] = [];
  const max = opts.maxTicks ?? 2_000_000;
  while (sim.phase !== "won" && sim.phase !== "lost" && sim.tick < max) {
    if (opts.untilWave !== undefined && sim.phase === "build" && sim.wave >= opts.untilWave) break;
    const acts = opts.untilWave !== undefined && sim.wave >= opts.untilWave ? [] : decide(sim, ranked);
    actions.push(...acts);
    const ev = step(sim, acts);
    if (ev.some((e) => e.type === "waveEnd")) hashes.push(hashSim(sim));
  }
  expect(sim.rejected).toBe(0);
  return { actions, sim, hashes };
}

const STRONG: Script = { buy: ["fire"], maxMages: 8, trap: "spike", maxTraps: 3, trapFrom: 3, meteor: true };

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

  // Slow (about 15 s): run with MAGES_COST=1 npx vitest run shared/games/mages/replay.test.ts -t "replay cost"
  it.skipIf(!process.env.MAGES_COST)("endless replay cost", { timeout: 120_000 }, () => {
    const cfg = endlessCfg({ __noLeak: true });
    const run = play(cfg, { buy: ["fire", "lightning", "ice", "earth", "poison"], maxMages: 15, trap: "spike", maxTraps: 6, meteor: true }, { untilWave: 100 });
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
    console.log(`endless 100-wave replay: ${ms.toFixed(0)} ms (${run.sim.tick} ticks); waves 51-100: ${late.toFixed(0)} ms; 300 waves ≈ ${(ms + 4 * late).toFixed(0)} ms`);
  });
});
