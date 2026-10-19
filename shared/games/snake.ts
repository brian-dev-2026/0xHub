// Snake Arena: up to 4 snakes in one arena, simulated only on the server.
// Clients send direction changes and render the snapshots the server
// broadcasts every tick.

import { Rng } from "../tetris/engine";

export const SNAKE_W = 40;
export const SNAKE_H = 28;
export const SNAKE_TICK_MS = 100;
export const SNAKE_ROUND_MS = 120_000;
export const SNAKE_MAX_PLAYERS = 4;
export const RESPAWN_TICKS = 25;
const START_LEN = 4;
const KILL_POINTS = 5;
export const SNAKE_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15"];

/** 0 up, 1 right, 2 down, 3 left */
export type SnakeDir = 0 | 1 | 2 | 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export interface SnakeMember {
  id: string;
  name: string;
  avatar: string;
  color: string;
  bot: boolean;
}

interface Snake extends SnakeMember {
  body: number[]; // cell indexes, head first
  dir: SnakeDir;
  queue: SnakeDir[];
  alive: boolean;
  respawnAt: number;
  score: number;
  kills: number;
  deaths: number;
  grow: number;
  best: number; // longest length reached
}

export interface SnakeSnapshot {
  tick: number;
  players: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    bot: boolean;
    body: number[];
    alive: boolean;
    score: number;
    kills: number;
    respawnIn: number;
  }[];
  food: number[];
}

export interface SnakeStanding {
  id: string;
  bot: boolean;
  place: number;
  score: number;
  kills: number;
  deaths: number;
  best: number;
}

export class SnakeSim {
  snakes: Snake[];
  food = new Set<number>();
  tick = 0;
  private rng: Rng;

  constructor(seed: number, members: SnakeMember[]) {
    this.rng = new Rng(seed);
    this.snakes = members.slice(0, SNAKE_MAX_PLAYERS).map((m) => ({
      ...m,
      body: [],
      dir: 1,
      queue: [],
      alive: false,
      respawnAt: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      grow: 0,
      best: START_LEN,
    }));
    for (const s of this.snakes) if (!this.spawn(s)) s.respawnAt = 1; // retry next tick
    this.topUpFood();
  }

  private idx(x: number, y: number) {
    return y * SNAKE_W + x;
  }

  private occupied(): Set<number> {
    const o = new Set<number>();
    for (const s of this.snakes) if (s.alive) for (const c of s.body) o.add(c);
    return o;
  }

  private spawn(s: Snake): boolean {
    const occ = this.occupied();
    for (let attempt = 0; attempt < 200; attempt++) {
      const dir = Math.floor(this.rng.next() * 4) as SnakeDir;
      const x = 6 + Math.floor(this.rng.next() * (SNAKE_W - 12));
      const y = 6 + Math.floor(this.rng.next() * (SNAKE_H - 12));
      const body: number[] = [];
      for (let i = 0; i < START_LEN; i++) body.push(this.idx(x - DX[dir] * i, y - DY[dir] * i));
      // keep some room ahead of the head too
      const ahead = [1, 2, 3].map((k) => this.idx(x + DX[dir] * k, y + DY[dir] * k));
      if ([...body, ...ahead].some((c) => occ.has(c) || this.food.has(c))) continue;
      s.body = body;
      s.dir = dir;
      s.queue = [];
      s.alive = true;
      s.grow = 0;
      return true;
    }
    return false;
  }

  private topUpFood() {
    const want = this.snakes.length + 4;
    const occ = this.occupied();
    let guard = 0;
    while (this.food.size < want && guard++ < 500) {
      const c = Math.floor(this.rng.next() * SNAKE_W * SNAKE_H);
      if (!occ.has(c)) this.food.add(c);
    }
  }

  /** Queue a direction change (max 2 buffered; reversing into yourself is ignored). */
  setDir(id: string, d: number) {
    const s = this.snakes.find((p) => p.id === id);
    if (!s || !s.alive || ![0, 1, 2, 3].includes(d) || s.queue.length >= 2) return;
    const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
    if (d === last || (d + 2) % 4 === last) return;
    s.queue.push(d as SnakeDir);
  }

  private cellAfter(head: number, d: SnakeDir): number | null {
    const x = (head % SNAKE_W) + DX[d];
    const y = Math.floor(head / SNAKE_W) + DY[d];
    if (x < 0 || x >= SNAKE_W || y < 0 || y >= SNAKE_H) return null;
    return this.idx(x, y);
  }

