import { DurableObject } from "cloudflare:workers";
import {
  COUNTDOWN_MS,
  GARBAGE_ACK_STEPS,
  MATCH_DURATION_MS,
  MAX_LAG_STEPS,
  MAX_LEAD_STEPS,
  RECONNECT_GRACE_MS,
  type BoardSnapshot,
  type ClientMsg,
  type MatchPhase,
  type PlayerInfo,
  type ServerMsg,
} from "../shared/protocol";
import { BUFFER_ROWS, STEP_MS } from "../shared/tetris/engine";
import { PlayerSim, decodeEvents, runBatch, type SimState } from "../shared/tetris/sim";
import { recordBattle } from "./db";
import type { Env } from "./env";

type Identity = Omit<PlayerInfo, "skin">;

interface PendingChunk {
  id: number;
  lines: number;
  label?: string;
  /** Receiver's sim step by which the chunk must be applied. */
  deadline: number;
}

/** Persisted per-player state. */
interface Seat {
  user: Identity;
  skin: string | null; // set by hello
  connected: boolean;
  disconnectedAt: number;
  sim: SimState | null;
  epoch: number;
  /** Garbage sent to this player that they haven't applied yet. */
  pending: PendingChunk[];
  nextChunkId: number;
  wantsRematch: boolean;
}

interface RoomData {
  room: string;
  phase: MatchPhase;
  startsAt: number;
  endsAt: number;
  seats: Seat[];
}

const MAX_MSG_BYTES = 64 * 1024;
const MAX_MSGS_PER_SEC = 120;
const PERSIST_EVERY_MS = 3000;
const HEARTBEAT_MS = 1000;

/**
 * One 1v1 match — the authoritative referee.
 *
 * Clients send only their inputs. The room replays each player's inputs on
 * its own copy of their game (the same deterministic engine the browser
 * runs), so attacks, KOs and results are computed here and can't be forged.
 * State is persisted to Durable Object storage and timers use alarms, so a
 * restart or deploy doesn't lose the match: clients reconnect and resync.
 */
