import { useSyncExternalStore } from "react";

// Tiny persisted stores. Each store is a single JSON blob in localStorage.

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return typeof fallback === "object" && fallback && !Array.isArray(fallback) ? { ...fallback, ...parsed } : parsed;
  } catch {
    return fallback;
  }
}

export interface Store<T> {
  get(): T;
  set(update: Partial<T> | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
  use(): T;
}

export function createStore<T extends object>(key: string, initial: T): Store<T> {
  let state = load(key, initial);
  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(update) {
      state = typeof update === "function" ? update(state) : Array.isArray(state) ? (update as T) : { ...state, ...update };
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* storage unavailable */
      }
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

// ---------- profile ----------

export const AVATARS = ["🎮", "👾", "🦊", "🐉", "🚀", "⚡", "🔥", "🌙", "🐼", "🦄", "💎", "🎯", "🤖", "🐙", "🍀", "👑"];
export const ACCENTS = ["#8b5cf6", "#22d3ee", "#f472b6", "#a3e635", "#fb923c", "#f43f5e", "#facc15", "#60a5fa"];

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  color: string;
  createdAt: number;
}

function randomName() {
  const a = ["Swift", "Neon", "Pixel", "Shadow", "Turbo", "Cosmic", "Lucky", "Iron", "Frost", "Blaze"];
  const b = ["Fox", "Block", "Spinner", "Stacker", "Comet", "Ninja", "Wolf", "Drop", "Titan", "Owl"];
  return `${a[Math.floor(Math.random() * a.length)]}${b[Math.floor(Math.random() * b.length)]}${Math.floor(Math.random() * 90 + 10)}`;
}

export const profileStore = createStore<Profile>("0xhub:profile", {
  id: crypto.randomUUID(),
  name: randomName(),
  avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
  color: ACCENTS[0],
  createdAt: Date.now(),
});
// Persist the generated identity immediately so the id is stable.
profileStore.set({});

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
  /** Soft drop factor (multiplier of gravity), 41 = instant */
  sdf: number;
  volume: number;
  keys: Record<Action, string[]>;
  reducedMotion: boolean;
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

export const settingsStore = createStore<Settings>("0xhub:settings", {
  skin: "classic",
  theme: "battle",
  ghost: true,
  das: 133,
  arr: 10,
  sdf: 20,
  volume: 0.5,
  keys: DEFAULT_KEYS,
  reducedMotion: false,
});

// ---------- stats & history ----------

export interface HistoryEntry {
  mode: "endless" | "battle";
  ts: number;
  score?: number;
  lines: number;
  level?: number;
  result?: "win" | "lose" | "draw";
  opponent?: string;
  kos?: number;
  linesSent?: number;
  durationMs: number;
}

export interface Stats {
  endlessGames: number;
  bestScore: number;
  totalLines: number;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  playTimeMs: number;
  history: HistoryEntry[];
  highScores: { score: number; lines: number; level: number; ts: number }[];
}

export const statsStore = createStore<Stats>("0xhub:stats", {
  endlessGames: 0,
  bestScore: 0,
  totalLines: 0,
  battles: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  kos: 0,
  playTimeMs: 0,
  history: [],
  highScores: [],
});

export function recordEndless(e: { score: number; lines: number; level: number; durationMs: number }) {
  statsStore.set((s) => ({
    ...s,
    endlessGames: s.endlessGames + 1,
    bestScore: Math.max(s.bestScore, e.score),
    totalLines: s.totalLines + e.lines,
    playTimeMs: s.playTimeMs + e.durationMs,
    history: [{ mode: "endless" as const, ts: Date.now(), ...e }, ...s.history].slice(0, 30),
    highScores: [...s.highScores, { score: e.score, lines: e.lines, level: e.level, ts: Date.now() }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10),
  }));
}

export function recordBattle(e: {
  result: "win" | "lose" | "draw";
  opponent: string;
  kos: number;
  linesSent: number;
  lines: number;
  durationMs: number;
}) {
  statsStore.set((s) => ({
    ...s,
    battles: s.battles + 1,
    wins: s.wins + (e.result === "win" ? 1 : 0),
    losses: s.losses + (e.result === "lose" ? 1 : 0),
    draws: s.draws + (e.result === "draw" ? 1 : 0),
    kos: s.kos + e.kos,
    totalLines: s.totalLines + e.lines,
    playTimeMs: s.playTimeMs + e.durationMs,
    history: [{ mode: "battle" as const, ts: Date.now(), ...e }, ...s.history].slice(0, 30),
  }));
}
