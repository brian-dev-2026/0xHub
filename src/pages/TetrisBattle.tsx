import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { RECONNECT_GRACE_MS, isValidRoomCode, randomRoomCode } from "../../shared/protocol";
import { Avatar } from "../components/Layout";
import { IconArrowLeft, IconBolt, IconCopy, IconSwords } from "../components/icons";
import { GAME_NAME } from "../games/registry";
import { BoardPanel, useCellSize } from "../games/tetris/BoardPanel";
import { BattleClient, type EndInfo } from "../games/tetris/battleClient";
import { GameSocket } from "../games/tetris/net";
import { TouchControls } from "../games/tetris/TouchControls";
import { useMe } from "../lib/auth";
import { fmtClock } from "../lib/format";
import { settingsStore } from "../lib/store";
import { ControlsHint } from "./TetrisEndless";

export default function TetrisBattle() {
  const { code: codeParam } = useParams();
  const code = codeParam?.toUpperCase();
  return code ? <Room key={code} code={code} /> : <Lobby />;
}

// ---------- lobby & matchmaking ----------

function Lobby() {
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const mm = useRef<GameSocket | null>(null);
  const retries = useRef(0);

  const stopSearch = useCallback(() => {
    mm.current?.close();
    mm.current = null;
  }, []);
  useEffect(() => stopSearch, [stopSearch]);

  const search = useCallback(() => {
    setError("");
    setSearching(true);
    let matched = false;
    mm.current = new GameSocket(
      "/api/ws/matchmake",
      (msg) => {
        if (msg.t === "matched") {
          matched = true;
          stopSearch();
          navigate(`/games/tetris/battle/${msg.room}`, { replace: true });
        } else if (msg.t === "replaced") {
          matched = true; // another tab took over the search
          stopSearch();
          setSearching(false);
          setError("You started searching in another tab.");
        } else if (msg.t === "waiting") retries.current = 0;
      },
      (unexpected) => {
        if (!unexpected || matched) return;
        // The queue server restarted or the network blipped: rejoin the queue.
        if (retries.current++ < 5) setTimeout(search, 500 * retries.current);
        else {
          setSearching(false);
          setError("Couldn't reach the matchmaking server.");
        }
      },
    );
  }, [navigate, stopSearch]);

  const joinRoom = () => {
    const c = joinCode.trim().toUpperCase();
    if (isValidRoomCode(c)) navigate(`/games/tetris/battle/${c}`);
  };

  return (
    <Shell>
      <div className="mx-auto w-full max-w-3xl animate-in">
        {!searching ? (
          <>
            <div className="mb-8 text-center">
              <div className="chip mx-auto mb-3"><IconSwords width={14} height={14} /> 1v1 Battle</div>
              <h1 className="text-3xl font-bold sm:text-4xl">Battle 2P</h1>
              <p className="mt-2 text-zinc-400">2-minute rounds. Send garbage, KO your rival, most KOs wins.</p>
            </div>
            {error && <div role="alert" className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300 ring-1 ring-rose-500/30">{error}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <button onClick={search} className="glass glass-hover group rounded-2xl p-6 text-left">
                <div className="mb-4 grid size-12 place-items-center rounded-xl bg-linear-to-br from-violet-500 to-cyan-400 text-white">
                  <IconBolt />
                </div>
                <div className="text-lg font-bold">Quick match</div>
                <div className="mt-1 text-sm text-zinc-400">Get paired with the next player looking for a game.</div>
              </button>
              <div className="glass rounded-2xl p-6">
                <div className="text-lg font-bold">Play a friend</div>
                <div className="mt-1 mb-4 text-sm text-zinc-400">Create a private room and share the link, or enter a code.</div>
                <button onClick={() => navigate(`/games/tetris/battle/${randomRoomCode()}`)} className="btn btn-primary w-full">
                  Create private room
                </button>
                <div className="mt-3 flex gap-2">
                  <input
                    className="input font-mono tracking-[0.3em] uppercase"
                    placeholder="CODE"
                    aria-label="Room code"
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
        ) : (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <div className="pulse-ring grid size-24 place-items-center rounded-full bg-violet-500/20 text-4xl">⚔️</div>
            <div>
              <div className="text-2xl font-bold">Finding an opponent…</div>
              <div className="mt-1 text-sm text-zinc-400">Tip: open a private window, sign in as someone else, and quick match to test.</div>
            </div>
            <button className="btn btn-ghost" onClick={() => (stopSearch(), setSearching(false))}>Cancel</button>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ---------- room / match ----------

function Room({ code }: { code: string }) {
  const valid = isValidRoomCode(code);
  const navigate = useNavigate();
  const leave = () => navigate("/games/tetris/battle");
  if (!valid) {
    return (
      <Shell onBack={leave}>
        <ErrorBox message="That room code isn't valid." onBack={leave} />
      </Shell>
    );
  }
  return <Match code={code} onLeave={leave} />;
}

function Match({ code, onLeave }: { code: string; onLeave: () => void }) {
  // The client opens a socket, so it's created in an effect (not during render).
  const [client, setClient] = useState<BattleClient | null>(null);
  useEffect(() => {
    const c = new BattleClient(code);
    setClient(c);
    return () => c.dispose();
  }, [code]);
  if (!client) {
    return (
      <Shell onBack={onLeave}>
        <div className="py-16 text-center text-zinc-400">Connecting…</div>
      </Shell>
    );
  }
  return <MatchView client={client} code={code} onLeave={onLeave} />;
}

function MatchView({ client, code, onLeave }: { client: BattleClient; code: string; onLeave: () => void }) {
  const settings = settingsStore.use();
  const profile = useMe().user;
  const cell = useCellSize(0.92, 230);
  const oppCell = Math.max(10, Math.round(cell * 0.62));
  const ui = client.ui.use();
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(iv);
  }, []);
  const [copied, setCopied] = useState(false);

  const getMine = useCallback(() => client.session.panelState(), [client]);
  const getOpp = useCallback(() => client.oppState, [client]);
  const getPopups = useCallback(() => client.session.popups, [client]);
  const getShake = useCallback(() => client.session.shakeAt, [client]);

  if (ui.phase === "error") {
    return (
      <Shell onBack={onLeave}>
        <ErrorBox message={ui.error || "Something went wrong."} onBack={onLeave} />
      </Shell>
    );
  }

  const shareUrl = `${location.origin}/games/tetris/battle/${code}`;
  if ((ui.phase === "connecting" || ui.phase === "waiting") && !ui.opponent) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard blocked */
      }
    };
    return (
      <Shell onBack={onLeave}>
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 py-12 text-center animate-in">
          <div className="text-sm text-zinc-400">Room code</div>
          <div className="font-mono text-5xl font-bold tracking-[0.35em] text-gradient">{code}</div>
          <div className="flex w-full max-w-md gap-2">
            <input readOnly className="input text-xs" aria-label="Invite link" value={shareUrl} onFocus={(e) => e.target.select()} />
            <button className="btn btn-primary" onClick={copy}>
              <IconCopy width={16} height={16} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center gap-3 text-zinc-400" aria-live="polite">
            <span className="inline-block size-2 animate-pulse rounded-full bg-cyan-400" />
            {ui.reconnecting ? "Reconnecting…" : ui.phase === "connecting" ? "Connecting…" : "Waiting for opponent to join…"}
          </div>
          <button className="btn btn-ghost" onClick={onLeave}>Leave room</button>
        </div>
      </Shell>
    );
  }

  const now = performance.now();
  const remaining = ui.phase === "playing" ? ui.endsAt - now : ui.phase === "countdown" ? 120_000 : 0;
  const e = client.session.sim.engine;

  const mySide = (
    <div className="panel-box space-y-2.5 rounded-xl p-3" style={{ ["--frame" as string]: "#33334f" }}>
      <BStat label="KOs" value={ui.kos.you} accent="text-amber-300" />
      <BStat label="Sent" value={e.linesSent} accent="text-rose-300" />
      <BStat label="Lines" value={e.lines} />
      <BStat label="Combo" value={Math.max(0, e.combo)} />
    </div>
  );

  let myOverlay: React.ReactNode = null;
  if (ui.countdown !== null && ui.phase !== "ended") {
    myOverlay = (
      <div key={ui.countdown} className="countdown text-7xl font-bold text-white drop-shadow-[0_0_20px_rgba(139,92,246,0.8)]">
        {ui.countdown === 0 ? "GO!" : ui.countdown}
      </div>
    );
  } else if (ui.koFlash === "you") {
    myOverlay = <div className="countdown text-6xl font-black text-rose-400">K.O.</div>;
  } else if (ui.phase === "ended") {
    myOverlay = ui.end ? (
      <ResultCard
        end={ui.end}
        rematch={ui.rematch}
        opponentPresent={!!ui.opponent}
        onRematch={() => client.requestRematch()}
        onLeave={onLeave}
      />
    ) : (
      <div className="flex flex-col items-center gap-3 p-4 text-center">
        <div className="text-xl font-bold">Match over</div>
        <button className="btn btn-ghost" onClick={onLeave}>Back to lobby</button>
      </div>
    );
  }

  const opp = client.oppState;
  let oppOverlay: React.ReactNode = null;
  if (!ui.opponentConnected && ui.phase !== "ended") {
    oppOverlay = (
      <div className="px-3 text-center text-xs text-amber-200">
        Opponent disconnected
        <div className="mt-1 text-[10px] text-zinc-400">They forfeit if not back within {Math.round(RECONNECT_GRACE_MS / 1000)}s</div>
      </div>
    );
  } else if (ui.koFlash === "opponent") {
    oppOverlay = <div className="countdown text-4xl font-black text-amber-300">K.O.!</div>;
  } else if (!opp && ui.phase !== "ended") {
    oppOverlay = <div className="text-xs text-zinc-400">Waiting…</div>;
  }

  return (
    <Shell onBack={onLeave} compact>
      {ui.reconnecting && (
        <div role="status" className="mx-auto mb-3 rounded-xl bg-amber-500/15 px-4 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
          Connection lost — reconnecting… your match is held for {Math.round(RECONNECT_GRACE_MS / 1000)} seconds.
        </div>
      )}
      {/* Scoreboard */}
      <div className="glass mx-auto mb-4 flex w-full max-w-4xl items-center justify-between gap-2 rounded-2xl px-3 py-2.5 sm:px-5">
        <PlayerTag p={{ name: profile.displayName, avatar: profile.avatar, color: profile.color }} kos={ui.kos.you} />
        <div className="text-center">
          <div
            className={`font-mono text-2xl font-bold tabular-nums sm:text-3xl ${remaining < 15000 && ui.phase === "playing" ? "text-rose-400" : ""}`}
            aria-label="Time remaining"
          >
            {fmtClock(remaining)}
          </div>
          <div className="text-[10px] tracking-[0.2em] text-zinc-500 uppercase">{ui.latency ? `${ui.latency}ms` : ""}</div>
        </div>
        <PlayerTag p={ui.opponent ?? { name: "—", avatar: "❔", color: "#555555" }} kos={ui.kos.opponent} right />
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
          <TouchControls input={client.session.input} />
        </div>

        <div className="relative flex flex-col items-center">
          <BoardPanel
            getState={getOpp}
            skinId={ui.opponent?.skin ?? settings.skin}
            themeId={settings.theme}
            cell={oppCell}
            nextCount={3}
            header={<div className="text-xs font-semibold text-zinc-400">{ui.opponent?.name ?? "Opponent"}'s board</div>}
            side={
              <div className="panel-box space-y-1.5 rounded-xl p-2" style={{ ["--frame" as string]: "#33334f" }}>
                <BStat label="KOs" value={ui.kos.opponent} accent="text-amber-300" small />
                <BStat label="Sent" value={ui.oppSent} accent="text-rose-300" small />
              </div>
            }
            overlay={oppOverlay}
          />
          {ui.oppAttack && (
            <div key={ui.oppAttack.id} className="popup popup-garbage absolute top-1/2 left-1/2 -translate-x-1/2">
              {ui.oppAttack.text}
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

// ---------- pieces ----------

function ErrorBox({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center" role="alert">
      <div className="text-4xl">⚠️</div>
      <div className="text-xl font-bold">{message}</div>
      <button className="btn btn-primary" onClick={onBack}>Back to lobby</button>
    </div>
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
          <div className="text-xs font-bold tracking-[0.3em] text-violet-300">{GAME_NAME.toUpperCase()}</div>
          <div className="text-lg font-bold">Battle 2P</div>
        </div>
        <div className="w-19" />
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
            <span key={i} aria-hidden>★</span>
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
      {end.reason === "forfeit" && (
        <div className="text-xs text-zinc-400">{end.result === "win" ? "Your opponent left the match" : "You left the match"}</div>
      )}
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
        {opponentPresent && (
          <button className="btn btn-primary" onClick={onRematch} disabled={rematch === "sent"}>
            {rematch === "sent" ? "Waiting for opponent…" : rematch === "received" ? "Accept rematch" : "Rematch"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>Back to lobby</button>
      </div>
    </div>
  );
}

function Rules() {
  const rows = [
    ["Double", "1"],
    ["Triple", "2"],
    ["Quad (4 lines)", "4"],
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
        <li>• You can watch your opponent's board live. Every move is verified by the server.</li>
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
