import { describe, expect, it } from "vitest";
import { makeRng } from "./rng";
import { ECON, ENEMIES, MAGES, SPELLS, TRAPS, UNLOCKS, type MageId, type SpellId, type TrapId } from "./data";

describe("mage siege rng", () => {
  it("rng is deterministic", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const c = makeRng(42);
    const d = makeRng(43);
    const same = Array.from({ length: 5 }, () => c.next() === d.next()).every(Boolean);
    expect(same).toBe(false);
  });

  it("rng range", () => {
    const r = makeRng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      const v = r.int(6);
      expect(Number.isInteger(v) && v >= 0 && v <= 5).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("state() resumes the stream", () => {
    const a = makeRng(9);
    a.next();
    const b = makeRng(a.state());
    expect(b.next()).toBe(a.next());
  });
});

describe("mage siege data", () => {
  it("every mage has 5-level tables", () => {
    for (const m of Object.values(MAGES)) {
      expect(m.passive.length).toBe(5);
      expect(m.active.length).toBe(5);
    }
  });

  it("spec values", () => {
    expect(MAGES.fire.dmg).toBe(14);
    expect(MAGES.earth.aps).toBe(0.5);
    expect(MAGES.lightning.active).toEqual([3, 5, 7, 9, 10]);
    expect(ENEMIES.knight.armor).toBe(8);
    expect(ENEMIES.treant.hp).toBe(6400);
    expect(TRAPS.mine.price).toBe(70);
    expect(SPELLS.surge.cooldown).toBe(90);
    expect(ECON.waveBonus(3)).toBe(35);
  });

  it("unlocks cover everything once", () => {
    const all = [UNLOCKS.start, ...Object.values(UNLOCKS.stages)];
    const mages = all.flatMap((u) => u.mages ?? []).sort();
    const traps = all.flatMap((u) => u.traps ?? []).sort();
    const spells = all.flatMap((u) => u.spells ?? []).sort();
    expect(mages).toEqual((Object.keys(MAGES) as MageId[]).sort());
    expect(traps).toEqual((Object.keys(TRAPS) as TrapId[]).sort());
    expect(spells).toEqual((Object.keys(SPELLS) as SpellId[]).sort());
  });
});
