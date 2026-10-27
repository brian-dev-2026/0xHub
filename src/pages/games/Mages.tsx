import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { mountMages, type MagesApi } from "../../games/mages/engine";
import { ApiError } from "../../lib/auth";

/**
 * Parsed JSON of a Mage Siege API call. A refused chunk comes back as a 400 whose body still says what happened
 * (`ok: false`), so that body is returned; other failures throw, and so does a body that can't be read (a truncated
 * answer must count as a failed request, never as a refusal).
 */
async function call(path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(path, body === undefined ? { signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") throw new ApiError(`Unreadable response (${res.status})`, res.status);
  if (!res.ok && typeof data.ok !== "boolean") throw new ApiError(typeof data.error === "string" ? data.error : `Request failed (${res.status})`, res.status);
  return data;
}

export const api: MagesApi = {
  progress: () => call("/api/mages/progress"),
  start: (body) => call("/api/mages/start", body),
  // Every upload or poll answer carries a boolean `ok`; anything else is a failed request (the player gets Retry)
  input: async (runId, batch, opts) => {
    const data = await call(`/api/mages/runs/${encodeURIComponent(runId)}/input`, batch, opts?.signal);
    if (typeof data.ok !== "boolean") throw new ApiError("Unexpected response", 0);
    return data;
  },
};

/** Full-screen Mage Siege. The engine owns everything inside the host element. */
export default function MagesPage() {
  const host = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    return mountMages(el, { onExit: () => navigate("/games"), api });
  }, [navigate]);

  return <div ref={host} className="fixed inset-0" />;
}
