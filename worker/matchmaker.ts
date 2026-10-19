import { DurableObject } from "cloudflare:workers";
import { randomRoomCode } from "../shared/protocol";
import { CLOSE_STALE, connSeq, isStale } from "./connSeq";
import type { Env } from "./env";

/** Snake Arena gathers players for this long, then starts (bots fill the rest). */
const GROUP_WINDOW_MS = 6000;
const GROUP_MAX = 4;

type Attachment = { userId: string; c: number };

/**
 * Quick-match queue, one instance per game. 1v1 games pair the first two
 * different players. Snake Arena groups up to four players within a short
 * window. Uses WebSocket hibernation, so an idle queue costs nothing.
 */
export class Matchmaker extends DurableObject<Env> {
  private send(ws: WebSocket, msg: object) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  private waiting(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private matchAll(sockets: WebSocket[], extra: object = {}) {
    const room = randomRoomCode();
    for (const ws of sockets) {
      this.send(ws, { t: "matched", room, ...extra });
      ws.close(1000, "matched");
    }
  }

  async fetch(request: Request): Promise<Response> {
    let userId: string;
    try {
      userId = JSON.parse(decodeURIComponent(request.headers.get("X-0xHub-User") ?? "")).id;
      if (!userId) throw new Error();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    const group = request.headers.get("X-0xHub-Game") === "snake";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // The same account searching again (e.g. a second tab) replaces its old
    // entry — unless the old entry is newer (a stale attempt arriving late).
    const seq = connSeq(request);
    const mine = this.waiting().filter((ws) => (ws.deserializeAttachment() as Attachment).userId === userId);
    if (isStale(seq, mine)) {
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ userId: `stale:${userId}`, c: seq } satisfies Attachment);
      server.close(CLOSE_STALE, "stale");
      return new Response(null, { status: 101, webSocket: client });
    }
    for (const ws of mine) {
      this.send(ws, { t: "replaced" });
      ws.close(4001, "replaced");
    }
    const others = this.waiting();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, c: seq } satisfies Attachment);

    if (group) {
      const queue = [...others, server];
      if (queue.length >= GROUP_MAX) {
        this.matchAll(queue.slice(0, GROUP_MAX), { auto: true });
        await this.ctx.storage.deleteAlarm();
      } else {
        this.send(server, { t: "waiting", startsIn: GROUP_WINDOW_MS });
        if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + GROUP_WINDOW_MS);
        for (const ws of queue) this.send(ws, { t: "queue", players: queue.length });
      }
    } else if (others[0]) {
      this.matchAll([others[0], server]);
    } else {
      this.send(server, { t: "waiting" });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Snake: the gathering window ended — start with whoever is waiting. */
  async alarm() {
    const queue = this.waiting();
    if (queue.length) this.matchAll(queue.slice(0, GROUP_MAX), { auto: true });
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
