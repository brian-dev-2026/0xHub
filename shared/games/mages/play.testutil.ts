// Test helper (not simulation code): a scripted player that plays a Sim live and
// records its actions, shared by the replay and chunk tests and the cost test.

import { MAGES, SPELLS, TRAPS, W, type MageId, type TrapId } from "./data";
import { magePrice } from "./combat";
import { hashSim } from "./replay";
import { createSim, step, type Action, type Sim, type SimConfig } from "./sim";

export const stageCfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  seed: 1234,
  mode: "stage",
  stage: 1,
  team: ["fire", "ice", "lightning"],
  traps: ["spike"],
  spells: ["meteor"],
  ...over,
});

export const endlessCfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  seed: 99,
  mode: "endless",
  stage: 1,
  team: ["fire", "ice", "lightning", "earth", "poison"],
  traps: ["spike", "barricade", "frost", "mine"],
  spells: ["meteor", "freeze", "surge"],
  ...over,
});

export interface Script {
  /** Mages to buy, in a repeating cycle. */
  buy: MageId[];
  /** Most mages on the board at once. */
  maxMages: number;
  /** Trap kind and how many to keep on the path. */
  trap?: TrapId;
  maxTraps?: number;
  /** Traps come before mage purchases from this wave on. */
  trapFrom?: number;
  meteor?: boolean;
  /** Stop buying after this many purchases. */
  maxPurchases?: number;
  /** Merge equal mages and cast charged actives (both default on). */
  merge?: boolean;
  cast?: boolean;
  /** Cast Time Freeze when the lead enemy is in the last quarter of the path. */
  freeze?: boolean;
  /** Boss plan: from wave 9 hold the next wave until this many barricades stand ahead of the boss, and aim actives at it. */
  bossBarricades?: number;
}

/** Wins stage 1 with 3 stars using every kind of action. */
export const STRONG: Script = { buy: ["fire"], maxMages: 8, trap: "spike", maxTraps: 3, trapFrom: 3, meteor: true };
/** A player who plans for the Ancient Treant: merges, actives, meteors and barricades where the mages cover the path. Wins stages 1-5. */
/** A player who never merges, casts or uses spells; must not 3-star stage 5. */
export const WEAK: Script = { buy: ["fire", "ice", "lightning", "earth", "poison"], maxMages: 14, trap: "spike", maxTraps: 3, trapFrom: 2, merge: false, cast: false };
export const BALANCED: Script = { buy: ["fire", "fire", "poison"], maxMages: 10, meteor: true, bossBarricades: 4 };
/** The Endless cost-test player (run with __noLeak). */
export const COST_SCRIPT: Script = { buy: ["fire", "lightning", "ice", "earth", "poison"], maxMages: 15, trap: "spike", maxTraps: 6, meteor: true };

/** Buildable tiles ranked by how many path tiles lie within 2.5 tiles (best first, ties by index). */
export function rankedTiles(sim: Sim): number[] {
  const near = (t: number): number =>
    sim.map.path.filter((p) => {
      const dx = (p % W) - (t % W);
      const dy = Math.floor(p / W) - Math.floor(t / W);
      return dx * dx + dy * dy <= 6.25;
    }).length;
  return sim.map.tiles
    .map((tile, i) => ({ i, ok: tile.kind === "build" && tile.terrain !== "blocked", n: near(i) }))
    .filter((x) => x.ok)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.i);
}

/** Distance along the path of the enemy furthest along (-1 when none). */
function best(sim: Sim): number {
  let b = -1;
  for (const e of sim.enemies) if (e.hp > 0 && e.d > b) b = e.d;
  return b;
}

/** Path tile under the enemy furthest along, or null when the board is empty. */
function leadTile(sim: Sim): number | null {
  let best = -1;
  for (const e of sim.enemies) if (e.hp > 0 && e.d > best) best = e.d;
  if (best < 0) return null;
  return sim.map.path[Math.min(sim.map.path.length - 1, Math.floor(best + 0.5))];
}

/**
 * A scripted player: observes the sim and returns this tick's actions. Casts
 * charged actives at the lead enemy, then makes at most one gold or board move
 * (merge, buy, trap, meteor), and starts the next wave as soon as it can.
 */
