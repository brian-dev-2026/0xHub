import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { IconArrowLeft } from "../components/icons";
import { BoardPanel, useCellSize } from "../games/tetris/BoardPanel";
import { GameSession } from "../games/tetris/session";
import { TouchControls } from "../games/tetris/TouchControls";
import { ApiError, authStore, refreshMe, sendRunChunk, startEndlessRun, useMe, type RunChunkResult } from "../lib/auth";
import { fmtClock, fmtNum } from "../lib/format";
import { sfx } from "../lib/sfx";
import { settingsStore } from "../lib/store";
import { STEP_MS } from "../../shared/tetris/engine";
import { GAME_NAME } from "../games/registry";
import { Check, Star } from "../components/marks";

type Phase = "ready" | "starting" | "playing" | "over";

interface Result {
  score: number;
  lines: number;
  level: number;
  durationMs: number;
  newBest: boolean;
  verify: "pending" | "ok" | "failed";
  rank?: number;
  error?: string;
}

const UPLOAD_EVERY_MS = 5000;

/**
 * Streams a run's inputs to the server in chunks so the server can verify it
 * as it goes. Failed uploads are retried with the next chunk (inputs are
 * merged, never dropped).
 */
class RunUploader {
  private pending: { upTo: number; ev: number[]; h: number } | null = null;
  private inFlight = false;
  failed = "";

  constructor(
    readonly runId: string,
    private session: GameSession,
  ) {}

  private take() {
    const b = this.session.flush();
    if (!this.pending) this.pending = { upTo: b.upTo, ev: b.ev, h: b.h };
    else {
      this.pending.ev.push(...b.ev);
      this.pending.upTo = b.upTo;
      this.pending.h = b.h;
    }
  }

  async tick() {
    if (this.inFlight || this.failed) return;
    this.take();
    const batch = this.pending!;
    this.inFlight = true;
    try {
      const res = await sendRunChunk(this.runId, batch);
      if (res.ok) this.pending = null;
      else this.failed = res.error ?? "Run failed verification";
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) this.failed = e.message;
      // network/server error: keep `pending` and retry on the next tick
    } finally {
      this.inFlight = false;
    }
  }

  /** Upload everything left and get the verified result. */
  async finish(): Promise<RunChunkResult> {
    for (let i = 0; i < 20 && this.inFlight; i++) await new Promise((r) => setTimeout(r, 100));
    if (this.failed) return { ok: false, error: this.failed };
    this.take();
    const batch = this.pending!;
    let lastErr = "Couldn't reach the server";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await sendRunChunk(this.runId, { ...batch, final: true });
        if (res.ok) this.pending = null;
        return res;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : lastErr;
        if (e instanceof ApiError && e.status < 500) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    return { ok: false, error: lastErr };
  }
}

