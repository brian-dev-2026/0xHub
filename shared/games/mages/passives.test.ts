import { describe, expect, it } from "vitest";
import { MAGES, secs, type MageId } from "./data";
import { combatTick, damage, mageStats, statusTick } from "./combat";
import { pathPoint } from "./map";
import { createSim, spawnForTest, step, type Enemy, type Mage, type Sim, type SimEvent } from "./sim";

interface Rig {
  sim: Sim;
  m: Mage;
  /** Path position (tiles) of a straight stretch, with room for 2 tiles each way. */
  d0: number;
  ev: SimEvent[];
}

/** A sim with one mage of `kind`/`level` beside a straight stretch of the path. */
function rig(kind: MageId, level: 1 | 2 | 3 | 4 | 5, seed = 1): Rig {
  const sim = createSim({ seed, mode: "stage", stage: 1, team: [kind], traps: [], spells: [] });
  const p = sim.map.path;
  for (let i = 5; i < p.length - 5; i++) {
    const line = (f: (t: number) => number): boolean => [-2, -1, 1, 2].every((k) => f(p[i + k]) === f(p[i]));
    if (!line((t) => t % 16) && !line((t) => Math.floor(t / 16))) continue;
    const c = pathPoint(sim.map, i);
    for (let t = 0; t < sim.map.tiles.length; t++) {
      const tile = sim.map.tiles[t];
      if (tile.kind !== "build" || tile.terrain === "blocked") continue;
      const dx = (t % 16) + 0.5 - c.x;
      const dy = Math.floor(t / 16) + 0.5 - c.y;
      if (Math.sqrt(dx * dx + dy * dy) > 1.01) continue;
      (tile as { terrain: string }).terrain = "grass";
      const m: Mage = { id: sim.nextId++, kind, level, tile: t, cd: 0, charge: 0, hits: 0, stunT: 0, spent: 0 };
      sim.mages.push(m);
      return { sim, m, d0: i, ev: [] };
    }
  }
  throw new Error("no straight stretch");
}

/** Makes the mage attack now (one combat tick). */
const hit = (r: Rig): void => {
  r.m.cd = 0;
  combatTick(r.sim, r.ev);
};
const foe = (r: Rig, d: number, hp = 1e5, kind: "goblin" | "knight" | "goblinChief" = "goblin"): Enemy => {
  const e = spawnForTest(r.sim, kind, d);
  e.hp = e.maxHp = hp;
  return e;
};
const hitDmg = (r: Rig): number => mageStats(r.sim, r.m).dmg;
const passiveEvents = (r: Rig, kind: string): SimEvent[] => r.ev.filter((e) => e.type === "passive" && e.kind === kind);
const LEVELS = [1, 2, 3, 4, 5] as const;

