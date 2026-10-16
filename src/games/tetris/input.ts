import type { Action, Settings } from "../../lib/store";

/**
 * Keyboard + touch input with guideline-style handling:
 * DAS (delay before auto-repeat), ARR (repeat rate, 0 = teleport to wall)
 * and soft drop. Feed it key events and call `update(STEP_MS)` once per
 * simulation step, so auto-shift happens at deterministic steps.
 */
export interface InputTarget {
  move(dx: number): boolean;
  rotate(dir: 1 | -1): boolean;
  hardDrop(): void;
  holdPiece(): boolean;
  softDrop(on: boolean): void;
  pause?(): void;
}

export class InputController {
  private held = new Set<Action>();
  private dir: -1 | 0 | 1 = 0;
  private dasTimer = 0;
  private arrTimer = 0;
  private dasCharged = false;

  constructor(
    private target: InputTarget,
    private getSettings: () => Settings,
  ) {}

  private actionFor(code: string): Action | null {
    const keys = this.getSettings().keys;
    for (const a of Object.keys(keys) as Action[]) if (keys[a].includes(code)) return a;
    return null;
  }

  onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const action = this.actionFor(e.code);
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    this.press(action);
  };

  onKeyUp = (e: KeyboardEvent) => {
    const action = this.actionFor(e.code);
    if (action) this.release(action);
  };

  press(action: Action) {
    if (action === "pause") {
      this.target.pause?.();
      return;
    }
    if (this.held.has(action)) return;
    this.held.add(action);
    switch (action) {
      case "left":
      case "right": {
        const d = action === "left" ? -1 : 1;
        this.dir = d;
        this.dasTimer = 0;
        this.arrTimer = 0;
        this.dasCharged = false;
        this.target.move(d);
        break;
      }
      case "soft":
        this.target.softDrop(true);
        break;
      case "cw":
        this.target.rotate(1);
        break;
      case "ccw":
        this.target.rotate(-1);
        break;
      case "hard":
        this.target.hardDrop();
        break;
      case "hold":
        this.target.holdPiece();
        break;
    }
  }

  release(action: Action) {
    if (!this.held.delete(action)) return;
    if (action === "soft") this.target.softDrop(false);
    if (action === "left" || action === "right") {
      // Fall back to the other direction if it's still held.
      const other = action === "left" ? "right" : "left";
      if (this.held.has(other)) {
        this.dir = other === "left" ? -1 : 1;
        this.dasTimer = 0;
        this.dasCharged = false;
      } else this.dir = 0;
    }
  }

  /** Advance auto-shift by one simulation step. */
  update(dt: number) {
    if (this.dir === 0) return;
    const { das, arr } = this.getSettings();
    if (!this.dasCharged) {
      this.dasTimer += dt;
      if (this.dasTimer < das) return;
      this.dasCharged = true;
      this.arrTimer = arr; // shift immediately once DAS charges
    }
    if (arr === 0) {
      while (this.target.move(this.dir)) {
        /* slide to the wall */
      }
      return;
    }
    this.arrTimer += dt;
    while (this.arrTimer >= arr) {
      this.arrTimer -= arr;
      if (!this.target.move(this.dir)) {
        this.arrTimer = 0;
        break;
      }
    }
  }

  releaseAll() {
    if (this.held.has("soft")) this.target.softDrop(false);
    this.held.clear();
    this.dir = 0;
  }
}
