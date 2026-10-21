// Mage Siege run verification, without any storage: what the MageRun Durable
// Object does with one chunk of a run. Pure (takes the stored run, the chunk and
// the time; returns a decision and never mutates its input) so it can be tested.

import { MAX_ACTIONS, advance, outcomeOf, restoreSim, serializeSim, validateActions, type SimSnapshot } from "../shared/games/mages/chunk";
import { TICK_HZ } from "../shared/games/mages/data";
import type { Progress } from "../shared/games/mages/progress";
import { hashSim, type Outcome } from "../shared/games/mages/replay";
import { createSim, type SimConfig } from "../shared/games/mages/sim";

/** What a finished run writes to D1 (once, keyed by runId). */
export interface Finish {
  mode: SimConfig["mode"];
  stage: SimConfig["stage"];
  team: SimConfig["team"];
  outcome: Outcome;
  durationMs: number;
  /** "stage": save the won stage's stars; "endless": record the score; "none": record nothing. */
  record: "stage" | "endless" | "none";
}

export interface MageChunkResult {
  ok: boolean;
  error?: string;
  finished?: boolean;
  outcome?: Outcome;
  progress?: Progress;
  /** Endless only: the player's best Endless score and its leaderboard rank. */
  best?: number;
  rank?: number;
}

export interface RunData {
  runId: string;
  userId: string;
  createdAt: number;
  /** The sim after the last accepted chunk (its cfg holds the seed, mode, stage and team); dropped once the run is done. */
  sim: SimSnapshot | null;
  /** Actions accepted so far, across all chunks. */
  actions: number;
  /** End and hash of the last accepted chunk (0 and the starting hash before any). */
  lastUpTo: number;
  lastHash: number;
  invalid: boolean;
  done: boolean;
  /** Set when the run is done: what to record. */
  finish: Finish | null;
  /** Set once the D1 writes succeeded: the final response, replayed to a retried final chunk. */
  result: MageChunkResult | null;
}

export type Decision =
  /** Answer without changing the run. */
  | { kind: "reply"; res: MageChunkResult }
  /** Mark the run invalid for good and answer. */
  | { kind: "kill"; res: MageChunkResult }
  /** Store the advanced run and answer ok. */
  | { kind: "accept"; data: RunData }
  /** Store the done run (data.finish set, no result yet), then record data.finish. */
  | { kind: "finish"; data: RunData }
  /** The run is done but its recording never completed: record data.finish again. */
  | { kind: "record"; data: RunData };

export const CLOCK_TOLERANCE_MS = 3000;
/** The client may play at up to 2x speed. */
export const MAX_GAME_SPEED = 2;

export function newRun(runId: string, userId: string, cfg: SimConfig, now: number): RunData {
  const sim = createSim(cfg);
  return {
    runId, userId, createdAt: now, sim: serializeSim(sim), actions: 0, lastUpTo: 0, lastHash: hashSim(sim),
    invalid: false, done: false, finish: null, result: null,
  };
}

/** Decides what one chunk does to a run (see MageRun for the client contract). */
export function decideChunk(data: RunData | null, userId: string, batch: Record<string, unknown>, now: number): Decision {
  const reply = (error: string): Decision => ({ kind: "reply", res: { ok: false, error } });
  const kill = (error: string): Decision => ({ kind: "kill", res: { ok: false, error } });
  if (!data) return reply("Unknown run");
  if (data.userId !== userId) return reply("Not your run");
  if (data.done) {
    if (data.result) return { kind: "reply", res: data.result };
    return data.finish ? { kind: "record", data } : reply("Run already finished");
  }
  if (data.invalid || !data.sim) return reply("Run failed verification");

  const { upTo, h } = batch;
  const final = batch.final === true;
  if (typeof upTo !== "number" || !Number.isInteger(upTo)) return kill("Bad batch");
  // A resent chunk (its response was lost) is acknowledged again; an older one is refused without harm.
  if (upTo === data.lastUpTo && h === data.lastHash && !final) return { kind: "reply", res: { ok: true } };
  if (upTo < data.lastUpTo) return reply("Chunk already verified");
  // The game can't have run faster than 2x the wall clock since the run started.
  if ((upTo / TICK_HZ) * 1000 > MAX_GAME_SPEED * (now - data.createdAt) + CLOCK_TOLERANCE_MS) return kill("Run is ahead of real time");

  const sim = restoreSim(data.sim);
  const actions = validateActions(batch.actions, sim.tick, upTo, MAX_ACTIONS - data.actions);
  if (typeof actions === "string") return kill(actions === "too many actions" ? "Too many actions" : `Malformed input: ${actions}`);
  const res = advance(sim, actions, upTo);
  if (!res.ok) return kill(`Run failed verification: ${res.error}`);
  const hash = hashSim(sim);
  if (h !== hash) return kill("Run failed verification");

  const next: RunData = { ...data, sim: serializeSim(sim), actions: data.actions + actions.length, lastUpTo: upTo, lastHash: hash };
  if (sim.phase !== "won" && sim.phase !== "lost" && !final) return { kind: "accept", data: next };

  // Over (or quit): a won stage saves its stars, Endless records its score once a wave
  // was cleared, anything else (a lost or quit stage, Endless with no wave cleared) records nothing.
  const { mode, stage, team } = sim.cfg;
  const outcome = outcomeOf(sim);
  const record = mode === "stage" ? (outcome.won ? "stage" : "none") : outcome.wavesCleared > 0 ? "endless" : "none";
  const finish: Finish = { mode, stage, team, outcome, durationMs: Math.round((outcome.ticks / TICK_HZ) * 1000), record };
  return { kind: "finish", data: { ...next, sim: null, done: true, finish, result: null } };
}
