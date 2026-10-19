import { SNAKE_COLORS, SNAKE_MAX_PLAYERS, SNAKE_ROUND_MS, SNAKE_TICK_MS, SnakeSim, type SnakeMember } from "../../shared/games/snake";
import { recordSnakeRound } from "../gamesDb";
import { BaseRoom, type AnyMsg, type Member } from "./baseRoom";

const COUNTDOWN_MS = 3000;
const AUTO_START_MS = 8000;
const BOT_NAMES = ["Byte", "Glitch", "Pixel", "Nibble", "Rogue", "Echo"];
const BOT_AVATARS = ["t-S", "t-Z", "p-W", "p-N"];

interface RoomState {
  phase: "lobby" | "countdown" | "playing" | "ended";
  hostId: string;
  /** Quick-match rooms start on their own. */
  auto: boolean;
  autoStartAt: number;
  fillBots: boolean;
  startsAt: number;
  endsAt: number;
  results: { id: string; name: string; avatar: string; color: string; bot: boolean; place: number; score: number; kills: number }[] | null;
}

/**
 * Snake Arena: up to 4 snakes; the server runs the simulation and streams a
 * snapshot every tick. Empty slots can be filled with bots.
 */
export class SnakeRoom extends BaseRoom<RoomState> {
  protected readonly maxMembers = SNAKE_MAX_PLAYERS;
  protected state: RoomState = {
    phase: "lobby",
    hostId: "",
    auto: false,
    autoStartAt: 0,
    fillBots: true,
    startsAt: 0,
    endsAt: 0,
    results: null,
  };
  private sim: SnakeSim | null = null;
  private loop: ReturnType<typeof setInterval> | undefined;
  private roster: SnakeMember[] = [];

  protected onLoaded() {
    // The simulation lives in memory only; if the room restarted mid-round, go back to the lobby.
    if (this.state.phase === "playing" || this.state.phase === "countdown") {
      this.state.phase = "lobby";
      this.state.results = null;
    }
  }

  protected canJoin(): string | null {
    if (this.state.phase === "playing" || this.state.phase === "countdown") return "A round is in progress — try again in a moment.";
    return super.canJoin();
  }

  private lobbyView() {
    return {
      t: "lobby",
      phase: this.state.phase,
      players: this.publicMembers(),
      hostId: this.state.hostId,
      auto: this.state.auto,
      fillBots: this.state.fillBots,
      autoStartIn: this.state.auto && this.state.phase === "lobby" ? Math.max(0, this.state.autoStartAt - Date.now()) : 0,
      startsIn: this.state.phase === "countdown" ? Math.max(0, this.state.startsAt - Date.now()) : 0,
      results: this.state.results,
    };
  }

  private pushLobby() {
    this.broadcast(this.lobbyView());
  }

  protected onJoin(m: Member, ws: WebSocket, reconnect: boolean) {
    if (!this.state.hostId || !this.member(this.state.hostId)) this.state.hostId = m.id;
    if (!reconnect && this.state.phase === "ended") this.state.phase = "lobby";
    this.sendWs(ws, this.lobbyView());
    if (this.sim && this.state.phase === "playing") this.sendWs(ws, { t: "tick", s: this.sim.snapshot(), msLeft: this.state.endsAt - Date.now() });
    this.pushLobby();
    if (this.state.auto && this.state.phase === "lobby" && this.members.length >= SNAKE_MAX_PLAYERS) this.beginCountdown();
  }

  protected async onMessage(m: Member, msg: AnyMsg) {
    switch (msg.t) {
      case "hello":
        // Quick-match rooms auto-start: the first matched player to say hello starts the timer.
        if (msg.auto === true && this.state.phase === "lobby" && !this.state.auto) {
          this.state.auto = true;
          this.state.autoStartAt = Date.now() + AUTO_START_MS;
          this.pushLobby();
        }
        return;
      case "start":
        if (this.state.phase !== "lobby" && this.state.phase !== "ended") return;
        if (m.id !== this.state.hostId && !this.state.auto) return;
        this.beginCountdown();
        return;
      case "bots":
        if (m.id === this.state.hostId && this.state.phase === "lobby") {
          this.state.fillBots = msg.on === true;
          this.pushLobby();
        }
        return;
      case "dir":
        if (this.sim && this.state.phase === "playing") this.sim.setDir(m.id, Number(msg.d));
        return;
      case "again":
        if (this.state.phase === "ended") {
          this.state.phase = "lobby";
          this.state.results = null;
          this.state.auto = false;
          this.pushLobby();
        }
        return;
      case "leave":
        if (this.sim && this.state.phase === "playing") this.sim.removePlayer(m.id);
        return;
    }
  }

