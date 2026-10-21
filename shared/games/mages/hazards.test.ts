import { describe, expect, it } from "vitest";
import { SPELLS, TRAPS, secs, type SpellId, type TrapId } from "./data";
import { applyAction, createSim, spawnForTest, step, type Enemy, type Mage, type Sim, type SimEvent } from "./sim";

const ALL_TRAPS: TrapId[] = ["spike", "barricade", "frost", "mine"];
const ALL_SPELLS: SpellId[] = ["meteor", "freeze", "surge"];

/** A sim with every trap and spell, lots of gold, and plain dirt on the whole path. */
function mk(opts: { stage?: 1 | 2 | 3 | 4 | 5; traps?: TrapId[]; spells?: SpellId[] } = {}): Sim {
  const sim = createSim({
    seed: 3, mode: "stage", stage: opts.stage ?? 1, team: ["fire"], traps: opts.traps ?? ALL_TRAPS, spells: opts.spells ?? ALL_SPELLS,
  });
  sim.gold = 100000;
  for (const i of sim.map.path) (sim.map.tiles[i] as { terrain: string }).terrain = "dirt";
  return sim;
}

const tileOf = (sim: Sim, order: number): number => sim.map.path[order];
const foe = (sim: Sim, kind: "goblin" | "brute" | "bat" | "goblinChief", d: number, hp = 1e6): Enemy => {
  const e = spawnForTest(sim, kind, d);
  e.hp = e.maxHp = hp;
  return e;
};
const placeTrap = (sim: Sim, kind: TrapId, order: number, ev: SimEvent[] = []): boolean =>
  applyAction(sim, { t: sim.tick, type: "trap", trap: kind, tile: tileOf(sim, order) }, ev);
const spell = (sim: Sim, kind: SpellId, target?: number, ev: SimEvent[] = []): boolean =>
  applyAction(sim, { t: sim.tick, type: "spell", spell: kind, target }, ev);
const run = (sim: Sim, ticks: number): SimEvent[] => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) ev.push(...step(sim, []));
  return ev;
};
/** Asserts that `f` is rejected and leaves the whole sim state untouched. */
function rejects(sim: Sim, f: () => boolean): void {
  const before = JSON.stringify(sim);
  expect(f()).toBe(false);
  expect(JSON.stringify(sim)).toBe(before);
}

