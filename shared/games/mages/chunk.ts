// Mage Siege per-wave verification. The server keeps a run's Sim between
// requests (as a plain-JSON snapshot) and advances it one chunk at a time with the
// client's actions; replay.ts verifies a whole log with the same pieces.

import { ENDLESS_MAX_WAVES, MAGES, SPELLS, TRAPS, W, H, secs, type MageId, type SpellId, type TrapId } from "./data";
import { generateMap } from "./map";
import { restoreRng } from "./rng";
import { stars, step, type Action, type Sim, type SimConfig } from "./sim";
import { STAGE_WAVES } from "./waves";

export interface Outcome {
  won: boolean;
  wavesCleared: number;
  /** Lives left when the game stopped (0 after a loss). */
  lives: number;
  stars: 0 | 1 | 2 | 3;
  /** Endless: waves cleared x 100 + lives left after the last cleared wave. Stage: 0. */
  score: number;
  ticks: number;
}

export const MAX_ACTIONS = 20_000;
/** Longest a single wave (with its build break) may take when bounding a replay. */
const MAX_WAVE_SECS = 120;
/** Longest one chunk may run, counted from the tick its wave or build break began. */
export const CHUNK_SECS = 150;
const TILES = W * H;

/** Tick limit for a run: every wave of the mode at maximum length. */
export function maxTicksFor(cfg: SimConfig): number {
  const waves = cfg.mode === "endless" ? ENDLESS_MAX_WAVES : STAGE_WAVES[cfg.stage].length;
  return waves * secs(MAX_WAVE_SECS);
}

/** The result of the game so far (final once the sim is won or lost). */
export function outcomeOf(sim: Sim): Outcome {
  return {
    won: sim.phase === "won",
    wavesCleared: sim.wavesCleared,
    lives: sim.lives,
    stars: stars(sim),
    score: sim.cfg.mode === "endless" ? sim.wavesCleared * 100 + sim.livesAtClear : 0,
    ticks: sim.tick,
  };
}

/** A Sim as plain JSON: the map is rebuilt from the seed and the RNGs are kept as their states. */
export type SimSnapshot = Omit<Sim, "map" | "rng" | "combatRng"> & { rng: number; combatRng: number };

/** Plain-JSON copy of the sim's state (shares nothing with `sim`). */
export function serializeSim(sim: Sim): SimSnapshot {
  // Fields are listed one by one so anything else on a Sim (a cache) never reaches the snapshot.
  const enemies = sim.enemies.map(({ def, pos, ...e }) => e);
  const mages = sim.mages.map(({ statsFor, ...m }) => m);
  const snap: SimSnapshot = {
    cfg: sim.cfg, tick: sim.tick, phase: sim.phase, wave: sim.wave, breakT: sim.breakT, phaseTick: sim.phaseTick,
    wavesCleared: sim.wavesCleared, livesAtClear: sim.livesAtClear, gold: sim.gold, lives: sim.lives, purchases: sim.purchases,
    mages, enemies, spawnQueue: sim.spawnQueue, nextId: sim.nextId, rejected: sim.rejected, kills: sim.kills,
    shatter: sim.shatter, zones: sim.zones, traps: sim.traps, spellCd: sim.spellCd,
    rng: sim.rng.state(), combatRng: sim.combatRng.state(),
  };
  return JSON.parse(JSON.stringify(snap)) as SimSnapshot;
}

/** Rebuilds a Sim from a snapshot (shares nothing with `snap`); it then steps exactly as the original would. */
export function restoreSim(snap: SimSnapshot): Sim {
  const s = JSON.parse(JSON.stringify(snap)) as SimSnapshot;
  return {
    cfg: s.cfg, map: generateMap(s.cfg.seed), rng: restoreRng(s.rng), combatRng: restoreRng(s.combatRng),
    tick: s.tick, phase: s.phase, wave: s.wave, breakT: s.breakT, phaseTick: s.phaseTick,
    wavesCleared: s.wavesCleared, livesAtClear: s.livesAtClear, gold: s.gold, lives: s.lives, purchases: s.purchases,
    mages: s.mages, enemies: s.enemies, spawnQueue: s.spawnQueue, nextId: s.nextId, rejected: s.rejected, kills: s.kills,
    shatter: s.shatter, zones: s.zones, traps: s.traps, spellCd: s.spellCd,
  };
}

const MAGE_IDS = Object.keys(MAGES) as MageId[];
const TRAP_IDS = Object.keys(TRAPS) as TrapId[];
const SPELL_IDS = Object.keys(SPELLS) as SpellId[];

