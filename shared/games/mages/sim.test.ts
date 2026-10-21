import { describe, expect, it } from "vitest";
import { ECON, ENEMIES, TICK_HZ, secs, type PathTerrain } from "./data";
import { pathLength } from "./map";
import { makeRng } from "./rng";
import { createSim, spawnForTest, stars, step, type Action, type Sim, type SimConfig, type SimEvent } from "./sim";
import { STAGE_WAVES, endlessWave } from "./waves";

const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  seed: 1234,
  mode: "stage",
  stage: 1,
  team: ["fire", "ice", "lightning"],
  traps: ["spike"],
  spells: ["meteor"],
  ...over,
});

/** Set every path tile's terrain (R1: generated maps always carry mud). */
const paintPath = (sim: Sim, terrain: PathTerrain): void => {
  for (const t of sim.map.path) {
    const tile = sim.map.tiles[t];
    if (tile.kind === "path") tile.terrain = terrain;
  }
};

const startWave = (sim: Sim): SimEvent[] => step(sim, [{ t: sim.tick, type: "startWave" } as Action]);

/** Run the current/next wave to its end, killing every enemy as soon as it spawns. */
const clearWave = (sim: Sim): SimEvent[] => {
  const all: SimEvent[] = [];
  let ev = sim.phase === "build" ? startWave(sim) : step(sim, []);
  for (let guard = 0; guard < 100000; guard++) {
    all.push(...ev);
    if (ev.some((e) => e.type === "waveEnd" || e.type === "end")) return all;
    for (const e of sim.enemies) e.hp = 0;
    ev = step(sim, []);
  }
  throw new Error("wave never ended");
};

