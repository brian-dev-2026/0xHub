import { PASSWORD_MIN, USERNAME_RE, isValidRoomCode, type MeResponse } from "../shared/protocol";
import {
  SESSION_COOKIE,
  clearCookie,
  createSession,
  deleteSession,
  dummyVerify,
  hashPassword,
  newRecoveryCode,
  normalizeRecoveryCode,
  readCookie,
  sessionCookie,
  userIdForToken,
  verifyPassword,
} from "./auth";
import {
  ACCENTS,
  AVATARS,
  cleanup,
  createUser,
  deleteAccount,
  getHighScores,
  getHistory,
  getSettings,
  getStats,
  getUser,
  getUserByUsername,
  rateLimit,
  revokeSessions,
  saveSettings,
  setPassword,
  setRecoveryHash,
  toPublic,
  topBattle,
  topEndless,
  touchUser,
  updateProfile,
  upgradeGuest,
  type UserRow,
} from "./db";
import { sha256 } from "./auth";
import { gameHistory, gameSummaries, topRatings, topScores } from "./gamesDb";
import { isDifficulty } from "../shared/games/mines";
import { chessTimeControl } from "../shared/games/clocks";
import type { Env } from "./env";

export { Matchmaker } from "./matchmaker";
export { BattleRoom } from "./room";
export { EndlessRun } from "./endless";
export { SnakeRoom } from "./games/snakeRoom";
export { Duel2048Room } from "./games/duel2048Room";
export { Connect4Room } from "./games/connect4Room";
export { ChessRoom } from "./games/chessRoom";
export { GeneralsRoom } from "./games/generalsRoom";
export { MinesRun, Run2048 } from "./games/soloRuns";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      ...headers,
    },
  });
const err = (message: string, status = 400) => json({ error: message }, status);

const MIN = 60_000;
const HOUR = 60 * MIN;

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

async function limit(env: Env, key: string, max: number, windowMs: number) {
  const wait = await rateLimit(env.DB, key, max, windowMs);
  if (wait) throw new HttpError(`Too many attempts. Try again in ${wait > 90 ? `${Math.ceil(wait / 60)} minutes` : `${wait} seconds`}.`, 429, { "retry-after": String(wait) });
}

async function body(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError("Request too large", 413);
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new HttpError("Invalid JSON", 400);
  }
}

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function currentUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const id = await userIdForToken(env.DB, token);
  return id ? getUser(env.DB, id) : null;
}

async function requireUser(request: Request, env: Env): Promise<UserRow> {
  const u = await currentUser(request, env);
  if (!u) throw new HttpError("Not signed in", 401);
  return u;
}

async function me(env: Env, u: UserRow): Promise<MeResponse> {
  const [stats, tetrisHistory, highScores, settings, games, otherHistory] = await Promise.all([
    getStats(env.DB, u),
    getHistory(env.DB, u.id),
    getHighScores(env.DB, u.id),
    getSettings(env.DB, u.id),
    gameSummaries(env.DB, u.id),
    gameHistory(env.DB, u.id),
  ]);
  const history = [...tetrisHistory.map((h) => ({ ...h, game: "tetris" as const })), ...otherHistory]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 25);
  return { user: toPublic(u), stats, history, highScores, settings, games };
}

async function startSession(request: Request, env: Env, u: UserRow, extra: Record<string, unknown> = {}) {
  const { token, expiresAt } = await createSession(env.DB, u.id);
  return json({ ...(await me(env, u)), ...extra }, 200, { "set-cookie": sessionCookie(request, token, expiresAt) });
}

/** Give an account a fresh recovery code (replacing any old one) and return it for showing once. */
async function issueRecoveryCode(env: Env, userId: string): Promise<string> {
  const code = newRecoveryCode();
  await setRecoveryHash(env.DB, userId, await hashPassword(normalizeRecoveryCode(code)));
  return code;
}