describe("fire: burn", () => {
  it("fire burn dps by level", () => {
    const pct = [0.3, 0.4, 0.5, 0.6, 0.8];
    for (const lv of LEVELS) {
      const r = rig("fire", lv);
      const e = foe(r, r.d0);
      hit(r);
      expect(e.status.burnDps).toBeCloseTo(hitDmg(r) * pct[lv - 1], 9);
      expect(e.status.burnT).toBe(secs(3));
    }
  });

  it("burn deals its dps for exactly 3 s", () => {
    const r = rig("fire", 1);
    const e = foe(r, r.d0, 1000);
    hit(r);
    const after = e.hp;
    for (let i = 0; i < 200; i++) statusTick(r.sim, r.ev);
    expect(after - e.hp).toBeCloseTo(hitDmg(r) * 0.3 * 3, 6);
    expect(e.status.burnT).toBe(0);
  });

  it("fire L3 spreads burn on death", () => {
    const r = rig("fire", 3);
    const a = foe(r, r.d0 + 1);
    const near = foe(r, r.d0 + 0.5);
    const far = foe(r, r.d0 - 2);
    hit(r); // burns a (the frontmost)
    expect(a.status.burnT).toBeGreaterThan(0);
    a.hp = 1;
    hit(r); // a dies burning
    expect(r.sim.enemies).not.toContain(a);
    expect(near.status.burnT).toBe(secs(3));
    expect(near.status.burnDps).toBeCloseTo(hitDmg(r) * 0.5, 9);
    expect(far.status.burnT).toBe(0);
    expect(passiveEvents(r, "burnSpread").length).toBe(1);
  });

  it("fire L2 does not spread", () => {
    const r = rig("fire", 2);
    const a = foe(r, r.d0 + 1);
    const near = foe(r, r.d0 + 0.5);
    hit(r);
    a.hp = 1;
    hit(r);
    expect(near.status.burnT).toBe(0);
  });

  it("fire L5 explodes", () => {
    const r = rig("fire", 5);
    const a = foe(r, r.d0 + 1);
    const inside = foe(r, r.d0 + 0.2, 1e6); // 0.8 tiles from a: outside splash (0.6), inside explosion (1)
    const outside = foe(r, r.d0 - 2, 1e6);
    hit(r);
    a.hp = 1;
    const before = inside.hp;
    const outBefore = outside.hp;
    hit(r);
    expect(before - inside.hp).toBeCloseTo(hitDmg(r), 9);
    expect(outside.hp).toBe(outBefore);
    expect(passiveEvents(r, "explode").length).toBe(1);
  });

  it("chained explosions end: each enemy dies once", () => {
    const r = rig("fire", 5);
    const es = [foe(r, r.d0 + 1), foe(r, r.d0 + 0.2, 1), foe(r, r.d0 - 0.6, 1), foe(r, r.d0 - 1.4, 1)];
    hit(r);
    es[0].hp = 1;
    hit(r);
    expect(r.sim.enemies.length).toBe(0);
    expect(r.sim.kills).toBe(4);
  });
});

describe("ice: chill, freeze, shatter", () => {
  it("ice slow by level", () => {
    const pct = [0.2, 0.25, 0.3, 0.35, 0.4];
    for (const lv of LEVELS) {
      const r = rig("ice", lv);
      const e = foe(r, r.d0);
      hit(r);
      expect(e.status.slow).toBeCloseTo(pct[lv - 1], 9);
      expect(e.status.slowT).toBe(secs(2));
    }
  });

  it("slow lasts exactly secs(2) ticks and slows movement for those ticks", () => {
    const r = rig("ice", 1);
    const e = foe(r, r.d0);
    const sim = r.sim;
    step(sim, []); // tick 0: the mage hits, slow applied, enemy already moves slowed
    sim.mages.length = 0;
    let active = e.status.slowT > 0 ? 1 : 0;
    expect(e.status.slowT).toBe(secs(2));
    while (e.status.slowT > 0) {
      step(sim, []);
      if (e.status.slowT > 0) active++;
    }
    expect(active).toBe(secs(2));
    // Ticks 0..59 moved slowed (60 x 0.8 / 30), the tick the slow ended moved normally.
    expect(e.d - r.d0).toBeCloseTo((secs(2) * 0.8 + 1) / 30, 9);
  });

  it("ice L3 freezes every 5th hit", () => {
    const r = rig("ice", 3);
    const e = foe(r, r.d0);
    for (let i = 1; i <= 10; i++) {
      hit(r);
      expect(e.status.freezeT > 0).toBe(i % 5 === 0);
      e.status.freezeT = 0;
    }
    expect(passiveEvents(r, "freeze").length).toBe(2);
    const low = rig("ice", 2);
    const f = foe(low, low.d0);
    for (let i = 0; i < 10; i++) hit(low);
    expect(f.status.freezeT).toBe(0);
  });

  it("a frozen enemy does not move for exactly 1 s", () => {
    const r = rig("ice", 3);
    const e = foe(r, r.d0);
    r.m.hits = 4;
    step(r.sim, []); // tick 0: 5th hit freezes; frozen from this tick on
    r.sim.mages.length = 0;
    expect(e.status.freezeT).toBe(secs(1));
    for (let i = 1; i < secs(1); i++) step(r.sim, []);
    expect(e.d).toBe(r.d0);
    step(r.sim, []);
    expect(e.d).toBeGreaterThan(r.d0);
  });

  it("ice L5 frozen takes 1.5x", () => {
    const r = rig("ice", 5);
    const e = foe(r, r.d0);
    statusTick(r.sim, r.ev);
    expect(r.sim.shatter).toBe(true);
    e.status.freezeT = 10;
    damage(r.sim, e, 10, null, r.ev);
    expect(e.maxHp - e.hp).toBe(15);
    e.status.freezeT = 0;
    damage(r.sim, e, 10, null, r.ev);
    expect(e.maxHp - e.hp).toBe(25);
    r.sim.mages.length = 0;
    statusTick(r.sim, r.ev);
    expect(r.sim.shatter).toBe(false);
  });

  it("shatter needs an L5 ice mage, not L4", () => {
    const r = rig("ice", 4);
    statusTick(r.sim, r.ev);
    expect(r.sim.shatter).toBe(false);
  });
});

