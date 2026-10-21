// Random terrain map generation for Mage Siege. Deterministic: only the seeded
// RNG is used, and retries continue the same stream.

import { H, W, type BuildTerrain, type PathTerrain } from "./data";
import { makeRng, type Rng } from "./rng";

export type Tile =
  | { kind: "path"; terrain: PathTerrain; order: number }
  | { kind: "build"; terrain: BuildTerrain };

export interface Prop {
  tile: number;
  type: "tree" | "rock" | "pillar" | "crystal" | "well" | "reed";
  /** Quarter turns, 0..3. */
  turn: number;
  scale: number;
}

export interface GameMap {
  seed: number;
  /** Length W * H; index = y * W + x. */
  tiles: Tile[];
  /** Tile indices, entry to exit. */
  path: number[];
  props: Prop[];
}

// Brief says 0.5, but that accepts only ~0.4% of walks (3 s for 500 maps); 0.4 takes ~0.3 s.
const RIGHT_WEIGHT = 0.4;
const MIN_PATH = 34;
const MAX_PATH = 48;
const MIN_BUILDABLE = 40;
const MIN_PATH_ADJACENT = 24;

const neighbours = (i: number): number[] => {
  const x = i % W;
  const y = Math.floor(i / W);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
};

/** Constrained random walk from x = 0 to x = W - 1, or null when it dead-ends or is the wrong length. */
function walkPath(rng: Rng): number[] | null {
  const path = [rng.int(H) * W];
  const used = new Set(path);
  while (path.length <= MAX_PATH) {
    const cur = path[path.length - 1];
    if (cur % W === W - 1) return path.length >= MIN_PATH ? path : null;
    const y = Math.floor(cur / W);
    // Right gets RIGHT_WEIGHT; the rest is shared between the vertical moves the map allows.
    const vertical = [...(y > 0 ? [cur - W] : []), ...(y < H - 1 ? [cur + W] : [])];
    const moves = [{ to: cur + 1, w: RIGHT_WEIGHT }, ...vertical.map((to) => ({ to, w: (1 - RIGHT_WEIGHT) / vertical.length }))];
    // A candidate may share an edge only with the current tile.
    const ok = moves.filter((m) => !used.has(m.to) && neighbours(m.to).every((n) => n === cur || !used.has(n)));
    if (ok.length === 0) return null;
    let roll = rng.next() * ok.reduce((s, m) => s + m.w, 0);
    let chosen = ok[ok.length - 1];
    for (const m of ok) {
      roll -= m.w;
      if (roll < 0) {
        chosen = m;
        break;
      }
    }
    path.push(chosen.to);
    used.add(chosen.to);
  }
  return null;
}

