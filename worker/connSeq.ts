/** Connection ordering for seat takeover (see wsUrl in src/lib/api.ts). */

export const CLOSE_STALE = 4002;

export function connSeq(request: Request): number {
  const c = Number(new URL(request.url).searchParams.get("c"));
  return Number.isFinite(c) && c > 0 ? c : Date.now() * 1000;
}

export function seqOf(ws: WebSocket): number {
  return (ws.deserializeAttachment() as { c?: number } | null)?.c ?? 0;
}

/**
 * Decide what to do when a user who already has open sockets connects again:
 * if any existing socket is newer, the incoming one is stale and must be
 * closed; otherwise the existing ones are replaced.
 */
export function isStale(incoming: number, existing: WebSocket[]): boolean {
  return existing.some((ws) => seqOf(ws) > incoming);
}
