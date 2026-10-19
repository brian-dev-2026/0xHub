import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DUEL_MS, DUEL_TARGET, type Dir, type G2048, type G2048Spawn, type G2048View } from "../../../shared/games/g2048";
import { isValidRoomCode } from "../../../shared/protocol";
import { ConnectionBanner, ErrorPanel, GameShell, InvitePanel, MatchLobby, fmtMs } from "../../components/GameShell";
import { GameLogo } from "../../components/GameLogo";
import { IconPlay } from "../../components/icons";
import { Avatar, Check } from "../../components/marks";
import { SectionTitle, StatTile } from "../../components/ui";
import { Board2048, useBoardSize, useMoveInput } from "../../games/g2048/Board2048";
import { RemoteBoard } from "../../games/g2048/remote";
import { ApiError, refreshMe, useMe } from "../../lib/auth";
import { fmtNum } from "../../lib/format";
import { useRoomSocket, type RoomSocket } from "../../lib/roomSocket";
import { sfx } from "../../lib/sfx";
import { Look2048, CustomizeSection } from "../../games/LookPickers";

async function post<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export default function Game2048Page({ mode }: { mode?: "solo" | "duel" }) {
  const { code } = useParams();
  if (mode === "solo") return <Solo />;
  if (mode === "duel" && code) return <Duel key={code} code={code.toUpperCase()} />;
  return <Home />;
}

function Home() {
  const s = useMe().games["2048"];
  return (
    <GameShell title="2048" kicker="0xHub" back="/games">
      <div className="mx-auto w-full max-w-3xl space-y-6 animate-in">
        <div className="flex items-center gap-4">
          <GameLogo game="2048" size={56} />
          <div>
            <h1 className="text-3xl font-bold">2048 Duel</h1>
            <p className="text-zinc-400">Slide and merge tiles. Chase a high score solo, or race a rival to 2048.</p>
          </div>
        </div>
        <Link to="/games/2048/solo" className="glass glass-hover flex items-center gap-4 rounded-2xl p-5">
          <span className="grid size-12 place-items-center rounded-xl bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30">
            <IconPlay width={20} height={20} />
          </span>
          <div className="flex-1">
            <div className="text-lg font-bold">Solo</div>
            <div className="text-sm text-zinc-400">Classic 2048. Your best verified score goes on the leaderboard.</div>
          </div>
          <span className="chip">Best {fmtNum(s.bestScore)}</span>
        </Link>
        <SectionTitle>Duel · 1v1</SectionTitle>
        <MatchLobby
          game="2048"
          roomPath={(c) => `/games/2048/duel/${c}`}
          quickHint="Same tiles for both players. First to 2048 wins — or the higher score after 5 minutes."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Best score" value={fmtNum(s.bestScore)} accent="#f59e0b" />
          <StatTile label="Duel rating" value={s.rating} accent="#8b5cf6" />
          <StatTile label="Duel wins" value={s.duelWins} accent="#34d399" />
          <StatTile label="Duel losses" value={s.duelLosses} accent="#f43f5e" />
        </div>
        <CustomizeSection>
          <Look2048 />
        </CustomizeSection>
      </div>
    </GameShell>
  );
}

// ---------- Solo (server-verified) ----------