const isPlainObject = (x: unknown): x is Record<string, unknown> => {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};
const isTile = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < TILES;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === "string" && (list as readonly string[]).includes(x);

/** Parses one untrusted action into a clean Action (known fields only), or returns an error. */
function parseAction(x: unknown, fromTick: number, upTo: number): Action | string {
  if (!isPlainObject(x)) return "action is not an object";
  const t = x.t;
  if (!Number.isInteger(t) || (t as number) < fromTick || (t as number) >= upTo) return "bad action tick";
  const tick = t as number;
  const optTarget = (): number | undefined | null => (x.target === undefined ? undefined : isTile(x.target) ? x.target : null);
  switch (x.type) {
    case "place":
      return oneOf(MAGE_IDS, x.mage) && isTile(x.tile) ? { t: tick, type: "place", mage: x.mage, tile: x.tile } : "bad place action";
    case "merge":
    case "move":
      return isTile(x.from) && isTile(x.to) ? { t: tick, type: x.type, from: x.from, to: x.to } : `bad ${x.type} action`;
    case "sell":
      return isTile(x.tile) ? { t: tick, type: "sell", tile: x.tile } : "bad sell action";
    case "cast": {
      const target = optTarget();
      if (!isTile(x.tile) || target === null) return "bad cast action";
      return target === undefined ? { t: tick, type: "cast", tile: x.tile } : { t: tick, type: "cast", tile: x.tile, target };
    }
    case "trap":
      return oneOf(TRAP_IDS, x.trap) && isTile(x.tile) ? { t: tick, type: "trap", trap: x.trap, tile: x.tile } : "bad trap action";
    case "spell": {
      const target = optTarget();
      if (!oneOf(SPELL_IDS, x.spell) || target === null) return "bad spell action";
      return target === undefined ? { t: tick, type: "spell", spell: x.spell } : { t: tick, type: "spell", spell: x.spell, target };
    }
    case "startWave":
      return { t: tick, type: "startWave" };
    default:
      return "unknown action type";
  }
}

/**
 * Parses an untrusted action list: an array of at most `max` well-formed actions,
 * sorted by tick, every tick in [fromTick, upTo). Returns clean Actions or the first error.
 */
export function validateActions(raw: unknown, fromTick: number, upTo: number, max: number): Action[] | string {
  if (!Array.isArray(raw)) return "actions must be an array";
  if (raw.length > max) return "too many actions";
  const list: Action[] = [];
  let prev = fromTick;
  for (const x of raw) {
    const a = parseAction(x, fromTick, upTo);
    if (typeof a === "string") return a;
    if (a.t < prev) return "actions out of order";
    prev = a.t;
    list.push(a);
  }
  return list;
}

/**
 * Last tick a chunk starting now may run to: the tick the current wave or build
 * break began plus CHUNK_SECS. Before wave 1 the build phase has no timer, so
 * there it counts from the chunk start (idle time costs one bounded chunk per request).
 */
export function chunkLimit(sim: Sim): number {
  const from = sim.phase === "build" && sim.wave === 0 ? sim.tick : sim.phaseTick;
  return from + secs(CHUNK_SECS);
}

/**
 * Steps `sim` from `sim.tick` to `upTo` (exclusive), feeding each tick its
 * actions (sorted, every `t` in [sim.tick, upTo)). Fails on a bad chunk end, a
 * chunk longer than chunkLimit or past the mode's tick limit, a game that ends
 * before `upTo`, and any action the sim refuses. Bad chunk bounds and action
 * lists are refused before stepping; after a failure mid-chunk the sim is part
 * way through and must be discarded.
 */
export function advance(sim: Sim, actions: Action[], upTo: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(upTo) || upTo < sim.tick) return { ok: false, error: "bad chunk end" };
  if (upTo > maxTicksFor(sim.cfg)) return { ok: false, error: "chunk past the tick limit" };
  if (upTo > chunkLimit(sim)) return { ok: false, error: "chunk too long" };
  let prev = sim.tick;
  for (const a of actions) {
    if (!(a.t >= prev && a.t < upTo)) return { ok: false, error: "action outside the chunk" };
    prev = a.t;
  }
  let next = 0;
  const batch: Action[] = [];
  while (sim.tick < upTo) {
    if (sim.phase === "won" || sim.phase === "lost") return { ok: false, error: "chunk runs past the end of the game" };
    batch.length = 0;
    while (next < actions.length && actions[next].t === sim.tick) batch.push(actions[next++]);
    const rejected = sim.rejected;
    step(sim, batch);
    if (sim.rejected !== rejected) return { ok: false, error: "illegal action" };
  }
  return { ok: true };
}
