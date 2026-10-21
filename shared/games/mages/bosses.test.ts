import { describe, expect, it } from "vitest";
import { ENEMIES, STAGE_HP, secs, type EnemyId, type MageId } from "./data";
import { combatTick } from "./combat";
import { pathLength, pathPoint } from "./map";
import { applyAction, createSim, spawnForTest, step, type Enemy, type Mage, type Sim, type SimEvent } from "./sim";

const newSim = (stage: 1 | 2 | 3 | 4 | 5 = 1): Sim =>
  createSim({ seed: 1, mode: "stage", stage, team: ["fire", "ice", "lightning", "earth", "poison", "wind"], traps: [], spells: [] });

/** Steps with no wave running (nothing spawns, no wave ends). */
function foe(sim: Sim, kind: EnemyId, d: number, hp?: number): Enemy {
  const e = spawnForTest(sim, kind, d);
  if (hp !== undefined) e.hp = e.maxHp = hp;
  return e;
}
const run = (sim: Sim, n: number): SimEvent[] => {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...step(sim, []));
  return all;
};
const skills = (ev: SimEvent[], skill: string): Extract<SimEvent, { type: "bossSkill" }>[] =>
  ev.filter((x): x is Extract<SimEvent, { type: "bossSkill" }> => x.type === "bossSkill" && x.skill === skill);
const alive = (sim: Sim, kind: EnemyId): Enemy[] => sim.enemies.filter((e) => e.kind === kind);
const plainDirt = (sim: Sim): void => {
  for (const t of sim.map.path) (sim.map.tiles[t] as { terrain: string }).terrain = "dirt";
};