function validateCredentials(b: Record<string, unknown>): { username: string; password: string } {
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!USERNAME_RE.test(username)) throw new HttpError("Usernames are 3–20 letters, numbers or _ (no spaces).", 400);
  if (password.length < PASSWORD_MIN) throw new HttpError(`Password must be at least ${PASSWORD_MIN} characters.`, 400);
  if (password.length > 200) throw new HttpError("Password is too long.", 400);
  return { username, password };
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  // Basic CSRF protection for state-changing requests: the cookie is SameSite=Lax,
  // and we additionally require same-origin requests.
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return err("Cross-origin request blocked", 403);
  }

  if (pathname === "/api/health") return json({ ok: true });

  // ---------- auth ----------

  if (pathname === "/api/auth/guest" && method === "POST") {
    const existing = await currentUser(request, env);
    if (existing) return json(await me(env, existing));
    await limit(env, `guest-ip:${clientIp(request)}`, 30, HOUR);
    return startSession(request, env, await createUser(env.DB, {}));
  }

  if (pathname === "/api/auth/register" && method === "POST") {
    const b = await body(request);
    const { username, password } = validateCredentials(b);
    await limit(env, `register-ip:${clientIp(request)}`, 10, HOUR);
    if (await getUserByUsername(env.DB, username)) return err("That username is taken.", 409);
    const passwordHash = await hashPassword(password);
    const current = await currentUser(request, env);
    if (current?.is_guest) {
      // Upgrade the guest in place so their stats and history carry over.
      try {
        await upgradeGuest(env.DB, current.id, username, passwordHash);
      } catch {
        return err("That username is taken.", 409);
      }
      const recoveryCode = await issueRecoveryCode(env, current.id);
      return json({ ...(await me(env, (await getUser(env.DB, current.id))!)), recoveryCode });
    }
    let user: UserRow;
    try {
      user = await createUser(env.DB, { username, passwordHash });
    } catch {
      return err("That username is taken.", 409);
    }
    const recoveryCode = await issueRecoveryCode(env, user.id);
    return startSession(request, env, (await getUser(env.DB, user.id))!, { recoveryCode });
  }

  // Forgot password: username + recovery code -> new password. The code is
  // single-use; a new one is issued, and every other session is signed out.
  if (pathname === "/api/auth/recover" && method === "POST") {
    const b = await body(request);
    const username = typeof b.username === "string" ? b.username.trim() : "";
    const code = typeof b.code === "string" ? normalizeRecoveryCode(b.code) : "";
    const password = typeof b.password === "string" ? b.password : "";
    if (password.length < PASSWORD_MIN) return err(`Password must be at least ${PASSWORD_MIN} characters.`);
    if (password.length > 200) return err("Password is too long.");
    if (!username || code.length !== 20) return err("Wrong username or recovery code.", 401);
    await limit(env, `recover-ip:${clientIp(request)}`, 10, HOUR);
    await limit(env, `recover-user:${username.toLowerCase()}`, 5, HOUR);
    const user = await getUserByUsername(env.DB, username);
    if (!user?.recovery_hash) {
      await dummyVerify(code);
      return err("Wrong username or recovery code.", 401);
    }
    if (!(await verifyPassword(code, user.recovery_hash))) return err("Wrong username or recovery code.", 401);
    await setPassword(env.DB, user.id, await hashPassword(password));
    await revokeSessions(env.DB, user.id);
    const recoveryCode = await issueRecoveryCode(env, user.id);
    return startSession(request, env, (await getUser(env.DB, user.id))!, { recoveryCode });
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const b = await body(request);
    const username = typeof b.username === "string" ? b.username.trim() : "";
    const password = typeof b.password === "string" ? b.password : "";
    if (!username || !password || password.length > 200) return err("Wrong username or password.", 401);
    // Throttle both per network and per account, so neither spraying many
    // accounts nor hammering one account works.
    await limit(env, `login-ip:${clientIp(request)}`, 30, 10 * MIN);
    await limit(env, `login-user:${username.toLowerCase()}`, 10, 15 * MIN);
    const user = await getUserByUsername(env.DB, username);
    if (!user?.password_hash) {
      await dummyVerify(password);
      return err("Wrong username or password.", 401);
    }
    if (!(await verifyPassword(password, user.password_hash))) return err("Wrong username or password.", 401);
    await touchUser(env.DB, user.id);
    return startSession(request, env, user);
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) await deleteSession(env.DB, token);
    return json({ ok: true }, 200, { "set-cookie": clearCookie(request) });
  }

  // ---------- current user ----------

  if (pathname === "/api/me" && method === "GET") {
    const u = await currentUser(request, env);
    if (!u) return err("Not signed in", 401);
    if (Date.now() - u.last_seen_at > 60_000) await touchUser(env.DB, u.id);
    return json(await me(env, u));
  }

  if (pathname === "/api/me" && method === "PATCH") {
    const u = await requireUser(request, env);
    const b = await body(request);
    const patch: { displayName?: string; avatar?: string; color?: string } = {};
    if (typeof b.displayName === "string") {
      const n = b.displayName.trim().replace(/\s+/g, " ");
      if (n.length < 2 || n.length > 20) return err("Display name must be 2–20 characters.");
      patch.displayName = n;
    }
    if (typeof b.avatar === "string") {
      if (!AVATARS.includes(b.avatar)) return err("Unknown avatar.");
      patch.avatar = b.avatar;
    }
    if (typeof b.color === "string") {
      if (!ACCENTS.includes(b.color)) return err("Unknown color.");
      patch.color = b.color;
    }
    await updateProfile(env.DB, u.id, patch);
    return json(await me(env, (await getUser(env.DB, u.id))!));
  }

  if (pathname === "/api/me/settings" && method === "PUT") {
    const u = await requireUser(request, env);
    const text = await request.text();
    if (text.length > 8_192) return err("Settings too large", 413);
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    } catch {
      return err("Invalid settings");
    }
    await saveSettings(env.DB, u.id, text);
    return json({ ok: true });
  }

  if (pathname === "/api/me/password" && method === "POST") {
    const u = await requireUser(request, env);
    if (u.is_guest || !u.password_hash) return err("Guests don't have a password yet — create an account first.");
    const b = await body(request);
    const current = typeof b.current === "string" ? b.current : "";
    const next = typeof b.next === "string" ? b.next : "";
    await limit(env, `password:${u.id}`, 10, HOUR);
    if (!(await verifyPassword(current, u.password_hash))) return err("Your current password is wrong.", 401);
    if (next.length < PASSWORD_MIN) return err(`Password must be at least ${PASSWORD_MIN} characters.`);
    if (next.length > 200) return err("Password is too long.");
    await setPassword(env.DB, u.id, await hashPassword(next));
    // Sign out every other device.
    const token = readCookie(request, SESSION_COOKIE);
    await revokeSessions(env.DB, u.id, token ? await sha256(token) : undefined);
    return json({ ok: true });
  }

  if (pathname === "/api/me/recovery" && method === "POST") {
    const u = await requireUser(request, env);
    if (u.is_guest || !u.password_hash) return err("Create an account first.");
    const b = await body(request);
    const password = typeof b.password === "string" ? b.password : "";
    await limit(env, `password:${u.id}`, 10, HOUR);
    if (!(await verifyPassword(password, u.password_hash))) return err("Your password is wrong.", 401);
    const recoveryCode = await issueRecoveryCode(env, u.id);
    return json({ ...(await me(env, (await getUser(env.DB, u.id))!)), recoveryCode });
  }

  if (pathname === "/api/me" && method === "DELETE") {
    const u = await requireUser(request, env);
    if (!u.is_guest && u.password_hash) {
      const b = await body(request);
      const password = typeof b.password === "string" ? b.password : "";
      await limit(env, `password:${u.id}`, 10, HOUR);
      if (!(await verifyPassword(password, u.password_hash))) return err("Your password is wrong.", 401);
    }
    await deleteAccount(env.DB, u.id);
    return json({ ok: true }, 200, { "set-cookie": clearCookie(request) });
  }

  // ---------- verified endless runs ----------

  if (pathname === "/api/runs/endless/start" && method === "POST") {
    const u = await requireUser(request, env);
    const b = await body(request);
    const startLevel = Math.floor(Number(b.startLevel ?? 1));
    if (!Number.isInteger(startLevel) || startLevel < 1 || startLevel > 15) return err("Start level must be 1–15.");
    await limit(env, `run-start:${u.id}`, 120, HOUR);
    const runId = crypto.randomUUID();
    const { seed } = await env.ENDLESS_RUN.get(env.ENDLESS_RUN.idFromName(runId)).init(u.id, startLevel);
    return json({ runId, seed });
  }

  const runInput = pathname.match(/^\/api\/runs\/endless\/([0-9a-f-]{36})\/input$/);
  if (runInput && method === "POST") {
    const u = await requireUser(request, env);
    const b = await body(request, 2_000_000);
    const res = await env.ENDLESS_RUN.get(env.ENDLESS_RUN.idFromName(runInput[1])).input(u.id, b);
    return json(res, res.ok ? 200 : 400);
  }

  if (pathname === "/api/leaderboard" && method === "GET") {
    const game = url.searchParams.get("game") ?? "tetris";
    const mode = url.searchParams.get("mode") ?? "";
    switch (game) {
      case "tetris":
        return json(mode === "battle" ? await topBattle(env.DB, 50) : await topEndless(env.DB, 50));
      case "snake":
        return json(mode === "wins" ? await topRatings(env.DB, "snake", "wins") : await topScores(env.DB, "snake", "arena"));
      case "2048":
        return json(mode === "duel" ? await topRatings(env.DB, "2048", "rating") : await topScores(env.DB, "2048", "solo"));
      case "mines":
        return json(await topScores(env.DB, "mines", isDifficulty(mode) ? mode : "beginner"));
      case "connect4":
      case "chess":
      case "generals":
        return json(await topRatings(env.DB, game, "rating"));
      default:
        return err("Unknown game", 404);
    }
  }

  // ---------- verified solo runs: Minesweeper, 2048 ----------

  if (pathname === "/api/runs/mines/start" && method === "POST") {
    const u = await requireUser(request, env);
    const b = await body(request);
    if (!isDifficulty(b.difficulty)) return err("Unknown difficulty.");
    await limit(env, `run-start:${u.id}`, 300, HOUR);
    const runId = crypto.randomUUID();
    const info = await env.MINES_RUN.get(env.MINES_RUN.idFromName(runId)).init(u.id, b.difficulty);
    return json({ runId, ...info });
  }
  const minesAction = pathname.match(/^\/api\/runs\/mines\/([0-9a-f-]{36})\/action$/);
  if (minesAction && method === "POST") {
    const u = await requireUser(request, env);
    const res = await env.MINES_RUN.get(env.MINES_RUN.idFromName(minesAction[1])).action(u.id, await body(request));
    return json(res, res.ok ? 200 : 400);
  }

  if (pathname === "/api/runs/2048/start" && method === "POST") {
    const u = await requireUser(request, env);
    await limit(env, `run-start:${u.id}`, 300, HOUR);
    const runId = crypto.randomUUID();
    await env.RUN2048.get(env.RUN2048.idFromName(runId)).init(u.id);
    return json({ runId });
  }

  // ---------- realtime ----------

  const isWs = request.headers.get("Upgrade") === "websocket";

  // Solo 2048 is played over a socket so tiles can come from the server one move at a time.
  const run2048 = pathname.match(/^\/api\/ws\/runs\/2048\/([0-9a-f-]{36})$/);
  if (run2048) {
    if (!isWs) return err("Expected WebSocket", 426);
    const u = await requireUser(request, env);
    return env.RUN2048.get(env.RUN2048.idFromName(run2048[1])).fetch(withUser(request, u));
  }

  // Other games: /api/ws/<game>/matchmake and /api/ws/<game>/room/<code>
  const gameWs = pathname.match(/^\/api\/ws\/(snake|2048|connect4|chess|generals)\/(matchmake|room\/([A-Za-z0-9]+))$/);
  if (gameWs) {
    if (!isWs) return err("Expected WebSocket", 426);
    const game = gameWs[1] as "snake" | "2048" | "connect4" | "chess" | "generals";
    const u = await requireUser(request, env);
    if (gameWs[2] === "matchmake") {
      const req = withUser(request, u);
      const headers = new Headers(req.headers);
      headers.set("X-0xHub-Game", game);
      // Chess players are only paired with others who picked the same time control.
      const queue = game === "chess" ? `mm:chess:${chessTimeControl(url.searchParams.get("tc")).id}` : `mm:${game}`;
      return env.MATCHMAKER.get(env.MATCHMAKER.idFromName(queue)).fetch(new Request(req, { headers }));
    }
    const code = gameWs[3].toUpperCase();
    if (!isValidRoomCode(code)) return err("Invalid room code");
    const rooms = { snake: env.SNAKE_ROOM, "2048": env.DUEL2048_ROOM, connect4: env.CONNECT4_ROOM, chess: env.CHESS_ROOM, generals: env.GENERALS_ROOM };
    const ns = rooms[game] as DurableObjectNamespace;
    return ns.get(ns.idFromName(`${game}:${code}`)).fetch(withUser(request, u, code));
  }

  if (pathname === "/api/ws/matchmake") {
    if (!isWs) return err("Expected WebSocket", 426);
    const u = await requireUser(request, env);
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName("global"));
    return stub.fetch(withUser(request, u));
  }

  const room = pathname.match(/^\/api\/ws\/room\/([A-Za-z0-9]+)$/);
  if (room) {
    if (!isWs) return err("Expected WebSocket", 426);
    const code = room[1].toUpperCase();
    if (!isValidRoomCode(code)) return err("Invalid room code");
    const u = await requireUser(request, env);
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(`room:${code}`));
    return stub.fetch(withUser(request, u, code));
  }

  return err("Not found", 404);
}

/** Forward the authenticated identity to a Durable Object (only reachable through this Worker). */
function withUser(request: Request, u: UserRow, room?: string): Request {
  const headers = new Headers(request.headers);
  // Header values must be ASCII; names and avatars can contain emoji, so percent-encode.
  headers.set(
    "X-0xHub-User",
    encodeURIComponent(JSON.stringify({ id: u.id, name: u.display_name, avatar: u.avatar, color: u.color, rating: u.rating })),
  );
  if (room) headers.set("X-0xHub-Room", room);
  return new Request(request, { headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return new Response(null, { status: 404 }); // static assets handle the rest
    let res: Response;
    try {
      res = await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status, e.headers);
      else {
        console.error(e);
        res = err("Server error", 500);
      }
    }
    // Always consume the request body, even on early rejections (e.g. 401), so
    // keep-alive connections stay healthy.
    if (request.body && !request.bodyUsed) await request.arrayBuffer().catch(() => {});
    return res;
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env.DB));
  },
} satisfies ExportedHandler<Env>;
