import { describe, expect, it } from "vitest";
import { ACTIVES, MAGES, PASSIVES, secs, type MageId } from "./data";
import { combatTick, mageStats } from "./combat";
import { zoneTick } from "./actives";
import { pathLength, pathPoint } from "./map";
import { applyAction, createSim, spawnForTest, step, type Enemy, type Mage, type Sim, type SimEvent, type Zone } from "./sim";

interface Rig {
  sim: Sim;
  m: Mage;
  /** Path order of a straight stretch, with room for 2 tiles each way. */
  d0: number;
  ev: SimEvent[];
}

/** A charged mage of `kind`/`level` beside a straight stretch of the path; its basic attack is parked. */
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
      // Plain dirt on the stretch so enemy speed is predictable.
      for (let k = -3; k <= 3; k++) (sim.map.tiles[p[i + k]] as { terrain: string }).terrain = "dirt";
      const m: Mage = { id: sim.nextId++, kind, level, tile: t, cd: 1e9, charge: 1, hits: 0, stunT: 0, spent: 0 };
      sim.mages.push(m);
      return { sim, m, d0: i, ev: [] };
    }
  }
  throw new Error("no straight stretch");
}

const foe = (r: Rig, d: number, kind: "goblin" | "knight" | "bat" | "goblinChief" = "goblin", hp = 1e6): Enemy => {
  const e = spawnForTest(r.sim, kind, d);
  e.hp = e.maxHp = hp;
  return e;
};
const tileAt = (r: Rig, order: number): number => r.sim.map.path[order];
const castAction = (r: Rig, target?: number) => ({ t: r.sim.tick, type: "cast" as const, tile: r.m.tile, target });
const cast = (r: Rig, target?: number): boolean => applyAction(r.sim, castAction(r, target), r.ev);
const castEvent = (r: Rig) => r.ev.find((x): x is Extract<SimEvent, { type: "cast" }> => x.type === "cast")!;
const hitDmg = (r: Rig): number => mageStats(r.sim, r.m).dmg;
const lost = (e: Enemy): number => e.maxHp - e.hp;
const zones = (r: Rig, kind: Zone["kind"]): Zone[] => r.sim.zones.filter((z) => z.kind === kind);
const LEVELS = [1, 2, 3, 4, 5] as const;

/** Steps the sim (the first step carries `first`) and counts ticks on which `e` did not move. */
function stillTicks(r: Rig, e: Enemy, first: ReturnType<typeof castAction>): number {
  let n = 0;
  let d = e.d;
  step(r.sim, [first]);
  while (e.d === d && n < 1000) {
    n++;
    d = e.d;
    step(r.sim, []);
  }
  return n;
}

describe("charging and casting", () => {
  it("cast rejected until fully charged", () => {
    const r = rig("lightning", 1);
    foe(r, r.d0);
    r.m.charge = 0.999;
    const before = JSON.stringify(r.sim);
    expect(cast(r)).toBe(false);
    expect(JSON.stringify(r.sim)).toBe(before);
    const ev = step(r.sim, [castAction(r)]);
    expect(r.sim.rejected).toBe(1);
    expect(r.sim.zones.length).toBe(0);
    expect(ev.some((x) => x.type === "cast")).toBe(false);
  });

  it("stunned mages, missing mages and bad targets are rejected, charge kept", () => {
    const r = rig("fire", 1);
    foe(r, r.d0);
    const tries: Array<() => boolean> = [
      () => cast(r), // targeted, no target
      () => cast(r, r.m.tile), // a build tile, not path
      () => cast(r, -1),
      () => cast(r, 16 * 9),
      () => cast(r, tileAt(r, r.d0) + 0.5),
      () => applyAction(r.sim, { t: r.sim.tick, type: "cast", tile: r.m.tile === 0 ? 1 : 0, target: tileAt(r, r.d0) }, r.ev),
      () => {
        r.m.stunT = 5;
        const ok = cast(r, tileAt(r, r.d0));
        r.m.stunT = 0;
        return ok;
      },
    ];
    for (const t of tries) {
      const before = JSON.stringify(r.sim);
      expect(t()).toBe(false);
      expect(JSON.stringify(r.sim)).toBe(before);
    }
    expect(r.m.charge).toBe(1);
  });

  it("charge takes 14 s base and less on a well", () => {
    const r = rig("ice", 1);
    r.m.charge = 0;
    for (let i = 0; i < secs(14) - 1; i++) combatTick(r.sim, r.ev);
    expect(r.m.charge).toBeLessThan(1);
    combatTick(r.sim, r.ev);
    expect(r.m.charge).toBe(1);

    const w = rig("ice", 1);
    (w.sim.map.tiles[w.m.tile] as { terrain: string }).terrain = "well";
    w.m.charge = 0;
    let n = 0;
    while (w.m.charge < 1) {
      combatTick(w.sim, w.ev);
      n++;
    }
    expect(n).toBe(Math.ceil(secs(14) / 1.35));
  });

  it("cast resets charge", () => {
    const r = rig("wind", 1);
    expect(cast(r)).toBe(true);
    expect(r.m.charge).toBe(0);
    expect(cast(r)).toBe(false);
    expect(castEvent(r)).toMatchObject({ mage: r.m.id, skill: "wind", level: 1 });
  });
});