describe("lightning: chain", () => {
  it("lightning chains every 3rd attack with 70% falloff", () => {
    const r = rig("lightning", 1);
    const es = [0, 1, 2, 3].map((i) => foe(r, r.d0 + 1 - i)); // 1 tile apart, front first
    const D = hitDmg(r);
    hit(r);
    hit(r);
    expect(es.slice(1).every((e) => e.hp === e.maxHp)).toBe(true);
    hit(r); // 3rd attack: front takes D x3 total, chains to 2
    expect(es[0].maxHp - es[0].hp).toBeCloseTo(3 * D, 9);
    expect(es[1].maxHp - es[1].hp).toBeCloseTo(D * 0.7, 9);
    expect(es[2].maxHp - es[2].hp).toBeCloseTo(D * 0.49, 9);
    expect(es[3].hp).toBe(es[3].maxHp);
    expect(passiveEvents(r, "chain").length).toBe(1);
  });

  it("lightning L5 chains every attack", () => {
    const r = rig("lightning", 5);
    const es = Array.from({ length: 8 }, (_, i) => foe(r, r.d0 + 2 - i * 0.5));
    const D = hitDmg(r);
    hit(r);
    for (let i = 0; i < 7; i++) expect(es[i].maxHp - es[i].hp).toBeCloseTo(i === 0 ? D : D * 0.7 ** i, 6);
    expect(es[7].hp).toBe(es[7].maxHp); // 6 extra, no more
    hit(r);
    expect(passiveEvents(r, "chain").length).toBe(2);
  });

  it("chain never repeats a target", () => {
    const r = rig("lightning", 5);
    const es = Array.from({ length: 5 }, () => foe(r, r.d0)); // all on one spot
    hit(r);
    const ev = passiveEvents(r, "chain")[0] as Extract<SimEvent, { type: "passive" }>;
    expect(ev.targets.length).toBe(4);
    expect(new Set(ev.targets).size).toBe(4);
    const dealt = es.map((e) => e.maxHp - e.hp).filter((x) => x > 0);
    expect(dealt.length).toBe(5);
  });
});

describe("earth: armor break and quake", () => {
  it("earth strips armor to floor 0", () => {
    const r = rig("earth", 3);
    const e = foe(r, r.d0, 1e9, "knight"); // armor 8
    hit(r);
    expect(e.armor).toBe(4);
    hit(r);
    expect(e.armor).toBe(0);
    hit(r);
    expect(e.armor).toBe(0);
  });

  it("earth removes 2/3/4/5/6 armor per hit", () => {
    for (const lv of LEVELS) {
      const r = rig("earth", lv);
      const e = foe(r, r.d0, 1e9, "knight");
      hit(r);
      expect(e.armor).toBe(Math.max(0, 8 - MAGES.earth.passive[lv - 1]));
    }
  });

  it("earth L5 quake", () => {
    const r = rig("earth", 5);
    const t = foe(r, r.d0 + 1);
    const close = foe(r, r.d0 + 0.5); // 0.5 tiles away
    const far = foe(r, r.d0 - 1);
    hit(r);
    expect(close.maxHp - close.hp).toBeCloseTo(hitDmg(r) * 0.4, 9);
    expect(far.hp).toBe(far.maxHp);
    expect(t.maxHp - t.hp).toBeCloseTo(hitDmg(r), 9);
    const low = rig("earth", 4);
    foe(low, low.d0 + 1);
    const c = foe(low, low.d0 + 0.5);
    hit(low);
    expect(c.hp).toBe(c.maxHp);
  });
});

