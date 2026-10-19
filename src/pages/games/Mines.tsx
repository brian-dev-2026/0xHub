import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DIFFICULTIES, isDifficulty, type Difficulty } from "../../../shared/games/mines";
import { ErrorPanel, GameShell } from "../../components/GameShell";
import { GameLogo } from "../../components/GameLogo";
import { Check } from "../../components/marks";
import { Card, SectionTitle } from "../../components/ui";
import { settingsStore } from "../../lib/store";
import { getMinesTheme } from "../../games/looks";
import { minesCellClass, minesVars } from "../../games/lookStyles";
import { ApiError, refreshMe, useMe } from "../../lib/auth";
import { sfx } from "../../lib/sfx";
import { MinesLook, CustomizeSection } from "../../games/LookPickers";

export const fmtTime = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)}s`);

async function post<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export default function MinesPage() {
  const { difficulty } = useParams();
  if (difficulty) return isDifficulty(difficulty) ? <Play key={difficulty} difficulty={difficulty} /> : <Bad />;
  return <Home />;
}

function Bad() {
  const navigate = useNavigate();
  return <GameShell title="Minesweeper" kicker="Rush" back="/games/mines"><ErrorPanel message="Unknown difficulty." onBack={() => navigate("/games/mines")} /></GameShell>;
}

function Home() {
  const s = useMe().games.mines;
  return (
    <GameShell title="Minesweeper Rush" kicker="0xHub" back="/games">
      <div className="mx-auto w-full max-w-3xl space-y-6 animate-in">
        <div className="flex items-center gap-4">
          <GameLogo game="mines" size={56} />
          <div>
            <h1 className="text-3xl font-bold">Minesweeper Rush</h1>
            <p className="text-zinc-400">Clear the field as fast as you can. Your first click is always safe.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => {
            const info = DIFFICULTIES[d];
            return (
              <Link key={d} to={`/games/mines/${d}`} className="glass glass-hover rounded-2xl p-5">
                <div className="text-lg font-bold">{info.label}</div>
                <div className="mt-1 text-sm text-zinc-400">{info.w}×{info.h} · {info.mines} mines</div>
                <div className="mt-4 text-xs text-zinc-500">Your best</div>
                <div className="font-mono text-xl font-bold">{fmtTime(s[d])}</div>
              </Link>
            );
          })}
        </div>
        <Card>
          <SectionTitle>How it works</SectionTitle>
          <ul className="space-y-1.5 text-sm text-zinc-400">
            <li>Click (or tap) to reveal. Right-click or long-press to flag — or switch on flag mode.</li>
            <li>Click a number whose mines are all flagged to open its neighbours (chording).</li>
            <li>The mine layout stays on the server, and the server times your run from first click to clear.</li>
          </ul>
        </Card>
        <CustomizeSection>
          <MinesLook />
        </CustomizeSection>
      </div>
    </GameShell>
  );
}

function Play({ difficulty }: { difficulty: Difficulty }) {
  const theme = getMinesTheme(settingsStore.use().minesTheme);
  const info = DIFFICULTIES[difficulty];
  const { w, h, mines } = info;
  const [runId, setRunId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Map<number, number>>(new Map());
  const [flags, setFlags] = useState<Set<number>>(new Set());
  const [lost, setLost] = useState<{ mines: number[]; hit: number } | null>(null);
  const [won, setWon] = useState<{ timeMs: number; best: number; rank: number } | null>(null);
  const [startError, setStartError] = useState("");
  const [flagMode, setFlagMode] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);
  const queue = useRef(Promise.resolve());
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const flagsRef = useRef(flags);
  flagsRef.current = flags;

  const start = useCallback(async () => {
    setStartError("");
    setRevealed(new Map());
    setFlags(new Set());
    setLost(null);
    setWon(null);
    setStartedAt(0);
    try {
      const r = await post<{ runId: string }>("/api/runs/mines/start", { difficulty });
      setRunId(r.runId);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Couldn't start.");
    }
  }, [difficulty]);
  useEffect(() => void start(), [start]);

  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(iv);
  }, []);

  const over = !!lost || !!won;
  const act = (type: "reveal" | "chord", cell: number) => {
    if (!runId || over) return;
    if (!startedAt) setStartedAt(performance.now());
    const id = runId;
    // Actions are sent strictly in order.
    queue.current = queue.current.then(async () => {
      try {
        const res = await post<{ cells?: [number, number][]; lost?: { mines: number[]; hit: number }; won?: { timeMs: number; best: number; rank: number } }>(
          `/api/runs/mines/${id}/action`,
          { type, cell, flags: type === "chord" ? [...flagsRef.current] : undefined },
        );
        if (res.cells?.length) {
          setRevealed((cur) => {
            const next = new Map(cur);
            for (const [c, n] of res.cells!) next.set(c, n);
            return next;
          });
          sfx.move();
        }
        if (res.lost) {
          setLost(res.lost);
          sfx.gameOver();
        }
        if (res.won) {
          setWon(res.won);
          sfx.win();
          void refreshMe();
        }
      } catch {
        /* run ended or network error: ignore this click */
      }
    });
  };

  const toggleFlag = (i: number) => {
    if (over || revealed.has(i)) return;
    setFlags((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    sfx.rotate();
  };

  const onCell = (i: number) => {
    if (longPressed.current) return;
    if (revealed.has(i)) {
      if ((revealed.get(i) ?? 0) > 0) act("chord", i);
      return;
    }
    if (flagMode) return toggleFlag(i);
    if (!flags.has(i)) act("reveal", i);
  };

  const elapsed = won ? won.timeMs : startedAt ? performance.now() - startedAt : 0;
  const cell = Math.max(18, Math.min(32, Math.floor((Math.min(window.innerWidth, 1100) - 48) / w)));
  const mineSet = new Set(lost?.mines ?? []);

  return (
    <GameShell title={info.label} kicker="Minesweeper Rush" back="/games/mines" right={<button className="btn btn-ghost px-3 py-2 text-xs" onClick={() => void start()}>New</button>}>
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4">
        <div className="glass flex items-center gap-6 rounded-2xl px-5 py-2.5">
          <div className="text-center">
            <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">Mines</div>
            <div className="font-mono text-xl font-bold">{mines - flags.size}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">Time</div>
            <div className="font-mono text-xl font-bold tabular-nums">{(elapsed / 1000).toFixed(1)}</div>
          </div>
          <button
            className={`btn px-3 py-1.5 text-xs ${flagMode ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFlagMode((f) => !f)}
            aria-pressed={flagMode}
          >
            <span className="mines-flag inline-block" aria-hidden /> Flag mode
          </button>
        </div>

        {startError && <div className="text-rose-300">{startError}</div>}

        <div className="max-w-full overflow-auto rounded-xl p-1">
          <div
            className="relative grid select-none gap-px rounded-lg p-px"
            style={{ gridTemplateColumns: `repeat(${w}, ${cell}px)`, ...minesVars(theme) }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {Array.from({ length: w * h }, (_, i) => {
              const n = revealed.get(i);
              const isOpen = n !== undefined;
              const isMine = mineSet.has(i);
              const flagged = flags.has(i);
              return (
                <button
                  key={i}
                  aria-label={`Cell ${(i % w) + 1}, ${Math.floor(i / w) + 1}${isOpen ? (n ? `, ${n}` : ", empty") : flagged ? ", flagged" : ""}`}
                  className={minesCellClass(theme, isOpen, lost?.hit === i)}
                  style={{ width: cell, height: cell, fontSize: cell * 0.55, color: n ? theme.numbers[n - 1] : undefined, borderRadius: theme.radius }}
                  onClick={() => onCell(i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleFlag(i);
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType !== "touch") return;
                    longPressed.current = false;
                    pressTimer.current = setTimeout(() => {
                      longPressed.current = true;
                      toggleFlag(i);
                    }, 380);
                  }}
                  onPointerUp={() => clearTimeout(pressTimer.current)}
                  onPointerLeave={() => clearTimeout(pressTimer.current)}
                >
                  {isOpen && n ? n : null}
                  {!isOpen && flagged && !(lost && isMine) && <span className={`mines-flag ${lost ? "opacity-50" : ""}`} aria-hidden />}
                  {!isOpen && isMine && <span className="mines-mine" aria-hidden />}
                </button>
              );
            })}
            {over && (
              <div className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[1px]">
                <div className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center animate-in">
                  {won ? (
                    <>
                      <div className="text-xs font-bold tracking-[0.3em] text-emerald-300">CLEARED</div>
                      <div className="font-mono text-4xl font-bold">{fmtTime(won.timeMs)}</div>
                      <div className="text-xs text-zinc-400"><Check className="text-emerald-300" />Server-timed · best {fmtTime(won.best)} · rank <b className="text-white">#{won.rank}</b></div>
                    </>
                  ) : (
                    <div className="text-2xl font-black text-rose-400">BOOM</div>
                  )}
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={() => void start()}>Play again</button>
                    <Link className="btn btn-ghost" to="/leaderboard?game=mines">Leaderboard</Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="text-xs text-zinc-500">Right-click or long-press to flag · click a number to chord</div>
      </div>
    </GameShell>
  );
}

