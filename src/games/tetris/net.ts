import type { ClientMsg, ServerMsg } from "../../../shared/protocol";
import { wsUrl } from "../../lib/api";

/** Thin typed wrapper around a WebSocket to the game server. */
export class GameSocket {
  private ws: WebSocket;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private closedByUs = false;
  latency = 0;

  constructor(
    path: string,
    private onMessage: (msg: ServerMsg) => void,
    private onClose: (unexpected: boolean, code: number) => void,
    onOpen?: () => void,
  ) {
    this.ws = new WebSocket(wsUrl(path));
    this.ws.addEventListener("open", () => {
      onOpen?.();
      this.pingTimer = setInterval(() => this.send({ t: "ping", at: performance.now() }), 3000);
    });
    this.ws.addEventListener("message", (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.t === "pong") {
        this.latency = Math.round(performance.now() - msg.at);
        return;
      }
      this.onMessage(msg);
    });
    this.ws.addEventListener("close", (ev) => {
      clearInterval(this.pingTimer);
      this.onClose(!this.closedByUs, ev.code);
    });
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg): boolean {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    try {
      this.ws.close(1000);
    } catch {
      /* ignore */
    }
  }
}
