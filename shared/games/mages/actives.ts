// Mage Siege active skills: tap-to-cast actives and the zones they leave on the
// path. Deterministic (no Math.pow/sin/cos); all damage goes through damage().

import { ACTIVES, BOSS_STUN, ENEMIES, MAGES, PASSIVES, TICK_HZ, secs } from "./data";
import { applyBurn, damage, dist, mageById, mageStats } from "./combat";
import { pathLength, pathPoint } from "./map";
import type { Enemy, Mage, Sim, SimEvent, Trap, Zone } from "./sim";

/**
 * Casts run in the action phase, before statusTick counts timers down on the
 * same tick, so stuns and freezes set by a cast get one extra tick: they then
 * hold the enemy for exactly the stun's ticks, counting the cast tick.
 */
const CAST_LEAD = 1;

/** Ticks a stun or freeze of `s` seconds lasts on `e`: half (rounded to ticks) on bosses. */
const stunTicks = (e: Enemy, s: number): number => secs(ENEMIES[e.kind].boss !== null ? s * BOSS_STUN : s);

function stun(e: Enemy, s: number): void {
  e.status.stunT = Math.max(e.status.stunT, stunTicks(e, s) + CAST_LEAD);
}

export function freeze(e: Enemy, s: number): void {
  e.status.freezeT = Math.max(e.status.freezeT, stunTicks(e, s) + CAST_LEAD);
}

/** Living enemies within `r` tiles (Euclidean between path points) of path position `d`. */
function around(sim: Sim, d: number, r: number): Enemy[] {
  const c = pathPoint(sim.map, d);
  return sim.enemies.filter((e) => {
    if (e.hp <= 0) return false;
    const p = pathPoint(sim.map, e.d);
    return dist(c.x, c.y, p.x, p.y) <= r;
  });
}

/** `n` consecutive path orders centred on `o` (an even count leans forward), shifted to stay on the path. */
function tilesAround(sim: Sim, o: number, n: number): number[] {
  const last = sim.map.path.length - 1;
  const first = Math.max(0, Math.min(last - n + 1, o - Math.floor((n - 1) / 2)));
  return Array.from({ length: n }, (_, i) => first + i);
}

/** Path order of a path tile index, or null for anything else. */
function pathOrder(sim: Sim, target: number | undefined): number | null {
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= sim.map.tiles.length) return null;
  const tile = sim.map.tiles[target];
  return tile.kind === "path" ? tile.order : null;
}

function addZone(sim: Sim, m: Mage, kind: Zone["kind"], d: number, r: number, s: number, dmg: number): Zone {
  const z: Zone = { id: sim.nextId++, kind, d, r, t: secs(s), level: m.level, owner: m.id, dmg };
  if (kind === "tornado") z.carried = {};
  sim.zones.push(z);
  return z;
}

/**
 * Casts mage `m`'s active. Rejects (returns false, changes nothing) when the meter
 * is not full, the mage is stunned, or a targeted active has no path-tile target;
 * instant actives ignore `target`. On success the meter empties.
 */
export function castActive(sim: Sim, m: Mage, target: number | undefined, ev: SimEvent[]): boolean {
  if (m.charge < 1 || m.stunT > 0) return false;
  const def = MAGES[m.kind];
  const order = pathOrder(sim, target);
  if (def.activeTargeted && order === null) return false;
  m.charge = 0;

  const lv = m.level;
  const value = def.active[lv - 1];
  const bonus = lv >= ACTIVES.bonusLevel;
  const dmg = mageStats(sim, m).dmg;
  const note = (hits: Enemy[]): void => {
    ev.push({
      type: "cast", mage: m.id, skill: m.kind, level: lv, ...(def.activeTargeted ? { target } : {}), hits: hits.map((e) => e.id),
    });
  };

  switch (m.kind) {
    case "fire": {
      const pillars = tilesAround(sim, order!, value);
      const hit = new Set<Enemy>();
      for (const p of pillars) for (const e of around(sim, p, ACTIVES.zoneRadius)) hit.add(e);
      note([...hit]);
      for (const e of hit) damage(sim, e, dmg * ACTIVES.pillarDmg, m, ev);
      if (bonus) for (const p of pillars) addZone(sim, m, "lava", p, ACTIVES.zoneRadius, ACTIVES.lavaSecs, dmg);
      return true;
    }
    case "ice": {
      const inside = around(sim, order!, value);
      note(inside);
      if (bonus) for (const e of inside) freeze(e, ACTIVES.blizzardFreezeSecs);
      addZone(sim, m, "blizzard", order!, value, ACTIVES.blizzardSecs, dmg);
      return true;
    }
    case "lightning": {
      const mx = (m.tile % 16) + 0.5;
      const my = Math.floor(m.tile / 16) + 0.5;
      const reach = mageStats(sim, m).range * ACTIVES.thunderRange;
      const struck = sim.enemies
        .filter((e) => {
          if (e.hp <= 0) return false;
          const p = pathPoint(sim.map, e.d);
          return dist(mx, my, p.x, p.y) <= reach;
        })
        .sort((a, b) => b.d - a.d)
        .slice(0, value);
      note(struck);
      const charged = new Set(struck.map((e) => Math.min(pathLength(sim.map), Math.max(0, Math.round(e.d)))));
      for (const e of struck) {
        damage(sim, e, dmg * ACTIVES.thunderDmg, m, ev);
        if (e.hp > 0) stun(e, def.stun![lv - 1]);
      }
      if (bonus) for (const d of charged) addZone(sim, m, "charged", d, ACTIVES.zoneRadius, ACTIVES.chargedSecs, dmg);
      return true;
    }
    case "earth": {
      const hit = new Set<Enemy>();
      for (const p of tilesAround(sim, order!, value)) for (const e of around(sim, p, ACTIVES.zoneRadius)) hit.add(e);
      note([...hit]);
      for (const e of hit) {
        damage(sim, e, dmg * ACTIVES.quakeDmg, m, ev);
        if (e.hp > 0) stun(e, def.stun![lv - 1]);
      }
      if (bonus) addZone(sim, m, "wall", order!, 0, ACTIVES.wallSecs, dmg);
      return true;
    }
    case "poison":
      note(around(sim, order!, value));
      addZone(sim, m, "plague", order!, value, ACTIVES.plagueSecs, dmg);
      return true;
    case "wind":
      note([]);
      for (let i = 0; i < value; i++)
        addZone(sim, m, "tornado", pathLength(sim.map), ACTIVES.zoneRadius, ACTIVES.tornadoSecs + i * ACTIVES.tornadoDelaySecs, dmg);
      return true;
  }
}

