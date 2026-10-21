// Mage Siege traps and spells. Traps sit on path tiles and wear down; spells cost
// gold and recharge. Deterministic; all damage goes through damage() with no mage
// credited, and freezes reuse the actives' helper so tick semantics match.

import { ENEMIES, MAX_TRAPS, METEOR_STAGE_SCALE, SPELLS, TICK_HZ, TRAPS, TRAP_STAGE_SCALE, secs, type SpellId, type TrapId } from "./data";
import { barricadeStop, freeze } from "./actives";
import { damage, dist } from "./combat";
import { pathLength, pathPoint } from "./map";
import type { Enemy, Sim, SimEvent, Trap } from "./sim";

/** base^n for a whole n >= 0 (Math.pow is not deterministic across engines). */
export const powi = (base: number, n: number): number => {
  let r = 1;
  for (let i = 0; i < n; i++) r *= base;
  return r;
};

/** Float slack for durability that is worn down in 1/TICK_HZ steps. */
const DUR_EPS = 1e-9;
const MINE_RADIUS = 1;
const METEOR_RADIUS = 1.2;
/** A brute stops for a trap lying at most this many tiles ahead... */
const BRUTE_REACH = 1;
/** ...but not one it is already entering (within half a tile). */
const BRUTE_MIN_GAP = 0.5;
const BRUTE_DUR_MULT = 3;

const isGround = (e: Enemy): boolean => !ENEMIES[e.kind].flying;
const durMult = (e: Enemy): number => (e.kind === "brute" ? BRUTE_DUR_MULT : 1);
const orderOf = (sim: Sim, t: Trap): number => (sim.map.tiles[t.tile] as { order: number }).order;

/** Path tile order an enemy is on: the nearest tile centre. */
const tileOrder = (sim: Sim, e: Enemy): number => Math.min(pathLength(sim.map), Math.max(0, Math.floor(e.d + 0.5)));

/** Living enemies within `r` tiles of the point (cx, cy), measured to their path points. */
function within(sim: Sim, cx: number, cy: number, r: number, groundOnly: boolean): Enemy[] {
  return sim.enemies.filter((e) => {
    if (e.hp <= 0 || (groundOnly && !isGround(e))) return false;
    const p = pathPoint(sim.map, e.d);
    return dist(cx, cy, p.x, p.y) <= r;
  });
}

/** Buys a trap and puts it on an empty path tile. Rejects (changes nothing) when not allowed. */
export function placeTrap(sim: Sim, kind: TrapId, tile: number, ev: SimEvent[]): boolean {
  const def = TRAPS[kind];
  if (!def || !sim.cfg.traps.includes(kind) || sim.gold < def.price || sim.traps.length >= MAX_TRAPS) return false;
  if (!Number.isInteger(tile) || tile < 0 || tile >= sim.map.tiles.length || sim.map.tiles[tile].kind !== "path") return false;
  if (sim.traps.some((t) => t.tile === tile)) return false;
  sim.gold -= def.price;
  const t: Trap = { id: sim.nextId++, kind, tile, dur: def.durability };
  sim.traps.push(t);
  ev.push({ type: "trapPlace", trap: t.id });
  return true;
}

/** Casts a spell. Rejects (changes nothing) when locked, cooling down, unaffordable, or a meteor has no valid target tile. */
export function castSpell(sim: Sim, kind: SpellId, target: number | undefined, ev: SimEvent[]): boolean {
  const def = SPELLS[kind];
  if (!def || !sim.cfg.spells.includes(kind) || sim.spellCd[kind] > 0 || sim.gold < def.cost) return false;
  if (kind === "meteor" && (target === undefined || !Number.isInteger(target) || target < 0 || target >= sim.map.tiles.length)) return false;
  sim.gold -= def.cost;
  sim.spellCd[kind] = secs(def.cooldown);
  if (kind === "meteor") {
    const cx = (target! % 16) + 0.5;
    const cy = Math.floor(target! / 16) + 0.5;
    const dmg = def.value * powi(METEOR_STAGE_SCALE, sim.cfg.stage - 1);
    ev.push({ type: "spell", spell: kind, target });
    for (const e of within(sim, cx, cy, METEOR_RADIUS, false)) damage(sim, e, dmg, null, ev);
  } else if (kind === "freeze") {
    ev.push({ type: "spell", spell: kind });
    for (const e of sim.enemies) if (e.hp > 0) freeze(e, def.value);
  } else {
    ev.push({ type: "spell", spell: kind });
    for (const m of sim.mages) m.charge = 1;
  }
  return true;
}

