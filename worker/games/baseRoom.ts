import { DurableObject } from "cloudflare:workers";
import { CLOSE_STALE, connSeq, isStale } from "../connSeq";
import type { Env } from "../env";
import { clearStorage } from "../storage";

export interface Identity {
  id: string;
  name: string;
  avatar: string;
  color: string;
  rating?: number;
}

export interface Member extends Identity {
  connected: boolean;
  disconnectedAt: number;
  joinedAt: number;
}

export type AnyMsg = { t: string; [k: string]: unknown };

const MAX_MSG_BYTES = 16 * 1024;
const MAX_MSGS_PER_SEC = 60;

/**
 * Shared plumbing for multiplayer game rooms: verified identity from the
 * Worker, seats (with takeover when the same account reconnects or opens a
 * second tab), WebSocket hibernation, abuse limits, persisted state and a
 * single alarm. Subclasses implement the game.
 */
export abstract class BaseRoom<S extends object> extends DurableObject<Env> {
  protected roomCode = "";
  protected members: Member[] = [];
  protected abstract state: S;
  protected abstract readonly maxMembers: number;
  private rate = new Map<WebSocket, { at: number; n: number }>();
  private loaded = false;

  protected ensureTable() {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  }

  /** Load persisted room data (call lazily — subclass fields aren't ready in the base constructor). */
  protected load() {
    if (this.loaded) return;
    this.loaded = true;
    this.ensureTable();
    const row = this.ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = 'room'`).toArray()[0];
    if (row) {
      const d = JSON.parse(row.v as string);
      this.roomCode = d.roomCode;
      this.members = d.members;
      this.state = d.state;
      this.onLoaded();
    }
  }

  /** Rebuild non-serializable in-memory state after a restart. */
  protected onLoaded() {}

  protected persist() {
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('room', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify({ roomCode: this.roomCode, members: this.members, state: this.state }),
    );
  }

  protected async wipe() {
    await clearStorage(this.ctx.storage);
    this.ensureTable();
  }

  // ---------- sockets ----------

  protected socketsOf(userId: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment() as { userId?: string } | null;
      return a?.userId === userId && ws.readyState === WebSocket.OPEN;
    });
  }

  protected sendWs(ws: WebSocket, msg: AnyMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  protected send(userId: string, msg: AnyMsg) {
    for (const ws of this.socketsOf(userId)) this.sendWs(ws, msg);
  }

  protected broadcast(msg: AnyMsg, exceptId?: string) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { userId?: string } | null;
      if (!a?.userId || a.userId === exceptId || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(text);
      } catch {
        /* closed */
      }
    }
  }

  protected member(id: string) {
    return this.members.find((m) => m.id === id);
  }

  protected publicMembers() {
    return this.members.map(({ id, name, avatar, color, rating, connected }) => ({ id, name, avatar, color, rating, connected }));
  }

  // ---------- hooks ----------

  /** Return an error message to refuse a new (non-reconnecting) member. */
  protected canJoin(): string | null {
    return this.members.length >= this.maxMembers ? "This room is full." : null;
  }
  protected abstract onJoin(m: Member, ws: WebSocket, reconnect: boolean): void | Promise<void>;
  protected abstract onMessage(m: Member, msg: AnyMsg, ws: WebSocket): void | Promise<void>;
  /** Called when a member's last socket closes. */
  protected abstract onDisconnect(m: Member): void | Promise<void>;
  protected abstract onAlarm(): void | Promise<void>;
  /** The next time the room needs an alarm, or null. */
  protected abstract nextAlarm(): number | null;

  protected async scheduleAlarm() {
    const at = this.nextAlarm();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 10));
  }

  // ---------- Durable Object entry points ----------

  async fetch(request: Request): Promise<Response> {
    this.load();
    let user: Identity;
    try {
      user = JSON.parse(decodeURIComponent(request.headers.get("X-0xHub-User") ?? ""));
      if (!user?.id) throw new Error();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!this.roomCode) this.roomCode = request.headers.get("X-0xHub-Room") ?? "";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const seq = connSeq(request);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: user.id, c: seq });

    let m = this.member(user.id);
    const reconnect = !!m;
    if (m) {
      const existing = this.socketsOf(user.id).filter((ws) => ws !== server);
      if (isStale(seq, existing)) {
        // An older connection attempt arrived late; the newer one keeps the seat.
        server.close(CLOSE_STALE, "stale");
        return new Response(null, { status: 101, webSocket: client });
      }
      for (const old of existing) {
        this.sendWs(old, { t: "replaced" });
        old.close(4001, "replaced");
      }
      Object.assign(m, user, { connected: true, disconnectedAt: 0 });
    } else {
      const refusal = this.canJoin();
      if (refusal) {
        this.sendWs(server, { t: "error", message: refusal, fatal: true });
        server.close(1008, "refused");
        return new Response(null, { status: 101, webSocket: client });
      }
      m = { ...user, connected: true, disconnectedAt: 0, joinedAt: Date.now() };
      this.members.push(m);
    }
    await this.onJoin(m, server, reconnect);
    this.persist();
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    this.load();
    const size = typeof raw === "string" ? raw.length : raw.byteLength;
    if (size > MAX_MSG_BYTES) return ws.close(1009, "message too large");
    const now = Date.now();
    const r = this.rate.get(ws) ?? { at: now, n: 0 };
    if (now - r.at >= 1000) (r.at = now), (r.n = 0);
    if (++r.n > MAX_MSGS_PER_SEC) return ws.close(1008, "rate limit");
    this.rate.set(ws, r);

    const userId = (ws.deserializeAttachment() as { userId?: string } | null)?.userId;
    const m = userId ? this.member(userId) : undefined;
    if (!m) return;
    let msg: AnyMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    if (msg.t === "ping") {
      if (typeof msg.at === "number") this.sendWs(ws, { t: "pong", at: msg.at });
      return;
    }
    await this.onMessage(m, msg, ws);
    await this.scheduleAlarm();
  }

  async webSocketClose(ws: WebSocket) {
    await this.socketGone(ws);
  }
  async webSocketError(ws: WebSocket) {
    await this.socketGone(ws);
  }

  private async socketGone(ws: WebSocket) {
    this.load();
    this.rate.delete(ws);
    const userId = (ws.deserializeAttachment() as { userId?: string } | null)?.userId;
    const m = userId ? this.member(userId) : undefined;
    if (!m || this.socketsOf(m.id).some((s) => s !== ws)) return;
    m.connected = false;
    m.disconnectedAt = Date.now();
    await this.onDisconnect(m);
    if (this.members.length === 0) {
      await this.wipe();
      return;
    }
    this.persist();
    await this.scheduleAlarm();
  }

  async alarm() {
    this.load();
    await this.onAlarm();
    if (this.members.length) {
      this.persist();
      await this.scheduleAlarm();
    }
  }

  protected removeMember(id: string) {
    this.members = this.members.filter((m) => m.id !== id);
  }
}
