import { describe, expect, it } from "vitest";
import { ECON, ENEMIES, MAGES, type MageId } from "./data";
import { combatTick, damage, mageStats, magePrice } from "./combat";
import { pathPoint } from "./map";
import { applyAction, createSim, spawnForTest, step, type Action, type Sim, type SimConfig, type SimEvent } from "./sim";

const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  seed: 1234, mode: "stage", stage: 1, team: ["fire", "ice", "lightning"], traps: ["spike"], spells: ["meteor"], ...over,
});

const act = (sim: Sim, a: Record<string, unknown>): Action => ({ t: sim.tick, ...a }) as Action;
const buildTiles = (sim: Sim): number[] => sim.map.tiles.flatMap((t, i) => (t.kind === "build" && t.terrain !== "blocked" ? [i] : []));
const setTerrain = (sim: Sim, i: number, terrain: string): void => {
  (sim.map.tiles[i] as { terrain: string }).terrain = terrain;
};
const place = (sim: Sim, mage: MageId, tile: number): void => {
  step(sim, [act(sim, { type: "place", mage, tile })]);
};
const mageAt = (sim: Sim, tile: number) => sim.mages.find((m) => m.tile === tile)!;

describe("buying and placing", () => {
  it("place costs 50 then 60", () => {
    const sim = createSim(cfg());
    const [a, b] = buildTiles(sim);
    expect(magePrice(sim)).toBe(50);
    place(sim, "fire", a);
    expect(magePrice(sim)).toBe(60);
    place(sim, "ice", b);
    expect(sim.gold).toBe(120 - 50 - 60);
    expect(sim.mages.length).toBe(2);
    expect(sim.rejected).toBe(0);
  });

  it("place rejects path, blocked, occupied, unaffordable, not-in-team tiles or mages", () => {
    const rejects = (sim: Sim, a: Record<string, unknown>): void => {
      const before = JSON.stringify(sim);
      expect(applyAction(sim, act(sim, a), [])).toBe(false);
      expect(JSON.stringify(sim)).toBe(before);
      const rej = sim.rejected;
      step(sim, [act(sim, a)]);
      expect(sim.rejected).toBe(rej + 1);
    };
    {
      const sim = createSim(cfg());
      rejects(sim, { type: "place", mage: "fire", tile: sim.map.path[3] });
    }
    {
      const sim = createSim(cfg());
      const free = buildTiles(sim);
      setTerrain(sim, free[0], "blocked");
      rejects(sim, { type: "place", mage: "fire", tile: free[0] });
    }
    {
      const sim = createSim(cfg());
      const free = buildTiles(sim);
      place(sim, "fire", free[1]);
      rejects(sim, { type: "place", mage: "ice", tile: free[1] });
    }
    {
      const sim = createSim(cfg());
      const free = buildTiles(sim);
      sim.gold = 49;
      rejects(sim, { type: "place", mage: "fire", tile: free[1] });
    }
    {
      const sim = createSim(cfg());
      const free = buildTiles(sim);
      rejects(sim, { type: "place", mage: "earth", tile: free[1] });
    }
  });

  it("rejected actions leave state unchanged", () => {
    const sim = createSim(cfg());
    sim.gold = 1000;
    const [a, b, c] = buildTiles(sim);
    place(sim, "fire", a);
    place(sim, "ice", b);
    const snap = (): string => JSON.stringify({ mages: sim.mages, gold: sim.gold, purchases: sim.purchases });
    const before = snap();
    const ev: SimEvent[] = [];
    expect(applyAction(sim, act(sim, { type: "merge", from: a, to: b }), ev)).toBe(false);
    expect(applyAction(sim, act(sim, { type: "move", from: a, to: b }), ev)).toBe(false);
    expect(applyAction(sim, act(sim, { type: "move", from: c, to: a }), ev)).toBe(false);
    expect(snap()).toBe(before);
    expect(ev).toEqual([]);
  });
});

