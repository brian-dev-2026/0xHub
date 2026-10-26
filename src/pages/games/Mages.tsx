import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { mountMages, type MagesApi } from "../../games/mages/engine";
import { ApiError } from "../../lib/auth";

/**
 * Parsed JSON of a Mage Siege API call. A rejected wave chunk comes back as a 400 whose body still says what
 * happened (`ok: false`), so that body is returned; other failures throw.
 */
async function call(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(path, body === undefined ? { signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => ({}))) as { ok?: unknown; error?: string };
  if (!res.ok && typeof data.ok !== "boolean") throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

const api: MagesApi = {
  progress: () => call("/api/mages/progress"),
  start: (body) => call("/api/mages/start", body),
  input: (runId, batch, opts) => call(`/api/mages/runs/${encodeURIComponent(runId)}/input`, batch, opts?.signal),
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
