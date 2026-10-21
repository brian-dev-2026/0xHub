// Mage Siege wave tables: stage waves as plain data, plus the seeded Endless
// wave generator. Counts are first-guess balance, tuned during play-testing.

import type { EnemyId } from "./data";
import type { Rng } from "./rng";

/** `count` enemies of `kind`, the first `delay` seconds after the wave starts, then one every `every` seconds. */
export type Group = { kind: EnemyId; count: number; every: number; delay: number };

const g = (kind: EnemyId, count: number, every: number, delay = 0): Group => ({ kind, count, every, delay });

// Stage 1 introduces goblins and wolves; stage 2 adds bats; stage 3 adds brutes;
// stage 4 adds shamans and knights; stage 5 mixes everything. Wave 10 of
// stages 1-4 holds the stage's mini-boss, stage 5's the Ancient Treant.
export const STAGE_WAVES: Record<1 | 2 | 3 | 4 | 5, Group[][]> = {
  1: [
    [g("goblin", 6, 1.5)],
    [g("goblin", 8, 1.3)],
    [g("goblin", 6, 1.2), g("wolf", 3, 1.5, 6)],
    [g("wolf", 6, 1.0)],
    [g("goblin", 10, 1.0), g("wolf", 4, 1.2, 5)],
    [g("goblin", 12, 0.9)],
    [g("wolf", 8, 0.8), g("goblin", 8, 1.0, 4)],
    [g("goblin", 14, 0.8), g("wolf", 6, 0.9, 6)],
    [g("wolf", 12, 0.7), g("goblin", 10, 0.8, 3)],
    [g("goblin", 10, 1.0), g("goblinChief", 1, 0, 6), g("wolf", 6, 1.0, 10)],
  ],
  2: [
    [g("goblin", 8, 1.2), g("wolf", 3, 1.2, 6)],
    [g("bat", 5, 1.5)],
    [g("goblin", 10, 1.0), g("bat", 4, 1.5, 4)],
    [g("wolf", 8, 0.9), g("bat", 4, 1.2, 5)],
    [g("bat", 10, 1.0)],
    [g("goblin", 12, 0.8), g("wolf", 6, 0.9, 4)],
    [g("bat", 8, 1.0), g("wolf", 8, 0.8, 3)],
    [g("goblin", 14, 0.7), g("bat", 8, 1.0, 5)],
    [g("wolf", 12, 0.7), g("bat", 10, 0.8, 4)],
    [g("goblin", 12, 0.8), g("direWolf", 1, 0, 6), g("bat", 8, 1.0, 9)],
  ],
  3: [
    [g("goblin", 10, 1.0), g("bat", 4, 1.2, 6)],
    [g("brute", 3, 3.0)],
    [g("goblin", 10, 0.9), g("brute", 3, 2.5, 5)],
    [g("wolf", 10, 0.8), g("bat", 6, 1.0, 4)],
    [g("brute", 6, 2.0), g("goblin", 8, 1.0, 3)],
    [g("bat", 12, 0.8), g("wolf", 6, 0.9, 5)],
    [g("brute", 8, 1.6), g("wolf", 8, 0.8, 4)],
    [g("goblin", 16, 0.6), g("brute", 5, 2.0, 6)],
    [g("brute", 8, 1.4), g("bat", 10, 0.8, 3), g("wolf", 8, 0.7, 8)],
    [g("brute", 4, 2.0), g("troll", 1, 0, 6), g("goblin", 10, 0.8, 9)],
  ],
  4: [
    [g("goblin", 10, 0.9), g("brute", 2, 3.0, 5)],
    [g("shaman", 2, 3.0), g("goblin", 10, 0.9, 1)],
    [g("knight", 4, 2.5)],
    [g("wolf", 10, 0.7), g("shaman", 3, 2.5, 3)],
    [g("knight", 5, 2.0), g("bat", 8, 1.0, 4)],
    [g("brute", 6, 1.8), g("shaman", 3, 2.5, 4)],
    [g("knight", 6, 1.6), g("wolf", 10, 0.7, 3)],
    [g("goblin", 16, 0.6), g("shaman", 4, 2.0, 2), g("bat", 8, 0.9, 8)],
    [g("knight", 8, 1.4), g("brute", 6, 1.6, 4), g("shaman", 3, 2.5, 6)],
    [g("knight", 4, 2.0), g("witch", 1, 0, 6), g("shaman", 3, 2.0, 8), g("goblin", 10, 0.8, 10)],
  ],
  5: [
    [g("goblin", 12, 0.8), g("wolf", 6, 0.8, 5)],
    [g("bat", 10, 0.9), g("brute", 4, 2.0, 4)],
    [g("knight", 6, 1.6), g("shaman", 3, 2.5, 3)],
    [g("wolf", 14, 0.6), g("bat", 8, 0.9, 4)],
    [g("brute", 8, 1.5), g("shaman", 4, 2.0, 3)],
    [g("knight", 8, 1.4), g("bat", 10, 0.8, 5)],
    [g("goblin", 20, 0.5), g("wolf", 10, 0.6, 4), g("shaman", 4, 2.0, 6)],
    [g("brute", 10, 1.2), g("knight", 8, 1.3, 5)],
    [g("knight", 10, 1.2), g("bat", 12, 0.7, 3), g("brute", 6, 1.5, 8), g("shaman", 4, 2.0, 10)],
    [g("goblin", 12, 0.8), g("treant", 1, 0, 6), g("knight", 6, 1.5, 12)],
  ],
};

/** Endless enemy pool: each kind joins the mix from its wave on. */
const ENDLESS_POOL: { kind: EnemyId; from: number }[] = [
  { kind: "goblin", from: 1 },
  { kind: "wolf", from: 1 },
  { kind: "bat", from: 4 },
  { kind: "brute", from: 7 },
  { kind: "shaman", from: 12 },
  { kind: "knight", from: 16 },
];
const ENDLESS_BOSSES: EnemyId[] = ["goblinChief", "direWolf", "troll", "witch", "treant"];

/** Seeded Endless wave: more groups and bigger, faster groups as waves go on; a boss every 10th wave. */
export function endlessWave(wave: number, rng: Rng): Group[] {
  const pool = ENDLESS_POOL.filter((p) => wave >= p.from).map((p) => p.kind);
  const groupCount = Math.min(4, 1 + Math.floor(wave / 8));
  const count = Math.min(24, 6 + Math.floor(wave / 3));
  const every = Math.max(0.4, 1.2 - wave * 0.01);
  const groups: Group[] = [];
  for (let i = 0; i < groupCount; i++) groups.push(g(rng.pick(pool), count, every, i * 4));
  if (wave % 10 === 0) {
    const n = wave / 10 - 1;
    // One more boss each time the cycle comes around.
    groups.push(g(ENDLESS_BOSSES[n % ENDLESS_BOSSES.length], 1 + Math.floor(n / ENDLESS_BOSSES.length), 3, 6));
  }
  return groups;
}
