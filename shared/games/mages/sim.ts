// Mage Siege simulation: fixed 30 Hz ticks, deterministic (seeded RNG only,
// no wall clock, no Math.pow/sin/cos). The renderer reads Sim state and the
// events step() returns; gameplay changes only through actions.

import {
  BUILD_BREAK_SECS, ECON, MAX_LEVEL, ENDLESS_MAX_WAVES, ENDLESS_WAVE_HP, ENEMIES, LIVES, STAGE_HP, STARS, TERRAIN_BOOST, TICK_HZ, WAVE_HP, secs,
  type EnemyId, type MageId, type SpellId, type TrapId,
} from "./data";
import { combatTick, killEnemy, magePrice, refreshShatter, statusTick } from "./combat";
import { generateMap, pathLength, type GameMap } from "./map";
import { makeRng, type Rng } from "./rng";
import { STAGE_WAVES, endlessWave, type Group } from "./waves";

export interface SimConfig {
  seed: number;
  mode: "stage" | "endless";
  stage: 1 | 2 | 3 | 4 | 5;
  team: MageId[];
  traps: TrapId[];
  spells: SpellId[];
}

/** A player input, applied on tick `t`. `place` buys and places in one action. */
export type Action = { t: number } & (
  | { type: "place"; mage: MageId; tile: number }
  | { type: "merge"; from: number; to: number }
  | { type: "move"; from: number; to: number }
  | { type: "sell"; tile: number }
  | { type: "cast"; tile: number; target?: number }
  | { type: "trap"; trap: TrapId; tile: number }
  | { type: "spell"; spell: SpellId; target?: number }
  | { type: "startWave" }
);

/** Status effects; timers are in ticks. */
export interface Status {
  slow: number;
  slowT: number;
  stunT: number;
  freezeT: number;
  burnDps: number;
  burnT: number;
  /** Level of the fire mage that set the burn, and the hit damage it was based on (for death spread/explosion). */
  burnLv: number;
  burnHit: number;
  /** Id of the mage that applied the burn. */
  burnBy: number;
  /** `dps` is per stack; `lv` and `by` are the level and id of the mage that last added a stack. */
  poison: { stacks: number; dps: number; t: number; lv: number; by: number };
  shieldT: number;
  noHealT: number;
}

export interface Enemy {
  id: number;
  kind: EnemyId;
  hp: number;
  maxHp: number;
  armor: number;
  /** Tiles along the path from the entry. */
  d: number;
  /** Tiles per second. */
  speed: number;
  status: Status;
  gold: number;
}

export interface Mage {
  id: number;
  kind: MageId;
  level: 1 | 2 | 3 | 4 | 5;
  tile: number;
  cd: number;
  /** Active charge, 0..1. */
  charge: number;
  hits: number;
  stunT: number;
  /** Gold spent on this mage, including merged-in mages. */
  spent: number;
}

export interface Sim {
  cfg: SimConfig;
  map: GameMap;
  rng: Rng;
  /** Combat randomness (gust); separate from `rng`, which drives Endless wave generation. */
  combatRng: Rng;
  tick: number;
  phase: "build" | "wave" | "won" | "lost";
  /** Current wave number; 0 before wave 1. */
  wave: number;
  /** Ticks left in the build break (only counts down after a wave has been played). */
  breakT: number;
  gold: number;
  lives: number;
  purchases: number;
  mages: Mage[];
  enemies: Enemy[];
  /** Pending spawns of the current wave, sorted by tick. */
  spawnQueue: { tick: number; kind: EnemyId }[];
  nextId: number;
  rejected: number;
  kills: number;
  /** Frozen enemies take +50% damage (kept up by the Ice L5 passive, Task 5). */
  shatter: boolean;
}

