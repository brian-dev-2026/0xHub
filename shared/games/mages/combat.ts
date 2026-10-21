// Mage Siege combat: mage stats, damage, kills and basic attacks. Deterministic
// (no Math.pow/sin/cos). Passives live here; actives and zones in actives.ts; Tasks 7-8 add traps and bosses.

import { ACTIVE_CHARGE_SECS, BOSS_STUN, ECON, ENEMIES, LEVEL, MAGES, PASSIVES, SHIELD_DAMAGE, TERRAIN_BOOST, TICK_HZ, secs } from "./data";
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

/** Ticks a stun or freeze of `s` seconds lasts on `e`: half (rounded to ticks) on bosses. */
export const stunTicks = (e: Enemy, s: number): number => secs(ENEMIES[e.kind].boss !== null ? s * BOSS_STUN : s);

/** The one kill path: removes the enemy, pays its gold (+50% on ruins) and records the kill. */
export function killEnemy(sim: Sim, e: Enemy, by: Mage | null, ev: SimEvent[]): void {
  const i = sim.enemies.indexOf(e);
  if (i < 0) return;
  sim.enemies.splice(i, 1);
  const gold = by !== null && terrainOf(sim, by) === "ruins" ? Math.floor(e.gold * (1 + TERRAIN_BOOST.ruinsGold)) : e.gold;
  sim.gold += gold;
  sim.kills++;
  ev.push({ type: "kill", enemy: e.id, by: by ? by.id : null, gold });
  onDeath(sim, e, ev);
}

export const dist = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Living enemies within `r` tiles of `from` (by path position), excluding `except`. */
function near(sim: Sim, from: Enemy, r: number, except: ReadonlySet<Enemy> = new Set()): Enemy[] {
  const fp = pathPoint(sim.map, from.d);
  return sim.enemies.filter((o) => {
    if (o === from || o.hp <= 0 || except.has(o)) return false;
    const p = pathPoint(sim.map, o.d);
    return dist(fp.x, fp.y, p.x, p.y) <= r;
  });
}

