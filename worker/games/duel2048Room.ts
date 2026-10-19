import { DUEL_MS, DUEL_TARGET, G2048, type Dir, type G2048State } from "../../shared/games/g2048";
import { recordDuel } from "../gamesDb";
import { BaseRoom, type AnyMsg, type Member } from "./baseRoom";

const COUNTDOWN_MS = 3000;
const GRACE_MS = 15_000;
const PERSIST_EVERY_MS = 3000;

interface RoomState {
  phase: "waiting" | "countdown" | "playing" | "ended";
  seed: number;
  startsAt: number;
  endsAt: number;
  boards: Record<string, G2048State>;
  epochs: Record<string, number>;
  rematch: string[];
  result: { winner: string | null; reason: string; deltas: Record<string, number> | null } | null;
}

/** 2048 Duel: same seed for both players; the server replays every move. */
export class Duel2048Room extends BaseRoom<RoomState> {
  protected readonly maxMembers = 2;
  protected state: RoomState = { phase: "waiting", seed: 0, startsAt: 0, endsAt: 0, boards: {}, epochs: {}, rematch: [], result: null };
  private games = new Map<string, G2048>();
  private lastPersist = 0;

  protected onLoaded() {
    for (const [id, s] of Object.entries(this.state.boards)) this.games.set(id, G2048.deserialize(s));
  }

  private saveBoards(force = false) {
    if (!force && Date.now() - this.lastPersist < PERSIST_EVERY_MS) return;
    for (const [id, g] of this.games) this.state.boards[id] = g.serialize();
    this.persist();
    this.lastPersist = Date.now();
  }

  private boardView(g: G2048) {
    return { board: g.board, score: g.score, maxTile: g.maxTile, over: g.over, moves: g.moves };
  }

  private stateFor(id: string) {
    const now = Date.now();
    const boards: Record<string, ReturnType<Duel2048Room["boardView"]>> = {};
    for (const [pid, g] of this.games) boards[pid] = this.boardView(g);
    const mine = this.games.get(id);
    return {
      t: "state",
      phase: this.state.phase,
      players: this.publicMembers(),
      seed: this.state.seed,
      msUntilStart: Math.max(0, this.state.startsAt - now),
      msRemaining: this.state.phase === "ended" ? 0 : Math.max(0, this.state.endsAt - now),
      epoch: this.state.epochs[id] ?? 0,
      you: mine ? mine.serialize() : null,
      boards,
      rematch: this.state.rematch,
      result: this.state.result,
    };
  }

  private pushAll() {
    for (const m of this.members) this.send(m.id, this.stateFor(m.id));
  }

  private startCountdown() {
    const now = Date.now();
    this.state.phase = "countdown";
    this.state.seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.state.startsAt = now + COUNTDOWN_MS;
    this.state.endsAt = this.state.startsAt + DUEL_MS;
    this.state.rematch = [];
    this.state.result = null;
    this.games.clear();
    for (const m of this.members) {
      this.games.set(m.id, new G2048(this.state.seed));
      this.state.epochs[m.id] = (this.state.epochs[m.id] ?? 0) + 1;
    }
    this.saveBoards(true);
    this.pushAll();
  }

  private async finish(reason: string, forcedWinner?: string | null) {
    if (this.state.phase !== "playing" && this.state.phase !== "countdown") return;
    this.state.phase = "ended";
    const [a, b] = this.members;
    const ga = a && this.games.get(a.id);
    const gb = b && this.games.get(b.id);
    let winner: string | null = null;
    if (forcedWinner !== undefined) winner = forcedWinner;
    else if (ga && gb) {
      if (ga.score !== gb.score) winner = ga.score > gb.score ? a.id : b.id;
      else if (ga.maxTile !== gb.maxTile) winner = ga.maxTile > gb.maxTile ? a.id : b.id;
    }
    let deltas: Record<string, number> | null = null;
    if (a && b && ga && gb) {
      try {
        const d = await recordDuel(
          this.env.DB,
          "2048",
          this.roomCode,
          { userId: a.id, score: ga.score, data: { maxTile: ga.maxTile } },
          { userId: b.id, score: gb.score, data: { maxTile: gb.maxTile } },
          winner === a.id ? "a" : winner === b.id ? "b" : "draw",
          reason,
          Math.max(0, Math.min(Date.now(), this.state.endsAt) - this.state.startsAt),
        );
        deltas = { [a.id]: d.a, [b.id]: d.b };
      } catch (err) {
        console.error("2048 duel record failed", err);
      }
    }
    this.state.result = { winner, reason, deltas };
    this.members = this.members.filter((m) => m.connected);
    this.saveBoards(true);
    this.pushAll();
  }