export type SimEvent =
  | { type: "spawn"; enemy: number }
  | { type: "leak"; enemy: number; lives: number }
  | { type: "attack"; mage: number; enemy: number }
  | { type: "place"; mage: number }
  | { type: "merge"; mage: number; level: number }
  | { type: "sell"; tile: number; refund: number }
  | { type: "kill"; enemy: number; by: number | null; gold: number }
  | {
      type: "passive";
      mage: number;
      kind: "burn" | "burnSpread" | "explode" | "chill" | "freeze" | "shatter" | "chain" | "armorBreak" | "quake" | "venom" | "venomJump" | "gust";
      targets: number[];
    }
  | { type: "waveStart"; wave: number }
  | { type: "waveEnd"; wave: number; bonus: number }
  | { type: "end"; won: boolean };

export function createSim(cfg: SimConfig): Sim {
  // The map and the wave stream use separate seeds derived from cfg.seed.
  const map = generateMap(cfg.seed);
  return {
    cfg,
    map,
    rng: makeRng(cfg.seed ^ 0x5eed),
    combatRng: makeRng(cfg.seed ^ 0xc0ffee),
    tick: 0,
    phase: "build",
    wave: 0,
    breakT: 0,
    gold: ECON.startGold,
    lives: LIVES,
    purchases: 0,
    mages: [],
    enemies: [],
    spawnQueue: [],
    nextId: 1,
    rejected: 0,
    kills: 0,
    shatter: false,
  };
}

export function totalWaves(sim: Sim): number {
  return sim.cfg.mode === "endless" ? ENDLESS_MAX_WAVES : STAGE_WAVES[sim.cfg.stage].length;
}

export function stars(sim: Sim): 0 | 1 | 2 | 3 {
  if (sim.phase !== "won") return 0;
  if (sim.lives >= STARS[0]) return 3;
  if (sim.lives >= STARS[1]) return 2;
  return 1;
}

/** base^n for a whole n >= 0 (Math.pow is not deterministic across engines). */
const powi = (base: number, n: number): number => {
  let r = 1;
  for (let i = 0; i < n; i++) r *= base;
  return r;
};

/** HP multiplier for enemies of the current wave. */
function hpScale(sim: Sim): number {
  const w = Math.max(1, sim.wave) - 1;
  if (sim.cfg.mode === "endless") return powi(ENDLESS_WAVE_HP, w);
  return powi(STAGE_HP, sim.cfg.stage - 1) * powi(WAVE_HP, w);
}

const freshStatus = (): Status => ({
  slow: 0, slowT: 0, stunT: 0, freezeT: 0, burnDps: 0, burnT: 0, burnLv: 0, burnHit: 0, burnBy: 0,
  poison: { stacks: 0, dps: 0, t: 0, lv: 0, by: 0 }, shieldT: 0, noHealT: 0,
});

function spawnEnemy(sim: Sim, kind: EnemyId, d: number): Enemy {
  const def = ENEMIES[kind];
  const hp = def.hp * hpScale(sim);
  const e: Enemy = {
    id: sim.nextId++, kind, hp, maxHp: hp, armor: def.armor, d, speed: def.speed, status: freshStatus(), gold: def.gold,
  };
  sim.enemies.push(e);
  return e;
}

/** Test hook: spawn an enemy of the current wave's strength at `d` tiles along the path. */
export function spawnForTest(sim: Sim, kind: EnemyId, d = 0): Enemy {
  return spawnEnemy(sim, kind, d);
}

function waveGroups(sim: Sim, wave: number): Group[] {
  return sim.cfg.mode === "endless" ? endlessWave(wave, sim.rng) : STAGE_WAVES[sim.cfg.stage][wave - 1];
}

function startNextWave(sim: Sim, ev: SimEvent[]): void {
  sim.wave++;
  sim.phase = "wave";
  sim.breakT = 0;
  const queue: { tick: number; kind: EnemyId }[] = [];
  for (const grp of waveGroups(sim, sim.wave))
    for (let i = 0; i < grp.count; i++) queue.push({ tick: sim.tick + secs(grp.delay + i * grp.every), kind: grp.kind });
  // Array.prototype.sort is stable, so equal ticks keep group order.
  sim.spawnQueue = queue.sort((a, b) => a.tick - b.tick);
  ev.push({ type: "waveStart", wave: sim.wave });
}