/** The living enemy in `list` nearest to `from`; ties go to the earlier one in the list. */
function nearest(sim: Sim, from: Enemy, list: Enemy[]): Enemy | null {
  const fp = pathPoint(sim.map, from.d);
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const o of list) {
    const p = pathPoint(sim.map, o.d);
    const d = dist(fp.x, fp.y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/**
 * Death-triggered passives, run from the single kill path after `e` has left the
 * board (so nothing it triggers can hit it again): fire spread/explosion, venom jump, the Treant's saplings.
 */
function onDeath(sim: Sim, e: Enemy, ev: SimEvent[]): void {
  const st = e.status;
  // Saplings die with their Treant (no gold).
  if (e.kind === "treant") for (const s of sim.enemies.filter((o) => o.kind === "sapling")) killEnemy(sim, s, null, ev);
  if (st.burnT > 0 && st.burnLv >= PASSIVES.burnSpreadLevel) {
    const owner = mageById(sim, st.burnBy);
    const spread = near(sim, e, PASSIVES.burnSpreadRadius);
    for (const o of spread) applyBurn(o, st.burnDps, st.burnHit, st.burnLv, st.burnBy);
    if (spread.length > 0) ev.push({ type: "passive", mage: st.burnBy, kind: "burnSpread", targets: spread.map((o) => o.id) });
    if (st.burnLv >= PASSIVES.explodeLevel) {
      const hit = near(sim, e, PASSIVES.explodeRadius);
      ev.push({ type: "passive", mage: st.burnBy, kind: "explode", targets: hit.map((o) => o.id) });
      for (const o of hit) damage(sim, o, st.burnHit * PASSIVES.explodeDmg, owner, ev);
    }
  }
  if (st.poison.stacks > 0 && st.poison.t > 0 && st.poison.lv >= PASSIVES.venomJumpLevel) {
    const best = nearest(sim, e, near(sim, e, PASSIVES.venomJumpRadius));
    if (best !== null) {
      const bp = best.status.poison;
      bp.stacks = Math.min(MAGES.poison.passive[st.poison.lv - 1], bp.stacks + st.poison.stacks);
      bp.dps = st.poison.dps;
      bp.t = secs(PASSIVES.venomSecs);
      bp.lv = st.poison.lv;
      bp.by = st.poison.by;
      ev.push({ type: "passive", mage: st.poison.by, kind: "venomJump", targets: [best.id] });
    }
  }
}

/** The mage with this id, or null once it has been sold or merged away. */
export const mageById = (sim: Sim, id: number): Mage | null => sim.mages.find((m) => m.id === id) ?? null;

/** Sets a burn unless a stronger one (higher dps) is already active; the stronger keeps its level and owner. */
export function applyBurn(e: Enemy, dps: number, hit: number, lv: number, by: number): void {
  const st = e.status;
  if (st.burnT > 0 && st.burnDps > dps) return;
  st.burnDps = dps;
  st.burnT = secs(PASSIVES.burnSecs);
  st.burnLv = lv;
  st.burnHit = hit;
  st.burnBy = by;
}

/** Recomputes the Ice L5 shatter flag; called whenever mages change and each status tick. */
export function refreshShatter(sim: Sim): void {
  sim.shatter = sim.mages.some((m) => m.kind === "ice" && m.level === 5);
}

/**
 * Burn and venom damage, then timer countdown. A status applied on tick T with N
 * ticks is active (movement, shatter) on ticks T..T+N-1 and deals N ticks of damage.
 */
export function statusTick(sim: Sim, ev: SimEvent[]): void {
  refreshShatter(sim);
  for (const e of [...sim.enemies]) {
    if (e.hp <= 0) continue;
    const st = e.status;
    // Counted down first, so every damage source this tick sees the same shield.
    if (st.shieldT > 0) st.shieldT--;
    if (st.burnT > 0) {
      damage(sim, e, st.burnDps / TICK_HZ, mageById(sim, st.burnBy), ev, { ignoreArmor: true });
      if (--st.burnT === 0) {
        st.burnDps = 0;
        st.burnLv = 0;
        st.burnHit = 0;
        st.burnBy = 0;
      }
    }
    if (e.hp <= 0) continue;
    if (st.poison.t > 0) {
      damage(sim, e, (st.poison.stacks * st.poison.dps) / TICK_HZ, mageById(sim, st.poison.by), ev, { ignoreArmor: true });
      if (e.hp > 0 && --st.poison.t === 0) st.poison = { stacks: 0, dps: 0, t: 0, lv: 0, by: 0 };
    }
    if (st.slowT > 0 && --st.slowT === 0) st.slow = 0;
    if (st.freezeT > 0) st.freezeT--;
    if (st.stunT > 0) st.stunT--;
    if (st.noHealT > 0) st.noHealT--;
  }
}

/** Deals damage after armor (floor 1), shatter and shield; kills the enemy at 0 HP. */
export function damage(sim: Sim, e: Enemy, amount: number, by: Mage | null, ev: SimEvent[], opts: { ignoreArmor?: boolean } = {}): void {
  if (e.hp <= 0) return;
  let dealt = opts.ignoreArmor ? amount : Math.max(1, amount - e.armor);
  if (sim.shatter && e.status.freezeT > 0) dealt *= 1.5;
  if (e.status.shieldT > 0) dealt *= SHIELD_DAMAGE;
  e.hp -= dealt;
  if (e.hp <= 0) killEnemy(sim, e, by, ev);
}

const CHARGE_EPS = 1e-9;

/** Charges meters, then each ready mage hits the frontmost enemy in range. */
export function combatTick(sim: Sim, ev: SimEvent[]): void {
  for (const m of sim.mages) {
    const s = mageStats(sim, m);
    // Snap to full within float error so N steps of 1/N fill the meter on tick N.
    m.charge = m.charge + s.chargeRate >= 1 - CHARGE_EPS ? 1 : m.charge + s.chargeRate;
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
    passives(sim, m, target, hit(target), ev);
    m.cd = Math.round(TICK_HZ / s.aps);
  }
}

/** On-hit passives of mage `m` after it hit `target` (m.hits already counts this hit). */
function passives(sim: Sim, m: Mage, target: Enemy, hitDmg: number, ev: SimEvent[]): void {
  const lv = m.level;
  const alive = target.hp > 0;
  const st = target.status;
  const note = (kind: Extract<SimEvent, { type: "passive" }>["kind"], targets: Enemy[]): void => {
    ev.push({ type: "passive", mage: m.id, kind, targets: targets.map((o) => o.id) });
  };
  switch (m.kind) {
    case "fire":
      if (!alive) return;
      applyBurn(target, hitDmg * (MAGES.fire.passive[lv - 1] / 100), hitDmg, lv, m.id);
      note("burn", [target]);
      return;
    case "ice":
      if (!alive) return;
      st.slow = MAGES.ice.passive[lv - 1] / 100;
      st.slowT = secs(PASSIVES.slowSecs);
      note("chill", [target]);
      if (lv >= PASSIVES.freezeLevel && m.hits % PASSIVES.freezeEvery === 0) {
        st.freezeT = stunTicks(target, PASSIVES.freezeSecs);
        note("freeze", [target]);
      }
      if (sim.shatter && st.freezeT > 0) note("shatter", [target]);
      return;
    case "lightning": {
      if (lv < PASSIVES.chainAlwaysLevel && m.hits % PASSIVES.chainEvery !== 0) return;
      const hit = new Set<Enemy>([target]);
      const chained: Enemy[] = [];
      let prev = target;
      let dmg = hitDmg;
      for (let i = 0; i < MAGES.lightning.passive[lv - 1]; i++) {
        const next = nearest(sim, prev, near(sim, prev, PASSIVES.chainRadius, hit));
        if (next === null) break;
        dmg *= PASSIVES.chainFalloff;
        hit.add(next);
        chained.push(next);
        damage(sim, next, dmg, m, ev);
        prev = next;
      }
      if (chained.length > 0) note("chain", chained);
      return;
    }
    case "earth":
      if (alive) {
        target.armor = Math.max(0, target.armor - MAGES.earth.passive[lv - 1]);
        note("armorBreak", [target]);
      }
      if (lv >= PASSIVES.quakeLevel) {
        const victims = near(sim, target, PASSIVES.quakeRadius);
        note("quake", victims);
        for (const o of victims) damage(sim, o, hitDmg * PASSIVES.quakeDmg, m, ev);
      }
      return;
    case "poison": {
      if (!alive) return;
      const p = st.poison;
      p.stacks = Math.min(MAGES.poison.passive[lv - 1], p.stacks + 1);
      p.dps = PASSIVES.venomDpsPerLevel * lv;
      p.t = secs(PASSIVES.venomSecs);
      p.lv = lv;
      p.by = m.id;
      note("venom", [target]);
      return;
    }
    case "wind": {
      // Always draw, so the RNG stream does not depend on who was hit.
      const roll = sim.combatRng.next();
      if (!alive || ENEMIES[target.kind].boss !== null) return;
      if (roll < MAGES.wind.passive[lv - 1] / 100) {
        target.d = Math.max(0, target.d - PASSIVES.knockback[lv - 1]);
        note("gust", [target]);
      }
      return;
    }
  }
}
