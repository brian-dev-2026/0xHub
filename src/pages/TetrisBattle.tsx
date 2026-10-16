import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  isValidRoomCode,
  randomRoomCode,
  type BoardSnapshot,
  type PlayerInfo,
  type ServerMsg,
} from "../../shared/protocol";
import { Avatar } from "../components/Layout";
import { IconArrowLeft, IconBolt, IconCopy, IconSwords } from "../components/icons";
import { BoardPanel, useCellSize } from "../games/tetris/BoardPanel";
import { BUFFER_ROWS, COLS, VISIBLE_ROWS, decodeCell, type PieceType } from "../games/tetris/engine";
import { GameSocket } from "../games/tetris/net";
import { GameSession, type PanelState } from "../games/tetris/session";
import { TouchControls } from "../games/tetris/TouchControls";
import { fmtClock } from "../lib/format";
import { sfx } from "../lib/sfx";
import { profileStore, recordBattle, settingsStore } from "../lib/store";
import { ControlsHint } from "./TetrisEndless";

type Phase = "lobby" | "searching" | "waiting" | "countdown" | "playing" | "ended" | "error";

interface EndInfo {
  result: "win" | "lose" | "draw";
  reason: "time" | "forfeit";
  you: { kos: number; linesSent: number };
  opponent: { kos: number; linesSent: number };
  ratingDelta?: number;
}

const KO_FREEZE_MS = 1000;

function decodeSnapshot(s: BoardSnapshot): PanelState {
  const cells: number[][] = [];
  for (let y = 0; y < VISIBLE_ROWS; y++) {
    const row: number[] = [];
    for (let x = 0; x < COLS; x++) row.push(decodeCell(s.cells[y * COLS + x] ?? "."));
    cells.push(row);
  }
  return {
    view: {
      cells,
      active: s.active ? { ...s.active, type: s.active.type as PieceType } : null,
      ghostY: null,
      danger: cells.slice(0, 4).some((r) => r.some((c) => c !== 0)),
    },
    hold: (s.hold as PieceType) ?? null,
    holdUsed: false,
    next: s.next as PieceType[],
    incoming: s.incoming,
  };
}