describe("actives by mage", () => {
  it("fire pillars count and lava at L5", () => {
    for (const lv of LEVELS) {
      const r = rig("fire", lv);
      const n = MAGES.fire.active[lv - 1];
      const at = new Map<number, Enemy>();
      for (let k = -3; k <= 3; k++) at.set(k, foe(r, r.d0 + k));
      expect(cast(r, tileAt(r, r.d0))).toBe(true);
      const first = -Math.floor((n - 1) / 2);
      const hitKs = [...at.keys()].filter((k) => k >= first && k < first + n);
      expect(castEvent(r).hits.sort()).toEqual(hitKs.map((k) => at.get(k)!.id).sort());
      for (const [k, e] of at) expect(lost(e)).toBeCloseTo(hitKs.includes(k) ? 3 * hitDmg(r) : 0, 6);
      expect(castEvent(r).target).toBe(tileAt(r, r.d0));
      expect(zones(r, "lava").length).toBe(lv === 5 ? 5 : 0);
      if (lv === 5) {
        expect(zones(r, "lava").every((z) => z.t === secs(ACTIVES.lavaSecs) && z.owner === r.m.id)).toBe(true);
        const walker = foe(r, r.d0 + 0.3);
        zoneTick(r.sim, r.ev);
        expect(walker.status.burnBy).toBe(r.m.id);
        expect(walker.status.burnLv).toBe(5);
        expect(walker.status.burnDps).toBeCloseTo(hitDmg(r) * (MAGES.fire.passive[4] / 100), 6);
      }
    }
  });

  it("lava zones last exactly 5 s", () => {
    const r = rig("fire", 5);
    step(r.sim, [castAction(r, tileAt(r, r.d0))]);
    for (let i = 1; i < secs(5); i++) step(r.sim, []);
    expect(zones(r, "lava").length).toBe(5);
    step(r.sim, []);
    expect(zones(r, "lava").length).toBe(0);
  });

  it("blizzard radius and L5 freeze", () => {
    for (const lv of LEVELS) {
      const r = rig("ice", lv);
      const inside = foe(r, r.d0 + 1.4);
      const mid = foe(r, r.d0 + 1.8);
      expect(cast(r, tileAt(r, r.d0))).toBe(true);
      const [z] = zones(r, "blizzard");
      expect(z.r).toBe([1.5, 1.5, 1.5, 2, 2][lv - 1]);
      expect(z.t).toBe(secs(4));
      zoneTick(r.sim, r.ev);
      expect(inside.status.slow).toBe(0.5);
      expect(mid.status.slow).toBe(lv >= 4 ? 0.5 : 0);
      for (let i = 1; i < secs(1); i++) zoneTick(r.sim, r.ev);
      // At L5 the Ice passive's shatter makes the frozen target take +50%.
      expect(lost(inside)).toBeCloseTo(0.6 * hitDmg(r) * (lv === 5 ? 1.5 : 1), 6);
      expect(inside.status.freezeT > 0).toBe(lv === 5);
    }
    const r = rig("ice", 5);
    const e = foe(r, r.d0);
    expect(stillTicks(r, e, castAction(r, tileAt(r, r.d0)))).toBe(secs(2));
  });

  it("thunder target count and stun length", () => {
    for (const lv of LEVELS) {
      const r = rig("lightning", lv);
      const es = Array.from({ length: 12 }, (_, k) => foe(r, r.d0 - 1.5 + k * 0.3));
      expect(cast(r, 12345)).toBe(true); // instant: the target is ignored
      const n = MAGES.lightning.active[lv - 1];
      const front = es.slice(12 - n);
      expect(castEvent(r).hits.sort()).toEqual(front.map((e) => e.id).sort());
      for (const e of es) expect(lost(e)).toBeCloseTo(front.includes(e) ? 2.5 * hitDmg(r) : 0, 6);
    }
    for (const lv of LEVELS) {
      const r = rig("lightning", lv);
      const e = foe(r, r.d0);
      expect(stillTicks(r, e, castAction(r))).toBe(secs(MAGES.lightning.stun![lv - 1]));
    }
  });

  it("thunder only strikes within twice its range", () => {
    const r = rig("lightning", 5);
    const range2 = 2 * mageStats(r.sim, r.m).range;
    const mx = (r.m.tile % 16) + 0.5;
    const my = Math.floor(r.m.tile / 16) + 0.5;
    const far: Enemy[] = [];
    for (let d = 0; d <= pathLength(r.sim.map); d++) {
      const p = pathPoint(r.sim.map, d);
      if (Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2) > range2 + 0.01) far.push(foe(r, d));
    }
    expect(far.length).toBeGreaterThan(0);
    const near = foe(r, r.d0);
    expect(cast(r)).toBe(true);
    expect(castEvent(r).hits).toEqual([near.id]);
  });

  it("thunder L5 charged ground", () => {
    const r = rig("lightning", 5);
    foe(r, r.d0);
    foe(r, r.d0 + 0.1); // same tile: one charged zone
    foe(r, r.d0 + 1);
    expect(cast(r)).toBe(true);
    const z = zones(r, "charged");
    expect(z.map((x) => x.d).sort()).toEqual([r.d0, r.d0 + 1]);
    expect(z.every((x) => x.t === secs(4) && x.owner === r.m.id && x.r === ACTIVES.zoneRadius)).toBe(true);
    const walker = foe(r, r.d0 - 0.5);
    for (let i = 0; i < secs(1); i++) zoneTick(r.sim, r.ev);
    expect(lost(walker)).toBeCloseTo(0.5 * hitDmg(r), 6);
    const l4 = rig("lightning", 4);
    foe(l4, l4.d0);
    cast(l4);
    expect(zones(l4, "charged").length).toBe(0);
  });

  it("earthquake stun and L5 wall blocks ground but not bats", () => {
    for (const lv of LEVELS) {
      const r = rig("earth", lv);
      const at = new Map<number, Enemy>();
      for (let k = -2; k <= 2; k++) at.set(k, foe(r, r.d0 + k));
      expect(cast(r, tileAt(r, r.d0))).toBe(true);
      const hitIds = [-1, 0, 1].map((k) => at.get(k)!.id);
      expect(castEvent(r).hits.sort()).toEqual(hitIds.sort());
      for (const [k, e] of at) expect(lost(e)).toBeCloseTo(Math.abs(k) <= 1 ? 2 * hitDmg(r) : 0, 6);
      expect(zones(r, "wall").length).toBe(lv === 5 ? 1 : 0);
    }
    const r = rig("earth", 1);
    const e = foe(r, r.d0);
    expect(stillTicks(r, e, castAction(r, tileAt(r, r.d0)))).toBe(secs(1.2));

    const w = rig("earth", 5);
    const gob = foe(w, w.d0 - 2);
    const bat = foe(w, w.d0 - 2, "bat");
    step(w.sim, [castAction(w, tileAt(w, w.d0))]);
    expect(zones(w, "wall")[0]).toMatchObject({ d: w.d0, t: secs(3) - 1 });
    for (let i = 1; i < secs(3); i++) {
      step(w.sim, []);
      expect(gob.d).toBeLessThanOrEqual(w.d0);
    }
    expect(gob.d).toBe(w.d0);
    expect(bat.d).toBeGreaterThan(w.d0);
    step(w.sim, []);
    expect(zones(w, "wall").length).toBe(0);
    expect(gob.d).toBeGreaterThan(w.d0);
  });

  it("plague blocks shaman healing and L5 follows enemies", () => {
    const r = rig("poison", 1);
    const e = foe(r, r.d0 + 1);
    e.status.freezeT = 1e6;
    step(r.sim, [castAction(r, tileAt(r, r.d0))]);
    const [z] = zones(r, "plague");
    expect(z).toMatchObject({ r: 1.5, d: r.d0, owner: r.m.id });
    for (let i = 1; i < secs(5); i++) {
      expect(e.status.noHealT).toBeGreaterThan(0);
      step(r.sim, []);
    }
    expect(e.status.noHealT).toBeGreaterThan(0);
    expect(e.status.poison).toMatchObject({ stacks: 3, by: r.m.id, lv: 1, dps: PASSIVES.venomDpsPerLevel });
    step(r.sim, []);
    expect(zones(r, "plague").length).toBe(0);
    step(r.sim, []);
    expect(e.status.noHealT).toBe(0);
    expect(z.d).toBe(r.d0); // L1 cloud stays put

    const f = rig("poison", 5);
    const lead = foe(f, f.d0 + 1);
    foe(f, f.d0 + 0.5);
    expect(cast(f, tileAt(f, f.d0))).toBe(true);
    zoneTick(f.sim, f.ev);
    const [cloud] = zones(f, "plague");
    expect(cloud.d).toBe(f.d0 + 1);
    lead.d += 0.4;
    zoneTick(f.sim, f.ev);
    expect(cloud.d).toBe(f.d0 + 1.4);
    expect(lead.status.poison.stacks).toBe(1);
  });

  it("tornado pulls back max 2 tiles and L5 has two", () => {
    const r = rig("wind", 1);
    const end = pathLength(r.sim.map);
    const gob = foe(r, end - 1);
    const boss = foe(r, end - 1, "goblinChief");
    const bat = foe(r, end - 1, "bat");
    for (const e of [gob, boss, bat]) e.status.freezeT = 1e6;
    expect(cast(r)).toBe(true);
    const [t] = zones(r, "tornado");
    expect(t).toMatchObject({ d: end, t: secs(3) });
    for (let i = 0; i < secs(3); i++) zoneTick(r.sim, r.ev);
    expect(zones(r, "tornado").length).toBe(1);
    zoneTick(r.sim, r.ev);
    expect(zones(r, "tornado").length).toBe(0);
    expect(gob.d).toBeCloseTo(end - 3, 9);
    expect(boss.d).toBe(end - 1);
    expect(bat.d).toBe(end - 1);
    expect(lost(bat)).toBe(0);
    expect(lost(gob)).toBeGreaterThan(0);

    const two = rig("wind", 5);
    expect(cast(two)).toBe(true);
    const ts = zones(two, "tornado");
    expect(ts.map((z) => z.t)).toEqual([secs(3), secs(4)]);
    for (let i = 0; i < secs(1); i++) zoneTick(two.sim, two.ev);
    expect(ts[1].d).toBe(pathLength(two.sim.map));
    zoneTick(two.sim, two.ev);
    expect(ts[1].d).toBeLessThan(pathLength(two.sim.map));
  });

  it("tornado damage is 100% hit damage per second of contact", () => {
    const r = rig("wind", 1);
    const end = pathLength(r.sim.map);
    const boss = foe(r, end, "goblinChief");
    boss.status.freezeT = 1e6;
    cast(r);
    for (let i = 0; i < secs(3); i++) zoneTick(r.sim, r.ev);
    // Touch radius 0.6 at 4 tiles/s: contact while the tornado is within 0.6 tiles.
    const ticks = Math.floor((ACTIVES.zoneRadius * 30) / ACTIVES.tornadoSpeed) + 1;
    expect(lost(boss)).toBeCloseTo((hitDmg(r) * ticks) / 30, 6);
  });

  it("bosses get half stun", () => {
    const r = rig("lightning", 1);
    const e = foe(r, r.d0, "goblinChief");
    expect(stillTicks(r, e, castAction(r))).toBe(secs(0.5));
    const q = rig("earth", 1);
    const f = foe(q, q.d0, "goblinChief");
    expect(stillTicks(q, f, castAction(q, tileAt(q, q.d0)))).toBe(secs(0.6));
    const z = rig("ice", 5);
    const g = foe(z, z.d0, "goblinChief");
    expect(stillTicks(z, g, castAction(z, tileAt(z, z.d0)))).toBe(secs(1));
  });

  it("active kills credit the caster", () => {
    const r = rig("earth", 1);
    (r.sim.map.tiles[r.m.tile] as { terrain: string }).terrain = "ruins";
    const e = foe(r, r.d0, "goblin", 1);
    cast(r, tileAt(r, r.d0));
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(r.ev.find((x) => x.type === "kill")).toMatchObject({ by: r.m.id, gold: 6 });
  });
});