const mageOn = (sim: Sim, tile: number): Mage | undefined => sim.mages.find((m) => m.tile === tile);

/** A buildable (not path, not blocked) tile with no mage on it. */
function isFreeBuildTile(sim: Sim, tile: number): boolean {
  if (!Number.isInteger(tile) || tile < 0 || tile >= sim.map.tiles.length) return false;
  const t = sim.map.tiles[tile];
  return t.kind === "build" && t.terrain !== "blocked" && !mageOn(sim, tile);
}

/** Applies one action; returns false (and changes nothing) when it is not allowed now. */
export function applyAction(sim: Sim, a: Action, ev: SimEvent[]): boolean {
  const ok = applyActionInner(sim, a, ev);
  if (ok) refreshShatter(sim);
  return ok;
}

function applyActionInner(sim: Sim, a: Action, ev: SimEvent[]): boolean {
  switch (a.type) {
    case "startWave":
      // Starts wave 1, or skips the build break between waves.
      if (sim.phase !== "build" || sim.wave >= totalWaves(sim)) return false;
      startNextWave(sim, ev);
      return true;
    case "place": {
      const price = magePrice(sim);
      if (!sim.cfg.team.includes(a.mage) || sim.gold < price || !isFreeBuildTile(sim, a.tile)) return false;
      sim.gold -= price;
      sim.purchases++;
      const m: Mage = { id: sim.nextId++, kind: a.mage, level: 1, tile: a.tile, cd: 0, charge: 0, hits: 0, stunT: 0, spent: price };
      sim.mages.push(m);
      ev.push({ type: "place", mage: m.id });
      return true;
    }
    case "merge": {
      const from = mageOn(sim, a.from);
      const to = mageOn(sim, a.to);
      if (!from || !to || from === to || from.kind !== to.kind || from.level !== to.level || to.level >= MAX_LEVEL) return false;
      to.level = (to.level + 1) as Mage["level"];
      to.spent += from.spent;
      sim.mages.splice(sim.mages.indexOf(from), 1);
      ev.push({ type: "merge", mage: to.id, level: to.level });
      return true;
    }
    case "move": {
      const m = mageOn(sim, a.from);
      if (!m || !isFreeBuildTile(sim, a.to)) return false;
      m.tile = a.to;
      return true;
    }
    case "sell": {
      const m = mageOn(sim, a.tile);
      if (!m) return false;
      const refund = Math.floor(m.spent * ECON.sellRate);
      sim.gold += refund;
      sim.mages.splice(sim.mages.indexOf(m), 1);
      ev.push({ type: "sell", tile: a.tile, refund });
      return true;
    }
    // cast (Task 5), trap (Task 6), spell (Task 7).
    default:
      return false;
  }
}

function spawnDue(sim: Sim, ev: SimEvent[]): void {
  while (sim.spawnQueue.length > 0 && sim.spawnQueue[0].tick <= sim.tick) {
    const { kind } = sim.spawnQueue.shift()!;
    ev.push({ type: "spawn", enemy: spawnEnemy(sim, kind, 0).id });
  }
}

/** Kills enemies left at 0 HP by something other than damage() (e.g. test hooks). */
function reapDead(sim: Sim, ev: SimEvent[]): void {
  for (const e of sim.enemies.filter((x) => x.hp <= 0)) killEnemy(sim, e, null, ev);
}

const BRIDGE_SPEED = 0.5;

