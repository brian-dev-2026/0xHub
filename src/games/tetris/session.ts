import type { InputBatch, PendingGarbage } from "../../../shared/protocol";
import { BUFFER_ROWS, ROWS, STEP_MS, VISIBLE_ROWS, type ClearEvent, type PieceType } from "../../../shared/tetris/engine";
import { Ev, PlayerSim, type SimEvents, type SimState } from "../../../shared/tetris/sim";
import { sfx } from "../../lib/sfx";
import { settingsStore } from "../../lib/store";
import { InputController } from "./input";
import type { FieldView } from "./render";

export interface Popup {
  id: number;
  text: string;
  sub?: string;
  kind: "clear" | "tspin" | "tetris" | "combo" | "pc" | "b2b" | "garbage" | "ko" | "level";
  at: number;
}

export interface PanelState {
  view: FieldView;
  hold: PieceType | null;
  holdUsed: boolean;
  next: PieceType[];
  incoming: number;
}

export interface SessionOptions {
  mode: "endless" | "battle";
  onClear?(e: ClearEvent): void;
  /** Endless: the game is over. */
  onGameOver?(): void;
  /** Battle: you were KO'd (your field resets after a second). */
  onKO?(): void;
  /** A piece locked (used to flush inputs promptly in battle). */
  onLock?(): void;
}

const FLASH_MS = 220;
/** Never simulate more than this many steps in one frame (keeps the tab responsive while catching up). */
const MAX_CATCHUP_STEPS = 1200;

/**
 * Owns the local player's simulation, input and main loop.
 *
 * The game advances in fixed steps (STEP_MS). Every successful input is
 * recorded with the step it happened at, so the server can replay it exactly.
 */
export class GameSession {
  sim: PlayerSim;
  input: InputController;
  popups: Popup[] = [];
  paused = false;
  /** True while the clock is running (false during countdowns, after the end, before start). */
  running = false;
  /** Battle: server epoch the recorded inputs belong to. */
  epoch = 0;
  shakeAt = 0;