describe("traps", () => {
  it("trap only on empty path tiles", () => {
    const sim = mk();
    const build = sim.map.tiles.findIndex((t) => t.kind === "build");
    rejects(sim, () => applyAction(sim, { t: 0, type: "trap", trap: "spike", tile: build }, []));
    rejects(sim, () => applyAction(sim, { t: 0, type: "trap", trap: "spike", tile: -1 }, []));
    rejects(sim, () => applyAction(sim, { t: 0, type: "trap", trap: "spike", tile: 1.5 }, []));
    const ev: SimEvent[] = [];
    const gold = sim.gold;
    expect(placeTrap(sim, "spike", 5, ev)).toBe(true);
    expect(sim.gold).toBe(gold - TRAPS.spike.price);
    expect(sim.traps).toHaveLength(1);
    expect(sim.traps[0]).toMatchObject({ kind: "spike", tile: tileOf(sim, 5), dur: TRAPS.spike.durability });
    expect(ev).toEqual([{ type: "trapPlace", trap: sim.traps[0].id }]);
    rejects(sim, () => placeTrap(sim, "barricade", 5));
  });

  it("max 6 traps", () => {
    const sim = mk();
    for (let i = 0; i < 6; i++) expect(placeTrap(sim, "spike", 3 + i)).toBe(true);
    rejects(sim, () => placeTrap(sim, "spike", 12));
  });

  it("locked trap rejected", () => {
    const sim = mk({ traps: ["spike"] });
    rejects(sim, () => placeTrap(sim, "barricade", 5));
  });

  it("trap needs gold", () => {
    const sim = mk();
    sim.gold = TRAPS.spike.price - 1;
    rejects(sim, () => placeTrap(sim, "spike", 5));
  });

  it("spike damage and durability", () => {
    const sim = mk({ stage: 3 });
    placeTrap(sim, "spike", 6);
    const e = foe(sim, "goblin", 5.4);
    const ev = run(sim, 40);
    expect(e.maxHp - e.hp).toBeCloseTo(20 * 1.25 * 1.25, 6);
    expect(sim.traps[0].dur).toBe(29);
    expect(ev.filter((x) => x.type === "trapTrigger")).toEqual([{ type: "trapTrigger", trap: sim.traps[0].id, enemies: [e.id] }]);
  });

  it("spike breaks when its durability is used up", () => {
    const sim = mk();
    placeTrap(sim, "spike", 6);
    sim.traps[0].dur = 1;
    const e = foe(sim, "goblin", 5.4);
    const ev = run(sim, 40);
    expect(e.maxHp - e.hp).toBe(20);
    expect(sim.traps).toHaveLength(0);
    expect(ev.filter((x) => x.type === "trapBreak")).toHaveLength(1);
  });

  it("barricade blocks then breaks after 40 enemy-seconds", () => {
    const sim = mk();
    placeTrap(sim, "barricade", 8);
    const id = sim.traps[0].id;
    const e = foe(sim, "goblin", 6.5);
    let held = -1;
    let broke = -1;
    for (let i = 0; i < 2000 && broke < 0; i++) {
      const ev = step(sim, []);
      expect(e.d).toBeLessThanOrEqual(7.5 + (broke < 0 && held < 0 ? 1 : 0.04));
      if (held < 0 && e.d === 7.5) held = sim.tick;
      if (ev.some((x) => x.type === "trapBreak" && x.trap === id)) broke = sim.tick;
    }
    expect(held).toBeGreaterThan(0);
    expect(broke - held).toBeGreaterThanOrEqual(1198);
    expect(broke - held).toBeLessThanOrEqual(1202);
    expect(sim.traps).toHaveLength(0);
    run(sim, 60);
    expect(e.d).toBeGreaterThan(8);
  });

  it("two held enemies break a barricade twice as fast", () => {
    const sim = mk();
    placeTrap(sim, "barricade", 8);
    foe(sim, "goblin", 7.5);
    foe(sim, "goblin", 7.5);
    run(sim, 30);
    expect(sim.traps[0].dur).toBeCloseTo(38, 6);
  });

  it("brute deals 3x durability", () => {
    const sim = mk();
    placeTrap(sim, "barricade", 8);
    const b = foe(sim, "brute", 6.2);
    // The brute halts within 1 tile of the trap and starts attacking.
    let still = 0;
    for (let i = 0, d = -1; i < 200 && still < 2; i++) {
      step(sim, []);
      still = b.d === d ? still + 1 : 0;
      d = b.d;
    }
    expect(still).toBe(2);
    expect(8 - b.d).toBeLessThanOrEqual(1);
    const dur = sim.traps[0].dur;
    run(sim, 30);
    expect(dur - sim.traps[0].dur).toBeCloseTo(3, 6);
    run(sim, 400);
    expect(sim.traps).toHaveLength(0);
    run(sim, 60);
    expect(b.d).toBeGreaterThan(8);
  });

  it("a brute stops for a spike within 1 tile and attacks it", () => {
    const sim = mk();
    placeTrap(sim, "spike", 8);
    const b = foe(sim, "brute", 6.5);
    run(sim, 30);
    expect(b.d).toBeLessThan(8);
    expect(b.hp).toBe(b.maxHp);
    expect(sim.traps[0].dur).toBeLessThan(30);
  });

  it("a brute entering a trap costs it 3 durability", () => {
    const sim = mk();
    placeTrap(sim, "spike", 8);
    const b = foe(sim, "brute", 7.5);
    b.order = 7;
    run(sim, 1);
    expect(sim.traps[0].dur).toBe(27);
  });

  it("frost rune slows", () => {
    const sim = mk();
    placeTrap(sim, "frost", 6);
    const e = foe(sim, "goblin", 5.4);
    run(sim, 40);
    expect(e.status.slow).toBe(0.4);
    expect(sim.traps[0].dur).toBe(39);
  });

  it("frost rune slow lasts 2 s", () => {
    const sim = mk();
    placeTrap(sim, "frost", 6);
    const e = foe(sim, "goblin", 5.4);
    let slowTicks = 0;
    for (let i = 0; i < 100; i++) {
      step(sim, []);
      if (e.status.slow > 0) slowTicks++;
    }
    expect(slowTicks).toBe(secs(2));
  });

  it("mine is single use", () => {
    const sim = mk({ stage: 2 });
    placeTrap(sim, "mine", 10);
    const a = foe(sim, "goblin", 9.4);
    const near = foe(sim, "goblin", 10.6);
    const far = foe(sim, "goblin", 13);
    const ev = run(sim, 30);
    const dmg = 150 * 1.25;
    expect(a.maxHp - a.hp).toBeCloseTo(dmg, 6);
    expect(near.maxHp - near.hp).toBeCloseTo(dmg, 6);
    expect(far.hp).toBe(far.maxHp);
    expect(sim.traps).toHaveLength(0);
    expect(ev.filter((x) => x.type === "trapTrigger")).toHaveLength(1);
    expect(ev.filter((x) => x.type === "trapBreak")).toHaveLength(1);
    const late = foe(sim, "goblin", 8.5);
    run(sim, 100);
    expect(late.hp).toBe(late.maxHp);
  });

  it("bats ignore traps", () => {
    const sim = mk();
    placeTrap(sim, "spike", 6);
    placeTrap(sim, "barricade", 8);
    placeTrap(sim, "frost", 10);
    placeTrap(sim, "mine", 12);
    const durs = sim.traps.map((t) => t.dur);
    const e = foe(sim, "bat", 5);
    run(sim, 240);
    expect(e.d).toBeGreaterThan(13);
    expect(e.hp).toBe(e.maxHp);
    expect(e.status.slow).toBe(0);
    expect(sim.traps.map((t) => t.dur)).toEqual(durs);
  });

  it("a bat beside a mine is not hurt by it", () => {
    const sim = mk();
    placeTrap(sim, "mine", 10);
    const bat = foe(sim, "bat", 10);
    bat.speed = 0;
    foe(sim, "goblin", 9.4);
    run(sim, 30);
    expect(sim.traps).toHaveLength(0);
    expect(bat.hp).toBe(bat.maxHp);
  });

  it("trap kills credit nobody and pay gold", () => {
    const sim = mk();
    placeTrap(sim, "spike", 6);
    foe(sim, "goblin", 5.4, 10);
    const ev = run(sim, 40);
    expect(ev.find((x) => x.type === "kill")).toMatchObject({ by: null, gold: 4 });
  });
});

