import { DurableObject } from "cloudflare:workers";
import { randomRoomCode, type ServerMsg } from "../shared/protocol";
import type { Env } from "./env";

/**
 * Global quick-match queue. A client opens a socket, waits, and is handed a
 * room code as soon as a second player arrives. Both then connect to that
 * BattleRoom and the matchmaker socket is closed.
 */
export class Matchmaker extends DurableObject<Env> {
  private waiting: WebSocket | null = null;

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const send = (ws: WebSocket, msg: ServerMsg) => {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* socket already gone */
      }
    };

    const other = this.waiting;
    if (other && other.readyState === WebSocket.OPEN) {
      this.waiting = null;
      const room = randomRoomCode();
      send(other, { t: "matched", room });
      send(server, { t: "matched", room });
      other.close(1000, "matched");
      server.close(1000, "matched");
    } else {
      this.waiting = server;
      send(server, { t: "waiting", code: "" });
      const drop = () => {
        if (this.waiting === server) this.waiting = null;
      };
      server.addEventListener("close", drop);
      server.addEventListener("error", drop);
    }

    return new Response(null, { status: 101, webSocket: client });
  }
}
