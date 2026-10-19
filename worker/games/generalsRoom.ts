import { FIRST_MOVE_MS, GENERALS_CLOCK, GENERALS_SETUP_MS } from "../../shared/games/clocks";
import { GeneralsGame, randomSetup, validateSetup, type GGMoveResult, type GGState, type Placement, type Side } from "../../shared/games/generals";
import { recordDuel } from "../gamesDb";
import { BaseRoom, type AnyMsg, type Member } from "./baseRoom";

const GRACE_MS = 60_000;

interface RoomState {
  phase: "waiting" | "setup" | "playing" | "ended";
  /** Member id of side 0 (moves first, sets up on rows 1–3). */
  side0: string;
  nextSide0: string;
  setupEndsAt: number;
  setups: Record<string, Placement | null>;
  ready: string[];
  game: GGState | null;
  clocks: [number, number];
  turnStartedAt: number;
  startedAt: number;
  /** Last move, as both players may see it (no ranks). */
  last: GGMoveResult | null;
  drawOffer: Side | null;
  rematch: string[];
  result: { winner: Side | null; reason: string; deltas: Record<string, number> | null } | null;
}

const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

/**
 * Game of the Generals. The server is the arbiter: it holds both armies,
 * resolves every challenge, and only ever tells a player which pieces were
 * eliminated, never the opponent's ranks (until the game is over).
 */
export class GeneralsRoom extends BaseRoom<RoomState> {
  protected readonly maxMembers = 2;
  protected state: RoomState = {
    phase: "waiting",
    side0: "",
    nextSide0: "",
    setupEndsAt: 0,
    setups: {},
    ready: [],
    game: null,
    clocks: [0, 0],
    turnStartedAt: 0,
    startedAt: 0,
    last: null,
    drawOffer: null,
    rematch: [],
    result: null,
  };
  private game: GeneralsGame | null = null;

  protected onLoaded() {
    this.game = this.state.game ? GeneralsGame.deserialize(this.state.game) : null;
  }

  private sideOf(id: string): Side | null {
    if (!this.members.some((m) => m.id === id)) return null;
    return id === this.state.side0 ? 0 : 1;
  }

  private idOf(side: Side): string | undefined {
    return side === 0 ? this.state.side0 : this.members.find((m) => m.id !== this.state.side0)?.id;
  }

  /** Clocks run once both sides have moved once (like chess). */
  private clocksRunning() {
    return (this.game?.moves ?? 0) >= 2;
  }

  private timeLeft(side: Side, now = Date.now()): number {
    const base = this.state.clocks[side];
    if (this.state.phase !== "playing" || !this.game || !this.clocksRunning() || this.game.turn !== side) return base;
    return base - (now - this.state.turnStartedAt);
  }

  private viewFor(id: string) {
    const side = this.sideOf(id) ?? 0;
    const g = this.game;
    const over = this.state.phase === "ended";
    const now = Date.now();
    return {
      t: "state",
      phase: this.state.phase,
      players: this.publicMembers(),
      side0: this.state.side0,
      you: side,
      setupMsLeft: this.state.phase === "setup" ? Math.max(0, this.state.setupEndsAt - now) : 0,
      mySetup: this.state.setups[id] ?? null,
      ready: this.state.ready,
      cells: g ? g.viewFor(side, over) : null,
      turn: g?.turn ?? 0,
      moves: g?.moves ?? 0,
      pendingFlag: g?.pendingFlag ?? null,
      // You know the ranks of your own eliminated pieces; the opponent's only by count (all revealed at the end).
      lost: g ? g.captured[side].map((p) => p.rank) : [],
      killed: g ? (over ? g.captured[side === 0 ? 1 : 0].map((p) => p.rank) : g.captured[side === 0 ? 1 : 0].length) : 0,
      last: this.state.last,
      clocks: [Math.max(0, this.timeLeft(0, now)), Math.max(0, this.timeLeft(1, now))],
      clockRunning: this.state.phase === "playing" && this.clocksRunning(),
      firstMoveMsLeft: this.state.phase === "playing" && !this.clocksRunning() ? Math.max(0, this.state.turnStartedAt + FIRST_MOVE_MS - now) : 0,
      drawOffer: this.state.drawOffer,
      rematch: this.state.rematch,
      result: this.state.result,
    };
  }

