import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSim } from "../../../shared/games/mages/replay";
import { createSim, step, type Action, type Sim, type SimConfig, type SimEvent } from "../../../shared/games/mages/sim";
import {
  BEHIND_RETRY_MS, CHUNK_TICKS, LAG_TICKS, MAX_CHUNK_ACTIONS, PLAY_POLL_EVERY_MS, PLAY_POLL_FAST_MS, POLL_EVERY_MS, POLL_FOR_MS, POST_EVERY_MS, REQUEST_TIMEOUT_MS, createRunSubmitter, loadPendingRun, markVerifying, savePendingRun, takePendingRun, takeVerifying,
  type PendingBatch,
} from "./submit";

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
  const calls: { batch: PendingBatch & { poll?: boolean }; signal?: AbortSignal; answer: (res: unknown) => void; fail: (e: unknown) => void }[] = [];
  return {
    calls,
    input: (_runId: string, batch: unknown, opts?: { signal?: AbortSignal }) =>
      new Promise<unknown>((answer, fail) => calls.push({ batch: batch as PendingBatch, signal: opts?.signal, answer, fail })),
  };
}
const handlers = () => ({ onResult: vi.fn(), onReject: vi.fn(), onStatus: vi.fn(), onProgress: vi.fn(), onStored: vi.fn(), onGiveUp: vi.fn() });
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

