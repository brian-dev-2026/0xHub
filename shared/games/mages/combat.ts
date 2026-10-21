// Mage Siege combat: mage stats, damage, kills and basic attacks. Deterministic
// (no Math.pow/sin/cos). Tasks 5-8 add passives, actives, traps and bosses on top.

import { ACTIVE_CHARGE_SECS, ECON, ENEMIES, LEVEL, MAGES, TERRAIN_BOOST, TICK_HZ, secs } from "./data";
import { pathPoint } from "./map";
import type { Enemy, Mage, Sim, SimEvent } from "./sim";

/** base^n for a whole n >= 0. */
const powi = (base: number, n: number): number => {
  let r = 1;
  for (let i = 0; i < n; i++) r *= base;
  return r;
};

const terrainOf = (sim: Sim, m: Mage): string => {
  const t = sim.map.tiles[m.tile];
  return t.kind === "build" ? t.terrain : "";
};

/** Price of the next mage purchase. */
export function magePrice(sim: Sim): number {
  return ECON.magePrice + ECON.priceStep * sim.purchases;
}

/** Effective stats of a mage: level scaling plus terrain boosts. chargeRate is per tick. */
export function mageStats(sim: Sim, m: Mage): { dmg: number; aps: number; range: number; chargeRate: number } {
  const def = MAGES[m.kind];
  const terrain = terrainOf(sim, m);
  const lv = m.level - 1;
  let dmg = def.dmg * powi(LEVEL.dmg, lv);
  if (def.boost.includes(terrain as never)) dmg *= 1 + TERRAIN_BOOST.dmg;
  const aps = def.aps * (1 + LEVEL.aps * lv);
  let range = def.range * (1 + LEVEL.range * lv);
  if (terrain === "hill") range *= 1 + TERRAIN_BOOST.hillRange;
  let chargeRate = 1 / secs(ACTIVE_CHARGE_SECS);
  if (terrain === "crystal") chargeRate *= 1 + TERRAIN_BOOST.crystalCharge;
  else if (terrain === "well") chargeRate *= 1 + TERRAIN_BOOST.wellCharge;
  return { dmg, aps, range, chargeRate };
}

/** The one kill path: removes the enemy, pays its gold (+50% on ruins) and records the kill. */
export function killEnemy(sim: Sim, e: Enemy, by: Mage | null, ev: SimEvent[]): void {
  const i = sim.enemies.indexOf(e);
  if (i < 0) return;
  sim.enemies.splice(i, 1);
  const gold = by !== null && terrainOf(sim, by) === "ruins" ? Math.floor(e.gold * (1 + TERRAIN_BOOST.ruinsGold)) : e.gold;
  sim.gold += gold;
  sim.kills++;
  ev.push({ type: "kill", enemy: e.id, by: by ? by.id : null, gold });
}

/** Deals damage after armor (floor 1), shatter and shield; kills the enemy at 0 HP. */
export function damage(sim: Sim, e: Enemy, amount: number, by: Mage | null, ev: SimEvent[]): void {
  if (e.hp <= 0) return;
  let dealt = Math.max(1, amount - e.armor);
  if (sim.shatter && e.status.freezeT > 0) dealt *= 1.5;
  if (e.status.shieldT > 0) dealt *= 0.5;
  e.hp -= dealt;
  if (e.hp <= 0) killEnemy(sim, e, by, ev);
}

const dist = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Charges meters, then each ready mage hits the frontmost enemy in range. */
export function combatTick(sim: Sim, ev: SimEvent[]): void {
  for (const m of sim.mages) {
    const s = mageStats(sim, m);
    m.charge = Math.min(1, m.charge + s.chargeRate);
    if (m.stunT > 0) m.stunT--;
    if (m.cd > 0) m.cd--;
    if (m.cd > 0 || m.stunT > 0) continue;

    const mx = (m.tile % 16) + 0.5;
    const my = Math.floor(m.tile / 16) + 0.5;
    let target: Enemy | null = null;
    for (const e of sim.enemies) {
      if (e.hp <= 0 || (target !== null && e.d <= target.d)) continue;
      const p = pathPoint(sim.map, e.d);
      if (dist(mx, my, p.x, p.y) <= s.range) target = e;
    }
    if (target === null) continue;

    const def = MAGES[m.kind];
    const hit = (e: Enemy): number => (ENEMIES[e.kind].flying ? s.dmg * def.vsFlying : s.dmg);
    // Splash victims are picked before any damage lands.
    const tp = pathPoint(sim.map, target.d);
    const splashed =
      def.splash > 0
        ? sim.enemies.filter((e) => {
            if (e === target || e.hp <= 0) return false;
            const p = pathPoint(sim.map, e.d);
            return dist(tp.x, tp.y, p.x, p.y) <= def.splash;
          })
        : [];
    ev.push({ type: "attack", mage: m.id, enemy: target.id });
    damage(sim, target, hit(target), m, ev);
    for (const e of splashed) damage(sim, e, hit(e), m, ev);
    m.hits++;
    m.cd = Math.round(TICK_HZ / s.aps);
  }
}