/** Free build tiles, nearest first to path point `d`. */
function buildTilesNear(sim: Sim, d: number, n: number): number[] {
  const c = pathPoint(sim.map, d);
  return sim.map.tiles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.kind === "build" && t.terrain !== "blocked")
    .map(({ i }) => ({ i, k: Math.hypot((i % 16) + 0.5 - c.x, Math.floor(i / 16) + 0.5 - c.y) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .slice(0, n)
    .map((x) => x.i);
}
function addMage(sim: Sim, tile: number, kind: MageId = "fire"): Mage {
  const m: Mage = { id: sim.nextId++, kind, level: 1, tile, cd: 1e9, charge: 1, hits: 0, stunT: 0, spent: 20 };
  sim.mages.push(m);
  return m;
}

describe("shaman", () => {
  it("shaman heals 8% every 3 s", () => {
    const sim = newSim();
    const sh = foe(sim, "shaman", 5, 1000);
    sh.speed = 0;
    const ally = foe(sim, "goblin", 5.5, 1000);
    ally.speed = 0;
    ally.hp = 100;
    const far = foe(sim, "goblin", 9, 1000);
    far.speed = 0;
    far.hp = 100;
    const ev = run(sim, secs(3));
    expect(ally.hp).toBe(100); // the first heal is a full period after spawning
    ev.push(...step(sim, []));
    expect(ally.hp).toBeCloseTo(100 + 80, 9);
    expect(far.hp).toBe(100);
    expect(skills(ev, "heal")).toHaveLength(1);
    expect(skills(ev, "heal")[0].targets).toContain(ally.id);
    run(sim, secs(3));
    expect(ally.hp).toBeCloseTo(100 + 160, 9);
  });

  it("healing never exceeds max HP", () => {
    const sim = newSim();
    const sh = foe(sim, "shaman", 5, 1000);
    sh.speed = 0;
    sh.hp = 990;
    run(sim, secs(3) + 1);
    expect(sh.hp).toBe(1000);
  });

  it("plague blocks shaman heal", () => {
    const sim = newSim();
    const sh = foe(sim, "shaman", 5, 1000);
    sh.speed = 0;
    sh.hp = 500;
    run(sim, secs(3));
    sh.status.noHealT = 2; // a plague cloud sets 1 after the status tick; 2 survives it here
    const ev = step(sim, []);
    expect(sh.hp).toBe(500);
    expect(skills(ev, "heal")).toHaveLength(0);
    run(sim, secs(3)); // the period was spent; the next heal is a full period later
    expect(sh.hp).toBeCloseTo(580, 9);
  });
});

describe("goblin chief", () => {
  it("chief summons 4 goblins every 6 s", () => {
    const sim = newSim();
    const chief = foe(sim, "goblinChief", 4);
    chief.speed = 0;
    run(sim, secs(6));
    expect(alive(sim, "goblin")).toHaveLength(0);
    const ev = step(sim, []);
    const gobs = alive(sim, "goblin");
    expect(gobs).toHaveLength(4);
    expect(gobs.every((g) => g.d >= 4 && g.d < 4.1)).toBe(true); // spawned at the chief, then walked one tick
    expect(skills(ev, "summon")[0]).toMatchObject({ enemy: chief.id, targets: gobs.map((g) => g.id) });
    run(sim, secs(6));
    expect(alive(sim, "goblin")).toHaveLength(8);
  });
});

describe("dire wolf", () => {
  it("dire wolf sprint doubles speed for 2 s", () => {
    const sim = newSim();
    plainDirt(sim);
    const w = foe(sim, "direWolf", 0);
    const base = ENEMIES.direWolf.speed / 30;
    run(sim, secs(8));
    expect(w.d).toBeCloseTo(secs(8) * base, 9);
    let d = w.d;
    const ev = step(sim, []);
    expect(skills(ev, "sprint")).toHaveLength(1);
    expect(w.d - d).toBeCloseTo(base * 2, 9);
    for (let i = 1; i < secs(2); i++) {
      d = w.d;
      step(sim, []);
      expect(w.d - d).toBeCloseTo(base * 2, 9);
    }
    d = w.d;
    step(sim, []);
    expect(w.d - d).toBeCloseTo(base, 9); // sprint over: exactly 2 s long
  });
});

describe("troll", () => {
  it("troll regenerates 1% per second", () => {
    const sim = newSim();
    const t = foe(sim, "troll", 5, 1000);
    t.speed = 0;
    t.hp = 500;
    run(sim, secs(1));
    expect(t.hp).toBe(500);
    run(sim, 1);
    expect(t.hp).toBeCloseTo(510, 9);
  });

  it("troll regen stops while burning", () => {
    const sim = newSim();
    const t = foe(sim, "troll", 5, 1000);
    t.speed = 0;
    t.hp = 500;
    t.status.burnT = 1e6; // burning, but 0 dps so the HP check is exact
    run(sim, secs(3));
    expect(t.hp).toBe(500);
    t.status.burnT = 0;
    t.status.poison.t = 1e6; // poisoned (no stacks: no damage)
    run(sim, secs(3));
    expect(t.hp).toBe(500);
    t.status.poison.t = 0;
    run(sim, secs(1));
    expect(t.hp).toBeCloseTo(510, 9);
  });

  it("troll regen is blocked by plague", () => {
    const sim = newSim();
    const t = foe(sim, "troll", 5, 1000);
    t.speed = 0;
    t.hp = 500;
    t.status.noHealT = 1e6;
    run(sim, secs(3));
    expect(t.hp).toBe(500);
  });
});

describe("witch", () => {
  it("witch shield halves damage", () => {
    const sim = newSim();
    const wi = foe(sim, "witch", 5, 1e6);
    wi.speed = 0;
    const near = foe(sim, "goblin", 6.5, 1e6);
    near.speed = 0;
    const far = foe(sim, "goblin", 9, 1e6);
    far.speed = 0;
    run(sim, secs(7));
    expect(wi.status.shieldT).toBe(0);
    const ev = step(sim, []);
    expect([...skills(ev, "shield")[0].targets].sort()).toEqual([wi.id, near.id].sort());
    expect(wi.status.shieldT).toBeGreaterThan(0);
    expect(far.status.shieldT).toBe(0);
    // A 10-damage burn tick on each of the next ticks: halved for exactly secs(3) of them.
    let halved = 0;
    for (let i = 0; i < secs(3) + 3; i++) {
      const hp = near.hp;
      near.status.burnDps = 10 * 30;
      near.status.burnT = 1;
      step(sim, []);
      if (hp - near.hp === 5) halved++;
      else expect(hp - near.hp).toBe(10);
    }
    expect(halved).toBe(secs(3));
  });
});

describe("ancient treant", () => {
  it("treant plants 3 saplings every 10 s", () => {
    const sim = newSim(5);
    const t = foe(sim, "treant", 10);
    t.status.freezeT = 1e6; // hold it still (skills still run)
    run(sim, secs(10));
    expect(alive(sim, "sapling")).toHaveLength(0);
    const ev = step(sim, []);
    const sap = alive(sim, "sapling");
    expect(sap.map((s) => s.d)).toEqual([11, 12, 13]);
    expect(skills(ev, "saplings")[0]).toMatchObject({ enemy: t.id, targets: sap.map((s) => s.id) });
    expect(sap[0].maxHp).toBeCloseTo(200 * STAGE_HP ** 4, 6); // scaled like other enemies
    run(sim, 5);
    expect(sap.map((s) => s.d)).toEqual([11, 12, 13]); // stationary
    run(sim, secs(10) - 5);
    expect(alive(sim, "sapling")).toHaveLength(6);
  });

  it("saplings clamp below the path end and never leak", () => {
    const sim = newSim(5);
    const end = pathLength(sim.map);
    const t = foe(sim, "treant", end - 1);
    t.status.freezeT = 1e6; // hold it still (skills still run)
    run(sim, secs(10) + 1);
    expect(alive(sim, "sapling")).toHaveLength(3);
    for (const s of alive(sim, "sapling")) expect(s.d).toBeLessThan(end);
    expect(sim.lives).toBe(20);
  });

  it("saplings heal treant 2% per second each", () => {
    const sim = newSim(5);
    const t = foe(sim, "treant", 10, 10000);
    t.status.freezeT = 1e6; // hold it still (skills still run)
    t.hp = 5000;
    for (let i = 0; i < 2; i++) {
      const s = foe(sim, "sapling", 12 + i);
      s.owner = t.id;
      s.hp = s.maxHp = 1e9;
    }
    run(sim, secs(1));
    expect(t.hp).toBe(5000);
    run(sim, 1);
    expect(t.hp).toBeCloseTo(5000 + 2 * 0.02 * 10000, 6);
    t.hp = 9900;
    run(sim, secs(1));
    expect(t.hp).toBe(10000); // capped
    t.hp = 5000;
    t.status.noHealT = 1e6; // plague blocks it too
    run(sim, secs(2));
    expect(t.hp).toBe(5000);
  });

  it("saplings vanish when the treant dies", () => {
    const sim = newSim(5);
    const t = foe(sim, "treant", 10);
    t.status.freezeT = 1e6; // hold it still (skills still run)
    run(sim, secs(10) + 1);
    expect(alive(sim, "sapling")).toHaveLength(3);
    const ids = alive(sim, "sapling").map((s) => s.id);
    const gold = sim.gold;
    t.hp = 0;
    const ev = run(sim, 1);
    expect(sim.enemies).toHaveLength(0);
    // Withered, not killed: one kill (the Treant), no sapling gold, a despawn event each.
    expect(sim.kills).toBe(1);
    expect(sim.gold).toBe(gold + ENEMIES.treant.gold);
    expect(ev.filter((x) => x.type === "kill").map((x) => (x as { enemy: number }).enemy)).toEqual([t.id]);
    expect(ev.filter((x) => x.type === "despawn").map((x) => (x as { enemy: number }).enemy)).toEqual(ids);
  });

  it("each treant heals only from its own saplings and takes only its own with it", () => {
    const sim = newSim(5);
    const a = foe(sim, "treant", 5, 10000);
    const b = foe(sim, "treant", 15, 10000);
    for (const t of [a, b]) {
      t.status.freezeT = 1e6;
      t.hp = 5000;
    }
    const plant = (t: Enemy, n: number): void => {
      for (let i = 0; i < n; i++) {
        const s = foe(sim, "sapling", t.d + 1 + i);
        s.hp = s.maxHp = 1e9;
        s.owner = t.id;
      }
    };
    plant(a, 1);
    plant(b, 3);
    run(sim, secs(1) + 1);
    expect(a.hp).toBeCloseTo(5000 + 0.02 * 10000, 6);
    expect(b.hp).toBeCloseTo(5000 + 3 * 0.02 * 10000, 6);
    a.hp = 0;
    run(sim, 1);
    expect(sim.enemies.filter((e) => e.kind === "sapling" && e.owner === b.id)).toHaveLength(3);
    expect(sim.enemies.filter((e) => e.kind === "sapling" && e.owner === a.id)).toHaveLength(0);
    expect(alive(sim, "treant")).toEqual([b]);
  });

  it("root slam stuns the 3 nearest mages for 3 s", () => {
    const sim = newSim(5);
    const t = foe(sim, "treant", 10, 1e9);
    t.status.freezeT = 1e6; // hold it still (skills still run)
    const mages = buildTilesNear(sim, 10, 5).map((tile) => addMage(sim, tile));
    const c = pathPoint(sim.map, 10);
    const dist = (m: Mage): number => Math.hypot((m.tile % 16) + 0.5 - c.x, Math.floor(m.tile / 16) + 0.5 - c.y);
    const order = [...mages].sort((a, b) => dist(a) - dist(b) || a.id - b.id);
    run(sim, secs(15));
    expect(mages.every((m) => m.stunT === 0)).toBe(true);
    const ev = step(sim, []);
    expect(skills(ev, "rootSlam")[0].targets).toEqual(order.slice(0, 3).map((m) => m.id));
    for (const m of order.slice(0, 3)) expect(m.stunT).toBeGreaterThan(0);
    for (const m of order.slice(3)) expect(m.stunT).toBe(0);
    // The slammed mage cannot attack for exactly secs(3) ticks after the slam tick.
    const m = order[0];
    let blocked = 0;
    for (let i = 0; i < secs(3) + 2; i++) {
      m.cd = 0;
      if (!step(sim, []).some((x) => x.type === "attack" && x.mage === m.id)) blocked++;
    }
    expect(blocked).toBe(secs(3));
  });

  it("root-slammed mage cannot act", () => {
    const sim = newSim(5);
    const [a, b] = buildTilesNear(sim, 10, 2).map((tile) => addMage(sim, tile));
    const free = buildTilesNear(sim, 3, 30).find((tl) => !sim.mages.some((x) => x.tile === tl))!;
    const target = sim.map.path[3];
    a.stunT = 5;
    const rejects = (act: Parameters<typeof applyAction>[1]): void => {
      const before = JSON.stringify(sim);
      expect(applyAction(sim, act, [])).toBe(false);
      expect(JSON.stringify(sim)).toBe(before);
    };
    rejects({ t: 0, type: "cast", tile: a.tile, target });
    rejects({ t: 0, type: "move", from: a.tile, to: free });
    rejects({ t: 0, type: "sell", tile: a.tile });
    rejects({ t: 0, type: "merge", from: a.tile, to: b.tile }); // as source
    rejects({ t: 0, type: "merge", from: b.tile, to: a.tile }); // as target
    // The unstunned mage still can, and so can the slammed one once it is over.
    expect(applyAction(sim, { t: 0, type: "cast", tile: b.tile, target }, [])).toBe(true);
    a.stunT = 0;
    expect(applyAction(sim, { t: 0, type: "move", from: a.tile, to: free }, [])).toBe(true);
  });

  it("treant enrages under 50%", () => {
    const sim = newSim(5);
    plainDirt(sim);
    const t = foe(sim, "treant", 10, 1000);
    t.hp = 500;
    let d = t.d;
    step(sim, []);
    expect(t.d - d).toBeCloseTo(0.5 / 30, 9); // exactly 50% is not below
    t.hp = 499;
    d = t.d;
    step(sim, []);
    expect(t.d - d).toBeCloseTo((0.5 * 1.3) / 30, 9);
    t.hp = 900;
    d = t.d;
    step(sim, []);
    expect(t.d - d).toBeCloseTo(0.5 / 30, 9);
  });

  it("treant leak loses the run", () => {
    const sim = newSim(5);
    const t = foe(sim, "treant", pathLength(sim.map) - 0.001);
    const ev = run(sim, 2);
    expect(sim.phase).toBe("lost");
    expect(ev.some((x) => x.type === "leak" && x.enemy === t.id)).toBe(true);
  });
});

describe("boss stun halving (R17)", () => {
  const freezeOf = (kind: EnemyId): number => {
    const sim = newSim();
    const m = addMage(sim, buildTilesNear(sim, 10, 1)[0], "ice");
    m.level = 3;
    m.cd = 0;
    m.hits = 4; // the next hit is the 5th
    const e = foe(sim, kind, 10);
    e.speed = 0;
    combatTick(sim, []);
    return e.status.freezeT;
  };
  it("ice L3 passive freeze is halved on bosses", () => {
    expect(freezeOf("goblin")).toBe(secs(1));
    expect(freezeOf("goblinChief")).toBe(secs(0.5));
    expect(freezeOf("treant")).toBe(secs(0.5));
  });
});