/** Speed multiplier from the path tile the enemy is over (the nearest tile centre). */
function terrainFactor(sim: Sim, e: Enemy): number {
  if (ENEMIES[e.kind].flying) return 1;
  const order = Math.min(sim.map.path.length - 1, Math.max(0, Math.floor(e.d + 0.5)));
  const tile = sim.map.tiles[sim.map.path[order]];
  if (tile.kind !== "path") return 1;
  if (tile.terrain === "mud") return TERRAIN_BOOST.mudSpeed;
  if (tile.terrain === "ice") return TERRAIN_BOOST.iceSpeed;
  // Ground enemies bunch up on bridges (spacing halved).
  if (tile.terrain === "bridge") return BRIDGE_SPEED;
  return 1;
}

function moveEnemies(sim: Sim): void {
  for (const e of sim.enemies) {
    if (e.status.freezeT > 0) continue;
    e.d += (e.speed * terrainFactor(sim, e) * (1 - e.status.slow)) / TICK_HZ;
  }
}

/** Enemies past the exit cost lives and leave the board. */
function leak(sim: Sim, ev: SimEvent[]): void {
  const end = pathLength(sim.map);
  sim.enemies = sim.enemies.filter((e) => {
    if (e.d < end) return true;
    const lost = Math.min(sim.lives, ENEMIES[e.kind].leak);
    sim.lives -= lost;
    ev.push({ type: "leak", enemy: e.id, lives: lost });
    return false;
  });
}

function checkWaveEnd(sim: Sim, ev: SimEvent[]): void {
  // A run lost this tick gets no wave bonus.
  if (sim.phase !== "wave" || sim.lives <= 0 || sim.spawnQueue.length > 0 || sim.enemies.length > 0) return;
  const bonus = ECON.waveBonus(sim.wave);
  sim.gold += bonus;
  ev.push({ type: "waveEnd", wave: sim.wave, bonus });
  sim.phase = "build";
  sim.breakT = secs(BUILD_BREAK_SECS);
}

/**
 * Advances exactly one tick. Actions must be stamped with the tick they apply
 * on: those with `t === sim.tick` are applied, those with `t > sim.tick` are
 * left for later (ignored here), and those with `t < sim.tick` are stale and
 * count in `rejected`. Pass each action to step() only until its tick.
 * Order:
 *  1. apply this tick's actions (rejected and stale ones count in `rejected`)
 *  2. build break countdown; at 0 the next wave starts
 *  3. spawn due enemies
 *  4. status ticks (burn, poison, timers), mage combat (later tasks: traps/hazards, boss abilities)
 *  5. reap enemies at 0 HP
 *  6. move enemies
 *  7. leaks
 *  8. wave end
 *  9. end checks (lost at 0 lives, won after the last wave)
 * A finished sim (won/lost) no longer advances.
 */
export function step(sim: Sim, actions: Action[]): SimEvent[] {
  const ev: SimEvent[] = [];
  if (sim.phase === "won" || sim.phase === "lost") return ev;

  for (const a of actions) {
    if (a.t < sim.tick) sim.rejected++;
    else if (a.t === sim.tick && !applyAction(sim, a, ev)) sim.rejected++;
  }

  // Before wave 1 the build phase has no timer and waits for startWave.
  if (sim.phase === "build" && sim.wave > 0 && --sim.breakT <= 0) startNextWave(sim, ev);

  spawnDue(sim, ev);

  // Status timers run before combat so a status applied on tick T is active for
  // exactly secs(S) ticks (T..T+N-1) and burn/poison deal N ticks of damage (T+1..T+N).
  statusTick(sim, ev);
  combatTick(sim, ev);
  // Tasks 6-8 add here: mage actives, stun, trap and spell hazards, shaman/boss abilities.

  reapDead(sim, ev);
  moveEnemies(sim);
  leak(sim, ev);
  checkWaveEnd(sim, ev);

  if (sim.lives <= 0) {
    sim.phase = "lost";
    ev.push({ type: "end", won: false });
  } else if (sim.phase === "build" && sim.wave >= totalWaves(sim)) {
    sim.phase = "won";
    ev.push({ type: "end", won: true });
  }

  sim.tick++;
  return ev;
}
