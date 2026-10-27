// Mage Siege progress rules: what a player has unlocked (derived from cleared
// stages, never stored), whether a run may start, and how a verified outcome
// updates progress.

import { UNLOCKS, type MageId, type SpellId, type TrapId, type Unlock } from "./data";
import type { Outcome } from "./replay";

export type StageNo = 1 | 2 | 3 | 4 | 5;

export interface Progress {
  /** Best stars per cleared stage. */
  cleared: Partial<Record<StageNo, 1 | 2 | 3>>;
  endlessBest: number;
}

export interface Unlocked {
  mages: MageId[];
  traps: TrapId[];
  spells: SpellId[];
  endless: boolean;
  stages: number[];
}

const STAGES: StageNo[] = [1, 2, 3, 4, 5];
const TEAM_SIZE = 5;

export function unlocked(p: Progress): Unlocked {
  const u: Unlocked = { mages: [], traps: [], spells: [], endless: false, stages: [] };
  const add = (x: Unlock): void => {
    u.mages.push(...(x.mages ?? []));
    u.traps.push(...(x.traps ?? []));
    u.spells.push(...(x.spells ?? []));
    if (x.endless) u.endless = true;
  };
  add(UNLOCKS.start);
  for (const s of STAGES) {
    // Stage 1 is always open; stage N+1 opens once stage N is cleared.
    if (s === 1 || p.cleared[(s - 1) as StageNo]) u.stages.push(s);
    if (p.cleared[s]) add(UNLOCKS.stages[s]);
  }
  return u;
}

/** Returns why a run may not start, or null when it may. `team` is untrusted input: exactly min(5, unlocked mages) distinct unlocked mages. Endless ignores `stage`. */
export function checkStart(p: Progress, mode: "stage" | "endless", stage: number, team: unknown): string | null {
  const u = unlocked(p);
  if (mode === "endless") {
    if (!u.endless) return "Endless is locked";
  } else if (mode === "stage") {
    if (!u.stages.includes(stage)) return "stage is locked";
  } else return "unknown mode";

  // Five of the unlocked mages, or all of them while fewer than five are unlocked.
  const size = Math.min(TEAM_SIZE, u.mages.length);
  if (!Array.isArray(team) || team.length !== size) return `team must have ${size} mages`;
  if (!team.every((m) => typeof m === "string" && (u.mages as string[]).includes(m))) return "team has a locked or unknown mage";
  if (new Set(team).size !== team.length) return "team has the same mage twice";
  return null;
}

/** Progress after a verified outcome: a won stage keeps its best stars, Endless keeps the best score (and ignores `stage`). Does not mutate `p`. */
export function applyOutcome(p: Progress, mode: "stage" | "endless", stage: number, o: Outcome): Progress {
  if (mode === "endless") return { cleared: { ...p.cleared }, endlessBest: Math.max(p.endlessBest, o.score) };
  const cleared = { ...p.cleared };
  const s = STAGES.find((x) => x === stage);
  if (s !== undefined && o.won && o.stars > 0) cleared[s] = Math.max(cleared[s] ?? 0, o.stars) as 1 | 2 | 3;
  return { cleared, endlessBest: p.endlessBest };
}
