import type { MageId } from "../../../shared/games/mages/data";

export { clearPendingRun, loadPendingRun, savePendingRun, type PendingBatch, type PendingRun } from "./submit";

/** UI accent colour per mage element (CSS colour). */
export const MAGE_COLOR: Record<MageId, string>;

/** What a mage's passive and active do at `level` (1–5), with that level's numbers. */
export function describeMage(kind: MageId, level: number): { passive: { name: string; text: string }; active: { name: string; text: string } };

/** What a server refusal means for the player (never the raw reason). */
export function friendlyError(error: unknown): string;

/** The player's choices reported by the screens and HUD. */
export interface UICallbacks {
  exit(): void;
  reload(): void;
  stage(n: number): void;
  endless(): void;
  back(): void;
  play(team: MageId[]): void;
  shop(kind: "mage" | "trap" | "spell", id: string): void;
  startWave(): void;
  speed(): void;
  pause(): void;
  resume(): void;
  quality(name: string): void;
  quit(): void;
  sell(): void;
  closeInfo(): void;
  cancelMode(): void;
  result(action: "retry" | "next" | "map" | "resend"): void;
  resendLeftover(): void;
  discardLeftover(): void;
}

export interface UI {
  world(state: object): void;
  team(opts: object): void;
  showHud(cfg: object): void;
  hideHud(): void;
  frame(sim: object, ctx: object): void;
  banner(text: string | null, color?: string): void;
  mageInfo(mage: object | null, sim?: object, side?: "l" | "r"): void;
  pause(opts: object | null): void;
  results(opts: object): void;
  toast(text: string, bad?: boolean): void;
  holdRing(x: number | null, y?: number, color?: string | null): void;
  insets(): { top: number; right: number; bottom: number; left: number };
  readonly infoOpen: boolean;
  setPortraits(map: Partial<Record<MageId, string>>): void;
}

/** The screens and HUD, built inside `rootEl` (the engine's shadow-root frame). */
export function createUI(rootEl: HTMLElement, on: UICallbacks): UI;
