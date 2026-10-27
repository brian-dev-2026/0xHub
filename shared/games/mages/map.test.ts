import { describe, expect, it } from "vitest";
import { generateMap, pathLength, pathPoint, type GameMap } from "./map";
import { H, W } from "./data";

const xy = (i: number) => ({ x: i % W, y: Math.floor(i / W) });
const edge = (a: number, b: number) => {
  const p = xy(a);
  const q = xy(b);
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
};
const neighbours = (i: number): number[] => {
  const { x, y } = xy(i);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
};

const maps: GameMap[] = [];
for (let s = 1; s <= 500; s++) maps.push(generateMap(s));

describe("generateMap", () => {
  it("500 seeds produce valid maps", () => {
    for (const m of maps) {
      const p = m.path;
      expect(m.tiles).toHaveLength(W * H);
      expect(xy(p[0]).x).toBe(0);
      expect(xy(p[p.length - 1]).x).toBe(W - 1);
      expect(p.length).toBeGreaterThanOrEqual(34);
      expect(p.length).toBeLessThanOrEqual(48);
      for (let i = 1; i < p.length; i++) expect(edge(p[i - 1], p[i])).toBe(true);
      for (let i = 0; i < p.length; i++)
        for (let j = i + 2; j < p.length; j++) expect(edge(p[i], p[j])).toBe(false);
      const onPath = new Set(p);
      expect(onPath.size).toBe(p.length);
      m.tiles.forEach((t, i) => expect(t.kind === "path").toBe(onPath.has(i)));
      p.forEach((t, i) => {
        const tile = m.tiles[t];
        expect(tile.kind === "path" && tile.order).toBe(i);
      });
    }
  });

  it("guaranteed terrain", () => {
    for (const m of maps) {
      const count = (k: string) => m.tiles.filter((t) => t.kind === "build" && t.terrain === k).length;
      expect(count("hill")).toBeGreaterThanOrEqual(2);
      expect(count("water")).toBeGreaterThanOrEqual(2);
      expect(count("lava")).toBeGreaterThanOrEqual(1);
      expect(count("crystal")).toBeGreaterThanOrEqual(1);
      expect(count("forest")).toBeGreaterThanOrEqual(3);
      expect(count("well")).toBeGreaterThanOrEqual(1);
      expect(count("ruins")).toBeGreaterThanOrEqual(1);
      expect(count("blocked")).toBeGreaterThanOrEqual(6);
      expect(count("blocked")).toBeLessThanOrEqual(12);
      const onPath = new Set(m.path);
      const buildable = m.tiles
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.kind === "build" && t.terrain !== "blocked");
      expect(buildable.length).toBeGreaterThanOrEqual(40);
      expect(buildable.filter(({ i }) => neighbours(i).some((n) => onPath.has(n))).length).toBeGreaterThanOrEqual(24);

      const terr = m.path.map((i) => {
        const t = m.tiles[i];
        return t.kind === "path" ? t.terrain : "dirt";
      });
      // exactly one mud stretch of 2-3 consecutive tiles
      const mud = terr.flatMap((t, i) => (t === "mud" ? [i] : []));
      expect(mud.length).toBeGreaterThanOrEqual(2);
      expect(mud.length).toBeLessThanOrEqual(3);
      expect(mud[mud.length - 1] - mud[0]).toBe(mud.length - 1);
      const ice = terr.flatMap((t, i) => (t === "ice" ? [i] : []));
      expect([0, 2]).toContain(ice.length);
      if (ice.length) expect(ice[1] - ice[0]).toBe(1);
      expect(terr.filter((t) => t === "bridge").length).toBeLessThanOrEqual(1);
      for (const special of [...mud, ...ice]) {
        expect(special).toBeGreaterThan(0);
        expect(special).toBeLessThan(m.path.length - 1);
      }
    }
  });

  it("builds a bridge over the lake on some maps", () => {
    const withBridge = maps.filter((m) => m.path.some((i) => { const t = m.tiles[i]; return t.kind === "path" && t.terrain === "bridge"; }));
    expect(withBridge.length).toBeGreaterThan(100);
    expect(withBridge.length).toBeLessThan(400);
  });

  it("same seed same map", () => {
    expect(generateMap(7)).toEqual(generateMap(7));
    expect(generateMap(8).path).not.toEqual(generateMap(7).path);
  });

  it("pathPoint interpolates", () => {
    const m = generateMap(3);
    const c = (i: number) => ({ x: xy(i).x + 0.5, y: xy(i).y + 0.5 });
    expect(pathPoint(m, 0)).toEqual(c(m.path[0]));
    const mid = pathPoint(m, 0.5);
    expect(mid.x).toBeCloseTo((c(m.path[0]).x + c(m.path[1]).x) / 2);
    expect(mid.y).toBeCloseTo((c(m.path[0]).y + c(m.path[1]).y) / 2);
    expect(pathPoint(m, 1e9)).toEqual(c(m.path[m.path.length - 1]));
    expect(pathPoint(m, -5)).toEqual(c(m.path[0]));
    expect(pathLength(m)).toBe(m.path.length - 1);
  });
});