describe("deferred verification (Task 14b)", () => {
  const pending = (verifiedTo: number, queuedTo: number) => ({ ok: true, pending: true, verifiedTo, queuedTo });
  const finalSent = async (api: ReturnType<typeof stubApi>, sub: ReturnType<typeof createRunSubmitter>, sim: Sim) => {
    step(sim, []);
    sub.finish(sim, []);
    await flush();
    return api.calls.length - 1;
  };

  it("a stored final chunk is polled every POLL_EVERY_MS, with progress, until the finished result", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-p", h);
    const i = await finalSent(api, sub, sim);
    expect(api.calls[i].batch.final).toBe(true);
    api.calls[i].answer(pending(120, 900));
    await flush();
    expect(h.onStored).toHaveBeenCalledTimes(1);
    expect(h.onProgress).toHaveBeenLastCalledWith(120, 900);
    expect(store.data.size).toBe(0); // stored on the server: not a leftover any more (R44)
    expect(sub.finalStored).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS - 1);
    expect(api.calls).toHaveLength(i + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.calls[i + 1].batch).toEqual({ poll: true });
    api.calls[i + 1].answer(pending(600, 900));
    await flush();
    expect(h.onProgress).toHaveBeenLastCalledWith(600, 900);
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    const res = { ok: true, finished: true, outcome: { won: true, stars: 3 }, progress: { cleared: { 1: 3 }, endlessBest: 0 } };
    api.calls[i + 2].answer(res);
    await flush();
    expect(h.onResult).toHaveBeenCalledWith(res);
    expect(sub.done).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * POLL_EVERY_MS);
    expect(api.calls).toHaveLength(i + 3);
  });

  it("a failed poll is tried again; polling stops after POLL_FOR_MS or when the player leaves", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-q", h);
    const i = await finalSent(api, sub, sim);
    api.calls[i].answer(pending(0, 900));
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    api.calls[i + 1].fail(new TypeError("Failed to fetch"));
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    expect(api.calls).toHaveLength(i + 3);
    expect(h.onStatus).not.toHaveBeenCalledWith("failed", expect.anything());
    sub.detach();
    api.calls[i + 2].answer(pending(10, 900));
    await flush();
    await vi.advanceTimersByTimeAsync(10 * POLL_EVERY_MS);
    expect(api.calls).toHaveLength(i + 3);

    const api2 = stubApi(), sub2 = createRunSubmitter(api2, "run-r", handlers()), sim2 = createSim(cfg);
    const j = await finalSent(api2, sub2, sim2);
    api2.calls[j].answer(pending(0, 900));
    for (let t = 0; t < POLL_FOR_MS + 5 * POLL_EVERY_MS; t += POLL_EVERY_MS) {
      await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
      api2.calls[api2.calls.length - 1].answer(pending(0, 900));
    }
    const n = api2.calls.length;
    expect(n).toBeLessThanOrEqual(j + 2 + POLL_FOR_MS / POLL_EVERY_MS);
    await vi.advanceTimersByTimeAsync(10 * POLL_EVERY_MS);
    expect(api2.calls.length).toBe(n);
  });

  it("'Chunk already received' and 'Run already finished' are not fatal; other refusals are", async () => {
    const api = stubApi(), h = handlers();
    const left: PendingBatch[] = [{ upTo: 300, actions: [], h: 7 }, { upTo: 420, actions: [], h: 8, final: true }];
    const sub = createRunSubmitter(api, "run-n", h, left);
    sub.retry();
    await flush();
    api.calls[0].answer({ ok: false, error: "Chunk already received" });
    await flush();
    expect(api.calls[1].batch).toEqual(left[1]);
    api.calls[1].answer({ ok: false, error: "Run already finished" });
    await flush();
    expect(h.onReject).not.toHaveBeenCalled();
    expect(sub.finalStored).toBe(true);
    expect(store.data.size).toBe(0);
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    expect(api.calls[2].batch).toEqual({ poll: true });
    api.calls[2].answer({ ok: false, error: "Run could not be verified" });
    await flush();
    expect(h.onReject).toHaveBeenCalledWith("Run could not be verified");

    const api2 = stubApi(), h2 = handlers(), sim = createSim(cfg);
    const sub2 = createRunSubmitter(api2, "run-f", h2);
    await finalSent(api2, sub2, sim);
    api2.calls[0].answer({ ok: false, error: "Run is ahead of real time" });
    await flush();
    expect(h2.onReject).toHaveBeenCalledWith("Run is ahead of real time");
  });

  it("uploads about every 10 s of real time during a wave and polls about every 2 s in between while the server is behind (R46)", async () => {
    const sent: (PendingBatch & { poll?: boolean })[] = [];
    let inFlight = 0, overlap = false, behind = true;
    const api = {
      input: async (_id: string, body: unknown) => {
        if (inFlight++) overlap = true;
        await new Promise((r) => setTimeout(r, 50));
        inFlight--;
        sent.push(body as PendingBatch);
        const q = (body as PendingBatch).upTo ?? sent.filter((b) => !b.poll).at(-1)!.upTo;
        return { ok: true, pending: behind, verifiedTo: behind ? q - 30 : q, queuedTo: q };
      },
    };
    const sim = createSim(cfg), log: Action[] = [];
    const sub = createRunSubmitter(api, "run-c", handlers());
    log.push({ t: sim.tick, type: "startWave" });
    sub.afterTick(sim, log, step(sim, [log[0]]));
    const run = async (secsOfRealTime: number) => {
      for (let i = 0; i < secsOfRealTime * 30 && sim.phase === "wave"; i++) {
        await vi.advanceTimersByTimeAsync(1000 / 30);
        sub.afterTick(sim, log, step(sim, []));
      }
      await vi.advanceTimersByTimeAsync(100);
    };
    await run(31);
    expect(sim.phase).toBe("wave");
    const uploads = sent.filter((b) => !b.poll), polls = sent.filter((b) => b.poll);
    expect(uploads.map((b) => b.upTo)).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    const gaps = uploads.slice(1).map((b, k) => b.upTo - uploads[k].upTo);
    for (const g of gaps) expect(Math.abs(g - (POST_EVERY_MS / 1000) * 30)).toBeLessThanOrEqual(3);
    expect(polls.length).toBeGreaterThanOrEqual(10);
    expect(polls.length).toBeLessThanOrEqual(15);
    expect(polls.every((b) => JSON.stringify(b) === JSON.stringify({ poll: true }))).toBe(true);
    expect(overlap).toBe(false); // one request at a time
    expect(uploads[0].actions).toEqual([log[0]]);
    for (const b of uploads) expect(b.h).toBeGreaterThanOrEqual(0); // unsigned, exactly as hashSim returns it
    // Caught up: no polls until the next upload says the server is behind again
    behind = false;
    const before = sent.filter((b) => b.poll).length;
    await run(11);
    expect(sent.filter((b) => b.poll).length - before).toBeLessThanOrEqual(1);
  });

  it("a poll during play counts only when it says finished, and a fatal refusal ends the run", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg), log: Action[] = [];
    const sub = createRunSubmitter(api, "run-m", h);
    log.push({ t: sim.tick, type: "startWave" });
    sub.afterTick(sim, log, step(sim, [log[0]]));
    await vi.advanceTimersByTimeAsync(POST_EVERY_MS);
    sub.afterTick(sim, log, step(sim, []));
    await flush();
    expect(api.calls).toHaveLength(1);
    api.calls[0].answer({ ok: true, pending: true, verifiedTo: 0, queuedTo: sim.tick });
    await flush();
    await vi.advanceTimersByTimeAsync(PLAY_POLL_EVERY_MS);
    sub.afterTick(sim, log, step(sim, []));
    expect(api.calls[1].batch).toEqual({ poll: true });
    api.calls[1].answer({ ok: true, pending: false, verifiedTo: 10, queuedTo: 20 });
    await flush();
    expect(h.onResult).not.toHaveBeenCalled();
    expect(h.onProgress).not.toHaveBeenCalled(); // progress is for the results screen
    await vi.advanceTimersByTimeAsync(PLAY_POLL_EVERY_MS);
    sub.afterTick(sim, log, step(sim, []));
    api.calls[2].answer({ ok: false, error: "Run failed verification" });
    await flush();
    expect(h.onReject).toHaveBeenCalledWith("Run failed verification");
    expect(sub.done).toBe(true);
  });

  it("polls about every 1 s while the server lags more than LAG_TICKS, every 2 s otherwise (R47)", async () => {
    const api = stubApi(), sim = createSim(cfg), log: Action[] = [];
    const sub = createRunSubmitter(api, "run-l", handlers());
    log.push({ t: sim.tick, type: "startWave" });
    sub.afterTick(sim, log, step(sim, [log[0]]));
    await vi.advanceTimersByTimeAsync(POST_EVERY_MS);
    sub.afterTick(sim, log, step(sim, []));
    await flush();
    api.calls[0].answer({ ok: true, pending: true, verifiedTo: 0, queuedTo: LAG_TICKS + 100 });
    await flush();
    const pollsIn = async (ms: number) => {
      const n = api.calls.length;
      for (let t = 0; t < ms; t += 1000 / 30) {
        await vi.advanceTimersByTimeAsync(1000 / 30);
        sub.afterTick(sim, log, step(sim, []));
        const last = api.calls[api.calls.length - 1];
        if (api.calls.length > n && last.batch.poll) last.answer(lagAnswer());
      }
      await flush();
      return api.calls.length - n;
    };
    let lagAnswer = () => ({ ok: true, pending: true, verifiedTo: 0, queuedTo: LAG_TICKS + 100 });
    expect(await pollsIn(4000)).toBeGreaterThanOrEqual(3);
    lagAnswer = () => ({ ok: true, pending: true, verifiedTo: 100, queuedTo: LAG_TICKS });
    await pollsIn(1100);
    const slow = await pollsIn(4000);
    expect(slow).toBeGreaterThanOrEqual(1);
    expect(slow).toBeLessThanOrEqual(2);
    expect(PLAY_POLL_FAST_MS).toBeLessThan(PLAY_POLL_EVERY_MS);
  });

  it("'send this again later' (retry: true) keeps the chunk pending, polls, then resends it; later chunks wait behind it", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg), log: Action[] = [];
    const sub = createRunSubmitter(api, "run-b", h);
    step(sim, []);
    sub.afterTick(sim, log, [{ type: "waveEnd", wave: 1, bonus: 25 }]);
    await flush();
    const first = api.calls[0].batch;
    api.calls[0].answer({ ok: false, error: "Verification is behind: send this again later", retry: true });
    await flush();
    expect(h.onReject).not.toHaveBeenCalled();
    expect(loadPendingRun()!.batches).toEqual([first]); // still stored
    // A later chunk queues behind it and is not sent yet
    step(sim, []);
    sub.finish(sim, log);
    await flush();
    expect(api.calls).toHaveLength(1);
    // Polls drive verification meanwhile
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(PLAY_POLL_FAST_MS);
      const last = api.calls[api.calls.length - 1];
      expect(last.batch).toEqual({ poll: true });
      last.answer({ ok: true, pending: true, verifiedTo: 10 * i, queuedTo: 300 });
      await flush();
    }
    await vi.advanceTimersByTimeAsync(BEHIND_RETRY_MS);
    const uploads = () => api.calls.filter((c) => !c.batch.poll);
    // Answer any outstanding poll so the held chunk can go again
    for (let k = 0; k < 4 && uploads().length < 2; k++) {
      const last = api.calls[api.calls.length - 1];
      if (last.batch.poll) last.answer({ ok: true, pending: true, verifiedTo: 200, queuedTo: 300 });
      await vi.advanceTimersByTimeAsync(PLAY_POLL_FAST_MS);
    }
    expect(uploads()[1].batch).toEqual(first); // the same chunk, resent first
    uploads()[1].answer({ ok: true, pending: true, verifiedTo: 200, queuedTo: first.upTo });
    await flush();
    expect(uploads()[2].batch.final).toBe(true);
    expect(h.onReject).not.toHaveBeenCalled();
  });

  it("stop() and drop() abort the request in flight", async () => {
    const api = stubApi(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-s", handlers());
    await finalSent(api, sub, sim);
    sub.stop();
    expect(api.calls[0].signal!.aborted).toBe(true);
    expect(store.data.size).toBe(1); // kept for the next visit
    const api2 = stubApi(), sub2 = createRunSubmitter(api2, "run-d", handlers());
    await finalSent(api2, sub2, createSim(cfg));
    sub2.drop();
    expect(api2.calls[0].signal!.aborted).toBe(true);
    expect(store.data.size).toBe(0);
  });
});

