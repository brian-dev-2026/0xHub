// Mage Siege run submission: everything between the played sim and the server's verdict. It cuts the action log into
// chunks (worker/mages.ts client contract), sends them in order one request at a time, keeps the unsent ones in
// localStorage until the server acknowledges them (Review Focus 3), retries, and reports the final result. The engine
// only calls afterTick()/finish() while a run plays; the screens only see the handlers' callbacks.
import { secs } from '../../../shared/games/mages/data';
import { hashSim } from '../../../shared/games/mages/replay';

// ================= Pending run storage =================
const PENDING_KEY = '0xhubms.pending';

/** Stores the run's unsent chunks ({ runId, batches }); storage errors are ignored. */
export function savePendingRun(run) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(run)); } catch (e) { /* storage blocked or full */ }
}
/** The stored pending run, or null (none, unreadable or malformed). */
export function loadPendingRun() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw);
    return run && typeof run.runId === 'string' && Array.isArray(run.batches) ? run : null;
  } catch (e) { return null; }
}
export function clearPendingRun() {
  try { localStorage.removeItem(PENDING_KEY); } catch (e) { /* storage blocked */ }
}

/** A chunk goes out at every wave end, or after this much sim time without one (the server caps a chunk at 150 s, R31). */
export const CHUNK_TICKS = secs(120);

/**
 * createRunSubmitter(api, runId, handlers, batches = []) → { runId, afterTick(sim, log, events), finish(sim, log),
 * retry(), unsent, finalUnsent, drop(), stop() }
 * `batches` are chunks left unsent by an earlier visit (they go first). handlers: onResult(res) for the final response,
 * onReject(error) when the server refuses the run (ok: false), onStatus(state, final) with 'ok' | 'failed'. 'failed'
 * means a request did not get through; `final` says the final chunk is among the unsent ones: that one waits for
 * retry() (the player's Retry), while earlier chunks are retried on their own after a growing pause.
 */
export function createRunSubmitter(api, runId, { onResult, onReject, onStatus }, batches = []) {
  const queue = batches.slice();
  let busy = false, stopped = false, timer = 0, failures = 0;
  /** End of the last chunk, and how much of the action log it covered. */
  let lastUpTo = 0, logIdx = 0;
  const save = () => (queue.length ? savePendingRun({ runId, batches: queue }) : clearPendingRun());
  const hasFinal = () => queue.some(b => b.final === true);

  async function pump() {
    if (busy || stopped) return;
    clearTimeout(timer); timer = 0;
    busy = true;
    while (queue.length && !stopped) {
      let res;
      try { res = await api.input(runId, queue[0]); } catch (e) { res = null; }
      if (stopped) break;
      if (res === null) {
        failures++;
        busy = false;
        const fin = hasFinal();
        onStatus('failed', fin);
        if (!fin) timer = setTimeout(pump, Math.min(20000, 2000 * 2 ** Math.min(4, failures - 1)));
        return;
      }
      if (res.ok !== true) { stopped = true; clearPendingRun(); onReject(res.error || 'Run failed verification'); break; }
      failures = 0;
      queue.shift(); save();
      onStatus('ok', false);
      if (res.finished) onResult(res);
    }
    busy = false;
  }
  /** Queues the actions since the last chunk with the sim's hash at this tick, and sends. */
  function post(sim, log, final) {
    if (stopped) return;
    const batch = { upTo: sim.tick, actions: log.slice(logIdx), h: hashSim(sim) };
    if (final) batch.final = true;
    logIdx = log.length; lastUpTo = sim.tick;
    queue.push(batch); save();
    pump();
  }

  return {
    runId,
    /** Call after every tick of the run with that tick's events: posts a chunk at a wave end or after CHUNK_TICKS. */
    afterTick(sim, log, evs) {
      if (evs.some(e => e.type === 'waveEnd') || sim.tick - lastUpTo >= CHUNK_TICKS) post(sim, log, false);
    },
    /** The run is over (won, lost, or Endless ended by the player): posts the final chunk. */
    finish(sim, log) { post(sim, log, true); },
    retry() { pump(); },
    /** True while some chunk has not been acknowledged. */
    get unsent() { return queue.length > 0 && !stopped; },
    get finalUnsent() { return !stopped && hasFinal(); },
    /** Stops sending and forgets the run (quitting a stage: nothing to record). */
    drop() { stopped = true; clearTimeout(timer); clearPendingRun(); },
    /** Stops sending but keeps what is stored (the page is going away). */
    stop() { stopped = true; clearTimeout(timer); },
  };
}