export default function TetrisBattle() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const settings = settingsStore.use();
  const profile = profileStore.use();
  const cell = useCellSize(0.92, 230);
  const oppCell = Math.max(10, Math.round(cell * 0.62));

  const [phase, setPhase] = useState<Phase>(codeParam ? "waiting" : "lobby");
  const [error, setError] = useState("");
  const [opponent, setOpponent] = useState<PlayerInfo | null>(null);
  const [kos, setKos] = useState({ you: 0, opponent: 0 });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState(0);
  const [end, setEnd] = useState<EndInfo | null>(null);
  const [rematch, setRematch] = useState<"none" | "sent" | "received">("none");
  const [koFlash, setKoFlash] = useState<"you" | "opponent" | null>(null);
  const [oppAttack, setOppAttack] = useState<{ text: string; id: number } | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);

  const sockRef = useRef<GameSocket | null>(null);
  const oppState = useRef<PanelState | null>(null);
  const oppSent = useRef(0);
  const matchStart = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [session] = useState(
    () =>
      new GameSession({
        mode: "battle",
        onClear: (e) => {
          if (e.sent > 0) sockRef.current?.send({ t: "attack", lines: e.sent, label: e.label || `${e.combo} COMBO` });
        },
        onTopOut: () => {
          if (phaseRef.current !== "playing") return;
          sockRef.current?.send({ t: "ko" });
        },
        onSnapshot: () => sendSnapshot(),
      }),
  );

  function sendSnapshot() {
    const e = session.engine;
    const a = e.active;
    sockRef.current?.send({
      t: "state",
      s: {
        cells: e.encodeVisible(),
        active: a ? { type: a.type, x: a.x, y: a.y - BUFFER_ROWS, rot: a.rot } : null,
        hold: e.hold,
        next: e.next.slice(0, 3),
        incoming: e.incomingTotal,
        linesSent: e.linesSent,
        lines: e.lines,
        combo: Math.max(0, e.combo),
      },
    });
  }

  // Main loop lifecycle
  useEffect(() => {
    session.frozen = true;
    session.start();
    const iv = setInterval(() => setTick((t) => t + 1), 200);
    return () => {
      session.stop();
      clearInterval(iv);
    };
  }, [session]);

  const handleMessage = useCallback(
    (msg: ServerMsg) => {
      switch (msg.t) {
        case "opponent":
          setOpponent(msg.player);
          break;
        case "countdown": {
          session.restart();
          session.frozen = true;
          oppState.current = null;
          oppSent.current = 0;
          setKos({ you: 0, opponent: 0 });
          setEnd(null);
          setRematch("none");
          setPhase("countdown");
          const startAt = performance.now() + msg.in;
          matchStart.current = Date.now() + msg.in;
          setEndsAt(Date.now() + msg.in + msg.duration);
          const steps = Math.ceil(msg.in / 1000);
          for (let i = 0; i < steps; i++) {
            setTimeout(() => {
              setCountdown(steps - i);
              sfx.countdown(false);
            }, i * 1000);
          }
          setTimeout(() => {
            setCountdown(0);
            sfx.countdown(true);
            session.frozen = false;
            setPhase("playing");
            setTimeout(() => setCountdown(null), 700);
          }, Math.max(0, startAt - performance.now()));
          break;
        }
        case "opState":
          oppState.current = decodeSnapshot(msg.s);
          oppSent.current = msg.s.linesSent;
          break;
        case "garbage":
          session.engine.receiveGarbage(msg.lines);
          if (msg.label) setOppAttack({ text: `${msg.label} → ${msg.lines}`, id: Date.now() });
          break;
        case "ko":
          setKos({ you: msg.you, opponent: msg.opponent });
          setKoFlash(msg.victim);
          sfx.ko();
          if (msg.victim === "you") {
            session.frozen = true;
            setTimeout(() => {
              session.resetField();
              if (phaseRef.current === "playing") session.frozen = false;
              setKoFlash(null);
            }, KO_FREEZE_MS);
          } else {
            setTimeout(() => setKoFlash(null), KO_FREEZE_MS);
          }
          break;
        case "end": {
          session.frozen = true;
          setEnd(msg);
          setPhase("ended");
          setCountdown(null);
          if (msg.result === "win") sfx.win();
          else sfx.gameOver();
          recordBattle({
            result: msg.result,
            opponent: opponentRef.current?.name ?? "Unknown",
            kos: msg.you.kos,
            linesSent: msg.you.linesSent,
            lines: session.engine.lines,
            durationMs: Math.max(0, Date.now() - matchStart.current),
          });
          break;
        }
        case "rematchRequested":
          setRematch("received");
          break;
        case "opponentLeft":
          setOpponent(null);
          oppState.current = null;
          if (phaseRef.current !== "ended") setPhase("waiting");
          setRematch("none");
          break;
        case "error":
          setError(msg.message);
          setPhase("error");
          break;
      }
    },
    [session],
  );

  const opponentRef = useRef<PlayerInfo | null>(null);
  opponentRef.current = opponent;

  // Connect to a room whenever the URL has a code.
  useEffect(() => {
    if (!codeParam) return;
    const code = codeParam.toUpperCase();
    if (!isValidRoomCode(code)) {
      setError("That room code isn't valid.");
      setPhase("error");
      return;
    }
    setPhase("waiting");
    setOpponent(null);
    const p = profileStore.get();
    const s = settingsStore.get();
    const sock = new GameSocket(
      `/api/ws/room/${code}`,
      handleMessage,
      (unexpected) => {
        if (unexpected && phaseRef.current !== "error") {
          setError("Connection to the game server was lost.");
          setPhase("error");
        }
      },
      () => sock.send({ t: "hello", player: { id: p.id, name: p.name, avatar: p.avatar, color: p.color, skin: s.skin } }),
    );
    sockRef.current = sock;
    return () => {
      sock.close();
      sockRef.current = null;
      session.frozen = true;
    };
  }, [codeParam, handleMessage, session]);

  // Quick match
  const mmRef = useRef<GameSocket | null>(null);
  const quickMatch = () => {
    setPhase("searching");
    let matched = false;
    mmRef.current = new GameSocket(
      "/api/ws/matchmake",
      (msg) => {
        if (msg.t === "matched") {
          matched = true;
          mmRef.current?.close();
          navigate(`/games/tetris/battle/${msg.room}`, { replace: true });
        }
      },
      (unexpected) => {
        if (unexpected && !matched) {
          setError("Couldn't reach the matchmaking server.");
          setPhase("error");
        }
      },
    );
  };
  const cancelSearch = () => {
    mmRef.current?.close();
    mmRef.current = null;
    setPhase("lobby");
  };
  useEffect(() => () => mmRef.current?.close(), []);

  const createRoom = () => navigate(`/games/tetris/battle/${randomRoomCode()}`);
  const joinRoom = () => {
    const c = joinCode.trim().toUpperCase();
    if (isValidRoomCode(c)) navigate(`/games/tetris/battle/${c}`);
  };

  const leave = () => {
    sockRef.current?.close();
    navigate("/games/tetris/battle");
    setPhase("lobby");
    setOpponent(null);
    setEnd(null);
  };

  const shareUrl = codeParam ? `${location.origin}/games/tetris/battle/${codeParam.toUpperCase()}` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const getMine = useCallback(() => session.panelState(), [session]);
  const getOpp = useCallback(() => oppState.current, []);
  const getPopups = useCallback(() => session.popups, [session]);
  const getShake = useCallback(() => session.shakeAt, [session]);

  // ---------- Lobby / pre-match screens ----------

  if (phase === "lobby" || phase === "searching" || phase === "error" || (phase === "waiting" && !opponent)) {
    return (
      <Shell onBack={codeParam ? leave : undefined}>
        <div className="mx-auto w-full max-w-3xl animate-in">
          {phase === "lobby" && (
            <>
              <div className="mb-8 text-center">
                <div className="chip mx-auto mb-3"><IconSwords width={14} height={14} /> 1v1 Battle</div>
                <h1 className="text-3xl font-bold sm:text-4xl">Battle 2P</h1>
                <p className="mt-2 text-zinc-400">2-minute rounds. Send garbage, KO your rival, most KOs wins.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <button onClick={quickMatch} className="glass glass-hover group rounded-2xl p-6 text-left">
                  <div className="mb-4 grid size-12 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-white">
                    <IconBolt />
                  </div>
                  <div className="text-lg font-bold">Quick match</div>
                  <div className="mt-1 text-sm text-zinc-400">Get paired with the next player looking for a game.</div>
                </button>
                <div className="glass rounded-2xl p-6">
                  <div className="text-lg font-bold">Play a friend</div>
                  <div className="mt-1 mb-4 text-sm text-zinc-400">Create a private room and share the link, or enter a code.</div>
                  <button onClick={createRoom} className="btn btn-primary w-full">Create private room</button>
                  <div className="mt-3 flex gap-2">
                    <input
                      className="input font-mono tracking-[0.3em] uppercase"
                      placeholder="CODE"
                      maxLength={5}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                    />
                    <button onClick={joinRoom} className="btn btn-ghost" disabled={!isValidRoomCode(joinCode)}>Join</button>
                  </div>
                </div>
              </div>
              <Rules />
            </>
          )}

          {phase === "searching" && (
            <div className="flex flex-col items-center gap-6 py-16 text-center">
              <div className="pulse-ring grid size-24 place-items-center rounded-full bg-violet-500/20 text-4xl">⚔️</div>
              <div>
                <div className="text-2xl font-bold">Finding an opponent…</div>
                <div className="mt-1 text-sm text-zinc-400">Tip: open this page in a second tab to test against yourself.</div>
              </div>
              <button className="btn btn-ghost" onClick={cancelSearch}>Cancel</button>
            </div>
          )}

          {phase === "waiting" && !opponent && (
            <div className="flex flex-col items-center gap-6 py-12 text-center">
              <div className="text-sm text-zinc-400">Room code</div>
              <div className="font-mono text-5xl font-bold tracking-[0.35em] text-gradient">{codeParam?.toUpperCase()}</div>
              <div className="flex w-full max-w-md gap-2">
                <input readOnly className="input text-xs" value={shareUrl} onFocus={(e) => e.target.select()} />
                <button className="btn btn-primary" onClick={copyLink}>
                  <IconCopy width={16} height={16} /> {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex items-center gap-3 text-zinc-400">
                <span className="inline-block size-2 animate-pulse rounded-full bg-cyan-400" /> Waiting for opponent to join…
              </div>
              <button className="btn btn-ghost" onClick={leave}>Leave room</button>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="text-4xl">⚠️</div>
              <div className="text-xl font-bold">{error || "Something went wrong."}</div>
              <button className="btn btn-primary" onClick={leave}>Back to lobby</button>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ---------- Match screen ----------

  const now = Date.now();
  const remaining = phase === "playing" ? endsAt - now : phase === "countdown" ? endsAt - matchStart.current : 0;
  const e = session.engine;

  const mySide = (
    <div className="panel-box space-y-2.5 rounded-xl p-3" style={{ ["--frame" as string]: "#33334f" }}>
      <BStat label="KOs" value={kos.you} accent="text-amber-300" />
      <BStat label="Sent" value={e.linesSent} accent="text-rose-300" />
      <BStat label="Lines" value={e.lines} />
      <BStat label="Combo" value={Math.max(0, e.combo)} />
    </div>
  );
  const opp = oppState.current;

  let myOverlay: React.ReactNode = null;
  if (countdown !== null && phase !== "ended") {
    myOverlay = (
      <div key={countdown} className="countdown text-7xl font-bold text-white drop-shadow-[0_0_20px_rgba(139,92,246,0.8)]">
        {countdown === 0 ? "GO!" : countdown}
      </div>
    );
  } else if (koFlash === "you") {
    myOverlay = <div className="countdown text-6xl font-black text-rose-400">K.O.</div>;
  } else if (phase === "ended" && end) {
    myOverlay = (
      <ResultCard
        end={end}
        rematch={rematch}
        opponentPresent={!!opponent}
        onRematch={() => {
          sockRef.current?.send({ t: "rematch" });
          setRematch("sent");
        }}
        onLeave={leave}
      />
    );
  }

  return (
    <Shell onBack={leave} compact>
      {/* Scoreboard */}
      <div className="glass mx-auto mb-4 flex w-full max-w-4xl items-center justify-between gap-2 rounded-2xl px-3 py-2.5 sm:px-5">
        <PlayerTag p={{ name: profile.name, avatar: profile.avatar, color: profile.color }} kos={kos.you} />
        <div className="text-center">
          <div className={`font-mono text-2xl font-bold tabular-nums sm:text-3xl ${remaining < 15000 && phase === "playing" ? "text-rose-400" : ""}`}>
            {fmtClock(remaining)}
          </div>
          <div className="text-[10px] tracking-[0.2em] text-zinc-500 uppercase">{sockRef.current ? `${sockRef.current.latency}ms` : ""}</div>
        </div>
        <PlayerTag p={opponent ?? { name: "—", avatar: "❔", color: "#555" }} kos={kos.opponent} right />
      </div>

      <div className="flex flex-wrap items-start justify-center gap-4 lg:gap-8">
        <div className="flex flex-col items-center">
          <BoardPanel
            getState={getMine}
            getPopups={getPopups}
            getShakeAt={getShake}
            skinId={settings.skin}
            themeId={settings.theme}
            ghost={settings.ghost}
            cell={cell}
            side={mySide}
            overlay={myOverlay}
          />
          <TouchControls input={session.input} />
        </div>

        <div className="relative flex flex-col items-center">
          <BoardPanel
            getState={getOpp}
            skinId={opponent?.skin ?? settings.skin}
            themeId={settings.theme}
            cell={oppCell}
            nextCount={3}
            header={<div className="text-xs font-semibold text-zinc-400">{opponent?.name ?? "Opponent"}'s board</div>}
            side={
              <div className="panel-box space-y-1.5 rounded-xl p-2" style={{ ["--frame" as string]: "#33334f" }}>
                <BStat label="KOs" value={kos.opponent} accent="text-amber-300" small />
                <BStat label="Sent" value={oppSent.current} accent="text-rose-300" small />
              </div>
            }
            overlay={
              koFlash === "opponent" ? (
                <div className="countdown text-4xl font-black text-amber-300">K.O.!</div>
              ) : !opp && phase !== "ended" ? (
                <div className="text-xs text-zinc-400">Waiting…</div>
              ) : null
            }
          />
          {oppAttack && (
            <div key={oppAttack.id} className="popup popup-garbage absolute top-1/2 left-1/2 -translate-x-1/2">
              {oppAttack.text}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-center">
        <ControlsHint />
      </div>
    </Shell>
  );
}

function Shell({ children, onBack, compact }: { children: React.ReactNode; onBack?: () => void; compact?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="app-bg" />
      <header className={`flex items-center justify-between px-4 ${compact ? "py-3" : "py-4"}`}>
        {onBack ? (
          <button onClick={onBack} className="btn btn-ghost px-3 py-2">
            <IconArrowLeft /> <span className="hidden sm:inline">Leave</span>
          </button>
        ) : (
          <Link to="/games/tetris" className="btn btn-ghost px-3 py-2">
            <IconArrowLeft /> <span className="hidden sm:inline">Back</span>
          </Link>
        )}
        <div className="text-center">
          <div className="text-xs font-bold tracking-[0.3em] text-violet-300">TETRIS</div>
          <div className="text-lg font-bold">Battle 2P</div>
        </div>
        <div className="w-[76px]" />
      </header>
      <div className="flex flex-1 flex-col px-3 pb-6">{children}</div>
    </div>
  );
}

function PlayerTag({ p, kos, right }: { p: { name: string; avatar: string; color: string }; kos: number; right?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${right ? "flex-row-reverse text-right" : ""}`}>
      <Avatar emoji={p.avatar} color={p.color} size={38} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{p.name}</div>
        <div className="flex items-center gap-1 text-xs text-amber-300" style={{ justifyContent: right ? "flex-end" : "flex-start" }}>
          {Array.from({ length: Math.min(kos, 8) }).map((_, i) => (
            <span key={i}>★</span>
          ))}
          <span className="font-mono font-bold">{kos} KO</span>
        </div>
      </div>
    </div>
  );
}

function BStat({ label, value, accent = "", small }: { label: string; value: React.ReactNode; accent?: string; small?: boolean }) {
  return (
    <div>
      <div className="text-[9px] font-bold tracking-[0.2em] text-zinc-400 uppercase">{label}</div>
      <div className={`font-mono font-bold tabular-nums ${small ? "text-sm" : "text-lg"} ${accent}`}>{value}</div>
    </div>
  );
}

function ResultCard({
  end,
  rematch,
  opponentPresent,
  onRematch,
  onLeave,
}: {
  end: EndInfo;
  rematch: "none" | "sent" | "received";
  opponentPresent: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const title = end.result === "win" ? "VICTORY" : end.result === "lose" ? "DEFEAT" : "DRAW";
  const color = end.result === "win" ? "text-amber-300" : end.result === "lose" ? "text-rose-400" : "text-zinc-200";
  return (
    <div className="flex flex-col items-center gap-3 p-4 text-center animate-in">
      <div className={`text-4xl font-black tracking-wider ${color}`}>{title}</div>
      {end.reason === "forfeit" && <div className="text-xs text-zinc-400">Opponent left the match</div>}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="text-zinc-400">You</div>
        <div className="text-zinc-400">Them</div>
        <div className="font-mono font-bold">{end.you.kos} KO</div>
        <div className="font-mono font-bold">{end.opponent.kos} KO</div>
        <div className="font-mono text-xs text-zinc-300">{end.you.linesSent} sent</div>
        <div className="font-mono text-xs text-zinc-300">{end.opponent.linesSent} sent</div>
      </div>
      {typeof end.ratingDelta === "number" && (
        <div className={`chip ${end.ratingDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
          Rating {end.ratingDelta >= 0 ? "+" : ""}
          {end.ratingDelta}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {opponentPresent && end.reason !== "forfeit" ? (
          <button className="btn btn-primary" onClick={onRematch} disabled={rematch === "sent"}>
            {rematch === "sent" ? "Waiting for opponent…" : rematch === "received" ? "Accept rematch" : "Rematch"}
          </button>
        ) : null}
        <button className="btn btn-ghost" onClick={onLeave}>Back to lobby</button>
      </div>
    </div>
  );
}

function Rules() {
  const rows = [
    ["Double", "1"],
    ["Triple", "2"],
    ["Tetris", "4"],
    ["T-Spin Single / Double / Triple", "2 / 4 / 6"],
    ["Back-to-Back bonus", "+1"],
    ["Combo", "+1 … +5"],
    ["Perfect Clear", "+10"],
  ];
  return (
    <div className="glass mt-6 rounded-2xl p-5">
      <div className="mb-3 text-sm font-semibold text-zinc-300">How battle works</div>
      <ul className="mb-4 space-y-1.5 text-sm text-zinc-400">
        <li>• Each round lasts <b className="text-zinc-200">2 minutes</b>. Topping out gives your opponent a <b className="text-zinc-200">KO</b> and your field resets.</li>
        <li>• Most KOs at the buzzer wins. Ties go to whoever sent more lines.</li>
        <li>• Clearing lines cancels incoming garbage first (watch the red meter).</li>
        <li>• You can watch your opponent's board live.</li>
      </ul>
      <div className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-white/5 py-1">
            <span className="text-zinc-400">{k}</span>
            <span className="font-mono font-bold text-rose-300">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
