import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { IconArrowLeft } from "../components/icons";
import { BoardPanel, useCellSize } from "../games/tetris/BoardPanel";
import { GameSession } from "../games/tetris/session";
import { TouchControls } from "../games/tetris/TouchControls";
import { submitEndless } from "../lib/api";
import { fmtClock, fmtNum } from "../lib/format";
import { sfx } from "../lib/sfx";
import { profileStore, recordEndless, settingsStore, statsStore } from "../lib/store";

type Phase = "ready" | "playing" | "over";

interface Result {
  score: number;
  lines: number;
  level: number;
  durationMs: number;
  newBest: boolean;
  rank?: number;
  submit: "pending" | "ok" | "offline";
}

export default function TetrisEndless() {
  const settings = settingsStore.use();
  const stats = statsStore.use();
  const cell = useCellSize(1, 170);
  const [phase, setPhase] = useState<Phase>("ready");
  const [startLevel, setStartLevel] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [, setTick] = useState(0);

  const [session] = useState(
    () =>
      new GameSession({
        mode: "endless",
        onTopOut: () => window.dispatchEvent(new Event("0xhub:endless-over")),
      }),
  );

  useEffect(() => {
    session.frozen = true;
    session.start();
    const iv = setInterval(() => setTick((t) => t + 1), 100);
    return () => {
      session.stop();
      clearInterval(iv);
    };
  }, [session]);

  // Game over handling
  useEffect(() => {
    const onOver = () => {
      const e = session.engine;
      sfx.gameOver();
      const prevBest = statsStore.get().bestScore;
      const r: Result = {
        score: e.score,
        lines: e.lines,
        level: e.level,
        durationMs: e.elapsedMs,
        newBest: e.score > prevBest,
        submit: "pending",
      };
      recordEndless({ score: r.score, lines: r.lines, level: r.level, durationMs: r.durationMs });
      setResult(r);
      setPhase("over");
      const p = profileStore.get();
      void submitEndless({ playerId: p.id, name: p.name, avatar: p.avatar, score: r.score, lines: r.lines, level: r.level }).then((res) =>
        setResult((cur) => (cur ? { ...cur, submit: res.ok ? "ok" : "offline", rank: res.rank } : cur)),
      );
    };
    window.addEventListener("0xhub:endless-over", onOver);
    return () => window.removeEventListener("0xhub:endless-over", onOver);
  }, [session]);

  const start = useCallback(() => {
    session.restart(startLevel);
    session.frozen = false;
    setResult(null);
    setPhase("playing");
  }, [session, startLevel]);

  // Enter / R to start or restart
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "playing" && (e.code === "Enter" || e.code === "KeyR")) start();
      else if (phase === "playing" && e.code === "KeyR" && session.paused) start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start, session]);

  const getState = useCallback(() => session.panelState(), [session]);
  const getPopups = useCallback(() => session.popups, [session]);
  const getShake = useCallback(() => session.shakeAt, [session]);

  const e = session.engine;
  const pps = e.elapsedMs > 0 ? (e.piecesPlaced / (e.elapsedMs / 1000)).toFixed(2) : "0.00";

  const side = (
    <div className="panel-box space-y-3 rounded-xl p-3 text-sm" style={{ ["--frame" as string]: "#33334f" }}>
      <Stat label="Score" value={fmtNum(e.score)} big />
      <Stat label="Best" value={fmtNum(Math.max(stats.bestScore, phase === "playing" ? e.score : 0))} />
      <Stat label="Level" value={e.level} />
      <Stat label="Lines" value={e.lines} />
      <Stat label="Time" value={fmtClock(e.elapsedMs)} />
      <Stat label="PPS" value={pps} />
    </div>
  );

  let overlay: React.ReactNode = null;
  if (phase === "ready") {
    overlay = (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <div className="text-2xl font-bold">Endless</div>
        <div className="text-xs text-zinc-300">Clear lines, level up, set a high score.</div>
        <label className="text-xs text-zinc-300">
          Start level
          <div className="mt-1 flex items-center gap-2">
            <button className="btn btn-ghost px-3 py-1" onClick={() => setStartLevel((l) => Math.max(1, l - 1))}>−</button>
            <span className="w-8 font-mono text-lg font-bold">{startLevel}</span>
            <button className="btn btn-ghost px-3 py-1" onClick={() => setStartLevel((l) => Math.min(15, l + 1))}>+</button>
          </div>
        </label>
        <button className="btn btn-primary pulse-ring" onClick={start}>Start game</button>
        <div className="text-[10px] text-zinc-400">or press Enter</div>
      </div>
    );
  } else if (phase === "over" && result) {
    overlay = (
      <div className="flex flex-col items-center gap-3 p-4 text-center animate-in">
        <div className="text-xs font-bold tracking-[0.3em] text-rose-300">GAME OVER</div>
        {result.newBest && <div className="chip border-amber-400/40 bg-amber-400/15 text-amber-200">★ New personal best</div>}
        <div className="font-mono text-4xl font-bold">{fmtNum(result.score)}</div>
        <div className="grid grid-cols-3 gap-3 text-xs text-zinc-300">
          <div><div className="font-mono text-base font-bold text-white">{result.lines}</div>lines</div>
          <div><div className="font-mono text-base font-bold text-white">{result.level}</div>level</div>
          <div><div className="font-mono text-base font-bold text-white">{fmtClock(result.durationMs)}</div>time</div>
        </div>
        <div className="text-xs text-zinc-400">
          {result.submit === "pending" && "Submitting to global leaderboard…"}
          {result.submit === "ok" && result.rank && <>Global rank (your best): <b className="text-white">#{result.rank}</b></>}
          {result.submit === "offline" && "Leaderboard unavailable — saved locally."}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={start}>Play again</button>
          <Link to="/leaderboard" className="btn btn-ghost">Leaderboard</Link>
        </div>
      </div>
    );
  } else if (session.paused) {
    overlay = (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-2xl font-bold">Paused</div>
        <button className="btn btn-primary" onClick={() => session.togglePause()}>Resume</button>
        <button className="btn btn-ghost" onClick={start}>Restart (R)</button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center">
      <div className="app-bg" />
      <header className="flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/games/tetris" className="btn btn-ghost px-3 py-2">
          <IconArrowLeft /> <span className="hidden sm:inline">Back</span>
        </Link>
        <div className="text-center">
          <div className="text-xs font-bold tracking-[0.3em] text-violet-300">TETRIS</div>
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
