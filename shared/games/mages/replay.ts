// Mage Siege replay and run verification. The client records actions; the
// server replays them headless with its own seed and records only the replay's
// outcome. hashSim fingerprints the state so tests can check determinism.

import { ENDLESS_MAX_WAVES, MAGES, SPELLS, TRAPS, W, H, secs, type MageId, type SpellId, type TrapId } from "./data";
import { createSim, stars, step, type Action, type Sim, type SimConfig, type SimEvent } from "./sim";
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
const TILES = W * H;

/** Tick limit for a run: every wave of the mode at maximum length. */
export function maxTicksFor(cfg: SimConfig): number {
  const waves = cfg.mode === "endless" ? ENDLESS_MAX_WAVES : STAGE_WAVES[cfg.stage].length;
  return waves * secs(MAX_WAVE_SECS);
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a (32-bit) over the state that decides the game: tick, phase, wave, gold, lives, mages, enemies, traps, zones (in array order). */
export function hashSim(sim: Sim): number {
  let h = FNV_OFFSET;
  const str = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME) >>> 0;
    h = Math.imul(h ^ 0x2c, FNV_PRIME) >>> 0;
  };
  // Floats are rounded to 1e-6 so the hash only reflects meaningful differences.
  const num = (x: number): void => str(String(Math.round(x * 1e6)));
  num(sim.tick);
  str(sim.phase);
  num(sim.wave);
  num(sim.gold);
  num(sim.lives);
  str("M");
  for (const m of sim.mages) {
    num(m.id); str(m.kind); num(m.level); num(m.tile); num(m.cd); num(m.charge); num(m.hits); num(m.stunT); num(m.spent);
  }
  str("E");
  for (const e of sim.enemies) {
    const s = e.status;
    num(e.id); str(e.kind); num(e.hp); num(e.maxHp); num(e.armor); num(e.d); num(e.speed); num(e.order); num(e.gold);
    num(s.slow); num(s.slowT); num(s.stunT); num(s.freezeT); num(s.burnDps); num(s.burnT); num(s.poison.stacks); num(s.poison.t); num(s.shieldT); num(s.noHealT);
  }
  str("T");
  for (const t of sim.traps) {
    num(t.id); str(t.kind); num(t.tile); num(t.dur);
  }
  str("Z");
  for (const z of sim.zones) {
    num(z.id); str(z.kind); num(z.d); num(z.r); num(z.t); num(z.level); num(z.owner); num(z.dmg);
  }
  return h;
}

/**
 * Replays a whole game headless. Actions must be sorted by `t`; each tick's
 * actions go to step() on that tick. Wave 1 starts only by a startWave action;
 * later waves also start on their own after the build break, as in the sim.
 * Stops when the game is won or lost (Endless is won at its 300-wave cap), at
 * `maxTicks`, or when wave 1 can never start. `rejected` counts actions the sim
 * refused plus actions left over when the replay stopped. `onStep` sees the sim
 * and events after every tick.
 */
export function replay(
  cfg: SimConfig,
  actions: Action[],
  maxTicks = maxTicksFor(cfg),
  onStep?: (sim: Sim, ev: SimEvent[]) => void,
): { outcome: Outcome; rejected: number; finished: boolean } {
  const sim = createSim(cfg);
  let next = 0;
  let wavesCleared = 0;
  let livesAtClear = 0;
  while (sim.phase !== "won" && sim.phase !== "lost" && sim.tick < maxTicks) {
    if (sim.wave === 0 && sim.phase === "build" && next >= actions.length) break;
    const batch: Action[] = [];
    // Out-of-order (stale) actions are passed on so the sim counts them as rejected.
    while (next < actions.length && actions[next].t <= sim.tick) batch.push(actions[next++]);
    const ev = step(sim, batch);
    for (const e of ev)
      if (e.type === "waveEnd") {
        wavesCleared++;
        livesAtClear = sim.lives;
      }
    onStep?.(sim, ev);
  }
  const finished = sim.phase === "won" || sim.phase === "lost";
  return {
    outcome: {
      won: sim.phase === "won",
      wavesCleared,
      lives: sim.lives,
      stars: stars(sim),
      score: cfg.mode === "endless" ? wavesCleared * 100 + livesAtClear : 0,
      ticks: sim.tick,
    },
    rejected: sim.rejected + (actions.length - next),
    finished,
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
function parseAction(x: unknown, maxT: number): Action | string {
  if (!isPlainObject(x)) return "action is not an object";
  const t = x.t;
  if (!Number.isInteger(t) || (t as number) < 0 || (t as number) >= maxT) return "bad action tick";
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
 * Verifies an untrusted action log by replaying it with the server's config.
 * Rejects malformed or unsorted logs, more than MAX_ACTIONS actions, any action
 * the sim refuses, and games that do not finish within the mode's tick limit.
 */
export function verifyRun(cfg: SimConfig, actions: unknown): { ok: true; outcome: Outcome } | { ok: false; error: string } {
  if ("__noLeak" in cfg) return { ok: false, error: "test-only config" };
  if (!Array.isArray(actions)) return { ok: false, error: "actions must be an array" };
  if (actions.length > MAX_ACTIONS) return { ok: false, error: "too many actions" };
  const maxTicks = maxTicksFor(cfg);
  const list: Action[] = [];
  let prev = 0;
  for (const raw of actions) {
    const a = parseAction(raw, maxTicks);
    if (typeof a === "string") return { ok: false, error: a };
    if (a.t < prev) return { ok: false, error: "actions out of order" };
    prev = a.t;
    list.push(a);
  }
  const r = replay(cfg, list, maxTicks);
  if (r.rejected > 0) return { ok: false, error: "illegal action" };
  if (!r.finished) return { ok: false, error: "game did not finish" };
  return { ok: true, outcome: r.outcome };
}