/**
 * Advances every zone one tick. A zone made on tick T with `t = N` acts on ticks
 * T..T+N-1 (walls block movement on those ticks too) and is removed on tick T+N.
 * Zone damage is per tick and ignores armor, like burn and venom.
 */
export function zoneTick(sim: Sim, ev: SimEvent[]): void {
  sim.zones = sim.zones.filter((z) => z.t > 0);
  for (const z of sim.zones) {
    zoneEffect(sim, z, ev);
    z.t--;
  }
}

function zoneEffect(sim: Sim, z: Zone, ev: SimEvent[]): void {
  const by = mageById(sim, z.owner);
  const hurt = (e: Enemy, perSec: number): void => damage(sim, e, (z.dmg * perSec) / TICK_HZ, by, ev, { ignoreArmor: true });
  switch (z.kind) {
    case "lava":
      for (const e of around(sim, z.d, z.r)) applyBurn(e, z.dmg * (MAGES.fire.passive[z.level - 1] / 100), z.dmg, z.level, z.owner);
      return;
    case "charged":
      for (const e of around(sim, z.d, z.r)) hurt(e, ACTIVES.chargedDps);
      return;
    case "blizzard":
      for (const e of around(sim, z.d, z.r)) {
        e.status.slow = Math.max(e.status.slow, ACTIVES.blizzardSlow);
        e.status.slowT = Math.max(e.status.slowT, 1);
        hurt(e, ACTIVES.blizzardDps);
      }
      return;
    case "plague": {
      if (z.level >= ACTIVES.bonusLevel) {
        // The cloud drifts with the frontmost enemy inside it.
        for (const e of around(sim, z.d, z.r)) if (e.d > z.d) z.d = e.d;
      }
      const stackNow = (secs(ACTIVES.plagueSecs) - z.t) % secs(ACTIVES.plagueStackSecs) === 0;
      for (const e of around(sim, z.d, z.r)) {
        e.status.noHealT = Math.max(e.status.noHealT, 1);
        if (!stackNow) continue;
        const p = e.status.poison;
        p.stacks = Math.min(MAGES.poison.passive[z.level - 1], p.stacks + 1);
        p.dps = PASSIVES.venomDpsPerLevel * z.level;
        p.t = secs(PASSIVES.venomSecs);
        p.lv = z.level;
        p.by = z.owner;
      }
      return;
    }
    case "wall":
      return;
    case "tornado": {
      // A later tornado waits at the exit until its own 3 s begin.
      if (z.t > secs(ACTIVES.tornadoSecs)) return;
      const stepD = ACTIVES.tornadoSpeed / TICK_HZ;
      for (const e of around(sim, z.d, z.r)) {
        if (ENEMIES[e.kind].flying) continue;
        hurt(e, ACTIVES.tornadoDps);
        // Bosses are immune to knockback.
        if (e.hp <= 0 || ENEMIES[e.kind].boss !== null) continue;
        const carried = z.carried![e.id] ?? 0;
        const mv = Math.min(stepD, ACTIVES.tornadoCarry - carried);
        if (mv <= 0) continue;
        e.d = Math.max(0, e.d - mv);
        z.carried![e.id] = carried + mv;
      }
      z.d = Math.max(0, z.d - stepD);
      return;
    }
  }
}

/** Moving from `e.d` to `to` stops at the blocker `at` if it has not been passed yet. */
export function stopAt(e: Enemy, to: number, at: number): number {
  return e.d <= at && to > at ? at : to;
}

/** Ground enemies are held at the near edge of a barricade tile. */
export const barricadeStop = (sim: Sim, t: Trap): number => (sim.map.tiles[t.tile] as { order: number }).order - 0.5;

/** Where a ground enemy moving from `e.d` to `to` stops: at a rock wall or a barricade it has not passed yet. */
export function wallStop(sim: Sim, e: Enemy, to: number): number {
  if (ENEMIES[e.kind].flying) return to;
  for (const z of sim.zones) if (z.kind === "wall") to = stopAt(e, to, z.d);
  for (const t of sim.traps) if (t.kind === "barricade") to = stopAt(e, to, barricadeStop(sim, t));
  return to;
}
