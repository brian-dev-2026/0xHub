import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSim } from "../../../shared/games/mages/replay";
import { createSim, step, type Action, type Sim, type SimConfig, type SimEvent } from "../../../shared/games/mages/sim";
import { CHUNK_TICKS, REQUEST_TIMEOUT_MS, createRunSubmitter, loadPendingRun, takePendingRun, savePendingRun, type PendingBatch } from "./submit";

/** An action before it is stamped with its tick. */
type Untimed = { [K in Action["type"]]: Omit<Extract<Action, { type: K }>, "t"> }[Action["type"]];

const cfg: SimConfig = { seed: 4242, mode: "stage", stage: 1, team: ["fire", "ice", "lightning"], traps: ["spike"], spells: ["meteor"] };

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** An api whose input() calls wait until the test answers them, in order. */
function stubApi() {
  const calls: { batch: PendingBatch; signal?: AbortSignal; answer: (res: unknown) => void; fail: (e: unknown) => void }[] = [];
  return {
    calls,
    input: (_runId: string, batch: unknown, opts?: { signal?: AbortSignal }) =>
      new Promise<unknown>((answer, fail) => calls.push({ batch: batch as PendingBatch, signal: opts?.signal, answer, fail })),
  };
}
const handlers = () => ({ onResult: vi.fn(), onReject: vi.fn(), onStatus: vi.fn() });
const flush = () => vi.advanceTimersByTimeAsync(0);

/** Plays `ticks` ticks, logging `acts` (stamped with the tick they apply on) like the engine does, and reporting each tick. */
function play(sim: Sim, log: Action[], ticks: number, acts: Record<number, Untimed[]>, each: (evs: SimEvent[]) => void) {
  for (let i = 0; i < ticks; i++) {
    const due = (acts[sim.tick] || []).map((a) => ({ ...a, t: sim.tick }) as Action);
    const evs = step(sim, due);
    log.push(...due);
    each(evs);
  }
}

let store: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createRunSubmitter", () => {
  it("posts chunks in order, one request at a time, with the actions since the last chunk and the hash at upTo", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg), log: Action[] = [];
    const sub = createRunSubmitter(api, "run-1", h);
    const hashes: number[] = [];
    // 1st chunk: a wave end (faked event) after a placement; 2nd: CHUNK_TICKS of sim time later
    const free = sim.map.tiles.flatMap((t, i) => (t.kind === "build" && t.terrain !== "blocked" ? [i] : []));
    play(sim, log, 10, { 2: [{ type: "place", mage: "fire", tile: free[0] }] }, (evs) => {
      const end = sim.tick === 10 ? [{ type: "waveEnd", wave: 1, bonus: 25 } as SimEvent] : [];
      if (end.length) hashes.push(hashSim(sim));
      sub.afterTick(sim, log, [...evs, ...end]);
    });
    play(sim, log, CHUNK_TICKS, { 20: [{ type: "place", mage: "ice", tile: free[1] }] }, (evs) => {
      if (sim.tick - 10 >= CHUNK_TICKS) hashes.push(hashSim(sim));
      sub.afterTick(sim, log, evs);
    });
    await flush();
    expect(api.calls).toHaveLength(1); // the second waits for the first answer
    expect(api.calls[0].batch).toEqual({ upTo: 10, actions: [log[0]], h: hashes[0] });
    expect(loadPendingRun()!.batches.map((b) => b.upTo)).toEqual([10, 10 + CHUNK_TICKS]);
    api.calls[0].answer({ ok: true });
    await flush();
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].batch).toEqual({ upTo: 10 + CHUNK_TICKS, actions: [log[1]], h: hashes[1] });
    expect(log[1]).toMatchObject({ type: "place", mage: "ice", t: 20 });
    api.calls[1].answer({ ok: true });
    await flush();
    expect(sub.unsent).toBe(false);
    expect(store.data.size).toBe(0);
    expect(h.onReject).not.toHaveBeenCalled();
  });

  it("a refused chunk (ok: false) stops the run and clears storage", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-2", h);
    step(sim, []);
    sub.finish(sim, []);
    await flush();
    expect(store.data.size).toBe(1);
    api.calls[0].answer({ ok: false, error: "Run failed verification" });
    await flush();
    expect(h.onReject).toHaveBeenCalledWith("Run failed verification");
    expect(store.data.size).toBe(0);
    expect(sub.unsent).toBe(false);
    sub.finish(sim, []);
    await flush();
    expect(api.calls).toHaveLength(1);
  });

  it("a failed final chunk waits for retry(); earlier chunks retry on their own", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-3", h);
    step(sim, []);
    sub.afterTick(sim, [], [{ type: "waveEnd", wave: 1, bonus: 25 }]);
    await flush();
    api.calls[0].fail(new TypeError("Failed to fetch"));
    await flush();
    expect(h.onStatus).toHaveBeenLastCalledWith("failed", false);
    await vi.advanceTimersByTimeAsync(2000); // backoff
    expect(api.calls).toHaveLength(2);
    step(sim, []);
    sub.finish(sim, []);
    api.calls[1].fail(new TypeError("Failed to fetch"));
    await flush();
    expect(h.onStatus).toHaveBeenLastCalledWith("failed", true);
    expect(sub.failures).toBe(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.calls).toHaveLength(2); // no automatic retry once the final chunk is waiting
    expect(loadPendingRun()!.batches.map((b) => b.final === true)).toEqual([false, true]);
    sub.retry();
    await flush();
    api.calls[2].answer({ ok: true });
    await flush();
    api.calls[3].answer({ ok: true, finished: true, outcome: { won: false } });
    await flush();
    expect(h.onResult).toHaveBeenCalledWith({ ok: true, finished: true, outcome: { won: false } });
    expect(store.data.size).toBe(0);
  });

  it("a request with no answer times out, is aborted and counts as failed", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-4", h);
    step(sim, []);
    sub.finish(sim, []);
    await flush();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(h.onStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.calls[0].signal!.aborted).toBe(true);
    expect(h.onStatus).toHaveBeenLastCalledWith("failed", true);
    expect(sub.finalUnsent).toBe(true);
    sub.retry();
    await flush();
    api.calls[1].answer({ ok: true, finished: true });
    await flush();
    expect(h.onResult).toHaveBeenCalled();
  });

  it("resends chunks left by an earlier visit first", async () => {
    const api = stubApi(), h = handlers();
    const left: PendingBatch[] = [{ upTo: 300, actions: [], h: 7 }, { upTo: 420, actions: [], h: 8, final: true }];
    const sub = createRunSubmitter(api, "run-5", h, left);
    sub.retry();
    await flush();
    expect(api.calls[0].batch).toEqual(left[0]);
    api.calls[0].answer({ ok: true });
    await flush();
    expect(api.calls[1].batch).toEqual(left[1]);
  });
});

describe("takePendingRun", () => {
  it("keeps a run with a final chunk and drops one without (R44)", () => {
    savePendingRun({ runId: "a", batches: [{ upTo: 1, actions: [], h: 1 }] });
    expect(takePendingRun()).toBeNull();
    expect(store.data.size).toBe(0);
    const run = { runId: "b", batches: [{ upTo: 1, actions: [], h: 1 }, { upTo: 2, actions: [], h: 2, final: true }] };
    savePendingRun(run);
    expect(takePendingRun()).toEqual(run);
  });
});
