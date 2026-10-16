// Deterministic player simulation shared by the browser (prediction) and the
// server (verification). A game is fully described by its seed, mode, start
// level and a list of input events stamped with the step they happened at.

import { STEP_MS, TetrisEngine, type EngineEvents, type EngineMode, type EngineState } from "./engine";

/** Input event codes (sent over the wire as [step, code, arg] triplets). */
export const Ev = {
  Left: 0,
  Right: 1,
  RotateCW: 2,
  RotateCCW: 3,
  HardDrop: 4,
  Hold: 5,
  SoftOn: 6, // arg = soft drop factor
  SoftOff: 7,
  Garbage: 8, // arg = garbage chunk id being applied
} as const;
export type EvCode = (typeof Ev)[keyof typeof Ev];
export const EV_MAX = 8;

export const MIN_SDF = 1;
export const MAX_SDF = 2000;

/** Steps a player stays frozen after a KO before their field resets (1 second). */
export const KO_FREEZE_STEPS = 60;

export interface SimEvents extends EngineEvents {
  /** Battle only: the player topped out at this step. */
  onKO?(): void;
  /** Battle only: the field was reset after the KO freeze. */
  onReset?(): void;
}

export interface SimOptions {
  mode: EngineMode;
  seed: number;
  startLevel?: number;
  events?: SimEvents;
  /** Maps a garbage chunk id to its line count; return null for an unknown id. */
  resolveGarbage?: (id: number) => number | null;
}

export interface SimState {
  engine: EngineState;
  steps: number;
  koAt: number;
  topOuts: number;
  sdf: number;
}

export class PlayerSim {
  engine: TetrisEngine;
  /** Fixed steps simulated so far. */
  steps = 0;
  /** Step at which the current KO freeze started, or -1. */
  koAt = -1;
  /** Battle: how many times this player has been KO'd. */
  topOuts = 0;
  /** Current soft drop factor (0 = not soft dropping). */
  sdf = 0;
  events: SimEvents;
  resolveGarbage: (id: number) => number | null;

  constructor(opts: SimOptions, engine?: TetrisEngine) {
    this.events = opts.events ?? {};
    this.resolveGarbage = opts.resolveGarbage ?? (() => null);
    this.engine =
      engine ?? new TetrisEngine({ mode: opts.mode, seed: opts.seed, startLevel: opts.startLevel, events: this.engineEvents() });
    this.engine.events = this.engineEvents();
  }

  private engineEvents(): EngineEvents {
    return {
      ...this.events,
      onTopOut: () => {
        this.events.onTopOut?.();
        if (this.engine.mode === "battle") {
          this.koAt = this.steps;
          this.topOuts++;
          this.events.onKO?.();
        }
      },
    };
  }

  /** Re-bind UI callbacks (e.g. after restoring from a server snapshot). */
  setEvents(events: SimEvents) {
    this.events = events;
    this.engine.events = this.engineEvents();
  }

  get frozen(): boolean {
    return this.koAt >= 0;
  }

  /** Whether more input can change anything (endless game over = finished). */
  get finished(): boolean {
    return this.engine.mode === "endless" && this.engine.gameOver;
  }

  /** Apply one input event at the current step. Returns whether it did something. */
  apply(code: number, arg = 0): boolean {
    if (code === Ev.Garbage) {
      const lines = this.resolveGarbage(arg);
      if (lines === null) return false;
      this.engine.receiveGarbage(lines);
      return true;
    }
    if (code === Ev.SoftOn) {
      this.sdf = Math.max(MIN_SDF, Math.min(MAX_SDF, arg || 20));
      return true;
    }
    if (code === Ev.SoftOff) {
      this.sdf = 0;
      return true;
    }
    if (this.frozen || this.engine.gameOver) return false;
    switch (code) {
      case Ev.Left:
        return this.engine.move(-1);
      case Ev.Right:
        return this.engine.move(1);
      case Ev.RotateCW:
        return this.engine.rotate(1);
      case Ev.RotateCCW:
        return this.engine.rotate(-1);
      case Ev.HardDrop: {
        const before = this.engine.piecesPlaced;
        this.engine.hardDrop();
        return this.engine.piecesPlaced > before;
      }
      case Ev.Hold:
        return this.engine.holdPiece();
    }
    return false;
  }

  /** Advance one fixed step. */
  step() {
    if (this.koAt >= 0) {
      if (this.steps - this.koAt >= KO_FREEZE_STEPS) {
        this.koAt = -1;
        this.engine.resetAfterKO();
        this.events.onReset?.();
      }
    } else {
      this.engine.tick(STEP_MS, this.sdf);
    }
    this.steps++;
  }

  /** Advance until `steps === target`. */
  advanceTo(target: number) {
    while (this.steps < target) this.step();
  }

  serialize(): SimState {
    return { engine: this.engine.serialize(), steps: this.steps, koAt: this.koAt, topOuts: this.topOuts, sdf: this.sdf };
  }

  static deserialize(s: SimState, opts: Omit<SimOptions, "mode" | "seed" | "startLevel">): PlayerSim {
    const engine = TetrisEngine.deserialize(s.engine);
    const sim = new PlayerSim({ ...opts, mode: s.engine.mode, seed: 0 }, engine);
    sim.steps = s.steps;
    sim.koAt = s.koAt;
    sim.topOuts = s.topOuts;
    sim.sdf = s.sdf;
    return sim;
  }
}

/**
 * Validate and decode a flat [step, code, arg, step, code, arg, ...] event list.
 * Returns null if malformed. Steps must be non-decreasing and within [from, upTo].
 */
export function decodeEvents(raw: unknown, from: number, upTo: number, maxEvents = 4000): [number, number, number][] | null {
  if (!Array.isArray(raw) || raw.length % 3 !== 0 || raw.length / 3 > maxEvents) return null;
  const out: [number, number, number][] = [];
  let last = from;
  for (let i = 0; i < raw.length; i += 3) {
    const s = raw[i], c = raw[i + 1], a = raw[i + 2];
    if (!Number.isInteger(s) || !Number.isInteger(c) || !Number.isInteger(a)) return null;
    if (s < last || s > upTo || c < 0 || c > EV_MAX || a < 0 || a > 1_000_000) return null;
    last = s;
    out.push([s, c, a]);
  }
  return out;
}

/** Apply a decoded batch to a sim, then advance it to `upTo`. `beforeStep` runs before every tick. */
export function runBatch(
  sim: PlayerSim,
  events: [number, number, number][],
  upTo: number,
  beforeStep?: () => void,
) {
  for (const [s, c, a] of events) {
    while (sim.steps < s) {
      beforeStep?.();
      sim.step();
    }
    sim.apply(c, a);
  }
  while (sim.steps < upTo) {
    beforeStep?.();
    sim.step();
  }
}