  protected onJoin(m: Member, ws: WebSocket, reconnect: boolean) {
    if (reconnect) this.state.epochs[m.id] = (this.state.epochs[m.id] ?? 0) + 1;
    this.sendWs(ws, this.stateFor(m.id));
    this.broadcast({ t: "presence", players: this.publicMembers() }, m.id);
    if (!reconnect && (this.state.phase === "waiting" || this.state.phase === "ended") && this.members.length === 2) this.startCountdown();
  }

  protected async onMessage(m: Member, msg: AnyMsg) {
    switch (msg.t) {
      case "moves":
        return this.onMoves(m, msg);
      case "rematch":
        if (this.state.phase !== "ended" || this.members.length < 2) return;
        if (!this.state.rematch.includes(m.id)) this.state.rematch.push(m.id);
        if (this.state.rematch.length === 2) this.startCountdown();
        else this.pushAll();
        return;
      case "leave":
        if (this.state.phase === "playing" || this.state.phase === "countdown") {
          const other = this.members.find((x) => x.id !== m.id);
          m.connected = false;
          await this.finish("forfeit", other?.id ?? null);
        }
        return;
    }
  }

  private async onMoves(m: Member, msg: AnyMsg) {
    if (this.state.phase === "countdown" && Date.now() >= this.state.startsAt) this.state.phase = "playing";
    if (this.state.phase !== "playing") return;
    if (msg.epoch !== this.state.epochs[m.id]) return; // stale batch from before a resync
    const g = this.games.get(m.id);
    const dirs = msg.dirs;
    if (!g || !Array.isArray(dirs) || dirs.length > 200) return;
    let ok = true;
    for (const d of dirs) {
      if (!g.move(d as Dir)) {
        ok = false;
        break;
      }
    }
    if (!ok || msg.h !== g.hash()) {
      this.state.epochs[m.id]++;
      this.send(m.id, { t: "resync", state: g.serialize(), epoch: this.state.epochs[m.id] });
    }
    this.broadcast({ t: "board", id: m.id, ...this.boardView(g) }, m.id);
    this.saveBoards();

    if (g.maxTile >= DUEL_TARGET) return this.finish("target", m.id);
    if ([...this.games.values()].every((x) => x.over)) return this.finish("stuck");
  }

  protected async onDisconnect(m: Member) {
    if (this.state.phase === "playing" || this.state.phase === "countdown") {
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return;
    }
    this.removeMember(m.id);
    this.state.rematch = [];
    if (this.state.phase === "ended") {
      // Keep the result on screen for whoever is left; a new joiner starts a fresh match.
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return;
    }
    this.games.delete(m.id);
    delete this.state.boards[m.id];
    this.state.phase = "waiting";
    this.state.result = null;
    this.broadcast({ t: "presence", players: this.publicMembers() });
    this.pushAll();
  }

  protected nextAlarm(): number | null {
    const { phase, startsAt, endsAt } = this.state;
    if (phase === "countdown") return startsAt;
    if (phase !== "playing") return null;
    let at = endsAt;
    for (const m of this.members) if (!m.connected) at = Math.min(at, m.disconnectedAt + GRACE_MS);
    return at;
  }

  protected async onAlarm() {
    const now = Date.now();
    if (this.state.phase === "countdown" && now >= this.state.startsAt) this.state.phase = "playing";
    if (this.state.phase !== "playing") return;
    const gone = this.members.find((m) => !m.connected && now - m.disconnectedAt >= GRACE_MS);
    if (gone) {
      await this.finish("forfeit", this.members.find((m) => m.id !== gone.id)?.id ?? null);
      return;
    }
    if (now >= this.state.endsAt) await this.finish("time");
  }
}