describe("spells", () => {
  it("meteor damage scales by stage", () => {
    for (const [stage, mult] of [[1, 1], [3, 1.35 * 1.35]] as const) {
      const sim = mk({ stage });
      const e = foe(sim, "goblin", 10);
      const far = foe(sim, "goblin", 14);
      const ev: SimEvent[] = [];
      expect(spell(sim, "meteor", tileOf(sim, 10), ev)).toBe(true);
      expect(e.maxHp - e.hp).toBeCloseTo(400 * mult, 6);
      expect(far.hp).toBe(far.maxHp);
      expect(ev).toEqual([{ type: "spell", spell: "meteor", target: tileOf(sim, 10) }]);
    }
  });

  it("meteor targets any tile and needs a valid one", () => {
    const sim = mk();
    const build = sim.map.tiles.findIndex((t) => t.kind === "build");
    expect(spell(sim, "meteor", build)).toBe(true);
    rejects(sim, () => spell(sim, "meteor", 99999));
    rejects(sim, () => spell(sim, "meteor"));
  });

  it("spell cooldown rejects recast", () => {
    const sim = mk();
    const gold = sim.gold;
    expect(spell(sim, "meteor", tileOf(sim, 10))).toBe(true);
    expect(sim.gold).toBe(gold - SPELLS.meteor.cost);
    rejects(sim, () => spell(sim, "meteor", tileOf(sim, 10)));
    run(sim, secs(30) - 1);
    rejects(sim, () => spell(sim, "meteor", tileOf(sim, 10)));
    run(sim, 1);
    expect(spell(sim, "meteor", tileOf(sim, 10))).toBe(true);
  });

  it("spells are castable in any phase and start ready", () => {
    for (const phase of ["build", "wave"] as const) {
      const sim = mk();
      sim.phase = phase;
      expect(sim.spellCd).toEqual({ meteor: 0, freeze: 0, surge: 0 });
      expect(spell(sim, "freeze")).toBe(true);
    }
  });

  it("spell needs gold", () => {
    const sim = mk();
    sim.gold = SPELLS.meteor.cost - 1;
    rejects(sim, () => spell(sim, "meteor", tileOf(sim, 10)));
  });

  it("locked spell rejected", () => {
    const sim = mk({ spells: ["meteor"] });
    rejects(sim, () => spell(sim, "freeze"));
  });

  it("time freeze halves on bosses", () => {
    const sim = mk();
    const g = foe(sim, "goblin", 5);
    const c = foe(sim, "goblinChief", 5);
    let gHeld = 0;
    let cHeld = 0;
    for (let i = 0; i < 200; i++) {
      const gd = g.d;
      const cd = c.d;
      step(sim, i === 0 ? [{ t: sim.tick, type: "spell", spell: "freeze" }] : []);
      if (g.d === gd) gHeld++;
      if (c.d === cd) cHeld++;
    }
    expect(gHeld).toBe(secs(3));
    expect(cHeld).toBe(secs(1.5));
  });

  it("mana surge fills every charge", () => {
    const sim = mk();
    const add = (charge: number): Mage => {
      const m: Mage = { id: sim.nextId++, kind: "fire", level: 1, tile: 0, cd: 0, charge, hits: 0, stunT: 0, spent: 0 };
      sim.mages.push(m);
      return m;
    };
    const ms = [add(0), add(0.4), add(1)];
    const ev: SimEvent[] = [];
    expect(spell(sim, "surge", undefined, ev)).toBe(true);
    expect(ms.map((m) => m.charge)).toEqual([1, 1, 1]);
    expect(ev).toEqual([{ type: "spell", spell: "surge" }]);
  });
});
