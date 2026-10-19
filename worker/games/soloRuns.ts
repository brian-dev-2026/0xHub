import { DurableObject } from "cloudflare:workers";
import { G2048, type Dir, type G2048State } from "../../shared/games/g2048";
import { DIFFICULTIES, MinesBoard, type Difficulty, type MinesState, type RevealedCell } from "../../shared/games/mines";
import type { Env } from "../env";
import { recordScore } from "../gamesDb";

const ABANDON_MS = 60 * 60 * 1000;

abstract class StoredRun<D> extends DurableObject<Env> {
  protected data: D | null = null;

  protected load(): D | null {
    if (this.data) return this.data;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const row = this.ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = 'run'`).toArray()[0];
    this.data = row ? (JSON.parse(row.v as string) as D) : null;
    return this.data;
  }

  protected save() {
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('run', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(this.data),
    );
  }

  protected async touch() {
    await this.ctx.storage.setAlarm(Date.now() + ABANDON_MS);
  }

  protected async discard() {
    await this.ctx.storage.deleteAll();
    this.data = null;
  }

  async alarm() {
    await this.discard(); // abandoned run
  }
}

// ---------- Minesweeper Rush ----------

interface MinesRunData {
  userId: string;
  difficulty: Difficulty;
  board: MinesState;
  firstAt: number;
  done: boolean;
}

export interface MinesActionResult {
  ok: boolean;
  error?: string;
  cells?: RevealedCell[];
  lost?: { mines: number[]; hit: number };
  won?: { timeMs: number; best: number; rank: number };
}

/**
 * One Minesweeper run. The mine layout only exists here; each reveal returns
 * just the newly opened cells. The official time runs from the first click
 * reaching the server to the winning click reaching the server.
 */
export class MinesRun extends StoredRun<MinesRunData> {
  async init(userId: string, difficulty: Difficulty) {
    if (this.load()) throw new Error("run exists");
    const { w, h, mines } = DIFFICULTIES[difficulty];
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.data = { userId, difficulty, board: new MinesBoard(w, h, mines, seed).serialize(), firstAt: 0, done: false };
    this.save();
    await this.touch();
    return { w, h, mines };
  }

  async action(userId: string, a: Record<string, unknown>): Promise<MinesActionResult> {
    const d = this.load();
    if (!d) return { ok: false, error: "Unknown run" };
    if (d.userId !== userId) return { ok: false, error: "Not your run" };
    if (d.done) return { ok: false, error: "Run already finished" };
    const board = MinesBoard.deserialize(d.board);
    const cell = Number(a.cell);
    let cells: RevealedCell[];
    if (a.type === "reveal") {
      cells = board.reveal(cell);
    } else if (a.type === "chord") {
      const flags = Array.isArray(a.flags) ? (a.flags as unknown[]).filter((x): x is number => Number.isInteger(x)).slice(0, 2000) : [];
      cells = board.chord(cell, new Set(flags));
    } else return { ok: false, error: "Bad action" };

    if (board.started && !d.firstAt) d.firstAt = Date.now();
    d.board = board.serialize();

    if (board.lost) {
      d.done = true;
      await this.discard();
      return { ok: true, cells, lost: { mines: board.mineList(), hit: board.boom } };
    }
    if (board.won) {
      const timeMs = Math.max(1, Date.now() - d.firstAt);
      const { best, rank } = await recordScore(this.env.DB, d.userId, "mines", d.difficulty, timeMs, timeMs);
      await this.discard();
      return { ok: true, cells, won: { timeMs, best, rank } };
    }
    this.save();
    await this.touch();
    return { ok: true, cells };
  }
}

// ---------- 2048 solo ----------

interface Run2048Data {
  userId: string;
  game: G2048State;
  createdAt: number;
  invalid: boolean;
}

export interface Run2048Result {
  ok: boolean;
  error?: string;
  finished?: boolean;
  score?: number;
  maxTile?: number;
  best?: number;
  rank?: number;
}

/** Verified 2048 solo run: server-issued seed, moves replayed in chunks. */
export class Run2048 extends StoredRun<Run2048Data> {
  async init(userId: string) {
    if (this.load()) throw new Error("run exists");
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.data = { userId, game: new G2048(seed).serialize(), createdAt: Date.now(), invalid: false };
    this.save();
    await this.touch();
    return { seed };
  }

  async input(userId: string, b: Record<string, unknown>): Promise<Run2048Result> {
    const d = this.load();
    if (!d) return { ok: false, error: "Unknown run" };
    if (d.userId !== userId) return { ok: false, error: "Not your run" };
    if (d.invalid) return { ok: false, error: "Run failed verification" };
    const dirs = b.dirs;
    if (!Array.isArray(dirs) || dirs.length > 20_000) return this.reject("Malformed input");
    const g = G2048.deserialize(d.game);
    for (const dir of dirs) if (!g.move(dir as Dir)) return this.reject("Run failed verification");
    if (b.h !== g.hash()) return this.reject("Run failed verification");
    d.game = g.serialize();

    if (!g.over && b.final !== true) {
      this.save();
      await this.touch();
      return { ok: true };
    }
    const { best, rank } = await recordScore(this.env.DB, d.userId, "2048", "solo", g.score, Date.now() - d.createdAt, { maxTile: g.maxTile, moves: g.moves });
    await this.discard();
    return { ok: true, finished: true, score: g.score, maxTile: g.maxTile, best, rank };
  }

  private reject(error: string): Run2048Result {
    if (this.data) {
      this.data.invalid = true;
      this.save();
    }
    return { ok: false, error };
  }
}