export class BattleRoom extends DurableObject<Env> {
  private data: RoomData = { room: "", phase: "waiting", startsAt: 0, endsAt: 0, seats: [] };
  private sims = new Map<string, PlayerSim>();
  private desynced = new Set<string>();
  private lastPersist = 0;
  private rate = new Map<WebSocket, { at: number; n: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureTable();
    const row = ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = 'room'`).toArray()[0];
    if (row) {
      this.data = JSON.parse(row.v as string);
      for (const seat of this.data.seats) if (seat.sim) this.sims.set(seat.user.id, this.buildSim(seat, seat.sim));
    }
  }

  // ---------- persistence ----------

  private ensureTable() {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  }

  private persist() {
    for (const seat of this.data.seats) {
      const sim = this.sims.get(seat.user.id);
      seat.sim = sim ? sim.serialize() : null;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('room', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(this.data),
    );
    this.lastPersist = Date.now();
  }

  private async scheduleAlarm() {
    const { phase, startsAt, endsAt } = this.data;
    let next: number | null = null;
    if (phase === "countdown") next = startsAt;
    else if (phase === "playing") next = Math.min(endsAt, Date.now() + HEARTBEAT_MS);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  // ---------- helpers ----------

  private seatOf(userId: string) {
    return this.data.seats.find((s) => s.user.id === userId);
  }
  private other(seat: Seat) {
    return this.data.seats.find((s) => s !== seat);
  }
  private socketsOf(userId: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment() as { userId?: string } | null;
      return a?.userId === userId && ws.readyState === WebSocket.OPEN;
    });
  }
  private send(seat: Seat | undefined, msg: ServerMsg) {
    if (!seat) return;
    const text = JSON.stringify(msg);
    for (const ws of this.socketsOf(seat.user.id)) {
      try {
        ws.send(text);
      } catch {
        /* closed */
      }
    }
  }
  private sendWs(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }
  private kosOf(seat: Seat): number {
    const opp = this.other(seat);
    return opp ? (this.sims.get(opp.user.id)?.topOuts ?? 0) : 0;
  }
  private nowSteps(): number {
    return Math.max(0, Math.floor((Date.now() - this.data.startsAt) / STEP_MS));
  }

  private buildSim(seat: Seat, state: SimState | null, seed = 0): PlayerSim {
    const opts = {
      resolveGarbage: (id: number) => {
        if (seat.pending[0]?.id === id) return seat.pending.shift()!.lines;
        this.desynced.add(seat.user.id); // acknowledged a chunk out of order
        return null;
      },
      events: {
        onClear: (e: { sent: number; label: string; combo: number }) => {
          if (e.sent > 0) this.routeGarbage(seat, e.sent, e.label || `${e.combo} COMBO`);
        },
        onKO: () => this.onKO(seat),
      },
    };
    return state ? PlayerSim.deserialize(state, opts) : new PlayerSim({ mode: "battle", seed, ...opts });
  }

  private routeGarbage(from: Seat, lines: number, label: string) {
    if (this.data.phase !== "playing") return;
    const to = this.other(from);
    const toSim = to && this.sims.get(to.user.id);
    if (!to || !toSim) return;
    const chunk: PendingChunk = { id: to.nextChunkId++, lines, label, deadline: toSim.steps + GARBAGE_ACK_STEPS };
    to.pending.push(chunk);
    this.send(to, { t: "garbage", id: chunk.id, lines, label });
  }

  private onKO(victim: Seat) {
    const opp = this.other(victim);
    if (!opp) return;
    const victimKOs = this.kosOf(victim);
    const oppKOs = this.kosOf(opp);
    this.send(victim, { t: "ko", victim: "you", you: victimKOs, opponent: oppKOs });
    this.send(opp, { t: "ko", victim: "opponent", you: oppKOs, opponent: victimKOs });
    this.persist();
  }

  private snapshot(sim: PlayerSim): BoardSnapshot {
    const e = sim.engine;
    const a = e.active;
    return {
      cells: e.encodeVisible(),
      active: a && !sim.frozen ? { type: a.type, x: a.x, y: a.y - BUFFER_ROWS, rot: a.rot } : null,
      hold: e.hold,
      next: e.next.slice(0, 3),
      incoming: e.incomingTotal,
      linesSent: e.linesSent,
      lines: e.lines,
      combo: Math.max(0, e.combo),
    };
  }

  private resync(seat: Seat) {
    const sim = this.sims.get(seat.user.id);
    if (!sim) return;
    seat.epoch++;
    this.desynced.delete(seat.user.id);
    this.send(seat, {
      t: "resync",
      sim: sim.serialize(),
      epoch: seat.epoch,
      pending: seat.pending.map(({ id, lines }) => ({ id, lines })),
    });
  }

  /** Advance a player's authoritative game, force-applying overdue garbage. */
  private advance(seat: Seat, events: [number, number, number][], upTo: number) {
    const sim = this.sims.get(seat.user.id)!;
    runBatch(sim, events, upTo, () => {
      while (seat.pending.length && seat.pending[0].deadline <= sim.steps) {
        // The client didn't apply this garbage in time; apply it for them.
        sim.engine.receiveGarbage(seat.pending.shift()!.lines);
        this.desynced.add(seat.user.id);
      }
    });
  }

  // ---------- lifecycle ----------

  async fetch(request: Request): Promise<Response> {
    let user: Identity;
    try {
      user = JSON.parse(request.headers.get("X-0xHub-User") ?? "");
      if (!user?.id) throw new Error();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!this.data.room) this.data.room = request.headers.get("X-0xHub-Room") ?? "";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: user.id });

    let seat = this.seatOf(user.id);
    if (seat) {
      // Reconnect (or the same account in another tab): take over the seat.
      for (const old of this.socketsOf(user.id)) {
        if (old === server) continue;
        this.sendWs(old, { t: "replaced" });
        old.close(4001, "replaced");
      }
      seat.user = user;
      seat.connected = true;
      seat.disconnectedAt = 0;
    } else {
      if (this.data.seats.length >= 2) {
        this.sendWs(server, { t: "error", message: "This room is full.", fatal: true });
        server.close(1008, "room full");
        return new Response(null, { status: 101, webSocket: client });
      }
      seat = {
        user,
        skin: null,
        connected: true,
        disconnectedAt: 0,
        sim: null,
        epoch: 0,
        pending: [],
        nextChunkId: 0,
        wantsRematch: false,
      };
      this.data.seats.push(seat);
    }

    const opp = this.other(seat);
    if (opp?.skin) this.sendWs(server, { t: "opponent", player: { ...opp.user, skin: opp.skin } });
    if (opp) {
      this.sendWs(server, { t: "opponentStatus", connected: opp.connected });
      this.send(opp, { t: "opponentStatus", connected: true });
    }

    const { phase } = this.data;
    if (phase !== "waiting") {
      const sim = this.sims.get(seat.user.id);
      const now = Date.now();
      seat.epoch++;
      this.sendWs(server, {
        t: "resume",
        phase,
        msUntilStart: Math.max(0, this.data.startsAt - now),
        msRemaining: phase === "ended" ? 0 : Math.max(0, this.data.endsAt - now),
        kos: { you: this.kosOf(seat), opponent: opp ? this.kosOf(opp) : 0 },
        sim: sim ? sim.serialize() : null,
        epoch: seat.epoch,
        pending: seat.pending.map(({ id, lines }) => ({ id, lines })),
      });
      const oppSim = opp && this.sims.get(opp.user.id);
      if (oppSim) this.sendWs(server, { t: "opState", s: this.snapshot(oppSim) });
    }
    this.persist();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    // Abuse limits: message size and rate.
    const size = typeof raw === "string" ? raw.length : raw.byteLength;
    if (size > MAX_MSG_BYTES) return ws.close(1009, "message too large");
    const now = Date.now();
    const r = this.rate.get(ws) ?? { at: now, n: 0 };
    if (now - r.at >= 1000) (r.at = now), (r.n = 0);
    if (++r.n > MAX_MSGS_PER_SEC) return ws.close(1008, "rate limit");
    this.rate.set(ws, r);

    const userId = (ws.deserializeAttachment() as { userId?: string } | null)?.userId;
    const seat = userId ? this.seatOf(userId) : undefined;
    if (!seat) return;

    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    switch (msg.t) {
      case "hello": {
        seat.skin = typeof msg.skin === "string" && /^[a-z0-9-]{1,24}$/.test(msg.skin) ? msg.skin : "classic";
        const opp = this.other(seat);
        if (opp?.skin) {
          this.send(seat, { t: "opponent", player: { ...opp.user, skin: opp.skin } });
          this.send(opp, { t: "opponent", player: { ...seat.user, skin: seat.skin } });
          if (this.data.phase === "waiting") await this.startCountdown();
        }
        this.persist();
        break;
      }
      case "input":
        this.onInput(seat, msg);
        break;
      case "rematch": {
        const opp = this.other(seat);
        if (this.data.phase !== "ended" || !opp?.connected) break;
        seat.wantsRematch = true;
        if (opp.wantsRematch) await this.startCountdown();
        else this.send(opp, { t: "rematchRequested" });
        this.persist();
        break;
      }
      case "leave":
        // Leaving on purpose forfeits immediately (no reconnect grace).
        if (this.data.phase === "playing" || this.data.phase === "countdown") {
          seat.connected = false;
          await this.finish("forfeit", seat);
        }
        break;
      case "ping":
        if (typeof msg.at === "number") this.sendWs(ws, { t: "pong", at: msg.at });
        break;
    }
  }

  private onInput(seat: Seat, msg: Extract<ClientMsg, { t: "input" }>) {
    // The start alarm may not have fired yet when the first input arrives.
    if (this.data.phase === "countdown" && Date.now() >= this.data.startsAt) this.data.phase = "playing";
    if (this.data.phase !== "playing") return;
    if (msg.epoch !== seat.epoch) return; // stale batch from before a resync
    const sim = this.sims.get(seat.user.id);
    if (!sim) return;
    const upTo = msg.upTo;
    if (!Number.isInteger(upTo) || upTo < sim.steps) return;
    if (upTo > this.nowSteps() + MAX_LEAD_STEPS) return this.resync(seat); // claims to be ahead of real time
    const events = decodeEvents(msg.ev, sim.steps, upTo);
    if (!events) return this.resync(seat);

    this.advance(seat, events, upTo);
    if (this.desynced.has(seat.user.id) || msg.h !== sim.engine.hash()) this.resync(seat);

    const opp = this.other(seat);
    if (opp) this.send(opp, { t: "opState", s: this.snapshot(sim) });
    if (Date.now() - this.lastPersist > PERSIST_EVERY_MS) this.persist();
  }

  private async startCountdown() {
    const now = Date.now();
    this.data.phase = "countdown";
    this.data.startsAt = now + COUNTDOWN_MS;
    this.data.endsAt = this.data.startsAt + MATCH_DURATION_MS;
    this.sims.clear();
    this.desynced.clear();
    const seeds = crypto.getRandomValues(new Uint32Array(this.data.seats.length));
    this.data.seats.forEach((seat, i) => {
      seat.pending = [];
      seat.nextChunkId = 0;
      seat.wantsRematch = false;
      seat.epoch++;
      this.sims.set(seat.user.id, this.buildSim(seat, null, seeds[i]));
      this.send(seat, { t: "countdown", in: COUNTDOWN_MS, duration: MATCH_DURATION_MS, seed: seeds[i], epoch: seat.epoch });
    });
    this.persist();
    await this.scheduleAlarm();
  }

  async alarm() {
    const now = Date.now();
    const d = this.data;
    if (d.phase === "countdown" && now >= d.startsAt) d.phase = "playing";

    if (d.phase === "playing") {
      if (now >= d.endsAt) {
        await this.finish("time");
        return;
      }
      for (const seat of d.seats) {
        // Forfeit after the reconnect grace period.
        if (!seat.connected && seat.disconnectedAt && now - seat.disconnectedAt >= RECONNECT_GRACE_MS) {
          await this.finish("forfeit", seat);
          return;
        }
        // Players can't stall: if a game falls too far behind real time, run it forward.
        const sim = this.sims.get(seat.user.id);
        const target = this.nowSteps() - MAX_LAG_STEPS;
        if (sim && sim.steps < target) {
          this.advance(seat, [], target);
          if (seat.connected) this.resync(seat);
          const opp = this.other(seat);
          if (opp) this.send(opp, { t: "opState", s: this.snapshot(sim) });
        }
      }
      if (now - this.lastPersist > PERSIST_EVERY_MS) this.persist();
    }
    await this.scheduleAlarm();
  }

  private async finish(reason: "time" | "forfeit", forfeiter?: Seat) {
    const d = this.data;
    if (d.phase !== "playing" && d.phase !== "countdown") return;
    d.phase = "ended";
    const [a, b] = d.seats;
    const simA = a && this.sims.get(a.user.id);
    const simB = b && this.sims.get(b.user.id);
    const kosA = a ? this.kosOf(a) : 0;
    const kosB = b ? this.kosOf(b) : 0;
    const sentA = simA?.engine.linesSent ?? 0;
    const sentB = simB?.engine.linesSent ?? 0;

    let outcome: "a" | "b" | "draw";
    if (reason === "forfeit") outcome = forfeiter === a ? "b" : "a";
    else if (kosA !== kosB) outcome = kosA > kosB ? "a" : "b";
    else if (sentA !== sentB) outcome = sentA > sentB ? "a" : "b";
    else outcome = "draw";

    let deltas: { a: number; b: number } | null = null;
    if (a && b) {
      try {
        deltas = await recordBattle(
          this.env.DB,
          d.room,
          { userId: a.user.id, kos: kosA, sent: sentA, lines: simA?.engine.lines ?? 0 },
          { userId: b.user.id, kos: kosB, sent: sentB, lines: simB?.engine.lines ?? 0 },
          outcome,
          reason,
          Math.max(0, Math.min(Date.now(), d.endsAt) - d.startsAt),
        );
      } catch (err) {
        console.error("recordBattle failed", err);
      }
    }

    const report = (me: Seat | undefined, key: "a" | "b") => {
      if (!me) return;
      const mine = key === "a" ? { kos: kosA, linesSent: sentA } : { kos: kosB, linesSent: sentB };
      const theirs = key === "a" ? { kos: kosB, linesSent: sentB } : { kos: kosA, linesSent: sentA };
      this.send(me, {
        t: "end",
        result: outcome === "draw" ? "draw" : outcome === key ? "win" : "lose",
        reason,
        you: mine,
        opponent: theirs,
        ratingDelta: deltas?.[key],
      });
    };
    report(a, "a");
    report(b, "b");

    // Players who left don't stay seated after the match.
    d.seats = d.seats.filter((s) => s.connected);
    for (const s of d.seats) s.wantsRematch = false;
    if (d.seats.length < 2) for (const s of d.seats) this.send(s, { t: "opponentLeft" });
    this.persist();
    await this.scheduleAlarm();
  }

  async webSocketClose(ws: WebSocket) {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket) {
    this.rate.delete(ws);
    const userId = (ws.deserializeAttachment() as { userId?: string } | null)?.userId;
    const seat = userId ? this.seatOf(userId) : undefined;
    if (!seat || this.socketsOf(seat.user.id).some((s) => s !== ws)) return; // another tab still open
    const opp = this.other(seat);
    const { phase } = this.data;
    if (phase === "playing" || phase === "countdown") {
      // Keep the seat for the reconnect grace period.
      seat.connected = false;
      seat.disconnectedAt = Date.now();
      this.send(opp, { t: "opponentStatus", connected: false });
      this.persist();
      await this.scheduleAlarm();
    } else {
      this.data.seats = this.data.seats.filter((s) => s !== seat);
      this.sims.delete(seat.user.id);
      if (opp) {
        opp.wantsRematch = false;
        this.send(opp, { t: "opponentLeft" });
      }
      this.data.phase = "waiting";
      if (!this.data.seats.length) {
        await this.ctx.storage.deleteAll();
        this.ensureTable();
        this.data ={ room: this.data.room, phase: "waiting", startsAt: 0, endsAt: 0, seats: [] };
        this.sims.clear();
        return;
      }
      this.persist();
      await this.scheduleAlarm();
    }
  }
}