describe("merge, move, sell", () => {
  it("merge: two fire L1 become one fire L2 on the to tile", () => {
    const sim = createSim(cfg());
    const [a, b] = buildTiles(sim);
    place(sim, "fire", a);
    place(sim, "fire", b);
    const ev = step(sim, [act(sim, { type: "merge", from: a, to: b })]);
    expect(sim.mages.length).toBe(1);
    const m = mageAt(sim, b);
    expect(m.level).toBe(2);
    expect(m.spent).toBe(110);
    expect(ev).toContainEqual({ type: "merge", mage: m.id, level: 2 });
    expect(sim.rejected).toBe(0);
  });

  it("merge rejects unequal levels and L5 onto L5", () => {
    const sim = createSim(cfg());
    sim.gold = 10000;
    const [a, b, c] = buildTiles(sim);
    place(sim, "fire", a);
    place(sim, "fire", b);
    place(sim, "fire", c);
    step(sim, [act(sim, { type: "merge", from: a, to: b })]);
    step(sim, [act(sim, { type: "merge", from: c, to: b })]);
    expect(sim.rejected).toBe(1);
    expect(mageAt(sim, b).level).toBe(2);
    mageAt(sim, b).level = 5;
    mageAt(sim, c).level = 5;
    step(sim, [act(sim, { type: "merge", from: c, to: b })]);
    expect(sim.rejected).toBe(2);
    expect(sim.mages.length).toBe(2);
  });

  it("move to an empty buildable tile keeps level and charge", () => {
    const sim = createSim(cfg());
    const [a, b] = buildTiles(sim);
    place(sim, "fire", a);
    const m = mageAt(sim, a);
    m.level = 3;
    m.charge = 0.4;
    step(sim, [act(sim, { type: "move", from: a, to: b })]);
    expect(m.tile).toBe(b);
    expect(m.level).toBe(3);
    expect(m.charge).toBeCloseTo(0.4, 1); // plus this tick's charging
    expect(sim.rejected).toBe(0);
  });

  it("sell refunds half of spent", () => {
    const sim = createSim(cfg());
    const [a, b] = buildTiles(sim);
    place(sim, "fire", a);
    place(sim, "fire", b);
    step(sim, [act(sim, { type: "merge", from: a, to: b })]);
    const gold = sim.gold;
    const ev = step(sim, [act(sim, { type: "sell", tile: b })]);
    expect(sim.gold).toBe(gold + 55);
    expect(sim.mages.length).toBe(0);
    expect(ev).toContainEqual({ type: "sell", tile: b, refund: 55 });
    step(sim, [act(sim, { type: "sell", tile: b })]);
    expect(sim.rejected).toBe(1);
  });
});

describe("mage stats", () => {
  const setup = (kind: MageId, terrain: string, level: 1 | 2 | 3 | 4 | 5 = 1) => {
    const sim = createSim(cfg({ team: [kind] }));
    const [a] = buildTiles(sim);
    setTerrain(sim, a, terrain);
    place(sim, kind, a);
    const m = mageAt(sim, a);
    m.level = level;
    return { sim, m };
  };

  it("level scaling", () => {
    const { sim, m } = setup("fire", "grass", 3);
    const s = mageStats(sim, m);
    expect(s.dmg).toBeCloseTo(14 * 1.8 * 1.8, 9);
    expect(s.aps).toBeCloseTo(1.0 * (1 + 0.08 * 2), 9);
    expect(s.range).toBeCloseTo(2.6 * (1 + 0.05 * 2), 9);
  });

  it("terrain", () => {
    const base = setup("fire", "grass");
    const lava = setup("fire", "lava");
    expect(mageStats(lava.sim, lava.m).dmg).toBeCloseTo(mageStats(base.sim, base.m).dmg * 1.3, 9);
    const hill = setup("fire", "hill");
    expect(mageStats(hill.sim, hill.m).range).toBeCloseTo(2.6 * 1.25, 9);
    const well = setup("fire", "well");
    expect(mageStats(well.sim, well.m).chargeRate).toBeCloseTo(mageStats(base.sim, base.m).chargeRate * 1.35, 9);
    const crystal = setup("fire", "crystal");
    expect(mageStats(crystal.sim, crystal.m).chargeRate).toBeCloseTo(mageStats(base.sim, base.m).chargeRate * 1.2, 9);
    expect(mageStats(base.sim, base.m).dmg).toBe(14);
  });
});

