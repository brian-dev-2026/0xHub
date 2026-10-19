import { MATCH_DURATION_MS, type BoardSnapshot, type PlayerInfo, type ServerMsg } from "../../../shared/protocol";
import { COLS, VISIBLE_ROWS, decodeCell, type PieceType } from "../../../shared/tetris/engine";
import type { SimState } from "../../../shared/tetris/sim";
import { refreshMe } from "../../lib/auth";
import { sfx } from "../../lib/sfx";
import { createStore, settingsStore } from "../../lib/store";
import { GameSocket } from "./net";
import { CLOSE_STALE } from "../../lib/api";
import { GameSession, type PanelState } from "./session";

export type BattlePhase = "connecting" | "waiting" | "countdown" | "playing" | "ended" | "error";

export interface EndInfo {
  result: "win" | "lose" | "draw";
  reason: "time" | "forfeit";
  you: { kos: number; linesSent: number };
  opponent: { kos: number; linesSent: number };
  ratingDelta?: number;
}

export interface BattleUi {
  phase: BattlePhase;
  error: string;
  reconnecting: boolean;
  opponent: PlayerInfo | null;
  opponentConnected: boolean;
  kos: { you: number; opponent: number };
  countdown: number | null;
  /** performance.now() timestamp when the round ends. */
  endsAt: number;
  end: EndInfo | null;
  rematch: "none" | "sent" | "received";
  koFlash: "you" | "opponent" | null;
  oppAttack: { text: string; id: number } | null;
  oppSent: number;
  latency: number;
}

const FLUSH_MS = 50;
const RECONNECT_DELAYS = [300, 700, 1500, 3000, 5000, 5000];
const KO_FLASH_MS = 1000;

function decodeSnapshot(s: BoardSnapshot): PanelState | null {
  if (typeof s?.cells !== "string" || s.cells.length !== COLS * VISIBLE_ROWS) return null;
  const cells: number[][] = [];
  for (let y = 0; y < VISIBLE_ROWS; y++) {
    const row: number[] = [];
    for (let x = 0; x < COLS; x++) row.push(decodeCell(s.cells[y * COLS + x]));
    cells.push(row);
  }
  return {
    view: {
      cells,
      active: s.active ? { ...s.active, type: s.active.type as PieceType } : null,
      ghostY: null,
      danger: cells.slice(0, 4).some((r) => r.some((c) => c !== 0)),
    },
    hold: (s.hold as PieceType) ?? null,
    holdUsed: false,
    next: (s.next ?? []) as PieceType[],
    incoming: s.incoming ?? 0,
  };
}

/**
 * Client side of a 1v1 match: owns the socket (with automatic reconnect),
 * the local game session and the UI state the battle page renders.
 */
export class BattleClient {
  readonly ui = createStore<BattleUi>({
    phase: "connecting",
    error: "",
    reconnecting: false,
    opponent: null,
    opponentConnected: true,
    kos: { you: 0, opponent: 0 },
    countdown: null,
    endsAt: 0,
    end: null,
    rematch: "none",
    koFlash: null,
    oppAttack: null,
    oppSent: 0,
    latency: 0,
  });
  readonly session: GameSession;
  oppState: PanelState | null = null;

  private sock: GameSocket | null = null;
  private disposed = false;
  private attempt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private matchStartedAt = 0;

  constructor(private code: string) {
    this.session = new GameSession({
      mode: "battle",
      onLock: () => this.flush(),
      onKO: () => this.flashKO("you"),
    });
    this.session.start();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    this.connect();
  }

