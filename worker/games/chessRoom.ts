import { Chess, type Color, type DrawReason } from "../../shared/games/chess";
import { FIRST_MOVE_MS, chessTimeControl, type TimeControl } from "../../shared/games/clocks";
import { recordDuel } from "../gamesDb";
import { BaseRoom, type AnyMsg, type Member } from "./baseRoom";

const GRACE_MS = 60_000;

interface Result {
  winner: Color | null;
  reason: string;
  deltas: Record<string, number> | null;
}

interface RoomState {
  phase: "waiting" | "playing" | "ended";
  tc: string;
  /** Member id playing white this game; the other member plays black. */
  white: string;
  /** Who plays white next game (rematches swap colors). */
  nextWhite: string;
  moves: string[]; // UCI
  clocks: { w: number; b: number };
  /** When the side to move started thinking (their clock runs from here). */
  turnStartedAt: number;
  startedAt: number;
  drawOffer: Color | null;
  rematch: string[];
  result: Result | null;
}

/**
 * Chess, FIDE rules, fully server-authoritative: clients send moves in UCI,
 * the server validates them, runs both clocks (Fischer increment) and decides
 * every result. Clocks start once each side has made its first move; a player
 * who doesn't make their first move in time aborts the game (unrated).
 */
export class ChessRoom extends BaseRoom<RoomState> {
  protected readonly maxMembers = 2;
  protected state: RoomState = {
    phase: "waiting",
    tc: "",
    white: "",
    nextWhite: "",
    moves: [],
    clocks: { w: 0, b: 0 },
    turnStartedAt: 0,
    startedAt: 0,
    drawOffer: null,
    rematch: [],
    result: null,
  };
  private chess = new Chess();

  protected onLoaded() {
    this.chess = new Chess();
    for (const m of this.state.moves) this.chess.move(m);
  }

  private get tc(): TimeControl {
    return chessTimeControl(this.state.tc);
  }

  private colorOf(id: string): Color | null {
    if (!this.members.some((m) => m.id === id)) return null;
    return id === this.state.white ? "w" : "b";
  }

  private idOf(color: Color): string | undefined {
    return color === "w" ? this.state.white : this.members.find((m) => m.id !== this.state.white)?.id;
  }

  /** Both sides have moved once: from here on the clocks run. */
  private clocksRunning() {
    return this.state.moves.length >= 2;
  }

  /** Time left for `color` right now. */
  private timeLeft(color: Color, now = Date.now()): number {
    const base = this.state.clocks[color];
    if (this.state.phase !== "playing" || !this.clocksRunning() || this.chess.turn !== color) return base;
    return base - (now - this.state.turnStartedAt);
  }

  private view() {
    const c = this.chess;
    const last = c.history[c.history.length - 1];
    return {
      t: "state",
      phase: this.state.phase,
      players: this.publicMembers(),
      white: this.state.white,
      tc: this.tc.id,
      moves: this.state.moves,
      san: c.history.map((m) => m.san),
      fen: c.fen(),
      turn: c.turn,
      check: c.inCheck(),
      lastMove: last ? { from: last.from, to: last.to } : null,
      clocks: { w: Math.max(0, this.timeLeft("w")), b: Math.max(0, this.timeLeft("b")) },
      clockRunning: this.state.phase === "playing" && this.clocksRunning(),
      firstMoveMsLeft: this.state.phase === "playing" && !this.clocksRunning() ? Math.max(0, this.state.turnStartedAt + FIRST_MOVE_MS - Date.now()) : 0,
      drawOffer: this.state.drawOffer,
      canClaim: this.state.phase === "playing" && (c.canClaimThreefold() || c.canClaimFifty()),
      rematch: this.state.rematch,
      result: this.state.result,
    };
  }

  private push() {
    this.broadcast(this.view());
  }

  private start() {
    const [a, b] = this.members;
    const white = this.state.nextWhite && this.members.some((m) => m.id === this.state.nextWhite) ? this.state.nextWhite : (crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? a.id : b.id);
    this.chess = new Chess();
    Object.assign(this.state, {
      phase: "playing",
      white,
      nextWhite: white === a.id ? b.id : a.id,
      moves: [],
      clocks: { w: this.tc.baseMs, b: this.tc.baseMs },
      turnStartedAt: Date.now(),
      startedAt: Date.now(),
      drawOffer: null,
      rematch: [],
      result: null,
    } satisfies Partial<RoomState>);
    this.persist();
    this.push();
  }

  private async finish(winner: Color | null, reason: string) {
    if (this.state.phase !== "playing") return;
    const now = Date.now();
    // Freeze the mover's clock at the end.
    if (this.clocksRunning()) this.state.clocks[this.chess.turn] = Math.max(0, this.timeLeft(this.chess.turn, now));
    this.state.phase = "ended";
    this.state.drawOffer = null;
    let deltas: Record<string, number> | null = null;
    const whiteId = this.idOf("w");
    const blackId = this.idOf("b");
    // Aborted games (no first moves) aren't rated or recorded.
    if (reason !== "aborted" && whiteId && blackId) {
      try {
        const d = await recordDuel(
          this.env.DB,
          "chess",
          this.roomCode,
          { userId: whiteId, score: winner === "w" ? 1 : 0, data: { color: "white", moves: this.state.moves.length } },
          { userId: blackId, score: winner === "b" ? 1 : 0, data: { color: "black", moves: this.state.moves.length } },
          winner === "w" ? "a" : winner === "b" ? "b" : "draw",
          reason,
          now - this.state.startedAt,
        );
        deltas = { [whiteId]: d.a, [blackId]: d.b };
      } catch (err) {
        console.error("chess record failed", err);
      }
    }
    this.state.result = { winner, reason, deltas };
    this.members = this.members.filter((m) => m.connected);
    this.persist();
    this.push();
  }

