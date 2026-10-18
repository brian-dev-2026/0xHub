import type { MeResponse, PublicUser } from "../../shared/protocol";
import { applyServerSettings, createStore, settingsStore } from "./store";

type Status = "loading" | "signedOut" | "signedIn" | "offline";

interface AuthState {
  status: Status;
  me: MeResponse | null;
}

export const authStore = createStore<AuthState>({ status: "loading", me: null });

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.json !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

let applyingServerSettings = false;

function setMe(me: MeResponse, loadSettings = false) {
  if (loadSettings) {
    applyingServerSettings = true;
    applyServerSettings(me.settings);
    applyingServerSettings = false;
  }
  authStore.set({ status: "signedIn", me });
}

export async function loadMe() {
  // Retry transient failures (network blips, 5xx) before showing the offline screen.
  for (let attempt = 0; ; attempt++) {
    try {
      setMe(await api<MeResponse>("/api/me"), true);
      return;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        authStore.set({ status: "signedOut", me: null });
        return;
      }
      if (attempt >= 2) {
        authStore.set({ status: "offline", me: null });
        return;
      }
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

/** Re-fetch stats/history after a game. */
export async function refreshMe() {
  try {
    setMe(await api<MeResponse>("/api/me"));
  } catch {
    /* keep showing the last known data */
  }
}

export async function playAsGuest() {
  setMe(await api<MeResponse>("/api/auth/guest", { method: "POST" }), true);
}

export async function login(username: string, password: string) {
  setMe(await api<MeResponse>("/api/auth/login", { method: "POST", json: { username, password } }), true);
}

/** Creates an account — or, when signed in as a guest, upgrades the guest and keeps their progress. */
export async function register(username: string, password: string) {
  const wasSignedIn = authStore.get().status === "signedIn";
  setMe(await api<MeResponse>("/api/auth/register", { method: "POST", json: { username, password } }), !wasSignedIn);
}

export async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  authStore.set({ status: "signedOut", me: null });
}

export async function updateProfile(patch: Partial<Pick<PublicUser, "displayName" | "avatar" | "color">>) {
  setMe(await api<MeResponse>("/api/me", { method: "PATCH", json: patch }));
}

export async function startEndlessRun(startLevel: number) {
  return api<{ runId: string; seed: number }>("/api/runs/endless/start", { method: "POST", json: { startLevel } });
}

export interface RunChunkResult {
  ok: boolean;
  error?: string;
  finished?: boolean;
  score?: number;
  lines?: number;
  level?: number;
  best?: number;
  rank?: number;
}

export async function sendRunChunk(runId: string, batch: { upTo: number; ev: number[]; h: number; final?: boolean }) {
  return api<RunChunkResult>(`/api/runs/endless/${runId}/input`, { method: "POST", json: batch });
}

export async function changePassword(current: string, next: string) {
  await api("/api/me/password", { method: "POST", json: { current, next } });
}

export async function deleteAccount(password?: string) {
  await api("/api/me", { method: "DELETE", json: { password } });
  authStore.set({ status: "signedOut", me: null });
}

// Save settings to the account shortly after they change.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
settingsStore.subscribe(() => {
  if (applyingServerSettings || authStore.get().status !== "signedIn") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api("/api/me/settings", { method: "PUT", json: settingsStore.get() }).catch(() => {});
  }, 600);
});

/** Convenience hook: the signed-in user's data (only valid under <AuthGate>). */
export function useMe(): MeResponse {
  const { me } = authStore.use();
  if (!me) throw new Error("useMe() used outside of a signed-in area");
  return me;
}