function Solo() {
  const size = useBoardSize();
  const best = useMe().games["2048"].bestScore;
  const [runId, setRunId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const board = useRef<RemoteBoard | null>(null);
  const sockRef = useRef<RoomSocket | null>(null);
  const [, redraw] = useState(0);
  const [result, setResult] = useState<{ status: "pending" | "ok" | "failed"; rank?: number; error?: string } | null>(null);
  const [startError, setStartError] = useState("");
  const area = useRef<HTMLDivElement>(null);

  const start = useCallback(async () => {
    setStartError("");
    setResult(null);
    setLive(false);
    board.current = null;
    try {
      const { runId } = await post<{ runId: string }>("/api/runs/2048/start", {});
      setRunId(runId);
      setLive(true);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Couldn't start a game.");
    }
  }, []);
  useEffect(() => void start(), [start]);

  const onChange = (g: G2048, slid: boolean) => {
    if (slid) {
      sfx.move();
      if (g.lastMerged.length) sfx.clear(Math.min(4, g.lastMerged.length));
    } else if (g.over) {
      sfx.gameOver();
      setResult((r) => r ?? { status: "pending" });
    }
    redraw((n) => n + 1);
  };

  const { sock, status, error } = useRoomSocket(live && runId ? `/api/ws/runs/2048/${runId}` : null, (m) => {
    if (m.t === "state") {
      if (board.current) board.current.reset(m.game);
      else board.current = new RemoteBoard(m.game, (n, d, h) => sockRef.current?.send({ t: "move", n, d, h }), onChange);
      redraw((n) => n + 1);
    } else if (m.t === "spawn") board.current?.spawn(m as unknown as G2048Spawn);
    else if (m.t === "done") {
      setResult({ status: "ok", rank: m.rank });
      setLive(false); // the run is over; close the socket
      void refreshMe();
    } else if (m.t === "error") {
      setResult({ status: "failed", error: m.message });
      setLive(false);
    }
  });
  sockRef.current = sock;

  const move = (d: Dir) => board.current?.press(d);
  const g = board.current?.game ?? null;
  useMoveInput(move, !!g && !g.over, area);
  const failed = live && status === "error" ? error || "Lost connection to the game server." : "";

  return (
    <GameShell title="Solo" kicker="2048" back="/games/2048" right={<button className="btn btn-ghost px-3 py-2 text-xs" onClick={() => void start()}>New</button>}>
      <div ref={area} className="mx-auto flex w-full max-w-md touch-none flex-col items-center gap-4 select-none">
        <div className="grid w-full grid-cols-3 gap-2" style={{ maxWidth: size }}>
          <Mini label="Score" value={fmtNum(g?.score ?? 0)} />
          <Mini label="Best" value={fmtNum(Math.max(best, g?.score ?? 0))} />
          <Mini label="Top tile" value={g ? g.maxTile : 0} />
        </div>
        {g ? (
          <Board2048
            board={g.board}
            size={size}
            merged={g.lastMerged}
            spawn={g.lastSpawn}
            dim={g.over}
            overlay={
              g.over && (
                <div className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center">
                  <div className="text-xs font-bold tracking-[0.3em] text-rose-300">GAME OVER</div>
                  <div className="font-mono text-3xl font-bold">{fmtNum(g.score)}</div>
                  <div className="text-xs text-zinc-400" aria-live="polite">
                    {result?.status === "pending" && "Verifying…"}
                    {result?.status === "ok" && <><Check className="text-emerald-300" />Verified · rank <b className="text-white">#{result.rank}</b></>}
                    {result?.status === "failed" && <span className="text-rose-300">Couldn't verify: {result.error}</span>}
                  </div>
                  <button className="btn btn-primary mt-1" onClick={() => void start()}>Play again</button>
                </div>
              )
            }
          />
        ) : (
          <div className="grid place-items-center text-zinc-400" style={{ width: size, height: size }}>{startError || failed || "Starting…"}</div>
        )}
        {g && <ConnectionBanner status={live ? status : "open"} />}
        <div className="text-xs text-zinc-500">Arrow keys, WASD or swipe.</div>
      </div>
    </GameShell>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2 text-center ring-1 ring-white/10">
      <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">{label}</div>
      <div className="font-mono text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

// ---------- Duel ----------

interface DuelState {
  phase: "waiting" | "countdown" | "playing" | "ended";
  players: { id: string; name: string; avatar: string; color: string; connected: boolean }[];
  msUntilStart: number;
  msRemaining: number;
  you: G2048View | null;
  boards: Record<string, { board: number[]; score: number; maxTile: number; over: boolean; moves: number }>;
  rematch: string[];
  result: { winner: string | null; reason: string; deltas: Record<string, number> | null } | null;
}

function Duel({ code }: { code: string }) {
  const navigate = useNavigate();
  const me = useMe().user;
  const size = useBoardSize(340);
  const [st, setSt] = useState<DuelState | null>(null);
  const [opp, setOpp] = useState<DuelState["boards"][string] | null>(null);
  const [, redraw] = useState(0);
  const board = useRef<RemoteBoard | null>(null);
  const sockRef = useRef<RoomSocket | null>(null);
  const clock = useRef({ startAt: 0, endAt: 0 });
  const lastPhase = useRef("");
  const area = useRef<HTMLDivElement>(null);
  const valid = isValidRoomCode(code);

  const onChange = (g: G2048, slid: boolean) => {
    if (slid) {
      sfx.move();
      if (g.lastMerged.length) sfx.clear(Math.min(4, g.lastMerged.length));
    }
    redraw((n) => n + 1);
  };

  const { sock, status, error } = useRoomSocket(valid ? `/api/ws/2048/room/${code}` : null, (m) => {
    if (m.t === "state") {
      const s = m as unknown as DuelState;
      const now = performance.now();
      clock.current = { startAt: now + s.msUntilStart, endAt: now + s.msUntilStart + (s.phase === "countdown" ? DUEL_MS : 0) };
      if (s.phase === "playing") clock.current.endAt = now + s.msRemaining;
      // A full state means a new game or a (re)join: the server's copy of our board is authoritative.
      if (s.you) {
        if (board.current) board.current.reset(s.you);
        else board.current = new RemoteBoard(s.you, (n, d, h) => sockRef.current?.send({ t: "move", n, d, h }), onChange);
      }
      const oppId = s.players.find((p) => p.id !== me.id)?.id;
      setOpp(oppId ? (s.boards[oppId] ?? null) : null);
      if (s.phase === "ended" && lastPhase.current !== "ended" && lastPhase.current) {
        if (s.result?.winner === me.id) sfx.win();
        else sfx.gameOver();
        void refreshMe();
      }
      lastPhase.current = s.phase;
      setSt(s);
    } else if (m.t === "board") {
      setOpp({ board: m.board, score: m.score, maxTile: m.maxTile, over: m.over, moves: m.moves });
    } else if (m.t === "spawn") board.current?.spawn(m as unknown as G2048Spawn);
    else if (m.t === "resync") board.current?.reset(m.game); else if (m.t === "presence") {
      setSt((cur) => (cur ? { ...cur, players: m.players } : cur));
    }
  });

  sockRef.current = sock;
  useEffect(() => {
    const t = setInterval(() => redraw((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const playing = st?.phase === "playing" || (st?.phase === "countdown" && performance.now() >= clock.current.startAt);
  const move = (d: Dir) => {
    if (playing) board.current?.press(d);
  };
  useMoveInput(move, !!playing, area);

  const leave = () => navigate("/games/2048");
  if (!valid) return <GameShell title="Duel" kicker="2048" back="/games/2048"><ErrorPanel message="That room code isn't valid." onBack={leave} /></GameShell>;
  if (status === "error") return <GameShell title="Duel" kicker="2048" back="/games/2048"><ErrorPanel message={error || "Something went wrong."} onBack={leave} /></GameShell>;
  if (!st || (st.players.length < 2 && st.phase === "waiting")) {
    return (
      <GameShell title="Duel" kicker="2048" back="/games/2048" onBack={leave}>
        <InvitePanel code={code} path={`/games/2048/duel/${code}`} waitingText={status === "open" ? "Waiting for an opponent to join…" : "Connecting…"}>
          <button className="btn btn-ghost" onClick={leave}>Leave room</button>
        </InvitePanel>
      </GameShell>
    );
  }

  const now = performance.now();
  const countdown = st.phase === "countdown" ? Math.ceil((clock.current.startAt - now) / 1000) : 0;
  const remaining = st.phase === "playing" || (st.phase === "countdown" && countdown <= 0) ? clock.current.endAt - now : st.phase === "countdown" ? DUEL_MS : 0;
  const oppP = st.players.find((p) => p.id !== me.id);
  const g = board.current?.game;
  const small = Math.round(size * 0.62);

  let overlay: React.ReactNode = null;
  if (st.phase === "countdown" && countdown > 0) overlay = <div key={countdown} className="countdown text-7xl font-bold text-white">{countdown}</div>;
  else if (st.phase === "ended" && st.result) {
    const r = st.result;
    const outcome = r.winner === me.id ? "VICTORY" : r.winner ? "DEFEAT" : "DRAW";
    const why = { target: `${DUEL_TARGET} reached`, time: "Time's up", stuck: "No moves left", forfeit: "Opponent left" }[r.reason] ?? r.reason;
    const delta = r.deltas?.[me.id];
    const iAsked = st.rematch.includes(me.id);
    overlay = (
      <div className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center animate-in">
        <div className={`text-3xl font-black ${outcome === "VICTORY" ? "text-amber-300" : outcome === "DEFEAT" ? "text-rose-400" : "text-zinc-200"}`}>{outcome}</div>
        <div className="text-sm text-zinc-300">{why}</div>
        {typeof delta === "number" && <div className={`chip ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>Rating {delta >= 0 ? "+" : ""}{delta}</div>}
        <div className="flex gap-2">
          {st.players.length === 2 && <button className="btn btn-primary" disabled={iAsked} onClick={() => sock?.send({ t: "rematch" })}>{iAsked ? "Waiting…" : st.rematch.length ? "Accept rematch" : "Rematch"}</button>}
          <button className="btn btn-ghost" onClick={leave}>Back</button>
        </div>
      </div>
    );
  } else if (g?.over) overlay = <div className="glass rounded-xl px-4 py-2 text-sm">No moves left — waiting for the round to end</div>;

  return (
    <GameShell title="Duel" kicker="2048" back="/games/2048" onBack={leave}>
      <ConnectionBanner status={status} />
      <div className="mx-auto mb-4 flex w-full max-w-3xl items-center justify-between rounded-2xl glass px-4 py-2.5">
        <div className="flex items-center gap-2"><Avatar avatar={me.avatar} color={me.color} size={34} /><span className="text-sm font-semibold">{me.displayName}</span></div>
        <div className={`font-mono text-2xl font-bold tabular-nums ${remaining < 30_000 && st.phase === "playing" ? "text-rose-400" : ""}`}>{fmtMs(remaining)}</div>
        <div className="flex items-center gap-2">{oppP && <><span className="text-sm font-semibold">{oppP.name}</span><Avatar avatar={oppP.avatar} color={oppP.color} size={34} /></>}</div>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-6">
        <div ref={area} className="flex touch-none flex-col items-center gap-2 select-none">
          <div className="flex w-full justify-between text-sm" style={{ width: size }}>
            <span>Score <b className="font-mono">{fmtNum(g?.score ?? 0)}</b></span>
            <span>Top <b className="font-mono">{g?.maxTile ?? 0}</b></span>
          </div>
          <Board2048 board={g?.board ?? new Array(16).fill(0)} size={size} merged={g?.lastMerged} spawn={g?.lastSpawn} dim={!!overlay} overlay={overlay} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="flex justify-between text-xs text-zinc-400" style={{ width: small }}>
            <span>{oppP?.name ?? "Opponent"}{oppP && !oppP.connected ? " (disconnected)" : ""}</span>
            <span className="font-mono text-white">{fmtNum(opp?.score ?? 0)}</span>
          </div>
          <Board2048 board={opp?.board ?? new Array(16).fill(0)} size={small} dim={opp?.over} overlay={opp?.over ? <span className="text-xs text-zinc-300">Stuck</span> : null} />
        </div>
      </div>
      <div className="mt-4 text-center text-xs text-zinc-500">Arrow keys, WASD or swipe. Same tiles for both players.</div>
    </GameShell>
  );
}
