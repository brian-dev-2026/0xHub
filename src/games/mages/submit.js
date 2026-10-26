// Mage Siege run submission: everything between the played sim and the server's verdict. It cuts the action log into
// chunks (worker/mages.ts client contract), sends them in order one request at a time, keeps the unsent ones in
// localStorage until the server has stored them (Review Focus 3), retries, and then follows the server's deferred,
// sliced verification (R43) by polling until the final result. The engine only calls afterTick()/finish() while a run
// plays and detach() when the player leaves; the screens only see the handlers' callbacks.
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

// ================= Cadence and limits (worker/mages.ts client contract) =================
/**
 * During play a chunk goes out about this often (real time): while a wave runs, or in a build break once there are new
 * actions. Uploads write Durable Object rows, which the free plan limits per day (R46), so they are spaced out and
 * polls drive the verification in between.
 */
export const POST_EVERY_MS = 10000;
/** While the game runs and the server is behind, a `{ poll: true }` (one verification slice, no writes) this often... */
export const PLAY_POLL_EVERY_MS = 2000;
/** ...and this often while it is more than LAG_TICKS behind (R47). */
export const PLAY_POLL_FAST_MS = 1000;
export const LAG_TICKS = 900;
/** Backstop for idle build time: a chunk after this much sim time without one (the server allows 150 s). */
export const CHUNK_TICKS = secs(120);
/** The server takes at most 2000 actions per chunk; a chunk goes out well before that. */
export const MAX_CHUNK_ACTIONS = 2000;
const ACTIONS_SOFT_LIMIT = MAX_CHUNK_ACTIONS - 100;
/** A request with no answer after this long counts as failed (R44), so the player gets Retry instead of a spinner. */
export const REQUEST_TIMEOUT_MS = 15000;
/** After the final chunk is stored, the result is polled this often while the player watches the results screen (R47). */
export const POLL_EVERY_MS = 500;
/** Polling gives up after this long; the server's alarm chain still finishes and records the run. */
export const POLL_FOR_MS = 3 * 60 * 1000;

/** Refusals that only mean the server already has this data (drop the chunk and carry on). */
const ALREADY_HAVE = /^(chunk already received|run already finished)/i;

/**
 * createRunSubmitter(api, runId, handlers, batches = []) → { runId, afterTick(sim, log, events), finish(sim, log),
 * retry(), detach(), unsent, finalUnsent, finalStored, done, failures, drop(), stop() }
 * `batches` are chunks left unsent by an earlier visit (they go first).
 * handlers:
 * - onResult(res): the final `finished` response (stars, progress, Endless best and rank);
 * - onReject(error): the server refused the run for good;
 * - onStatus(state, final): 'ok' | 'failed' for uploads ('failed': no answer, an error or a timeout; `final` says the
 *   final chunk is among the unsent ones, which waits for retry(), while earlier chunks are retried after a pause);
 * - onProgress(verifiedTo, queuedTo) (optional): verification progress once the final chunk is stored on the server;
 * - onStored() (optional): the final chunk is stored on the server, so nothing can be lost any more.
 * `api.input(runId, body, { signal })` posts a chunk or `{ poll: true }`.
 */