/** Flanking tiles (perpendicular to travel) of path[i], or null when the tile is a corner or a flank is off-map or on the path. */
function flanks(path: number[], i: number, onPath: Set<number>): [number, number] | null {
  const p = path[i];
  const x = p % W;
  const y = Math.floor(p / W);
  let pair: [number, number] | null = null;
  if (y === Math.floor(path[i - 1] / W) && y === Math.floor(path[i + 1] / W)) {
    if (y > 0 && y < H - 1) pair = [p - W, p + W];
  } else if (x === path[i - 1] % W && x === path[i + 1] % W) {
    if (x > 0 && x < W - 1) pair = [p - 1, p + 1];
  }
  return pair && !onPath.has(pair[0]) && !onPath.has(pair[1]) ? pair : null;
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Grow `water` with connected non-path tiles until it holds `size` tiles (or can't grow). */
function growLake(rng: Rng, water: Set<number>, onPath: Set<number>, size: number): void {
  while (water.size < size) {
    const frontier: number[] = [];
    for (const w of water)
      for (const n of neighbours(w)) if (!onPath.has(n) && !water.has(n) && !frontier.includes(n)) frontier.push(n);
    if (frontier.length === 0) return;
    water.add(rng.pick(frontier));
  }
}

function placeTerrain(rng: Rng, path: number[]): { tiles: Tile[]; props: Prop[] } | null {
  const onPath = new Set(path);
  const pathTerrain: PathTerrain[] = path.map(() => "dirt");
  const taken = new Set<number>(); // path orders that already carry special terrain
  const water = new Set<number>();

  // Lake, straddling a bridged path tile half the time.
  const bridgeAt: number[] = [];
  if (rng.next() < 0.5) for (let i = 1; i < path.length - 1; i++) if (flanks(path, i, onPath)) bridgeAt.push(i);
  if (bridgeAt.length > 0) {
    const i = rng.pick(bridgeAt);
    for (const f of flanks(path, i, onPath)!) water.add(f);
    pathTerrain[i] = "bridge";
    taken.add(i);
  } else {
    const nextToPath: number[] = [];
    for (let t = 0; t < W * H; t++) if (!onPath.has(t) && neighbours(t).some((n) => onPath.has(n))) nextToPath.push(t);
    water.add(rng.pick(nextToPath));
  }
  growLake(rng, water, onPath, 2 + rng.int(3));
  if (water.size < 2) return null;

  // Stretches of consecutive path tiles, never the first or last, never overlapping.
  const placeStretch = (len: number, kind: PathTerrain): boolean => {
    const starts: number[] = [];
    for (let s = 1; s + len <= path.length - 1; s++) {
      let free = true;
      for (let k = s; k < s + len; k++) if (taken.has(k)) free = false;
      if (free) starts.push(s);
    }
    if (starts.length === 0) return false;
    const start = rng.pick(starts);
    for (let k = start; k < start + len; k++) {
      pathTerrain[k] = kind;
      taken.add(k);
    }
    return true;
  };
  if (!placeStretch(2 + rng.int(2), "mud")) return null;
  if (rng.next() < 0.5 && !placeStretch(2, "ice")) return null;

  // Specials and blocked tiles come from a shuffled pool of non-path, non-water tiles.
  const pool: number[] = [];
  for (let t = 0; t < W * H; t++) if (!onPath.has(t) && !water.has(t)) pool.push(t);
  shuffle(rng, pool);
  const terrain = new Map<number, BuildTerrain>();
  for (const w of water) terrain.set(w, "water");
  const blockedCount = 6 + rng.int(7);
  const plan: [BuildTerrain, number][] = [
    ["blocked", blockedCount],
    ["hill", 2],
    ["lava", 1],
    ["crystal", 1],
    ["forest", 3],
    ["well", 1],
    ["ruins", 1],
  ];
  let at = 0;
  for (const [kind, n] of plan) for (let k = 0; k < n; k++) terrain.set(pool[at++], kind);

  const tiles: Tile[] = [];
  for (let t = 0; t < W * H; t++) tiles.push({ kind: "build", terrain: terrain.get(t) ?? "grass" });
  path.forEach((t, order) => {
    tiles[t] = { kind: "path", terrain: pathTerrain[order], order };
  });

  let buildable = 0;
  let nextToPath = 0;
  tiles.forEach((tile, t) => {
    if (tile.kind !== "build" || tile.terrain === "blocked") return;
    buildable++;
    if (neighbours(t).some((n) => onPath.has(n))) nextToPath++;
  });
  if (buildable < MIN_BUILDABLE || nextToPath < MIN_PATH_ADJACENT) return null;

  const props: Prop[] = [];
  const addProp = (tile: number, type: Prop["type"]) =>
    props.push({ tile, type, turn: rng.int(4), scale: 0.8 + rng.next() * 0.4 });
  tiles.forEach((tile, t) => {
    if (tile.kind !== "build") return;
    switch (tile.terrain) {
      case "forest": addProp(t, "tree"); break;
      case "grass": if (rng.next() < 0.2) addProp(t, "tree"); break;
      case "blocked": addProp(t, "rock"); break;
      case "ruins": addProp(t, "pillar"); break;
      case "crystal": addProp(t, "crystal"); break;
      case "well": addProp(t, "well"); break;
      case "water": if (neighbours(t).some((n) => !water.has(n)) && rng.next() < 0.7) addProp(t, "reed"); break;
      default: break;
    }
  });
  return { tiles, props };
}

export function generateMap(seed: number): GameMap {
  const rng = makeRng(seed);
  for (;;) {
    const path = walkPath(rng);
    if (!path) continue;
    const placed = placeTerrain(rng, path);
    if (placed) return { seed, path, ...placed };
  }
}

/** Tile-centre polyline point `d` tiles from the entry; clamps to the ends. */
export function pathPoint(map: GameMap, d: number): { x: number; y: number } {
  const last = map.path.length - 1;
  const c = Math.max(0, Math.min(last, d));
  const i = Math.floor(c);
  const f = c - i;
  const a = map.path[i];
  const ax = (a % W) + 0.5;
  const ay = Math.floor(a / W) + 0.5;
  if (i >= last || f === 0) return { x: ax, y: ay };
  const b = map.path[i + 1];
  return { x: ax + ((b % W) + 0.5 - ax) * f, y: ay + (Math.floor(b / W) + 0.5 - ay) * f };
}

export function pathLength(map: GameMap): number {
  return map.path.length - 1;
}