  private set(p: Partial<BattleUi>) {
    this.ui.set(p);
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(setTimeout(fn, ms));
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // ---------- connection ----------

  private connect() {
    if (this.disposed) return;
    const sock = new GameSocket(
      `/api/ws/room/${this.code}`,
      (m) => this.onMessage(m),
      (unexpected, code) => this.onClose(unexpected, sock, code),
      () => {
        this.attempt = 0;
        this.set({ reconnecting: false });
        sock.send({ t: "hello", skin: settingsStore.get().skin });
      },
    );
    this.sock = sock;
  }

  private onClose(unexpected: boolean, sock: GameSocket, code: number) {
    if (this.disposed || sock !== this.sock || !unexpected) return;
    if (code === CLOSE_STALE) {
      // A newer connection (another tab) owns this seat.
      this.abandonSocket();
      this.session.running = false;
      this.set({ phase: "error", error: "This match was opened in another tab or window." });
      return;
    }
    const { phase } = this.ui.get();
    if (phase === "error") return;
    if (this.attempt >= RECONNECT_DELAYS.length) {
      this.session.running = false;
      this.set({ phase: "error", error: "Lost connection to the game server.", reconnecting: false });
      return;
    }
    this.set({ reconnecting: true });
    setTimeout(() => this.connect(), RECONNECT_DELAYS[this.attempt++]);
  }

  /** Send recorded inputs to the server. */
  private flush() {
    if (!this.sock?.isOpen || this.ui.get().phase !== "playing" || !this.session.running) return;
    const batch = this.session.flush();
    if (!this.sock.send({ t: "input", ...batch })) return;
    this.set({ latency: this.sock.latency });
  }

  private flashKO(who: "you" | "opponent") {
    this.set({ koFlash: who });
    this.later(() => {
      if (this.ui.get().koFlash === who) this.set({ koFlash: null });
    }, KO_FLASH_MS);
  }

  private startRound(inMs: number, durationMs: number) {
    const startAt = performance.now() + inMs;
    this.matchStartedAt = Date.now() + inMs;
    this.set({ phase: inMs > 0 ? "countdown" : "playing", endsAt: startAt + durationMs, end: null, rematch: "none" });
    const whole = Math.ceil(inMs / 1000);
    for (let i = 0; i < whole; i++) {
      const at = inMs - (whole - i) * 1000;
      this.later(() => {
        this.set({ countdown: whole - i });
        sfx.countdown(false);
      }, Math.max(0, at));
    }
    this.later(() => {
      this.session.startClock(startAt);
      this.set({ phase: "playing", countdown: inMs > 0 ? 0 : null });
      if (inMs > 0) sfx.countdown(true);
      this.later(() => this.set({ countdown: null }), 700);
    }, inMs);
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case "opponent":
        this.set({ opponent: msg.player, opponentConnected: true });
        if (this.ui.get().phase === "connecting") this.set({ phase: "waiting" });
        break;
      case "opponentStatus":
        this.set({ opponentConnected: msg.connected });
        break;
      case "countdown":
        this.clearTimers();
        this.session.running = false;
        this.session.newGame(msg.seed);
        this.session.epoch = msg.epoch;
        this.oppState = null;
        this.set({ kos: { you: 0, opponent: 0 }, oppSent: 0, koFlash: null });
        this.startRound(msg.in, msg.duration);
        break;
      case "resume": {
        this.clearTimers();
        this.set({ kos: msg.kos });
        if (msg.phase === "ended" || !msg.sim) {
          this.session.running = false;
          this.set({ phase: msg.phase === "ended" ? "ended" : "waiting" });
          break;
        }
        this.session.loadState(msg.sim as SimState, msg.epoch, msg.pending);
        if (msg.phase === "countdown") {
          this.session.running = false;
          this.startRound(msg.msUntilStart, MATCH_DURATION_MS);
        } else {
          const elapsed = MATCH_DURATION_MS - msg.msRemaining;
          this.matchStartedAt = Date.now() - elapsed;
          this.session.startClock(performance.now() - elapsed);
          this.set({ phase: "playing", countdown: null, endsAt: performance.now() + msg.msRemaining });
        }
        break;
      }
      case "resync":
        this.session.loadState(msg.sim as SimState, msg.epoch, msg.pending);
        break;
      case "opState": {
        const st = decodeSnapshot(msg.s);
        if (st) {
          this.oppState = st;
          if (msg.s.linesSent !== this.ui.get().oppSent) this.set({ oppSent: msg.s.linesSent });
        }
        break;
      }
      case "garbage":
        this.session.receiveGarbage(msg.id, msg.lines);
        if (msg.label) this.set({ oppAttack: { text: `${msg.label} → ${msg.lines}`, id: Date.now() } });
        break;
      case "ko":
        this.set({ kos: { you: msg.you, opponent: msg.opponent } });
        if (msg.victim === "opponent") {
          sfx.ko();
          this.flashKO("opponent");
        }
        break;
      case "end":
        this.clearTimers();
        this.flush();
        this.session.running = false;
        this.set({ phase: "ended", end: msg, countdown: null, koFlash: null, rematch: "none" });
        if (msg.result === "win") sfx.win();
        else sfx.gameOver();
        void refreshMe(); // the server already stored the result
        break;
      case "rematchRequested":
        this.set({ rematch: "received" });
        break;
      case "opponentLeft":
        this.oppState = null;
        this.set({ opponent: null, rematch: "none" });
        if (this.ui.get().phase !== "ended") {
          this.session.running = false;
          this.set({ phase: "waiting" });
        }
        break;
      case "replaced":
        this.abandonSocket();
        this.session.running = false;
        this.set({ phase: "error", error: "This match was opened in another tab or window." });
        break;
      case "error":
        if (msg.fatal) {
          this.abandonSocket();
          this.session.running = false;
          this.set({ phase: "error", error: msg.message });
        }
        break;
    }
  }

  /** Stop using the socket without sending "leave" (another tab owns the seat, or the room refused us). */
  private abandonSocket() {
    this.disposed = true;
    this.sock?.close();
    this.sock = null;
  }

  // ---------- actions ----------

  requestRematch() {
    if (this.sock?.send({ t: "rematch" })) this.set({ rematch: "sent" });
  }

  get matchElapsedMs(): number {
    return this.matchStartedAt ? Date.now() - this.matchStartedAt : 0;
  }

  /** Leave the room. Mid-match this forfeits immediately. */
  dispose() {
    if (this.disposed && !this.sock) return;
    this.disposed = true;
    this.sock?.send({ t: "leave" });
    this.sock?.close();
    this.sock = null;
    this.clearTimers();
    clearInterval(this.flushTimer);
    this.session.stop();
  }
}
