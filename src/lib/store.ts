import { useSyncExternalStore } from "react";

// In-memory reactive stores. Nothing is persisted in the browser: the source
// of truth is the server database (see lib/auth.ts).

export interface Store<T> {
  get(): T;
  set(update: Partial<T> | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
  use(): T;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(update) {
      state = typeof update === "function" ? update(state) : { ...state, ...update };
      listeners.forEach((l) => l());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    use() {
      return useSyncExternalStore(store.subscribe, store.get, store.get);
    },
  };
  return store;
}

// ---------- settings ----------

export type Action = "left" | "right" | "soft" | "hard" | "cw" | "ccw" | "hold" | "pause";

export const ACTION_LABELS: Record<Action, string> = {
  left: "Move left",
  right: "Move right",
  soft: "Soft drop",
  hard: "Hard drop",
  cw: "Rotate clockwise",
  ccw: "Rotate counter-clockwise",
  hold: "Hold",
  pause: "Pause",
};

export interface Settings {
  skin: string;
  theme: string;
  ghost: boolean;
  /** Delayed Auto Shift, ms */
  das: number;
  /** Auto Repeat Rate, ms (0 = instant) */
  arr: number;
  /** Soft drop factor (multiplier of gravity), >= 41 = instant */
  sdf: number;
  volume: number;
  keys: Record<Action, string[]>;
  reducedMotion: boolean;
  /** Looks for the other games (ids from games/looks.ts). */
  snakeSkin: string;
  snakeArena: string;
  tiles2048: string;
  minesTheme: string;
  c4Discs: string;
  c4Board: string;
}

export const DEFAULT_KEYS: Record<Action, string[]> = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  soft: ["ArrowDown"],
  hard: ["Space"],
  cw: ["ArrowUp", "KeyX"],
  ccw: ["KeyZ", "ControlLeft"],
  hold: ["KeyC", "ShiftLeft"],
  pause: ["Escape", "KeyP"],
};

export const DEFAULT_SETTINGS: Settings = {
  skin: "classic",
  theme: "battle",
  ghost: true,
  das: 133,
  arr: 10,
  sdf: 20,
  volume: 0.5,
  keys: DEFAULT_KEYS,
  reducedMotion: false,
  snakeSkin: "classic",
  snakeArena: "meadow",
  tiles2048: "classic",
  minesTheme: "modern",
  c4Discs: "classic",
  c4Board: "blue",
};

export const settingsStore = createStore<Settings>(DEFAULT_SETTINGS);

/** Merge settings loaded from the server over the defaults, ignoring unknown/invalid fields. */
export function applyServerSettings(raw: Record<string, unknown> | null) {
  if (!raw) {
    settingsStore.set(DEFAULT_SETTINGS);
    return;
  }
  const next: Settings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k in raw && typeof raw[k] === typeof DEFAULT_SETTINGS[k]) (next as unknown as Record<string, unknown>)[k] = raw[k];
  }
  next.keys = { ...DEFAULT_KEYS, ...(next.keys ?? {}) };
  settingsStore.set(next);
}
