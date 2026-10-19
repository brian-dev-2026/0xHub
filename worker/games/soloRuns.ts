import { DurableObject } from "cloudflare:workers";
import { G2048, type Dir, type G2048State } from "../../shared/games/g2048";
import { CLOSE_STALE, connSeq, isStale } from "../connSeq";
import { DIFFICULTIES, MinesBoard, type Difficulty, type MinesState, type RevealedCell } from "../../shared/games/mines";
import type { Env } from "../env";
import { recordScore } from "../gamesDb";
import { clearStorage } from "../storage";

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
    await clearStorage(this.ctx.storage);
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
}

const SAVE_DELAY_MS = 3000;
const MAX_MOVES_PER_SEC = 40;

/**
 * One solo 2048 game, played over a WebSocket. The RNG never leaves this
 * object: the browser slides tiles itself and sends the move, and we reply
 * with the tile that spawned. Game over is decided here and the score
 * recorded from our copy.
 */
export class Run2048 extends StoredRun<Run2048Data> {
  private game: G2048 | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private rate = { at: 0, n: 0 };

  async init(userId: string) {
    if (this.load()) throw new Error("run exists");
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.data = { userId, game: new G2048(seed).serialize(), createdAt: Date.now() };
    this.save();
    await this.touch();
  }

  private current(): G2048 | null {
    const d = this.load();
    if (!d) return null;
    this.game ??= G2048.deserialize(d.game);
    return this.game;
  }

  private sendWs(ws: WebSocket, msg: Record<string, unknown>) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  async fetch(request: Request): Promise<Response> {
    let userId = "";
    try {
      userId = JSON.parse(decodeURIComponent(request.headers.get("X-0xHub-User") ?? "")).id;
    } catch {
      /* fallthrough */
    }
    const d = this.load();
    if (!d || !userId || d.userId !== userId) return new Response("Unknown run", { status: 404 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const seq = connSeq(request);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, c: seq });
    const existing = this.ctx.getWebSockets().filter((ws) => ws !== server);
    if (isStale(seq, existing)) {
      server.close(CLOSE_STALE, "stale");
    } else {
      for (const old of existing) {
        this.sendWs(old, { t: "replaced" });
        old.close(4001, "replaced");
      }
      this.sendWs(server, { t: "state", game: this.current()!.view() });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 1024) return ws.close(1009, "message too large");
    const now = Date.now();
    if (now - this.rate.at >= 1000) this.rate = { at: now, n: 0 };
    const tooFast = ++this.rate.n > MAX_MOVES_PER_SEC;
    if (this.rate.n > MAX_MOVES_PER_SEC * 5) return ws.close(1008, "rate limit"); // flooding, not playing
    let msg: { t?: string; n?: number; d?: number; h?: number; at?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === "ping") return this.sendWs(ws, { t: "pong", at: msg.at });
    if (msg.t !== "move") return;
    const g = this.current();
    if (!g || g.over) return;

    // Too fast: drop the move and send our board so the client stays in step.
    if (tooFast || msg.n !== g.moves + 1 || !g.slide(msg.d as Dir)) {
      this.sendWs(ws, { t: "state", game: g.view() }); // out of step: resync
      return;
    }
    const agreed = msg.h === g.hash();
    const cell = g.spawn();
    g.over = !g.canMove();
    if (agreed) this.sendWs(ws, { t: "spawn", n: g.moves, cell, value: g.board[cell] ?? 0, over: g.over });
    else this.sendWs(ws, { t: "state", game: g.view() });

    if (g.over) return this.finish(ws, g);
    this.saveSoon();
  }

  private saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      if (!this.data || !this.game) return;
      this.data.game = this.game.serialize();
      this.save();
      void this.touch();
    }, SAVE_DELAY_MS);
  }

  private async finish(ws: WebSocket, g: G2048) {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const d = this.data!;
    try {
      const { best, rank } = await recordScore(this.env.DB, d.userId, "2048", "solo", g.score, Date.now() - d.createdAt, { maxTile: g.maxTile, moves: g.moves });
      this.sendWs(ws, { t: "done", score: g.score, maxTile: g.maxTile, best, rank });
    } catch (err) {
      console.error("2048 record failed", err);
      this.sendWs(ws, { t: "error", message: "Couldn't save your score." });
    }
    this.game = null;
    await this.discard();
    ws.close(1000, "done");
  }

  async alarm() {
    clearTimeout(this.saveTimer);
    this.game = null;
    await super.alarm();
  }
}