function policy(s: Script): (sim: Sim, ranked: number[]) => Action[] {
  return (sim, ranked) => {
    const t = sim.tick;
    const out: Action[] = [];
    const lead = leadTile(sim);
    const treant = s.bossBarricades !== undefined ? sim.enemies.find((e) => e.kind === "treant") : undefined;
    const aim = treant ? sim.map.path[Math.min(sim.map.path.length - 1, Math.floor(treant.d + 0.5))] : lead;
    if (aim !== null && s.cast !== false)
      for (const m of sim.mages)
        if (m.charge >= 1 && m.stunT === 0) out.push(MAGES[m.kind].activeTargeted ? { t, type: "cast", tile: m.tile, target: aim } : { t, type: "cast", tile: m.tile });

    const rank = (tile: number): number => ranked.indexOf(tile);
    let move: Action | null = null;
    for (const a of sim.mages) {
      if (move || s.merge === false) break;
      for (const b of sim.mages)
        if (a !== b && a.kind === b.kind && a.level === b.level && a.level < 5 && a.stunT === 0 && b.stunT === 0 && rank(a.tile) > rank(b.tile)) {
          move = { t, type: "merge", from: a.tile, to: b.tile };
          break;
        }
    }
    const bossPrep = s.bossBarricades !== undefined && sim.wave >= 9 && sim.cfg.traps.includes("barricade");
    if (!move && s.freeze && sim.cfg.spells.includes("freeze") && sim.spellCd.freeze === 0 && sim.gold >= SPELLS.freeze.cost && best(sim) > sim.map.path.length * 0.75)
      move = { t, type: "spell", spell: "freeze" };
    if (!move && bossPrep && sim.traps.filter((x) => x.kind === "barricade").length < (s.bossBarricades ?? 0) && sim.gold >= TRAPS.barricade.price) {
      const cover = (p: number): number => sim.mages.reduce((n, m) => { const dx = (p % W) - (m.tile % W), dy = Math.floor(p / W) - Math.floor(m.tile / W); return n + (dx * dx + dy * dy <= 6.5 ? m.level : 0); }, 0);
      const spots = sim.map.path.map((p, i) => ({ p, i })).filter((x) => x.i > 0 && !sim.traps.some((y) => y.tile === x.p) && (!treant || x.i > treant.d + 0.6));
      spots.sort((a, b) => cover(b.p) - cover(a.p) || b.i - a.i);
      if (spots.length) move = { t, type: "trap", trap: "barricade", tile: spots[0].p };
    }
    if (!move && !bossPrep && s.trap && sim.wave >= (s.trapFrom ?? 0) && sim.traps.length < (s.maxTraps ?? 0) && sim.gold >= TRAPS[s.trap].price) {
      const spot = sim.map.path.slice(4).find((p) => !sim.traps.some((x) => x.tile === p));
      if (spot !== undefined) move = { t, type: "trap", trap: s.trap, tile: spot };
    }
    const free = ranked.find((tile) => !sim.mages.some((m) => m.tile === tile));
    if (!move && free !== undefined && sim.mages.length < s.maxMages && sim.purchases < (s.maxPurchases ?? Infinity) && sim.gold >= magePrice(sim))
      move = { t, type: "place", mage: (s.buy.filter((m) => sim.cfg.team.includes(m)))[sim.purchases % s.buy.filter((m) => sim.cfg.team.includes(m)).length], tile: free };
    if (!move && s.meteor && lead !== null && sim.enemies.length >= 4 && sim.spellCd.meteor === 0 && sim.gold >= SPELLS.meteor.cost)
      move = { t, type: "spell", spell: "meteor", target: lead };
    if (move) out.push(move);
    if (sim.phase === "build" && !bossPrep) out.push({ t, type: "startWave" });
    return out;
  };
}

/**
 * Plays `cfg` live with a script, recording every action, until the game ends or
 * `untilWave` is cleared. `hashes` holds hashSim after every waveEnd and
 * `waveEnds` the tick count after each of those steps.
 */
export function play(
  cfg: SimConfig,
  s: Script,
  opts: { maxTicks?: number; untilWave?: number } = {},
): { actions: Action[]; sim: Sim; hashes: number[]; waveEnds: number[] } {
  const sim = createSim(cfg);
  const ranked = rankedTiles(sim);
  const decide = policy(s);
  const actions: Action[] = [];
  const hashes: number[] = [];
  const waveEnds: number[] = [];
  const max = opts.maxTicks ?? 2_000_000;
  while (sim.phase !== "won" && sim.phase !== "lost" && sim.tick < max) {
    if (opts.untilWave !== undefined && sim.phase === "build" && sim.wave >= opts.untilWave) break;
    const acts = opts.untilWave !== undefined && sim.wave >= opts.untilWave ? [] : decide(sim, ranked);
    actions.push(...acts);
    const ev = step(sim, acts);
    if (ev.some((e) => e.type === "waveEnd")) {
      hashes.push(hashSim(sim));
      waveEnds.push(sim.tick);
    }
  }
  return { actions, sim, hashes, waveEnds };
}
