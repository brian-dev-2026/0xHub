// Mage Siege replay and run verification. The client records actions; the
// server replays them headless with its own seed and records only the replay's
// outcome. hashSim fingerprints the state so tests can check determinism.

import { MAX_ACTIONS, SPELL_IDS, maxTicksFor, outcomeOf, validateActions, type Outcome } from "./chunk";
import { createSim, step, type Action, type Sim, type SimConfig, type SimEvent } from "./sim";

export { MAX_ACTIONS, maxTicksFor, type Outcome };

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a (32-bit) over the state that decides the game: counters, both RNG states,
 * spell cooldowns, the spawn queue, mages, enemies, traps and zones (in array order).
 * The server compares it with the client's after every chunk, so it covers every
 * field a drift could hide in.
 */
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
  num(sim.rng.state()); num(sim.combatRng.state());
  num(sim.breakT); num(sim.phaseTick); num(sim.wavesCleared); num(sim.livesAtClear);
  num(sim.purchases); num(sim.nextId); num(sim.kills); str(sim.shatter ? "1" : "0");
  for (const k of SPELL_IDS) num(sim.spellCd[k]);
  str("Q");
  for (const q of sim.spawnQueue) {
    num(q.tick); str(q.kind);
  }
  str("M");
  for (const m of sim.mages) {
    num(m.id); str(m.kind); num(m.level); num(m.tile); num(m.cd); num(m.charge); num(m.hits); num(m.stunT); num(m.spent);
  }
  str("E");
  for (const e of sim.enemies) {
    const s = e.status;
    const p = s.poison;
    const a = e.abil;
    num(e.id); str(e.kind); num(e.hp); num(e.maxHp); num(e.armor); num(e.d); num(e.speed); num(e.order); num(e.gold); num(e.owner ?? -1);
    num(s.slow); num(s.slowT); num(s.stunT); num(s.freezeT); num(s.burnDps); num(s.burnT); num(s.burnLv); num(s.burnHit); num(s.burnBy);
    num(p.stacks); num(p.dps); num(p.t); num(p.lv); num(p.by); num(s.shieldT); num(s.noHealT);
    num(a.nextSkill); num(a.nextSlam); num(a.nextHeal); num(a.sprintT);
  }
  str("T");
  for (const t of sim.traps) {
    num(t.id); str(t.kind); num(t.tile); num(t.dur);
  }
  str("Z");
  for (const z of sim.zones) {
    num(z.id); str(z.kind); num(z.d); num(z.r); num(z.t); num(z.level); num(z.owner); num(z.dmg);
    // Integer keys iterate in ascending order, so this is deterministic.
    if (z.carried) for (const k of Object.keys(z.carried)) {
      str(k); num(z.carried[Number(k)]);
    }
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
  while (sim.phase !== "won" && sim.phase !== "lost" && sim.tick < maxTicks) {
    if (sim.wave === 0 && sim.phase === "build" && next >= actions.length) break;
    const batch: Action[] = [];
    // Out-of-order (stale) actions are passed on so the sim counts them as rejected.
    while (next < actions.length && actions[next].t <= sim.tick) batch.push(actions[next++]);
    const ev = step(sim, batch);
    onStep?.(sim, ev);
  }
  return {
    outcome: outcomeOf(sim),
    rejected: sim.rejected + (actions.length - next),
    finished: sim.phase === "won" || sim.phase === "lost",
  };
}

/**
 * Verifies an untrusted action log by replaying it with the server's config.
 * Rejects malformed or unsorted logs, more than MAX_ACTIONS actions, any action
 * the sim refuses, and games that do not finish within the mode's tick limit.
 */
export function verifyRun(cfg: SimConfig, actions: unknown): { ok: true; outcome: Outcome } | { ok: false; error: string } {
  if ("__noLeak" in cfg) return { ok: false, error: "test-only config" };
  const maxTicks = maxTicksFor(cfg);
  const list = validateActions(actions, 0, maxTicks, MAX_ACTIONS);
  if (typeof list === "string") return { ok: false, error: list };
  const r = replay(cfg, list, maxTicks);
  if (r.rejected > 0) return { ok: false, error: "illegal action" };
  if (!r.finished) return { ok: false, error: "game did not finish" };
  return { ok: true, outcome: r.outcome };
}