  private beginCountdown() {
    const humans = this.members.filter((m) => m.connected);
    if (!humans.length) return;
    this.state.phase = "countdown";
    this.state.startsAt = Date.now() + COUNTDOWN_MS;
    this.state.results = null;
    this.roster = humans.map((m, i) => ({ id: m.id, name: m.name, avatar: m.avatar, color: SNAKE_COLORS[i % SNAKE_COLORS.length], bot: false }));
    const needBots = this.state.fillBots || this.roster.length < 2 ? SNAKE_MAX_PLAYERS - this.roster.length : 0;
    for (let i = 0; i < needBots; i++) {
      const n = this.roster.length;
      this.roster.push({ id: `bot-${n}`, name: `${BOT_NAMES[(n + Date.now()) % BOT_NAMES.length]} (bot)`, avatar: BOT_AVATARS[n % BOT_AVATARS.length], color: SNAKE_COLORS[n], bot: true });
    }
    this.pushLobby();
    this.broadcast({ t: "roster", players: this.roster });
  }

  private startRound() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.sim = new SnakeSim(seed, this.roster);
    this.state.phase = "playing";
    this.state.endsAt = Date.now() + SNAKE_ROUND_MS;
    this.pushLobby();
    clearInterval(this.loop);
    this.loop = setInterval(() => void this.tick(), SNAKE_TICK_MS);
  }

  private async tick() {
    const sim = this.sim;
    if (!sim || this.state.phase !== "playing") return;
    sim.step();
    const msLeft = this.state.endsAt - Date.now();
    this.broadcast({ t: "tick", s: sim.snapshot(), msLeft });
    if (msLeft <= 0) await this.endRound();
  }

  private async endRound() {
    clearInterval(this.loop);
    const sim = this.sim;
    if (!sim) return;
    this.sim = null;
    const standings = sim.standings();
    const byId = new Map(this.roster.map((r) => [r.id, r]));
    this.state.results = standings.map((s) => {
      const r = byId.get(s.id)!;
      return { id: s.id, name: r.name, avatar: r.avatar, color: r.color, bot: r.bot, place: s.place, score: s.score, kills: s.kills };
    });
    this.state.phase = "ended";
    try {
      await recordSnakeRound(
        this.env.DB,
        this.roomCode,
        standings.filter((s) => !s.bot).map((s) => ({ userId: s.id, place: s.place, score: s.score, kills: s.kills, deaths: s.deaths, best: s.best })),
        standings.length,
        SNAKE_ROUND_MS,
      );
    } catch (err) {
      console.error("snake record failed", err);
    }
    // Drop players who left during the round.
    this.members = this.members.filter((m) => m.connected);
    if (!this.member(this.state.hostId) && this.members[0]) this.state.hostId = this.members[0].id;
    this.persist();
    this.pushLobby();
    this.broadcast({ t: "end", results: this.state.results });
  }

  protected async onDisconnect(m: Member) {
    if (this.state.phase === "playing" || this.state.phase === "countdown") {
      this.broadcast({ t: "presence", players: this.publicMembers() });
      return; // their snake keeps going; they can reconnect and resume
    }
    this.removeMember(m.id);
    if (this.state.hostId === m.id) this.state.hostId = this.members[0]?.id ?? "";
    if (!this.members.length) clearInterval(this.loop);
    this.pushLobby();
  }

  protected nextAlarm(): number | null {
    if (this.state.phase === "countdown") return this.state.startsAt;
    if (this.state.phase === "lobby" && this.state.auto) return this.state.autoStartAt;
    // While playing, the tick loop drives the round; this is a safety net.
    if (this.state.phase === "playing") return this.state.endsAt + 1000;
    return null;
  }

  protected async onAlarm() {
    const now = Date.now();
    if (this.state.phase === "lobby" && this.state.auto && now >= this.state.autoStartAt) this.beginCountdown();
    else if (this.state.phase === "countdown" && now >= this.state.startsAt) this.startRound();
    else if (this.state.phase === "playing" && now >= this.state.endsAt && this.sim) await this.endRound();
    else if (this.state.phase === "playing" && !this.sim) {
      this.state.phase = "lobby"; // restarted mid-round
      this.pushLobby();
    }
  }
}