export function createRunSubmitter(api, runId, handlers, batches = []) {
  const { onResult, onReject, onStatus, onProgress = () => {}, onStored = () => {} } = handlers;
  const queue = batches.slice();
  let busy = false, stopped = false, timer = 0, failures = 0, inFlight = null;
  /** End of the last chunk, how much of the action log it covered, and when it went out (real time). */
  let lastUpTo = 0, logIdx = 0, lastPostAt = Date.now();
  /** How far the server says it has verified and queued, and when the last poll during play went out. */
  let verifiedTo = 0, queuedTo = 0, lastPollAt = 0;
  const note = res => { if (typeof res.verifiedTo === 'number' && typeof res.queuedTo === 'number') { verifiedTo = res.verifiedTo; queuedTo = res.queuedTo; } };
  /** The final chunk is stored on the server; `polling` while the results screen waits; `done` once answered for good. */
  let finalStored = false, polling = true, pollUntil = 0, done = false;
  const save = () => (queue.length ? savePendingRun({ runId, batches: queue }) : clearPendingRun());
  const hasFinal = () => queue.some(b => b.final === true);

  /** One request: the parsed response, or null when it failed or timed out (the request is then aborted). */
  async function send(body) {
    const ctl = new AbortController();
    inFlight = ctl;
    let expire = 0;
    const timeout = new Promise(resolve => { expire = setTimeout(() => { ctl.abort(); resolve(null); }, REQUEST_TIMEOUT_MS); });
    try {
      return await Promise.race([api.input(runId, body, { signal: ctl.signal }).catch(() => null), timeout]);
    } finally { clearTimeout(expire); if (inFlight === ctl) inFlight = null; }
  }
  /** What a waiting timer does next: send what is unsent, or poll for the result once only that is outstanding. */
  const next = () => (queue.length ? pump() : finalStored ? poll() : undefined);
  const schedule = ms => { clearTimeout(timer); timer = setTimeout(next, ms); };
  const keepPolling = () => {
    if (stopped || !polling || !finalStored || queue.length) return;
    if (Date.now() > pollUntil) polling = false; // the alarm chain on the server finishes the job
    else schedule(POLL_EVERY_MS);
  };
  const finishWith = res => { done = true; stopped = true; clearTimeout(timer); clearPendingRun(); onResult(res); };
  const reject = error => { done = true; stopped = true; clearTimeout(timer); clearPendingRun(); onReject(error); };
  /** A refusal that only says the server already has the data is not fatal (worker/mages.ts contract). */
  const fatal = res => res.ok === false && !ALREADY_HAVE.test(String(res.error || ''));

  async function pump() {
    if (busy || stopped) return;
    clearTimeout(timer); timer = 0;
    busy = true;
    try {
      while (queue.length && !stopped) {
        const batch = queue[0];
        const res = await send(batch);
        if (stopped) return;
        if (!res || typeof res.ok !== 'boolean') {
          failures++;
          const fin = hasFinal();
          onStatus('failed', fin);
          if (!fin) schedule(Math.min(20000, 2000 * 2 ** Math.min(4, failures - 1)));
          return;
        }
        if (fatal(res)) { reject(res.error || 'Run could not be verified'); return; }
        // Stored (or already there): safe on the server, so it leaves the pending store
        failures = 0;
        if (res.ok) note(res);
        queue.shift(); save();
        onStatus('ok', false);
        if (res.ok && res.finished) { finishWith(res); return; }
        if (batch.final === true) { finalStored = true; pollUntil = Date.now() + POLL_FOR_MS; onStored(); }
        if (finalStored && res.ok) onProgress(res.verifiedTo ?? 0, res.queuedTo ?? 0);
      }
    } finally { busy = false; }
    keepPolling();
  }
  /**
   * One poll: the server runs a verification slice and answers its status. After the final chunk it reports progress
   * and repeats; during play (`midRun`) it only keeps the server's verification moving. Only `finished: true` is a
   * result, a fatal refusal ends the run, and a failed poll is simply tried again later.
   */
  async function poll(midRun = false) {
    if (busy || stopped || (!midRun && !polling)) return;
    busy = true;
    try {
      const res = await send({ poll: true });
      if (stopped) return;
      if (res && res.ok === true && res.finished) { finishWith(res); return; }
      if (res && fatal(res)) { reject(res.error || 'Run could not be verified'); return; }
      if (res && res.ok === true) { note(res); if (!midRun) onProgress(res.verifiedTo ?? 0, res.queuedTo ?? 0); }
    } finally { busy = false; }
    if (midRun) { if (queue.length) pump(); } else keepPolling();
  }

  /** Queues the actions since the last chunk with the sim's hash at this tick (hashSim's unsigned value, untouched). */
  function post(sim, log, final) {
    if (stopped || finalStored || hasFinal()) return;
    const batch = { upTo: sim.tick, actions: log.slice(logIdx), h: hashSim(sim) };
    if (final) batch.final = true;
    logIdx = log.length; lastUpTo = sim.tick; lastPostAt = Date.now();
    queue.push(batch); save();
    pump();
  }

  return {
    runId,
    /**
     * Call after every tick of the run with that tick's events. A chunk goes out at a wave end, about every
     * POST_EVERY_MS of real time while a wave runs (or a build break has new actions), after CHUNK_TICKS of sim time, or
     * before the actions outgrow a chunk; between uploads it polls while the server is behind.
     */
    afterTick(sim, log, evs) {
      const now = Date.now();
      const due = now - lastPostAt >= POST_EVERY_MS && (sim.phase === 'wave' || log.length > logIdx);
      if (due || evs.some(e => e.type === 'waveEnd') || sim.tick - lastUpTo >= CHUNK_TICKS || log.length - logIdx >= ACTIONS_SOFT_LIMIT) post(sim, log, false);
      // Between uploads, a poll while the server is behind: faster when it lags far (only while ticks run, so never
      // while paused or hidden; skipped while a request is out)
      else if (!busy && !stopped && !queue.length && !finalStored && verifiedTo < queuedTo
        && now - lastPollAt >= (queuedTo - verifiedTo > LAG_TICKS ? PLAY_POLL_FAST_MS : PLAY_POLL_EVERY_MS)) {
        lastPollAt = now;
        poll(true);
      }
    },
    /** The run is over with something to record (a won stage, Endless): posts the final chunk, then follows verification. */
    finish(sim, log) { post(sim, log, true); },
    /** Sends what is unsent again (the player's Retry), or resumes polling. */
    retry() { if (finalStored) { polling = true; pollUntil = Date.now() + POLL_FOR_MS; } return queue.length ? pump() : poll(); },
    /**
     * The player left the results screen: stop polling (the server's alarm chain finishes and records the run), but
     * keep sending anything not yet stored.
     */
    detach() { polling = false; if (!queue.length) clearTimeout(timer); },
    /** True while some chunk is not stored on the server. */
    get unsent() { return queue.length > 0 && !stopped; },
    get finalUnsent() { return !stopped && hasFinal(); },
    /** The final chunk is on the server: the result can no longer be lost, only take a moment. */
    get finalStored() { return finalStored; },
    /** The server answered for good (a result or a refusal). */
    get done() { return done; },
    /** Failed upload attempts in a row. */
    get failures() { return failures; },
    /** Stops sending and forgets the run (a quit or lost stage: nothing to record). */
    drop() { stopped = true; clearTimeout(timer); if (inFlight) inFlight.abort(); clearPendingRun(); },
    /** Stops sending but keeps what is stored (the page is going away). */
    stop() { stopped = true; clearTimeout(timer); if (inFlight) inFlight.abort(); },
  };
}

/** The stored pending run if it can still record something (it holds a final chunk, R44); any other is forgotten. */
export function takePendingRun() {
  const run = loadPendingRun();
  if (run && run.batches.length && run.batches.some(b => b && b.final === true)) return run;
  if (run) clearPendingRun();
  return null;
}
