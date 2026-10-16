import { isValidRoomCode } from "../shared/protocol";
import type { Env } from "./env";

export { Matchmaker } from "./matchmaker";
export { BattleRoom } from "./room";
export { Leaderboard } from "./leaderboard";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function leaderboard(env: Env) {
  return env.LEADERBOARD.get(env.LEADERBOARD.idFromName("global"));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/health") return json({ ok: true });

    // Quick match queue (single global matchmaker).
    if (pathname === "/api/ws/matchmake") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected WebSocket" }, 426);
      const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName("global"));
      return stub.fetch(request);
    }

    // Battle room, either from quick match or a private invite code.
    const room = pathname.match(/^\/api\/ws\/room\/([A-Za-z0-9]+)$/);
    if (room) {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected WebSocket" }, 426);
      const code = room[1].toUpperCase();
      if (!isValidRoomCode(code)) return json({ error: "Invalid room code" }, 400);
      const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(`room:${code}`));
      return stub.fetch(request);
    }

    if (pathname === "/api/leaderboard" && request.method === "GET") {
      const mode = url.searchParams.get("mode") === "battle" ? "battle" : "endless";
      const lb = leaderboard(env);
      return json(mode === "battle" ? await lb.topBattle(50) : await lb.topEndless(50));
    }

    if (pathname === "/api/leaderboard/endless" && request.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const result = await leaderboard(env).submitEndless(body);
      return json(result, result.ok ? 200 : 400);
    }

    if (pathname === "/api/player" && request.method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      return json(await leaderboard(env).playerSummary(id));
    }

    if (pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);

    // Everything else is served by the static asset handler (SPA fallback).
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