describe("poison: venom", () => {
  it("poison stacks cap by level", () => {
    const cap = [3, 4, 5, 6, 8];
    for (const lv of LEVELS) {
      const r = rig("poison", lv);
      const e = foe(r, r.d0);
      for (let i = 0; i < 12; i++) hit(r);
      expect(e.status.poison.stacks).toBe(cap[lv - 1]);
      expect(e.status.poison.t).toBe(secs(4));
    }
  });

  it("poison dps is 4×level per stack", () => {
    for (const lv of LEVELS) {
      const r = rig("poison", lv);
      const e = foe(r, r.d0);
      for (let i = 0; i < 3; i++) hit(r);
      const before = e.hp;
      statusTick(r.sim, r.ev);
      expect(before - e.hp).toBeCloseTo((3 * 4 * lv) / 30, 9);
    }
  });

  it("poison lasts 4 s after the last hit", () => {
    const r = rig("poison", 1);
    const e = foe(r, r.d0);
    hit(r);
    let ticks = 0;
    while (e.status.poison.t > 0) {
      statusTick(r.sim, r.ev);
      ticks++;
    }
    expect(ticks).toBe(secs(4));
    expect(e.status.poison.stacks).toBe(0);
  });

  it("poison L5 jumps on death", () => {
    const r = rig("poison", 5);
    const a = foe(r, r.d0 + 2);
    const b = foe(r, r.d0 + 1); // 1 tile
    const c = foe(r, r.d0 + 0.6); // 1.4 tiles
    const far = foe(r, r.d0 - 2);
    for (let i = 0; i < 5; i++) hit(r);
    expect(a.status.poison.stacks).toBe(5);
    a.hp = 1;
    hit(r);
    expect(r.sim.enemies).not.toContain(a);
    expect(b.status.poison.stacks).toBe(5);
    expect(b.status.poison.t).toBe(secs(4));
    expect(c.status.poison.stacks).toBe(0);
    expect(far.status.poison.stacks).toBe(0);
    expect(passiveEvents(r, "venomJump").length).toBe(1);
  });

  it("poison L4 does not jump", () => {
    const r = rig("poison", 4);
    const a = foe(r, r.d0 + 1);
    const b = foe(r, r.d0);
    for (let i = 0; i < 3; i++) hit(r);
    a.hp = 1;
    hit(r);
    expect(b.status.poison.stacks).toBe(0);
  });
});

describe("wind: gust", () => {
  it("wind gust pushes back with seeded chance", () => {
    const r = rig("wind", 1, 1);
    const e = foe(r, r.d0);
    let gusts = 0;
    for (let i = 0; i < 1000; i++) {
      e.d = r.d0;
      hit(r);
      if (e.d !== r.d0) {
        expect(e.d).toBeCloseTo(r.d0 - 0.5, 9);
        gusts++;
      }
    }
    expect(passiveEvents(r, "gust").length).toBe(gusts);
    expect(gusts).toBe(GUSTS_SEED_1);
  });

  it("level 5 gust pushes back 1 tile", () => {
    const r = rig("wind", 5, 1);
    const e = foe(r, r.d0);
    for (let i = 0; i < 100 && e.d === r.d0; i++) hit(r);
    expect(e.d).toBeCloseTo(r.d0 - 1, 9);
  });

  it("bosses ignore knockback", () => {
    const r = rig("wind", 5, 1);
    const boss = foe(r, r.d0, 1e9, "goblinChief");
    for (let i = 0; i < 1000; i++) hit(r);
    expect(boss.d).toBe(r.d0);
    expect(passiveEvents(r, "gust").length).toBe(0);
  });
});

/** Recorded once from this implementation: gusts out of 1000 wind L1 hits with seed 1. */
const GUSTS_SEED_1 = 116;