describe("edge cases (final-fix carry)", () => {
  const pending = (verifiedTo: number, queuedTo: number) => ({ ok: true, pending: true, verifiedTo, queuedTo });

  it("uploads before the actions outgrow a chunk (1900 of the 2000 allowed)", async () => {
    const sent: PendingBatch[] = [];
    const api = { input: async (_id: string, b: unknown) => { sent.push(b as PendingBatch); return pending(0, 0); } };
    const sim = createSim(cfg), log: Action[] = [];
    const sub = createRunSubmitter(api, "run-a", handlers());
    // Build-phase ticks (no time-based upload), many logged actions per tick
    for (let i = 0; i < 40 && sent.length === 0; i++) {
      for (let k = 0; k < 50; k++) log.push({ t: sim.tick, type: "startWave" } as Action);
      sub.afterTick(sim, log, step(sim, []));
    }
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].actions.length).toBe(MAX_CHUNK_ACTIONS - 100);
  });

  it("no polls while idle (hidden or paused), including the retry:true hold; they resume when active again", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-i", h);
    step(sim, []);
    sub.afterTick(sim, [], [{ type: "waveEnd", wave: 1, bonus: 25 }]);
    await flush();
    api.calls[0].answer({ ok: false, error: "Verification is behind: send this again later", retry: true });
    await flush();
    sub.setIdle(true);
    await vi.advanceTimersByTimeAsync(BEHIND_RETRY_MS * 4);
    expect(api.calls).toHaveLength(1); // neither polls nor the resend
    sub.setIdle(false);
    await flush();
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].batch).toEqual({ poll: true });
    api.calls[1].answer(pending(0, 30));
    await flush();

    // After the final chunk: results polling pauses while hidden and resumes at once
    const api2 = stubApi(), h2 = handlers(), sim2 = createSim(cfg);
    const sub2 = createRunSubmitter(api2, "run-j", h2);
    step(sim2, []);
    sub2.finish(sim2, []);
    await flush();
    api2.calls[0].answer(pending(0, 30));
    await flush();
    sub2.setIdle(true);
    await vi.advanceTimersByTimeAsync(POLL_FOR_MS * 2);
    expect(api2.calls).toHaveLength(1);
    expect(h2.onGiveUp).not.toHaveBeenCalled(); // time while hidden doesn't count
    sub2.setIdle(false);
    await flush();
    expect(api2.calls[1].batch).toEqual({ poll: true });
  });

  it("gives up polling after POLL_FOR_MS and says so (onGiveUp), instead of spinning forever", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-g", h);
    step(sim, []);
    sub.finish(sim, []);
    await flush();
    api.calls[0].answer(pending(0, 30));
    for (let t = 0; t <= POLL_FOR_MS + 5 * POLL_EVERY_MS; t += POLL_EVERY_MS) {
      await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
      const last = api.calls[api.calls.length - 1];
      if (last.batch.poll) last.answer(pending(0, 30));
    }
    await flush();
    expect(h.onGiveUp).toHaveBeenCalledTimes(1);
    expect(sub.done).toBe(false);
  });

  it("only clears the pending store when it holds its own run", async () => {
    const api = stubApi(), h = handlers(), sim = createSim(cfg);
    const old = createRunSubmitter(api, "run-old", h);
    step(sim, []);
    old.finish(sim, []);
    await flush();
    // A newer run saved its batches meanwhile
    const mine = { runId: "run-new", batches: [{ upTo: 9, actions: [], h: 1, final: true }] };
    savePendingRun(mine);
    api.calls[0].answer({ ok: true, finished: true, outcome: {} });
    await flush();
    expect(loadPendingRun()).toEqual(mine);
    old.drop();
    expect(loadPendingRun()).toEqual(mine);
  });

  it("detach() aborts a poll in flight (uploads carry on); stop() aborts anything", async () => {
    const api = stubApi(), sim = createSim(cfg);
    const sub = createRunSubmitter(api, "run-x", handlers());
    step(sim, []);
    sub.finish(sim, []);
    await flush();
    api.calls[0].answer(pending(0, 30));
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    expect(api.calls[1].batch).toEqual({ poll: true });
    sub.detach();
    expect(api.calls[1].signal!.aborted).toBe(true);

    const api2 = stubApi(), sub2 = createRunSubmitter(api2, "run-y", handlers()), sim2 = createSim(cfg);
    step(sim2, []);
    sub2.finish(sim2, []);
    await flush();
    sub2.detach(); // the final upload is not stored yet: it keeps going
    expect(api2.calls[0].signal!.aborted).toBe(false);
  });

  it("marks a run still verifying, for the next mount", () => {
    expect(takeVerifying()).toBeNull();
    markVerifying("run-v");
    expect(takeVerifying()).toBe("run-v");
    expect(takeVerifying()).toBeNull();
    markVerifying("run-w");
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(takeVerifying()).toBeNull(); // too old to matter
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
