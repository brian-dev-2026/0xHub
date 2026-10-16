import { settingsStore } from "../../lib/store";
import { sfx } from "../../lib/sfx";
import { BUFFER_ROWS, ROWS, VISIBLE_ROWS, TetrisEngine, type ClearEvent, type PieceType } from "./engine";
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
  startLevel?: number;
  onClear?(e: ClearEvent): void;
  onTopOut?(): void;
  onFrame?(): void;
  /** Throttled callback whenever the visible state changed (for multiplayer). */
  onSnapshot?(): void;
}

const FLASH_MS = 220;

/** Owns the engine, input and main loop for one local player. */
export class GameSession {
  engine: TetrisEngine;
  input: InputController;
  popups: Popup[] = [];
  paused = false;
  /** When frozen the loop renders but the game doesn't advance (countdown, KO, end). */
  frozen = false;
  private flash: { rows: number[]; at: number } | null = null;
  private raf = 0;
  private last = 0;
  private popupId = 0;
  private lastSnapAt = 0;
  private lastSnapKey = "";
  shakeAt = 0;
  private opts: SessionOptions;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.engine = this.createEngine();
    const self = this;
    this.input = new InputController(
      {
        move: (dx) => self.act(() => self.engine.move(dx)),
        rotate: (d) => self.act(() => self.engine.rotate(d)),
        hardDrop: () => self.act(() => {
          const before = self.engine.piecesPlaced;
          self.engine.hardDrop();
          if (self.engine.piecesPlaced > before) sfx.hardDrop();
          return true;
        }),
        holdPiece: () => self.act(() => self.engine.holdPiece()),
        pause: () => self.togglePause(),
      },
      () => settingsStore.get(),
    );
  }

  private createEngine(): TetrisEngine {
    return new TetrisEngine({
      mode: this.opts.mode,
      startLevel: this.opts.startLevel,
      events: {
        onMove: () => sfx.move(),
        onRotate: (t) => (t !== "none" ? sfx.tspinRotate() : sfx.rotate()),
        onHold: () => sfx.hold(),
        onLock: () => sfx.lock(),
        onClear: (e) => {
          // Flash where the cleared lines were (they collapse instantly underneath).
          this.flash = { rows: e.rows.filter((r) => r >= 0 && r < VISIBLE_ROWS), at: performance.now() };
          this.onClear(e);
        },
        onGarbageIn: (n) => {
          sfx.garbage();
          this.shakeAt = performance.now();
          this.pushPopup({ text: `+${n}`, sub: "GARBAGE", kind: "garbage" });
        },
        onTopOut: () => this.opts.onTopOut?.(),
        onLevelUp: (l) => {
          sfx.levelUp();
          this.pushPopup({ text: `LEVEL ${l}`, kind: "level" });
        },
      },
    });
  }

  private act(fn: () => boolean): boolean {
    if (this.paused || this.frozen || this.engine.gameOver) return false;
    return fn();
  }

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
    if (this.opts.mode === "battle" || this.engine.gameOver) return;
    this.paused = !this.paused;
    if (this.paused) this.input.releaseAll();
  }

  start() {
    window.addEventListener("keydown", this.input.onKeyDown);
    window.addEventListener("keyup", this.input.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - this.last);
      this.last = now;
      if (!this.paused && !this.frozen && !this.engine.gameOver) {
        this.input.update(dt);
        this.engine.tick(dt, this.input.softDropFactor());
      }
      this.maybeSnapshot(now);
      this.opts.onFrame?.();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.input.onKeyDown);
    window.removeEventListener("keyup", this.input.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private onBlur = () => {
    this.input.releaseAll();
    if (this.opts.mode === "endless" && !this.engine.gameOver) this.paused = true;
  };

  private maybeSnapshot(now: number) {
    if (!this.opts.onSnapshot || now - this.lastSnapAt < 50) return;
    const a = this.engine.active;
    const key = `${this.engine.piecesPlaced}|${a?.x},${a?.y},${a?.rot},${a?.type}|${this.engine.hold}|${this.engine.incomingTotal}`;
    if (key === this.lastSnapKey) return;
    this.lastSnapKey = key;
    this.lastSnapAt = now;
    this.opts.onSnapshot();
  }

  /** Fresh field for a new battle round or a KO. */
  resetField() {
    this.engine.resetAfterKO();
    this.flash = null;
  }

  /** Start a brand-new game with a new engine (endless restart / rematch). */
  restart(startLevel?: number) {
    if (startLevel !== undefined) this.opts.startLevel = startLevel;
    this.engine = this.createEngine();
    this.popups = [];
    this.flash = null;
    this.paused = false;
    this.input.releaseAll();
  }

  panelState(): PanelState {
    const e = this.engine;
    const now = performance.now();
    const cells = e.board.slice(BUFFER_ROWS, ROWS);
    let clearingRows: number[] | undefined;
    let clearProgress: number | undefined;
    if (this.flash && now - this.flash.at < FLASH_MS && !settingsStore.get().reducedMotion) {
      clearingRows = this.flash.rows;
      clearProgress = (now - this.flash.at) / FLASH_MS;
    }
    const a = e.active;
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