/** The trap a brute at `e` is attacking: the nearest one between half a tile and one tile ahead. */
function bruteTarget(sim: Sim, e: Enemy): Trap | null {
  if (e.kind !== "brute") return null;
  let best: Trap | null = null;
  let bestGap = Infinity;
  for (const t of sim.traps) {
    const gap = orderOf(sim, t) - e.d;
    if (gap > BRUTE_MIN_GAP && gap <= BRUTE_REACH && gap < bestGap) {
      best = t;
      bestGap = gap;
    }
  }
  return best;
}

/** A brute halts while it has a trap to attack; others are unaffected (barricades are handled by wallStop). */
export function trapStop(sim: Sim, e: Enemy, to: number): number {
  return bruteTarget(sim, e) !== null ? Math.min(to, e.d) : to;
}

function breakTrap(sim: Sim, t: Trap, ev: SimEvent[]): void {
  sim.traps.splice(sim.traps.indexOf(t), 1);
  ev.push({ type: "trapBreak", trap: t.id });
}

/** Applies a trap's effect to the ground enemies that just entered its tile. */
function trigger(sim: Sim, t: Trap, entrants: Enemy[], ev: SimEvent[]): void {
  const scale = powi(TRAP_STAGE_SCALE, sim.cfg.stage - 1);
  const def = TRAPS[t.kind];
  if (t.kind === "mine") {
    const c = pathPoint(sim.map, orderOf(sim, t));
    const caught = within(sim, c.x, c.y, MINE_RADIUS, true);
    t.dur = 0;
    ev.push({ type: "trapTrigger", trap: t.id, enemies: entrants.map((e) => e.id) });
    for (const e of caught) damage(sim, e, def.value * scale, null, ev);
    return;
  }
  if (t.kind === "barricade") return;
  const hit: Enemy[] = [];
  for (const e of entrants) {
    if (t.dur <= DUR_EPS) break;
    hit.push(e);
    t.dur -= durMult(e);
    if (t.kind === "spike") damage(sim, e, def.value * scale, null, ev);
    else {
      e.status.slow = Math.max(e.status.slow, def.value);
      e.status.slowT = Math.max(e.status.slowT, secs(def.secs ?? 0));
    }
  }
  if (hit.length > 0) ev.push({ type: "trapTrigger", trap: t.id, enemies: hit.map((e) => e.id) });
}

/**
 * Runs after the zones and before movement. Cools spells down; fires traps for
 * ground enemies that entered their tile since the last tick; wears barricades
 * (held enemies) and any trap a brute is attacking; removes broken traps.
 */
export function hazardTick(sim: Sim, ev: SimEvent[]): void {
  for (const k of Object.keys(sim.spellCd) as SpellId[]) if (sim.spellCd[k] > 0) sim.spellCd[k]--;

  // Ground enemies that moved onto a new tile since the last tick.
  const entered = new Map<Enemy, number>();
  for (const e of sim.enemies) {
    const o = tileOrder(sim, e);
    if (o === e.order) continue;
    e.order = o;
    if (isGround(e) && e.hp > 0) entered.set(e, o);
  }
  for (const t of [...sim.traps]) {
    const o = orderOf(sim, t);
    const entrants = [...entered].filter(([e, n]) => n === o && e.hp > 0).map(([e]) => e);
    if (entrants.length === 0) continue;
    trigger(sim, t, entrants, ev);
    if (t.dur <= DUR_EPS) breakTrap(sim, t, ev);
  }

  // Wear: barricade-held enemies and brutes attacking a trap.
  const wear = new Map<Trap, number>();
  const hurt = (t: Trap, mult: number): void => void wear.set(t, (wear.get(t) ?? 0) + mult / TICK_HZ);
  for (const e of sim.enemies) {
    if (e.hp <= 0 || !isGround(e)) continue;
    const target = bruteTarget(sim, e);
    if (target) hurt(target, BRUTE_DUR_MULT);
    else for (const t of sim.traps) if (t.kind === "barricade" && e.d === barricadeStop(sim, t)) hurt(t, durMult(e));
  }
  for (const t of [...sim.traps]) {
    const w = wear.get(t);
    if (w === undefined) continue;
    t.dur -= w;
    if (t.dur <= DUR_EPS) breakTrap(sim, t, ev);
  }
}
