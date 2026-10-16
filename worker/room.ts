import { DurableObject } from "cloudflare:workers";
import {
  COUNTDOWN_MS,
  MATCH_DURATION_MS,
  type ClientMsg,
  type PlayerInfo,
  type ServerMsg,
} from "../shared/protocol";
import type { Env } from "./env";

interface Seat {
  ws: WebSocket;
  info: PlayerInfo | null;
  kos: number;
  linesSent: number;
  wantsRematch: boolean;
}

type Phase = "waiting" | "countdown" | "playing" | "ended";

const MAX_ATTACK_PER_MSG = 24;

/**
 * One 1v1 match. The room is the referee: it runs the clock, routes garbage,
 * counts KOs and decides the winner. Each client simulates its own board and
 * streams snapshots that are relayed to the opponent for live spectating.
 */
export class BattleRoom extends DurableObject<Env> {
  private seats: Seat[] = [];
  private phase: Phase = "waiting";
  private timers: ReturnType<typeof setTimeout>[] = [];

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (this.seats.length >= 2) {
      this.send(server, { t: "error", message: "This room is full." });
      server.close(1008, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    const seat: Seat = { ws: server, info: null, kos: 0, linesSent: 0, wantsRematch: false };
    this.seats.push(seat);

    server.addEventListener("message", (ev) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data));
      } catch {
        return;
      }
      this.onMessage(seat, msg);
    });
    const onGone = () => this.onLeave(seat);
    server.addEventListener("close", onGone);
    server.addEventListener("error", onGone);

    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  private other(seat: Seat): Seat | undefined {
    return this.seats.find((s) => s !== seat);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private onMessage(seat: Seat, msg: ClientMsg) {
    const opp = this.other(seat);
    switch (msg.t) {
      case "hello": {
        seat.info = sanitizePlayer(msg.player);
        if (opp?.info) {
          this.send(seat.ws, { t: "opponent", player: opp.info });
          this.send(opp.ws, { t: "opponent", player: seat.info });
          if (this.phase === "waiting") this.startCountdown();
        }
        break;
      }
      case "state":
        if (opp && this.phase !== "waiting") this.send(opp.ws, { t: "opState", s: msg.s });
        break;
      case "attack": {
        if (this.phase !== "playing" || !opp) break;
        const lines = Math.max(0, Math.min(MAX_ATTACK_PER_MSG, Math.floor(Number(msg.lines) || 0)));
        if (!lines) break;
        seat.linesSent += lines;
        const label = typeof msg.label === "string" ? msg.label.slice(0, 32) : undefined;
        this.send(opp.ws, { t: "garbage", lines, label });
        break;
      }
      case "ko": {
        if (this.phase !== "playing" || !opp) break;
        opp.kos += 1;
        this.send(seat.ws, { t: "ko", victim: "you", you: seat.kos, opponent: opp.kos });
        this.send(opp.ws, { t: "ko", victim: "opponent", you: opp.kos, opponent: seat.kos });
        break;
      }
      case "rematch": {
        if (this.phase !== "ended" || !opp) break;
        seat.wantsRematch = true;
        if (opp.wantsRematch) this.startCountdown();
        else this.send(opp.ws, { t: "rematchRequested" });
        break;
      }
      case "ping":
        this.send(seat.ws, { t: "pong", at: msg.at });
        break;
    }
  }

  private startCountdown() {
    this.clearTimers();
    this.phase = "countdown";
    for (const s of this.seats) {
      s.kos = 0;
      s.linesSent = 0;
      s.wantsRematch = false;
      this.send(s.ws, { t: "countdown", in: COUNTDOWN_MS, duration: MATCH_DURATION_MS });
    }
    this.timers.push(
      setTimeout(() => {
        this.phase = "playing";
        this.timers.push(setTimeout(() => void this.finish("time"), MATCH_DURATION_MS));
      }, COUNTDOWN_MS),
    );
  }

  private async finish(reason: "time" | "forfeit", forfeiter?: Seat) {
    if (this.phase !== "playing" && this.phase !== "countdown") return;
    this.clearTimers();
    this.phase = "ended";

    const [a, b] = this.seats;
    let outcome: "a" | "b" | "draw";
    if (reason === "forfeit") outcome = forfeiter === a ? "b" : "a";
    else if (a.kos !== b?.kos) outcome = a.kos > (b?.kos ?? 0) ? "a" : "b";
    else if (a.linesSent !== b?.linesSent) outcome = a.linesSent > (b?.linesSent ?? 0) ? "a" : "b";
    else outcome = "draw";

    let deltas: { a: number; b: number } | null = null;
    if (a?.info && b?.info) {
      try {
        const lb = this.env.LEADERBOARD.get(this.env.LEADERBOARD.idFromName("global"));
        deltas = await lb.recordBattle(
          { player: a.info, kos: a.kos },
          { player: b.info, kos: b.kos },
          outcome,
        );
      } catch (err) {
        console.error("recordBattle failed", err);
      }
    }

    const report = (me: Seat | undefined, them: Seat | undefined, key: "a" | "b") => {
      if (!me || me === forfeiter) return;
      this.send(me.ws, {
        t: "end",
        result: outcome === "draw" ? "draw" : outcome === key ? "win" : "lose",
        reason,
        you: { kos: me.kos, linesSent: me.linesSent },
        opponent: { kos: them?.kos ?? 0, linesSent: them?.linesSent ?? 0 },
        ratingDelta: deltas?.[key],
      });
    };
    report(a, b, "a");
    report(b, a, "b");
  }

  private onLeave(seat: Seat) {
    if (!this.seats.includes(seat)) return;
    const opp = this.other(seat);
    if (this.phase === "playing" || this.phase === "countdown") {
      void this.finish("forfeit", seat).finally(() => this.removeSeat(seat, opp));
    } else {
      this.removeSeat(seat, opp);
    }
  }

  private removeSeat(seat: Seat, opp: Seat | undefined) {
    this.seats = this.seats.filter((s) => s !== seat);
    if (opp) this.send(opp.ws, { t: "opponentLeft" });
    this.phase = "waiting";
    this.clearTimers();
  }
}

function sanitizePlayer(p: Partial<PlayerInfo> | undefined): PlayerInfo {
  const str = (v: unknown, max: number, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
  return {
    id: str(p?.id, 64, crypto.randomUUID()),
    name: str(p?.name, 20, "Player"),
    avatar: str(p?.avatar, 8, "🎮"),
    color: /^#[0-9a-fA-F]{6}$/.test(p?.color ?? "") ? p!.color! : "#8b5cf6",
    skin: str(p?.skin, 24, "classic"),
  };
}