export default function TetrisEndless() {
  const settings = settingsStore.use();
  const stats = useMe().stats;
  const cell = useCellSize(1, 170);
  const [phase, setPhase] = useState<Phase>("ready");
  const [startLevel, setStartLevel] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [startError, setStartError] = useState("");
  const [, setTick] = useState(0);
  const uploader = useRef<RunUploader | null>(null);

  const [session] = useState(
    () => new GameSession({ mode: "endless", onGameOver: () => window.dispatchEvent(new Event("0xhub:endless-over")) }),
  );

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __session: GameSession }).__session = session;
    session.start();
    const iv = setInterval(() => setTick((t) => t + 1), 100);
    const up = setInterval(() => {
      if (session.running && !session.paused) void uploader.current?.tick();
    }, UPLOAD_EVERY_MS);
    return () => {
      session.stop();
      clearInterval(iv);
      clearInterval(up);
    };
  }, [session]);

  // Game over: show the local result immediately, then the server-verified one.
  useEffect(() => {
    const onOver = () => {
      const e = session.sim.engine;
      sfx.gameOver();
      const prevBest = authStore.get().me?.stats.bestScore ?? 0;
      setResult({
        score: e.score,
        lines: e.lines,
        level: e.level,
        durationMs: session.sim.steps * STEP_MS,
        newBest: e.score > prevBest,
        verify: "pending",
      });
      setPhase("over");
      const up = uploader.current;
      if (!up) return;
      void up.finish().then((res) => {
        setResult((cur) =>
          cur
            ? res.ok && res.finished
              ? { ...cur, score: res.score ?? cur.score, lines: res.lines ?? cur.lines, level: res.level ?? cur.level, verify: "ok", rank: res.rank }
              : { ...cur, verify: "failed", error: res.error }
            : cur,
        );
        void refreshMe();
      });
    };
    window.addEventListener("0xhub:endless-over", onOver);
    return () => window.removeEventListener("0xhub:endless-over", onOver);
  }, [session]);

  const start = useCallback(async () => {
    if (phase === "starting") return;
    setStartError("");
    setPhase("starting");
    session.running = false;
    try {
      const { runId, seed } = await startEndlessRun(startLevel);
      session.newGame(seed, startLevel);
      uploader.current = new RunUploader(runId, session);
      session.running = true;
      setResult(null);
      setPhase("playing");
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Couldn't start a run.");
      setPhase(result ? "over" : "ready");
    }
  }, [phase, session, startLevel, result]);

  // Enter / R to start or restart
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((phase === "ready" || phase === "over") && (e.code === "Enter" || e.code === "KeyR")) void start();
      else if (phase === "playing" && e.code === "KeyR" && session.paused) void start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start, session]);

  const getState = useCallback(() => session.panelState(), [session]);
  const getPopups = useCallback(() => session.popups, [session]);
  const getShake = useCallback(() => session.shakeAt, [session]);

  const e = session.sim.engine;
  const elapsed = session.sim.steps * STEP_MS;
  const pps = elapsed > 0 ? (e.piecesPlaced / (elapsed / 1000)).toFixed(2) : "0.00";

  const side = (
    <div className="panel-box space-y-3 rounded-xl p-3 text-sm" style={{ ["--frame" as string]: "#33334f" }}>
      <Stat label="Score" value={fmtNum(e.score)} big />
      <Stat label="Best" value={fmtNum(Math.max(stats.bestScore, phase === "playing" ? e.score : 0))} />
      <Stat label="Level" value={e.level} />
      <Stat label="Lines" value={e.lines} />
      <Stat label="Time" value={fmtClock(elapsed)} />
      <Stat label="PPS" value={pps} />
    </div>
  );

  let overlay: React.ReactNode = null;
  if (phase === "ready" || phase === "starting") {
    overlay = (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <div className="text-2xl font-bold">Endless</div>
        <div className="text-xs text-zinc-300">Clear lines, level up, set a high score.</div>
        <div className="text-xs text-zinc-300">
          Start level
          <div className="mt-1 flex items-center gap-2">
            <button className="btn btn-ghost px-3 py-1" aria-label="Lower start level" onClick={() => setStartLevel((l) => Math.max(1, l - 1))}>−</button>
            <span className="w-8 font-mono text-lg font-bold">{startLevel}</span>
            <button className="btn btn-ghost px-3 py-1" aria-label="Raise start level" onClick={() => setStartLevel((l) => Math.min(15, l + 1))}>+</button>
          </div>
        </div>
        <button className="btn btn-primary pulse-ring" onClick={() => void start()} disabled={phase === "starting"}>
          {phase === "starting" ? "Starting…" : "Start game"}
        </button>
        {startError ? <div className="text-xs text-rose-300">{startError}</div> : <div className="text-[10px] text-zinc-400">or press Enter</div>}
      </div>
    );
  } else if (phase === "over" && result) {
    overlay = (
      <div className="flex flex-col items-center gap-3 p-4 text-center animate-in">
        <div className="text-xs font-bold tracking-[0.3em] text-rose-300">GAME OVER</div>
        {result.newBest && result.verify !== "failed" && <div className="chip border-amber-400/40 bg-amber-400/15 text-amber-200"><Star /> New personal best</div>}
        <div className="font-mono text-4xl font-bold">{fmtNum(result.score)}</div>
        <div className="grid grid-cols-3 gap-3 text-xs text-zinc-300">
          <div><div className="font-mono text-base font-bold text-white">{result.lines}</div>lines</div>
          <div><div className="font-mono text-base font-bold text-white">{result.level}</div>level</div>
          <div><div className="font-mono text-base font-bold text-white">{fmtClock(result.durationMs)}</div>time</div>
        </div>
        <div className="text-xs text-zinc-400" aria-live="polite">
          {result.verify === "pending" && "Verifying your run…"}
          {result.verify === "ok" && <><Check className="text-emerald-300" />Verified · global rank (your best) <b className="text-white">#{result.rank}</b></>}
          {result.verify === "failed" && <span className="text-rose-300">This run couldn't be verified{result.error ? `: ${result.error}` : ""}. It wasn't saved.</span>}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => void start()}>Play again</button>
          <Link to="/leaderboard" className="btn btn-ghost">Leaderboard</Link>
        </div>
        {startError && <div className="text-xs text-rose-300">{startError}</div>}
      </div>
    );
  } else if (session.paused) {
    overlay = (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-2xl font-bold">Paused</div>
        <button className="btn btn-primary" onClick={() => session.togglePause()}>Resume</button>
        <button className="btn btn-ghost" onClick={() => void start()}>Restart (R)</button>
        <div className="max-w-[12rem] text-[10px] text-zinc-400">Restarting abandons this run — it won't be saved.</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center">
      <div className="app-bg" />
      <header className="flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/games/tetris" className="btn btn-ghost px-3 py-2">
          <IconArrowLeft /> <span className="hidden sm:inline">Back</span>
        </Link>
        <div className="text-center">
          <div className="text-xs font-bold tracking-[0.3em] text-violet-300">{GAME_NAME.toUpperCase()}</div>
          <div className="text-lg font-bold">Endless</div>
        </div>
        <button className="btn btn-ghost px-3 py-2" onClick={() => session.togglePause()} disabled={phase !== "playing"}>
          {session.paused ? "Resume" : "Pause"}
        </button>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center pb-6">
        <BoardPanel
          getState={getState}
          getPopups={getPopups}
          getShakeAt={getShake}
          skinId={settings.skin}
          themeId={settings.theme}
          ghost={settings.ghost}
          cell={cell}
          side={side}
          overlay={overlay}
        />
        <TouchControls input={session.input} />
        <ControlsHint />
      </div>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: React.ReactNode; big?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">{label}</div>
      <div className={`font-mono font-bold tabular-nums ${big ? "text-lg" : "text-sm"}`}>{value}</div>
    </div>
  );
}

export function ControlsHint() {
  return (
    <div className="mt-4 hidden flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 pointer-fine:flex">
      <span><kbd>← →</kbd> move</span>
      <span><kbd>↓</kbd> soft drop</span>
      <span><kbd>Space</kbd> hard drop</span>
      <span><kbd>↑ / X</kbd> rotate</span>
      <span><kbd>Z</kbd> rotate left</span>
      <span><kbd>C / Shift</kbd> hold</span>
      <span><kbd>Esc</kbd> pause</span>
      <Link to="/settings" className="text-violet-300 hover:underline">Remap keys</Link>
    </div>
  );
}
