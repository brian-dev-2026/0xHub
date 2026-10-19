// Password hashing and cookie sessions using WebCrypto (no dependencies).

const PBKDF2_ITERATIONS = 100_000; // Workers' maximum for PBKDF2
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = "sid";

const enc = new TextEncoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

/** Returns "pbkdf2$<iterations>$<salt>$<hash>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const actual = new Uint8Array(await pbkdf2(password, fromB64(salt), Number(iter)));
  const expected = fromB64(hash);
  if (actual.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O, 1/I/L, U

/** A new recovery code: 20 random characters (~98 bits) shown as XXXXX-XXXXX-XXXXX-XXXXX. */
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let s = "";
  for (let i = 0; i < 20; i++) {
    // Reject 240–255 so every character is equally likely.
    let b = bytes[i];
    while (b >= 240) b = crypto.getRandomValues(new Uint8Array(1))[0];
    s += RECOVERY_ALPHABET[b % 30];
    if (i % 5 === 4 && i < 19) s += "-";
  }
  return s;
}

/** Canonical form for comparing: uppercase, no separators or spaces. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A pretend verification so failed logins on unknown usernames take as long as real ones. */
export async function dummyVerify(password: string): Promise<void> {
  await pbkdf2(password, new Uint8Array(16), PBKDF2_ITERATIONS);
}

export async function sha256(s: string): Promise<string> {
  return toB64(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export async function createSession(db: D1Database, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = toB64(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256(token), userId, now, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
}

/** Resolve the user id for a session token, sliding the expiry forward when it's getting old. */
export async function userIdForToken(db: D1Database, token: string): Promise<string | null> {
  const hash = await sha256(token);
  const row = await db
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`)
    .bind(hash)
    .first<{ user_id: string; expires_at: number }>();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(hash).run();
    return null;
  }
  if (row.expires_at - now < SESSION_TTL_MS / 2) {
    await db.prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`).bind(now + SESSION_TTL_MS, hash).run();
  }
  return row.user_id;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(request: Request, token: string, expiresAt: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