  private botThink(s: Snake) {
    const occ = this.occupied();
    const head = s.body[0];
    let best: { d: SnakeDir; v: number } | null = null;
    for (const d of [0, 1, 2, 3] as SnakeDir[]) {
      if ((d + 2) % 4 === s.dir) continue;
      const c = this.cellAfter(head, d);
      if (c === null || (occ.has(c) && c !== s.body[s.body.length - 1])) continue;
      const cx = c % SNAKE_W;
      const cy = Math.floor(c / SNAKE_W);
      let dist = 1e9;
      for (const f of this.food) dist = Math.min(dist, Math.abs((f % SNAKE_W) - cx) + Math.abs(Math.floor(f / SNAKE_W) - cy));
      let free = 0;
      for (const d2 of [0, 1, 2, 3] as SnakeDir[]) {
        const n = this.cellAfter(c, d2);
        if (n !== null && !occ.has(n)) free++;
      }
      const v = -dist + free * 1.5 + this.rng.next() * 0.8 - (free === 0 ? 100 : 0);
      if (!best || v > best.v) best = { d, v };
    }
    if (best && best.d !== s.dir) s.queue = [best.d];
  }

  /** Advance one tick. */
  step() {
    this.tick++;
    for (const s of this.snakes) {
      if (!s.alive && this.tick >= s.respawnAt && s.respawnAt > 0) {
        if (this.spawn(s)) s.respawnAt = 0;
      }
    }
    for (const s of this.snakes) if (s.alive && s.bot) this.botThink(s);

    // Move every live snake.
    const heads = new Map<Snake, number | null>();
    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (s.queue.length) s.dir = s.queue.shift()!;
      const next = this.cellAfter(s.body[0], s.dir);
      heads.set(s, next);
      if (next === null) continue;
      if (this.food.has(next)) {
        this.food.delete(next);
        s.grow += 1;
        s.score += 1;
      }
      s.body.unshift(next);
      if (s.grow > 0) s.grow--;
      else s.body.pop();
      s.best = Math.max(s.best, s.body.length);
    }

    // Collisions, evaluated after everyone moved.
    const dead = new Map<Snake, Snake | null>(); // victim -> killer
    const live = this.snakes.filter((s) => s.alive);
    for (const s of live) {
      const head = heads.get(s);
      if (head === null || head === undefined) {
        dead.set(s, null); // wall
        continue;
      }
      for (const o of live) {
        if (o !== s && o.body[0] === head) {
          dead.set(s, null); // head-to-head: both die, no credit
          break;
        }
        // Skip index 0: our own head is there, and other heads were handled above.
        if (o.body.indexOf(head, 1) >= 0) {
          dead.set(s, o === s ? null : o);
          break;
        }
      }
    }
    for (const [victim, killer] of dead) {
      victim.alive = false;
      victim.deaths++;
      victim.respawnAt = this.tick + RESPAWN_TICKS;
      // The body turns into food (every other segment).
      victim.body.forEach((c, i) => {
        if (i % 2 === 0 && c !== heads.get(victim)) this.food.add(c);
      });
      victim.body = [];
      if (killer) {
        killer.kills++;
        killer.score += KILL_POINTS;
      }
    }
    this.topUpFood();
  }

  snapshot(): SnakeSnapshot {
    return {
      tick: this.tick,
      players: this.snakes.map((s) => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        color: s.color,
        bot: s.bot,
        body: s.body,
        alive: s.alive,
        score: s.score,
        kills: s.kills,
        respawnIn: s.alive ? 0 : Math.max(0, s.respawnAt - this.tick),
      })),
      food: [...this.food],
    };
  }

  standings(): SnakeStanding[] {
    const sorted = [...this.snakes].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    let place = 0;
    let prev: Snake | null = null;
    return sorted.map((s, i) => {
      if (!prev || s.score !== prev.score || s.kills !== prev.kills || s.deaths !== prev.deaths) place = i + 1;
      prev = s;
      return { id: s.id, bot: s.bot, place, score: s.score, kills: s.kills, deaths: s.deaths, best: s.best };
    });
  }

  removePlayer(id: string) {
    const s = this.snakes.find((p) => p.id === id);
    if (s) {
      s.alive = false;
      s.body = [];
      s.respawnAt = Number.MAX_SAFE_INTEGER; // left the match
    }
  }
}