  private log: number[] = [];
  private garbage = new Map<number, number>();
  private flash: { rows: number[]; at: number } | null = null;
  private raf = 0;
  private bgTimer: ReturnType<typeof setInterval> | undefined;
  private last = 0;
  /** Endless: accumulated unpaused play time. */
  private clockMs = 0;
  /** Battle: performance.now() at step 0 (wall-clock driven). */
  private clockStart = 0;
  private popupId = 0;
  private opts: SessionOptions;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.sim = this.makeSim(0);
    const s = this;
    this.input = new InputController(
      {
        move: (dx) => s.act(dx < 0 ? Ev.Left : Ev.Right),
        rotate: (d) => s.act(d > 0 ? Ev.RotateCW : Ev.RotateCCW),
        hardDrop: () => {
          if (s.act(Ev.HardDrop)) sfx.hardDrop();
        },
        holdPiece: () => s.act(Ev.Hold),
        softDrop: (on) => {
          if (on) s.record(Ev.SoftOn, Math.round(Math.min(2000, Math.max(1, settingsStore.get().sdf))));
          else s.record(Ev.SoftOff, 0);
        },
        pause: () => s.togglePause(),
      },
      () => settingsStore.get(),
    );
  }

  // ---------- simulation setup ----------

  private simEvents(): SimEvents {
    return {
      onMove: () => sfx.move(),
      onRotate: (t) => (t !== "none" ? sfx.tspinRotate() : sfx.rotate()),
      onHold: () => sfx.hold(),
      onLock: () => {
        sfx.lock();
        this.opts.onLock?.();
      },
      onClear: (e) => {
        this.flash = { rows: e.rows.filter((r) => r >= 0 && r < VISIBLE_ROWS), at: performance.now() };
        this.onClear(e);
      },
      onGarbageIn: (n) => {
        sfx.garbage();
        this.shakeAt = performance.now();
        this.pushPopup({ text: `+${n}`, sub: "GARBAGE", kind: "garbage" });
      },
      onTopOut: () => {
        if (this.opts.mode === "endless") {
          this.running = false;
          this.opts.onGameOver?.();
        }
      },
      onKO: () => {
        sfx.ko();
        this.input.releaseAll();
        this.opts.onKO?.();
      },
      onLevelUp: (l) => {
        sfx.levelUp();
        this.pushPopup({ text: `LEVEL ${l}`, kind: "level" });
      },
    };
  }

  private makeSim(seed: number, startLevel?: number): PlayerSim {
    return new PlayerSim({
      mode: this.opts.mode,
      seed,
      startLevel,
      events: this.simEvents(),
      resolveGarbage: (id) => this.garbage.get(id) ?? null,
    });
  }

  /** Start a brand-new game from a server-issued seed. */
  newGame(seed: number, startLevel?: number) {
    this.sim = this.makeSim(seed, startLevel);
    this.log = [];
    this.garbage.clear();
    this.popups = [];
    this.flash = null;
    this.paused = false;
    this.clockMs = 0;
    this.input.releaseAll();
  }

  /** Adopt the server's authoritative copy of this game (reconnect / divergence). */
  loadState(state: SimState, epoch: number, pending: PendingGarbage[]) {
    this.sim = PlayerSim.deserialize(state, {
      events: this.simEvents(),
      resolveGarbage: (id) => this.garbage.get(id) ?? null,
    });
    this.epoch = epoch;
    this.log = [];
    this.garbage = new Map(pending.map((p) => [p.id, p.lines]));
    this.input.releaseAll();
    for (const p of pending) this.record(Ev.Garbage, p.id);
  }

  /** Battle: step 0 happens at this performance.now() timestamp. */
  startClock(at: number) {
    this.clockStart = at;
    this.running = true;
  }

  // ---------- actions ----------

  /** Apply an input now and record it if it changed anything. */
  private act(code: number, arg = 0): boolean {
    if (!this.running || this.paused) return false;
    const ok = this.sim.apply(code, arg);
    if (ok) this.log.push(this.sim.steps, code, arg);
    return ok;
  }

  /** Apply + always record (state toggles like soft drop and garbage). */
  private record(code: number, arg: number) {
    this.sim.apply(code, arg);
    this.log.push(this.sim.steps, code, arg);
  }

  /** Battle: garbage arrived from the server. */
  receiveGarbage(id: number, lines: number) {
    if (this.garbage.has(id)) return;
    this.garbage.set(id, lines);
    this.record(Ev.Garbage, id);
  }

  /** Take the inputs recorded since the last flush. */
  flush(): Omit<InputBatch, "epoch"> & { epoch: number } {
    const batch = { epoch: this.epoch, upTo: this.sim.steps, ev: this.log, h: this.sim.engine.hash() };
    this.log = [];
    return batch;
  }

  get hasUnsent(): boolean {
    return this.log.length > 0;
  }

  // ---------- effects ----------

  private onClear(e: ClearEvent) {
    if (e.perfectClear) {
      sfx.tetris();
      this.pushPopup({ text: "PERFECT CLEAR", kind: "pc" });
    } else if (e.tspin !== "none") {
      sfx.tspin();
      this.pushPopup({ text: e.label, kind: "tspin" });
    } else if (e.lines === 4) {
      sfx.tetris();
      this.pushPopup({ text: e.label, kind: "tetris" });
    } else {
      sfx.clear(e.lines);
      if (e.lines >= 2 || e.b2b) this.pushPopup({ text: e.label, kind: e.b2b ? "b2b" : "clear" });
    }
    if (e.combo >= 1) {
      sfx.combo(e.combo);
      this.pushPopup({ text: `${e.combo} COMBO`, kind: "combo" });
    }
    this.opts.onClear?.(e);
  }

  pushPopup(p: Omit<Popup, "id" | "at">) {
    const now = performance.now();
    this.popups = [...this.popups.filter((x) => now - x.at < 1400), { ...p, id: ++this.popupId, at: now }].slice(-4);
  }

  togglePause() {
    if (this.opts.mode === "battle" || !this.running) return;
    this.paused = !this.paused;
    if (this.paused) this.input.releaseAll();
  }

  // ---------- loop ----------

  start() {
    window.addEventListener("keydown", this.input.onKeyDown);
    window.addEventListener("keyup", this.input.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.last = performance.now();
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // Browsers pause requestAnimationFrame in background tabs; keep the game moving anyway.
    this.bgTimer = setInterval(() => {
      if (document.hidden) this.frame();
    }, 250);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.bgTimer);
    window.removeEventListener("keydown", this.input.onKeyDown);
    window.removeEventListener("keyup", this.input.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private frame() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (!this.running || this.paused) return;
    let target: number;
    if (this.opts.mode === "battle") {
      target = Math.floor((now - this.clockStart) / STEP_MS);
    } else {
      this.clockMs += Math.min(dt, 250);
      target = Math.floor(this.clockMs / STEP_MS);
    }
    let n = 0;
    while (this.sim.steps < target && n < MAX_CATCHUP_STEPS && this.running) {
      this.input.update(STEP_MS);
      this.sim.step();
      n++;
    }
  }

  private onBlur = () => {
    this.input.releaseAll();
    if (this.opts.mode === "endless" && this.running) this.paused = true;
  };

  // ---------- rendering ----------

  panelState(): PanelState {
    const e = this.sim.engine;
    const now = performance.now();
    const cells = e.board.slice(BUFFER_ROWS, ROWS);
    let clearingRows: number[] | undefined;
    let clearProgress: number | undefined;
    if (this.flash && now - this.flash.at < FLASH_MS && !settingsStore.get().reducedMotion) {
      clearingRows = this.flash.rows;
      clearProgress = (now - this.flash.at) / FLASH_MS;
    }
    const a = this.sim.frozen ? null : e.active;
    const topRows = e.board.slice(BUFFER_ROWS, BUFFER_ROWS + 4);
    return {
      view: {
        cells,
        active: a ? { ...a, y: a.y - BUFFER_ROWS } : null,
        ghostY: a ? e.ghostY() - BUFFER_ROWS : null,
        clearingRows,
        clearProgress,
        danger: topRows.some((r) => r.some((c) => c !== 0)),
      },
      hold: e.hold,
      holdUsed: e.holdUsed,
      next: e.next,
      incoming: e.incomingTotal,
    };
  }
}