describe("mage siege simulation", () => {
  it("starts in build with 120 gold and 20 lives", () => {
    const sim = createSim(cfg());
    expect(sim.phase).toBe("build");
    expect(sim.gold).toBe(120);
    expect(sim.lives).toBe(20);
    expect(sim.wave).toBe(0);
    expect(sim.tick).toBe(0);
  });

  it("stays in build without a timer before wave 1", () => {
    const sim = createSim(cfg());
    for (let i = 0; i < secs(60); i++) step(sim, []);
    expect(sim.phase).toBe("build");
    expect(sim.wave).toBe(0);
  });

  it("startWave spawns wave 1", () => {
    const sim = createSim(cfg());
    const first = step(sim, [{ t: 0, type: "startWave" }]);
    expect(first).toContainEqual({ type: "waveStart", wave: 1 });
    let spawned = first.some((e) => e.type === "spawn");
    for (let i = 0; i < secs(30) && !spawned; i++) spawned = step(sim, []).some((e) => e.type === "spawn");
    expect(spawned).toBe(true);
    expect(sim.phase).toBe("wave");
    expect(sim.wave).toBe(1);
  });

  it("rejects startWave during a wave and unimplemented actions", () => {
    const sim = createSim(cfg());
    step(sim, [{ t: 0, type: "startWave" }]);
    step(sim, [{ t: 1, type: "startWave" }, { t: 1, type: "sell", tile: 0 }]);
    expect(sim.rejected).toBe(2);
    expect(sim.wave).toBe(1);
  });

  it("goblin crosses the map", () => {
    const sim = createSim(cfg());
    paintPath(sim, "dirt");
    sim.phase = "wave";
    sim.wave = 1;
    const g = spawnForTest(sim, "goblin");
    const expected = (pathLength(sim.map) / 1.0) * TICK_HZ;
    let leakedAt = -1;
    for (let i = 1; i <= expected + 5 && leakedAt < 0; i++) {
      const ev = step(sim, []);
      if (ev.some((e) => e.type === "leak" && e.enemy === g.id)) leakedAt = i;
    }
    expect(Math.abs(leakedAt - expected)).toBeLessThanOrEqual(1);
    expect(sim.lives).toBe(19);
    expect(sim.enemies).toHaveLength(0);
  });

  it("mud slows", () => {
    const sim = createSim(cfg());
    paintPath(sim, "mud");
    sim.phase = "wave";
    const g = spawnForTest(sim, "goblin", 5);
    for (let i = 0; i < TICK_HZ; i++) step(sim, []);
    expect(g.d - 5).toBeCloseTo(0.6, 2);
  });

  it("ice speeds up", () => {
    const sim = createSim(cfg());
    paintPath(sim, "ice");
    sim.phase = "wave";
    const g = spawnForTest(sim, "goblin", 5);
    for (let i = 0; i < TICK_HZ; i++) step(sim, []);
    expect(g.d - 5).toBeCloseTo(1.3, 2);
  });

  it("flyers ignore mud", () => {
    const sim = createSim(cfg());
    paintPath(sim, "mud");
    sim.phase = "wave";
    const b = spawnForTest(sim, "bat", 5);
    for (let i = 0; i < TICK_HZ; i++) step(sim, []);
    expect(b.d - 5).toBeCloseTo(1.3, 2);
  });

  it("HP scaling", () => {
    const sim = createSim(cfg({ stage: 3 }));
    sim.wave = 4;
    const g = spawnForTest(sim, "goblin");
    expect(g.hp).toBeCloseTo(40 * 1.35 ** 2 * 1.1 ** 3, 2);
    expect(g.maxHp).toBe(g.hp);
  });

  it("endless HP scaling ignores the stage", () => {
    const sim = createSim(cfg({ mode: "endless", stage: 5 }));
    sim.wave = 6;
    expect(spawnForTest(sim, "goblin").hp).toBeCloseTo(40 * 1.12 ** 5, 2);
  });

  it("wave end pays bonus and opens a 12 s break", () => {
    const sim = createSim(cfg());
    const ev = clearWave(sim);
    const killGold = ev.reduce((s, e) => s + (e.type === "kill" ? e.gold : 0), 0);
    expect(killGold).toBeGreaterThan(0);
    expect(ev).toContainEqual({ type: "waveEnd", wave: 1, bonus: ECON.waveBonus(1) });
    expect(sim.gold).toBe(120 + killGold + 25);
    expect(sim.phase).toBe("build");
    expect(sim.breakT).toBe(secs(12));
    for (let i = 0; i < secs(12) - 1; i++) expect(step(sim, []).some((e) => e.type === "waveStart")).toBe(false);
    expect(step(sim, [])).toContainEqual({ type: "waveStart", wave: 2 });
    expect(sim.phase).toBe("wave");
  });

  it("startWave skips the build break", () => {
    const sim = createSim(cfg());
    clearWave(sim);
    expect(startWave(sim)).toContainEqual({ type: "waveStart", wave: 2 });
  });

  it("lives reaching 0 loses", () => {
    const sim = createSim(cfg());
    sim.phase = "wave";
    sim.lives = 1;
    spawnForTest(sim, "goblin", pathLength(sim.map) - 0.01);
    const ev = step(sim, []);
    expect(ev).toContainEqual({ type: "end", won: false });
    expect(sim.lives).toBe(0);
    expect(sim.phase).toBe("lost");
    expect(stars(sim)).toBe(0);
    const tick = sim.tick;
    expect(step(sim, [])).toEqual([]);
    expect(sim.tick).toBe(tick);
  });

  it("leaking a mini-boss costs 5", () => {
    const sim = createSim(cfg());
    sim.phase = "wave";
    const b = spawnForTest(sim, "goblinChief", pathLength(sim.map) - 0.01);
    expect(step(sim, [])).toContainEqual({ type: "leak", enemy: b.id, lives: 5 });
    expect(sim.lives).toBe(15);
  });

  it("leaking the treant costs every life", () => {
    const sim = createSim(cfg({ stage: 5 }));
    sim.phase = "wave";
    spawnForTest(sim, "treant", pathLength(sim.map) - 0.001);
    step(sim, []);
    expect(sim.lives).toBe(0);
    expect(sim.phase).toBe("lost");
  });

  it("clearing wave 10 wins", () => {
    for (const [lives, want] of [[20, 3], [12, 2], [3, 1]] as const) {
      const sim = createSim(cfg());
      for (let w = 1; w <= 9; w++) clearWave(sim);
      expect(sim.phase).toBe("build");
      expect(sim.wave).toBe(9);
      sim.lives = lives;
      startWave(sim);
      // The mini-boss wave, plus an extra test-spawned enemy, all killed directly.
      spawnForTest(sim, "goblin");
      const ev = clearWave(sim);
      expect(ev).toContainEqual({ type: "end", won: true });
      expect(sim.phase).toBe("won");
      expect(stars(sim)).toBe(want);
    }
  });

  it("is deterministic", () => {
    const run = (): string => {
      const sim = createSim(cfg({ mode: "endless" }));
      for (let w = 0; w < 12; w++) clearWave(sim);
      return JSON.stringify({ t: sim.tick, g: sim.gold, w: sim.wave, k: sim.kills, r: sim.rng.state() });
    };
    expect(run()).toBe(run());
  });
});

