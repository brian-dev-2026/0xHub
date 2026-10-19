import { useEffect, useRef, useState } from "react";
import { CLOSE_STALE, wsUrl } from "./api";

export type RoomStatus = "connecting" | "open" | "reconnecting" | "closed" | "error";
type Msg = { t: string; [k: string]: any };

const RETRY = [300, 700, 1500, 3000, 5000, 5000];

/**
 * Close a socket without browser noise: closing one that's still connecting
 * makes Firefox and Safari log an error, so wait for it to open first.
 */
export function closeSocket(ws: WebSocket | null | undefined, code = 1000) {
  if (!ws) return;
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.onopen = () => ws.close(code);
    ws.onmessage = null;
    return;
  }
  try {
    ws.close(code);
  } catch {
    /* already closed */
  }
}

/**
 * A game-room WebSocket with automatic reconnect. Messages go to `onMessage`;
 * the server re-sends the full state on every (re)connect.
 */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private disposed = false;
  private ping: ReturnType<typeof setInterval> | undefined;
  status: RoomStatus = "connecting";
  error = "";
  latency = 0;

  constructor(
    private path: string,
    private onMessage: (m: Msg) => void,
    private onStatus: (s: RoomStatus) => void,
    private onOpen?: (sock: RoomSocket) => void,
  ) {
    this.connect();
  }

  private set(s: RoomStatus) {
    this.status = s;
    this.onStatus(s);
  }

  private connect() {
    if (this.disposed) return;
    const ws = new WebSocket(wsUrl(this.path));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.set("open");
      this.onOpen?.(this);
      clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ t: "ping", at: performance.now() }), 3000);
    };
    ws.onmessage = (ev) => {
      let m: Msg;
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (m.t === "pong") {
        this.latency = Math.round(performance.now() - m.at);
        return;
      }
      if (m.t === "replaced") {
        this.error = "This game was opened in another tab or window.";
        this.dispose();
        this.set("error");
        return;
      }
      if (m.t === "error" && m.fatal) {
        this.error = m.message;
        this.dispose();
        this.set("error");
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = (ev) => {
      clearInterval(this.ping);
      if (this.disposed || ws !== this.ws) return;
      if (ev.code === CLOSE_STALE) {
        this.error = "This game was opened in another tab or window.";
        this.disposed = true;
        this.set("error");
        return;
      }
      if (this.attempt >= RETRY.length) {
        this.error = "Lost connection to the game server.";
        this.set("error");
        return;
      }
      this.set("reconnecting");
      setTimeout(() => this.connect(), RETRY[this.attempt++]);
    };
  }

  send(m: Msg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  /** Close for good. Pass `leave` to tell the server you left on purpose. */
  dispose(leave = false) {
    if (leave) this.send({ t: "leave" });
    this.disposed = true;
    clearInterval(this.ping);
    closeSocket(this.ws);
  }
}

/** React hook: connect to a room for the component's lifetime. */
export function useRoomSocket(path: string | null, onMessage: (m: Msg) => void, onOpen?: (s: RoomSocket) => void) {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [sock, setSock] = useState<RoomSocket | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (!path) return;
    const s = new RoomSocket(path, (m) => handler.current(m), setStatus, (x) => openRef.current?.(x));
    setSock(s);
    return () => s.dispose(true);
  }, [path]);
  return { sock, status, error: sock?.error ?? "" };
}

/** Quick-match queue for a game. Returns a room code (and whether it's an auto-start room). */
export function useMatchmaking(game: string, onMatched: (room: string, auto: boolean) => void, params = "") {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const cb = useRef(onMatched);
  cb.current = onMatched;

  // Close queue sockets at once, even mid-connect: letting an abandoned search
  // finish connecting could match it with a real player.
  const stop = () => {
    ws.current?.close();
    ws.current = null;
    setSearching(false);
  };
  useEffect(() => () => ws.current?.close(), []);

  const start = () => {
    setError("");
    setSearching(true);
    let retries = 0;
    const open = () => {
      let done = false;
      const s = new WebSocket(wsUrl(`/api/ws/${game}/matchmake${params ? `?${params}` : ""}`));
      ws.current = s;
      s.onmessage = (e) => {
        const m = JSON.parse(e.data as string);
        if (m.t === "matched") {
          done = true;
          s.close();
          setSearching(false);
          cb.current(m.room, !!m.auto);
        } else if (m.t === "queue") setQueue(m.players);
        else if (m.t === "replaced") {
          done = true;
          setSearching(false);
          setError("You started searching in another tab.");
        }
      };
      s.onclose = () => {
        if (done || ws.current !== s) return;
        if (retries++ < 5) setTimeout(open, 500 * retries);
        else {
          setSearching(false);
          setError("Couldn't reach the matchmaking server.");
        }
      };
    };
    open();
  };

  return { searching, error, queue, start, stop };
}
