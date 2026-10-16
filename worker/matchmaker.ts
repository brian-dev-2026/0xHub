import { DurableObject } from "cloudflare:workers";
import { randomRoomCode, type ServerMsg } from "../shared/protocol";
import type { Env } from "./env";

/**
 * Global quick-match queue. A client opens a socket and waits; as soon as a
 * different player arrives, both get the same room code and the sockets close.
 * Uses WebSocket hibernation, so an idle queue costs nothing.
 */
export class Matchmaker extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    let userId: string;
    try {
      userId = JSON.parse(request.headers.get("X-0xHub-User") ?? "").id;
      if (!userId) throw new Error();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const waiting = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
    const send = (ws: WebSocket, msg: ServerMsg) => {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* closed */
      }
    };

    // The same account searching again (e.g. a second tab) replaces its old entry.
    for (const ws of waiting) {
      if ((ws.deserializeAttachment() as { userId: string }).userId === userId) {
        send(ws, { t: "replaced" });
        ws.close(4001, "replaced");
      }
    }
    const opponent = waiting.find((ws) => (ws.deserializeAttachment() as { userId: string }).userId !== userId);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId });

    if (opponent) {
      const room = randomRoomCode();
      send(opponent, { t: "matched", room });
      send(server, { t: "matched", room });
      opponent.close(1000, "matched");
      server.close(1000, "matched");
    } else {
      send(server, { t: "waiting" });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage() {
    /* clients don't send anything while queued */
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
}