  private pushAll() {
    for (const m of this.members) this.send(m.id, this.viewFor(m.id));
  }

  private startSetup() {
    const [a, b] = this.members;
    const side0 = this.state.nextSide0 && this.members.some((m) => m.id === this.state.nextSide0) ? this.state.nextSide0 : rand() < 0.5 ? a.id : b.id;
    this.game = null;
    Object.assign(this.state, {
      phase: "setup",
      side0,
      nextSide0: side0 === a.id ? b.id : a.id,
      setupEndsAt: Date.now() + GENERALS_SETUP_MS,
      setups: {},
      ready: [],
      game: null,
      clocks: [GENERALS_CLOCK.baseMs, GENERALS_CLOCK.baseMs],
      last: null,
      drawOffer: null,
      rematch: [],
      result: null,
    } satisfies Partial<RoomState>);
    // Everyone starts from a random arrangement they can then rearrange.
    for (const m of this.members) this.state.setups[m.id] = randomSetup(this.sideOf(m.id)!, rand);
    this.persist();
    this.pushAll();
  }

  private startPlay() {
    const id0 = this.idOf(0)!;
    const id1 = this.idOf(1)!;
    const s0 = this.state.setups[id0] ?? randomSetup(0, rand);
    const s1 = this.state.setups[id1] ?? randomSetup(1, rand);
    this.game = new GeneralsGame(s0, s1, 0);
    this.state.game = this.game.serialize();
    this.state.phase = "playing";
    this.state.turnStartedAt = Date.now();
    this.state.startedAt = Date.now();
    this.persist();
    this.pushAll();
  }

  private async finish(winner: Side | null, reason: string) {
    if (this.state.phase !== "playing" && this.state.phase !== "setup") return;
    const now = Date.now();
    if (this.game && this.clocksRunning()) this.state.clocks[this.game.turn] = Math.max(0, this.timeLeft(this.game.turn, now));
    this.state.phase = "ended";
    this.state.drawOffer = null;
    let deltas: Record<string, number> | null = null;
    const id0 = this.idOf(0);
    const id1 = this.idOf(1);
    if (reason !== "aborted" && id0 && id1) {
      try {
        const d = await recordDuel(
          this.env.DB,
          "generals",
          this.roomCode,
          { userId: id0, score: winner === 0 ? 1 : 0, data: { side: 0, moves: this.game?.moves ?? 0 } },
          { userId: id1, score: winner === 1 ? 1 : 0, data: { side: 1, moves: this.game?.moves ?? 0 } },
          winner === 0 ? "a" : winner === 1 ? "b" : "draw",
          reason,
          now - (this.state.startedAt || now),
        );
        deltas = { [id0]: d.a, [id1]: d.b };
      } catch (err) {
        console.error("generals record failed", err);
      }
    }
    this.state.result = { winner, reason, deltas };
    if (this.game) this.state.game = this.game.serialize();
    this.members = this.members.filter((m) => m.connected);
    this.persist();
    this.pushAll();
  }

  protected onJoin(m: Member, ws: WebSocket, reconnect: boolean) {
    this.sendWs(ws, this.viewFor(m.id));
    this.broadcast({ t: "presence", players: this.publicMembers() }, m.id);
    if (!reconnect && (this.state.phase === "waiting" || this.state.phase === "ended") && this.members.length === 2) this.startSetup();
  }