describe("mage siege waves", () => {
  it("every stage has 10 waves with its boss in wave 10", () => {
    const bosses = { 1: "goblinChief", 2: "direWolf", 3: "troll", 4: "witch", 5: "treant" } as const;
    for (const s of [1, 2, 3, 4, 5] as const) {
      expect(STAGE_WAVES[s]).toHaveLength(10);
      expect(STAGE_WAVES[s][9].some((g) => g.kind === bosses[s])).toBe(true);
      for (const wave of STAGE_WAVES[s].slice(0, 9)) expect(wave.every((g) => ENEMIES[g.kind].boss === null)).toBe(true);
      for (const wave of STAGE_WAVES[s]) for (const g of wave) expect(g.count).toBeGreaterThan(0);
    }
  });

  it("stages introduce enemies in order", () => {
    const kinds = (s: 1 | 2 | 3 | 4 | 5) => new Set(STAGE_WAVES[s].flat().map((g) => g.kind));
    expect([...kinds(1)].sort()).toEqual(["goblin", "goblinChief", "wolf"]);
    expect(kinds(2).has("bat")).toBe(true);
    expect(kinds(2).has("brute")).toBe(false);
    expect(kinds(3).has("brute")).toBe(true);
    expect(kinds(3).has("shaman")).toBe(false);
    expect(kinds(4).has("shaman") && kinds(4).has("knight")).toBe(true);
    for (const k of ["goblin", "wolf", "bat", "brute", "shaman", "knight", "treant"] as const) expect(kinds(5).has(k)).toBe(true);
  });

  it("endless waves have bosses every 10th", () => {
    const rng = makeRng(5);
    expect(endlessWave(10, rng).some((g) => g.kind === "goblinChief")).toBe(true);
    expect(endlessWave(20, rng).some((g) => g.kind === "direWolf")).toBe(true);
    expect(endlessWave(50, rng).some((g) => g.kind === "treant")).toBe(true);
    expect(endlessWave(60, rng).some((g) => g.kind === "goblinChief")).toBe(true);
    for (const w of [1, 9, 11, 49]) expect(endlessWave(w, rng).every((g) => ENEMIES[g.kind].boss === null)).toBe(true);
  });

  it("endless mix widens with the wave", () => {
    const rng = makeRng(8);
    const seen = (from: number, to: number) => {
      const s = new Set<string>();
      for (let w = from; w <= to; w++) for (const g of endlessWave(w, rng)) s.add(g.kind);
      return s;
    };
    expect(seen(1, 3).has("knight")).toBe(false);
    expect(seen(30, 60).has("knight")).toBe(true);
  });
});
