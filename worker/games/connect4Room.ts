import { C4_TURN_MS, canDrop, drop, emptyBoard, isFull, winningLine, type C4State } from "../../shared/games/connect4";
import { recordDuel } from "../gamesDb";
import { BaseRoom, type AnyMsg, type Member } from "./baseRoom";

const GRACE_MS = 30_000;

interface RoomState {
  phase: "waiting" | "playing" | "ended";
  game: C4State | null;
  /** Seat (0/1 = order in members) that goes first next game. */
  nextFirst: 0 | 1;
  startedAt: number;
  rematch: string[];
  result: { winnerSeat: number; reason: string; deltas: [number, number] | null } | null;
}

/** Connect Four: fully server-authoritative, turn-based. */
export class Connect4Room extends BaseRoom<RoomState> {
  protected readonly maxMembers = 2;
  protected state: RoomState = { phase: "waiting", game: null, nextFirst: 0, startedAt: 0, rematch: [], result: null };

  private seatOf(id: string) {
    return this.members.findIndex((m) => m.id === id);
  }

  private view() {
    const g = this.state.game;
    return {
      t: "state",
      phase: this.state.phase,
      players: this.publicMembers(),
      board: g?.board ?? emptyBoard(),
      firstSeat: g?.firstSeat ?? 0,
      turn: g?.turn ?? 1,
      winLine: g?.winLine ?? null,
      winner: g?.winner ?? 0,
      lastMove: g?.moves.length ? g.moves[g.moves.length - 1] : -1,
      turnMsLeft: g && this.state.phase === "playing" ? Math.max(0, g.turnEndsAt - Date.now()) : 0,
      rematch: this.state.rematch,
      result: this.state.result,
    };
  }

  private push() {
    this.broadcast(this.view());
  }

  private start() {
    const firstSeat = this.state.nextFirst;
    this.state.game = { board: emptyBoard(), firstSeat, turn: 1, moves: [], winLine: null, winner: 0, turnEndsAt: Date.now() + C4_TURN_MS };
    this.state.phase = "playing";
    this.state.startedAt = Date.now();
    this.state.rematch = [];
    this.state.result = null;
    this.push();
  }

  /** Seat whose disc is `disc` this game. */
  private seatForDisc(disc: 1 | 2): number {
    const first = this.state.game!.firstSeat;
    return disc === 1 ? first : 1 - first;
  }

  private async finish(winnerSeat: number, reason: string) {
    const g = this.state.game!;
    this.state.phase = "ended";
    this.state.nextFirst = (1 - g.firstSeat) as 0 | 1; // alternate who starts
    const [a, b] = this.members;
    let deltas: [number, number] | null = null;
    if (a && b) {
      try {
        const d = await recordDuel(
          this.env.DB,
          "connect4",
          this.roomCode,
          { userId: a.id, score: winnerSeat === 0 ? 1 : 0 },
          { userId: b.id, score: winnerSeat === 1 ? 1 : 0 },
          winnerSeat === 0 ? "a" : winnerSeat === 1 ? "b" : "draw",
          reason,
          Date.now() - this.state.startedAt,
        );
        deltas = [d.a, d.b];
      } catch (err) {
        console.error("connect4 record failed", err);
      }
    }
    this.state.result = { winnerSeat, reason, deltas };
    // Players who left don't keep their seat after the game.
    this.members = this.members.filter((x) => x.connected);
    this.push();
  }

  protected onJoin(m: Member, ws: WebSocket, reconnect: boolean) {
    this.sendWs(ws, this.view());
    this.broadcast({ t: "presence", players: this.publicMembers() }, m.id);
    if (!reconnect && this.state.phase !== "playing" && this.members.length === 2) this.start();
  }

  protected async onMessage(m: Member, msg: AnyMsg) {
    const seat = this.seatOf(m.id);
    const g = this.state.game;
    switch (msg.t) {
      case "drop": {
        if (this.state.phase !== "playing" || !g) return;
        if (this.seatForDisc(g.turn) !== seat) return; // not your turn
        const col = Number(msg.col);
        if (!canDrop(g.board, col)) return;
        const row = drop(g.board, col, g.turn);
        g.moves.push(col);
        const line = winningLine(g.board, row, col);
        if (line) {
          g.winLine = line;
          g.winner = g.turn;
          await this.finish(seat, "connect");
          return;
        }
        if (isFull(g.board)) {
          g.winner = 3;
          await this.finish(-1, "draw");
          return;
        }
        g.turn = g.turn === 1 ? 2 : 1;
        g.turnEndsAt = Date.now() + C4_TURN_MS;
        this.persist();
        this.push();
        return;
      }
      case "rematch": {
        if (this.state.phase !== "ended" || this.members.length < 2) return;
        if (!this.state.rematch.includes(m.id)) this.state.rematch.push(m.id);
        if (this.state.rematch.length === 2) this.start();
        else this.push();
        return;
      }
      case "leave":
        if (this.state.phase === "playing") await this.finish(1 - seat, "forfeit");
        return;
    }
  }

  protected async onDisconnect(m: Member) {
    if (this.state.phase === "playing") {
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return; // grace period handled by the alarm
    }
    this.removeMember(m.id);
    this.state.rematch = [];
    if (this.state.phase === "ended") {
      // Keep the result on screen for whoever is left; a new joiner starts a fresh game.
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return;
    }
    this.state.phase = "waiting";
    this.state.game = null;
    this.state.result = null;
    this.broadcast({ t: "presence", players: this.publicMembers() });
    this.push();
  }

  protected nextAlarm(): number | null {
    if (this.state.phase !== "playing" || !this.state.game) return null;
    let at = this.state.game.turnEndsAt;
    for (const m of this.members) if (!m.connected) at = Math.min(at, m.disconnectedAt + GRACE_MS);
    return at;
  }

  protected async onAlarm() {
    const g = this.state.game;
    if (this.state.phase !== "playing" || !g) return;
    const now = Date.now();
    const gone = this.members.findIndex((m) => !m.connected && now - m.disconnectedAt >= GRACE_MS);
    if (gone >= 0) {
      await this.finish(1 - gone, "forfeit");
      return;
    }
    if (now >= g.turnEndsAt) await this.finish(1 - this.seatForDisc(g.turn), "timeout");
  }
}