  protected async onMessage(m: Member, msg: AnyMsg) {
    const side = this.sideOf(m.id);
    if (side === null) return;
    const other: Side = side === 0 ? 1 : 0;
    const now = Date.now();
    switch (msg.t) {
      case "setup": {
        if (this.state.phase !== "setup" || this.state.ready.includes(m.id)) return;
        if (!validateSetup(side, msg.placement)) return this.send(m.id, this.viewFor(m.id));
        this.state.setups[m.id] = msg.placement;
        this.persist();
        return;
      }
      case "ready": {
        if (this.state.phase !== "setup") return;
        if (msg.placement !== undefined) {
          if (!validateSetup(side, msg.placement)) return this.send(m.id, this.viewFor(m.id));
          this.state.setups[m.id] = msg.placement;
        }
        if (!this.state.ready.includes(m.id)) this.state.ready.push(m.id);
        if (this.state.ready.length === 2) return this.startPlay();
        this.persist();
        this.pushAll();
        return;
      }
      case "unready":
        if (this.state.phase !== "setup") return;
        this.state.ready = this.state.ready.filter((x) => x !== m.id);
        this.pushAll();
        return;
      case "move": {
        const g = this.game;
        if (this.state.phase !== "playing" || !g || g.turn !== side) return;
        if (this.clocksRunning() && this.timeLeft(side, now) <= 0) return this.finish(other, "timeout");
        const res = g.move(side, Number(msg.from), Number(msg.to));
        if (!res) return this.send(m.id, this.viewFor(m.id));
        if (this.clocksRunning()) this.state.clocks[side] = this.state.clocks[side] - (now - this.state.turnStartedAt) + GENERALS_CLOCK.incMs;
        this.state.turnStartedAt = now;
        this.state.last = res;
        if (this.state.drawOffer === other) this.state.drawOffer = null;
        this.state.game = g.serialize();
        if (g.winner !== null) return this.finish(g.winner, g.reason ?? "flag-captured");
        this.persist();
        this.pushAll();
        return;
      }
      case "resign":
        if (this.state.phase === "setup") return this.finish(null, "aborted");
        if (this.state.phase !== "playing") return;
        if ((this.game?.moves ?? 0) < 2) return this.finish(null, "aborted");
        return this.finish(other, "resign");
      case "draw-offer":
        if (this.state.phase !== "playing" || (this.game?.moves ?? 0) < 2) return;
        if (this.state.drawOffer === other) return this.finish(null, "agreement");
        this.state.drawOffer = side;
        this.pushAll();
        return;
      case "draw-accept":
        if (this.state.phase === "playing" && this.state.drawOffer === other) return this.finish(null, "agreement");
        return;
      case "draw-decline":
        if (this.state.drawOffer === other) {
          this.state.drawOffer = null;
          this.pushAll();
        }
        return;
      case "rematch":
        if (this.state.phase !== "ended" || this.members.length < 2) return;
        if (!this.state.rematch.includes(m.id)) this.state.rematch.push(m.id);
        if (this.state.rematch.length === 2) this.startSetup();
        else this.pushAll();
        return;
      case "leave":
        if (this.state.phase === "setup") return this.finish(null, "aborted");
        if (this.state.phase !== "playing") return;
        if ((this.game?.moves ?? 0) < 2) return this.finish(null, "aborted");
        return this.finish(other, "forfeit");
    }
  }

  protected async onDisconnect(m: Member) {
    if (this.state.phase === "playing" || this.state.phase === "setup") {
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return;
    }
    this.removeMember(m.id);
    this.state.rematch = [];
    if (this.state.phase === "ended") {
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return;
    }
    this.state.phase = "waiting";
    this.pushAll();
  }

  protected nextAlarm(): number | null {
    let at: number;
    if (this.state.phase === "setup") at = this.state.setupEndsAt;
    else if (this.state.phase === "playing" && this.game) {
      at = this.clocksRunning() ? this.state.turnStartedAt + this.state.clocks[this.game.turn] : this.state.turnStartedAt + FIRST_MOVE_MS;
    } else return null;
    for (const m of this.members) if (!m.connected) at = Math.min(at, m.disconnectedAt + GRACE_MS);
    return at;
  }

  protected async onAlarm() {
    const now = Date.now();
    if (this.state.phase !== "setup" && this.state.phase !== "playing") return;
    const gone = this.members.find((m) => !m.connected && now - m.disconnectedAt >= GRACE_MS);
    if (gone) {
      if (this.state.phase === "setup" || (this.game?.moves ?? 0) < 2) return this.finish(null, "aborted");
      return this.finish(this.sideOf(gone.id) === 0 ? 1 : 0, "forfeit");
    }
    if (this.state.phase === "setup") {
      // Setup time is up: whatever arrangement each player has is used.
      if (now >= this.state.setupEndsAt) this.startPlay();
      return;
    }
    const g = this.game!;
    if (!this.clocksRunning()) {
      if (now >= this.state.turnStartedAt + FIRST_MOVE_MS) await this.finish(null, "aborted");
      return;
    }
    if (this.timeLeft(g.turn, now) <= 0) await this.finish(g.turn === 0 ? 1 : 0, "timeout");
  }
}
