// Mage Siege enemy traits and boss skills: Shaman heal, Goblin Chief summons, Dire Wolf
// sprint, Troll regen, Witch shield and the Ancient Treant. Deterministic; runs once per
// tick from step(), after the zones (so a plague cloud's no-heal already holds) and
// before reaping and movement. Damage-side effects stay in combat.ts.

import { ABILITIES as A, ENEMIES, W, secs } from "./data";
import { dist } from "./combat";
import { pathLength, pathPoint } from "./map";
import { stunMage } from "./actives";
import { spawnEnemy, type Enemy, type Sim, type SimEvent } from "./sim";

/**
 * Skill timers of one enemy. `next*` are absolute ticks: a skill first fires one full
 * period after the enemy spawned, then every period after that. `sprintT` is the
 * ticks of sprint left.
 */
export interface Abilities {
  nextSkill: number;
  nextSlam: number;
  nextHeal: number;
  sprintT: number;
}

/** Timers for a new enemy of `kind` spawned on `tick`. */
export function freshAbilities(kind: Enemy["kind"], tick: number): Abilities {
  const first = (s: number): number => tick + secs(s);
  const t: Abilities = { nextSkill: 0, nextSlam: 0, nextHeal: 0, sprintT: 0 };
  switch (kind) {
    case "shaman": t.nextSkill = first(A.shamanHealSecs); break;
    case "goblinChief": t.nextSkill = first(A.chiefSummonSecs); break;
    case "direWolf": t.nextSkill = first(A.wolfSprintEverySecs); break;
    case "troll": t.nextSkill = first(A.trollRegenSecs); break;
    case "witch": t.nextSkill = first(A.witchShieldEverySecs); break;
    case "treant":
      t.nextSkill = first(A.treantPlantSecs);
      t.nextSlam = first(A.treantSlamSecs);
      t.nextHeal = first(A.treantHealSecs);
      break;
  }
  return t;
}

/** Plague (noHealT) blocks every kind of enemy healing. */
const canHeal = (e: Enemy): boolean => e.hp > 0 && e.status.noHealT <= 0;

/** Heals `e` by `amount` without passing max HP; true if it gained anything. */
function heal(e: Enemy, amount: number): boolean {
  if (!canHeal(e) || e.hp >= e.maxHp) return false;
  e.hp = Math.min(e.maxHp, e.hp + amount);
  return true;
}

/** Living enemies (the caster included) within `r` tiles of `c`, in spawn order. */
function within(sim: Sim, c: Enemy, r: number): Enemy[] {
  const cp = pathPoint(sim.map, c.d);
  return sim.enemies.filter((o) => {
    if (o.hp <= 0) return false;
    const p = pathPoint(sim.map, o.d);
    return dist(cp.x, cp.y, p.x, p.y) <= r;
  });
}

/** True when the skill is due on this tick; moves it one period on. */
function due(sim: Sim, e: Enemy, key: "nextSkill" | "nextSlam" | "nextHeal", periodSecs: number): boolean {
  if (sim.tick < e.abil[key]) return false;
  e.abil[key] = sim.tick + secs(periodSecs);
  return true;
}

export function enemyAbilities(sim: Sim, ev: SimEvent[]): void {
  for (const e of [...sim.enemies]) {
    if (e.hp <= 0 || !sim.enemies.includes(e)) continue;
    const note = (skill: Extract<SimEvent, { type: "bossSkill" }>["skill"], targets: number[]): void => {
      ev.push({ type: "bossSkill", enemy: e.id, skill, targets });
    };
    switch (e.kind) {
      case "shaman":
        if (due(sim, e, "nextSkill", A.shamanHealSecs) && canHeal(e)) {
          const healed = within(sim, e, A.shamanHealRadius).filter((o) => heal(o, o.maxHp * A.shamanHealPct));
          if (healed.length > 0) note("heal", healed.map((o) => o.id));
        }
        break;
      case "goblinChief":
        if (due(sim, e, "nextSkill", A.chiefSummonSecs)) {
          const goblins: number[] = [];
          for (let i = 0; i < A.chiefSummonCount; i++) {
            const g = spawnEnemy(sim, "goblin", e.d);
            goblins.push(g.id);
            ev.push({ type: "spawn", enemy: g.id });
          }
          note("summon", goblins);
        }
        break;
      case "direWolf":
        if (due(sim, e, "nextSkill", A.wolfSprintEverySecs)) {
          e.abil.sprintT = secs(A.wolfSprintSecs);
          note("sprint", [e.id]);
        }
        e.speed = ENEMIES.direWolf.speed * (e.abil.sprintT > 0 ? A.wolfSprintSpeed : 1);
        if (e.abil.sprintT > 0) e.abil.sprintT--;
        break;
      case "troll":
        if (due(sim, e, "nextSkill", A.trollRegenSecs) && e.status.burnT <= 0 && e.status.poison.t <= 0 && heal(e, e.maxHp * A.trollRegenPct))
          note("regen", [e.id]);
        break;
      case "witch":
        if (due(sim, e, "nextSkill", A.witchShieldEverySecs)) {
          const shielded = within(sim, e, A.witchShieldRadius);
          // statusTick counts shieldT down before any damage, so +1 shields the next secs(S) ticks.
          for (const o of shielded) o.status.shieldT = Math.max(o.status.shieldT, secs(A.witchShieldSecs) + 1);
          note("shield", shielded.map((o) => o.id));
        }
        break;
      case "treant":
        treant(sim, e, ev, note);
        break;
    }
  }
}

function treant(sim: Sim, e: Enemy, ev: SimEvent[], note: (skill: "saplings" | "rootSlam" | "heal", targets: number[]) => void): void {
  if (due(sim, e, "nextSkill", A.treantPlantSecs)) {
    const last = pathLength(sim.map) - A.saplingEndMargin;
    const ids: number[] = [];
    for (let i = 1; i <= A.treantSaplings; i++) {
      const s = spawnEnemy(sim, "sapling", Math.min(e.d + i, last));
      s.owner = e.id;
      ids.push(s.id);
      ev.push({ type: "spawn", enemy: s.id });
    }
    note("saplings", ids);
  }
  if (due(sim, e, "nextHeal", A.treantHealSecs)) {
    const n = sim.enemies.filter((o) => o.owner === e.id && o.hp > 0).length;
    if (n > 0 && heal(e, e.maxHp * A.treantHealPctPerSapling * n)) note("heal", [e.id]);
  }
  if (due(sim, e, "nextSlam", A.treantSlamSecs)) {
    const c = pathPoint(sim.map, e.d);
    const away = (m: { tile: number }): number => dist((m.tile % W) + 0.5, Math.floor(m.tile / W) + 0.5, c.x, c.y);
    const hit = [...sim.mages].sort((a, b) => away(a) - away(b) || a.id - b.id).slice(0, A.treantSlamTargets);
    for (const m of hit) stunMage(m, A.treantSlamStunSecs);
    note("rootSlam", hit.map((m) => m.id));
  }
  const enraged = e.hp < e.maxHp * A.treantEnrageBelow;
  e.speed = ENEMIES.treant.speed * (enraged ? A.treantEnrageSpeed : 1);
}