  /** Flag fall: the other side wins, unless they couldn't possibly mate (then it's a draw). */
  private async flagFall(color: Color) {
    const other: Color = color === "w" ? "b" : "w";
    if (this.chess.canMate(other)) await this.finish(other, "timeout");
    else await this.finish(null, "timeout-vs-insufficient" satisfies DrawReason);
  }

  protected onJoin(m: Member, ws: WebSocket, reconnect: boolean) {
    if (!this.state.tc) this.state.tc = chessTimeControl(this.joinParams.get("tc")).id;
    this.sendWs(ws, this.view());
    this.broadcast({ t: "presence", players: this.publicMembers() }, m.id);
    if (!reconnect && this.state.phase !== "playing" && this.members.length === 2) this.start();
  }

  protected async onMessage(m: Member, msg: AnyMsg) {
    const color = this.colorOf(m.id);
    if (!color) return;
    const now = Date.now();
    switch (msg.t) {
      case "move": {
        if (this.state.phase !== "playing" || this.chess.turn !== color || typeof msg.uci !== "string" || msg.uci.length > 6) return;
        if (this.clocksRunning() && this.timeLeft(color, now) <= 0) return this.flagFall(color);
        const mv = this.chess.move(msg.uci);
        if (!mv) return this.sendWs(this.socketsOf(m.id)[0], this.view()); // illegal: resend the real position
        if (this.clocksRunning()) this.state.clocks[color] = this.state.clocks[color] - (now - this.state.turnStartedAt) + this.tc.incMs;
        this.state.moves.push(mv.uci);
        this.state.turnStartedAt = now;
        // Making a move declines a pending draw offer from the opponent.
        if (this.state.drawOffer && this.state.drawOffer !== color) this.state.drawOffer = null;
        const out = this.chess.outcome();
        if (out) return this.finish(out.winner, out.reason);
        this.persist();
        this.push();
        return;
      }
      case "resign":
        if (this.state.phase !== "playing") return;
        if (this.state.moves.length < 2) return this.finish(null, "aborted");
        return this.finish(color === "w" ? "b" : "w", "resign");
      case "draw-offer":
        if (this.state.phase !== "playing" || this.state.moves.length < 2) return;
        if (this.state.drawOffer && this.state.drawOffer !== color) return this.finish(null, "agreement"); // both offered
        this.state.drawOffer = color;
        this.push();
        return;
      case "draw-accept":
        if (this.state.phase === "playing" && this.state.drawOffer && this.state.drawOffer !== color) return this.finish(null, "agreement");
        return;
      case "draw-decline":
        if (this.state.drawOffer && this.state.drawOffer !== color) {
          this.state.drawOffer = null;
          this.push();
        }
        return;
      case "claim-draw":
        // FIDE: threefold repetition and the 50-move rule are draws on claim.
        if (this.state.phase !== "playing") return;
        if (this.chess.canClaimThreefold()) return this.finish(null, "threefold");
        if (this.chess.canClaimFifty()) return this.finish(null, "fifty");
        return;
      case "rematch":
        if (this.state.phase !== "ended" || this.members.length < 2) return;
        if (!this.state.rematch.includes(m.id)) this.state.rematch.push(m.id);
        if (this.state.rematch.length === 2) this.start();
        else this.push();
        return;
      case "leave":
        if (this.state.phase !== "playing") return;
        if (this.state.moves.length < 2) return this.finish(null, "aborted");
        return this.finish(color === "w" ? "b" : "w", "forfeit");
    }
  }

  protected async onDisconnect(m: Member) {
    if (this.state.phase === "playing") {
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return; // the clock keeps running; the alarm handles abandonment
    }
    this.removeMember(m.id);
    this.state.rematch = [];
    if (this.state.phase === "ended") {
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return;
    }
    this.state.phase = "waiting";
    this.push();
  }

  protected nextAlarm(): number | null {
    if (this.state.phase !== "playing") return null;
    const turn = this.chess.turn;
    let at = this.clocksRunning() ? this.state.turnStartedAt + this.state.clocks[turn] : this.state.turnStartedAt + FIRST_MOVE_MS;
    for (const m of this.members) if (!m.connected) at = Math.min(at, m.disconnectedAt + GRACE_MS);
    return at;
  }

  protected async onAlarm() {
    if (this.state.phase !== "playing") return;
    const now = Date.now();
    const gone = this.members.find((m) => !m.connected && now - m.disconnectedAt >= GRACE_MS);
    if (gone) {
      if (this.state.moves.length < 2) return this.finish(null, "aborted");
      return this.finish(this.colorOf(gone.id) === "w" ? "b" : "w", "forfeit");
    }
    const turn = this.chess.turn;
    if (!this.clocksRunning()) {
      if (now >= this.state.turnStartedAt + FIRST_MOVE_MS) await this.finish(null, "aborted");
      return;
    }
    if (this.timeLeft(turn, now) <= 0) await this.flagFall(turn);
  }
}