describe("combat", () => {
  /** A mage of `kind` on the buildable tile nearest path point 6. */
  const arena = (kind: MageId) => {
    const sim = createSim(cfg({ team: [kind] }));
    const target = pathPoint(sim.map, 6);
    const dist = (i: number): number => ((i % 16) + 0.5 - target.x) ** 2 + (Math.floor(i / 16) + 0.5 - target.y) ** 2;
    const tile = buildTiles(sim).sort((p, q) => dist(p) - dist(q))[0];
    setTerrain(sim, tile, "grass");
    place(sim, kind, tile);
    return { sim, m: mageAt(sim, tile) };
  };

  it("attacks the frontmost enemy in range", () => {
    const { sim } = arena("fire");
    const back = spawnForTest(sim, "sapling", 6.3);
    const front = spawnForTest(sim, "sapling", 6.5);
    const far = spawnForTest(sim, "sapling", 30);
    const ev: SimEvent[] = [];
    combatTick(sim, ev);
    expect(ev.filter((e) => e.type === "attack")).toEqual([{ type: "attack", mage: sim.mages[0].id, enemy: front.id }]);
    expect(front.hp).toBeLessThan(front.maxHp);
    expect(far.hp).toBe(far.maxHp);
    expect(back.hp).toBeLessThan(back.maxHp); // within fire's splash of the target
  });

  it("respects attack speed", () => {
    const { sim } = arena("earth");
    spawnForTest(sim, "sapling", 6);
    const attacks: number[] = [];
    for (let i = 0; i < 120; i++) {
      for (const e of step(sim, [])) if (e.type === "attack") attacks.push(i);
    }
    expect(attacks).toEqual([0, 60]);
  });

  it("lightning deals +25% to flyers", () => {
    const { sim } = arena("lightning");
    const bat = spawnForTest(sim, "bat", 6);
    combatTick(sim, []);
    expect(bat.maxHp - bat.hp).toBeCloseTo(11 * 1.25, 9);
  });

  it("armor floors at 1", () => {
    const sim = createSim(cfg());
    const knight = spawnForTest(sim, "knight", 3);
    const hp = knight.hp;
    damage(sim, knight, 3, null, []);
    expect(knight.hp).toBe(hp - 1);
    expect(ENEMIES.knight.armor).toBe(8);
  });

  it("frozen takes +50% only with shatter; shielded takes half", () => {
    const sim = createSim(cfg());
    const e = spawnForTest(sim, "goblin", 3);
    e.status.freezeT = 10;
    damage(sim, e, 10, null, []);
    expect(e.hp).toBe(40 - 10);
    sim.shatter = true;
    damage(sim, e, 10, null, []);
    expect(e.hp).toBe(30 - 15);
    e.status.freezeT = 0;
    e.status.shieldT = 10;
    damage(sim, e, 10, null, []);
    expect(e.hp).toBe(15 - 5);
  });

  it("a kill pays once, credits the mage, and leaves the list", () => {
    const { sim, m } = arena("fire");
    const g = spawnForTest(sim, "goblin", 6);
    g.hp = 1;
    const gold = sim.gold;
    const ev = step(sim, []);
    expect(ev.filter((e) => e.type === "kill")).toEqual([{ type: "kill", enemy: g.id, by: m.id, gold: 4 }]);
    expect(sim.gold).toBe(gold + 4);
    expect(sim.kills).toBe(1);
    expect(sim.enemies.length).toBe(0);
  });

  it("ruins gold: a kill by a mage on ruins gives floor(gold x 1.5)", () => {
    const { sim, m } = arena("fire");
    setTerrain(sim, m.tile, "ruins");
    const b = spawnForTest(sim, "bat", 6);
    b.hp = 1;
    const gold = sim.gold;
    damage(sim, b, 50, m, []);
    expect(sim.gold).toBe(gold + Math.floor(6 * 1.5));
    expect(MAGES.fire.dmg).toBe(14);
    expect(ECON.sellRate).toBe(0.5);
  });
});
