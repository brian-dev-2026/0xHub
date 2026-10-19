import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { C4_COLS, C4_ROWS, C4_TURN_MS } from "../../../shared/games/connect4";
import { isValidRoomCode } from "../../../shared/protocol";
import { ConnectionBanner, ErrorPanel, GameShell, InvitePanel, MatchLobby } from "../../components/GameShell";
import { GameLogo } from "../../components/GameLogo";
import { Avatar } from "../../components/marks";
import { Card, SectionTitle, StatTile } from "../../components/ui";
import { refreshMe, useMe } from "../../lib/auth";
import { sfx } from "../../lib/sfx";
import { useRoomSocket } from "../../lib/roomSocket";

const DISC = ["", "#f43f5e", "#facc15"];

interface C4View {
  phase: "waiting" | "playing" | "ended";
  players: { id: string; name: string; avatar: string; color: string; rating?: number; connected: boolean }[];
  board: number[];
  firstSeat: number;
  turn: 1 | 2;
  winLine: number[] | null;
  winner: number;
  lastMove: number;
  turnMsLeft: number;
  rematch: string[];
  result: { winnerSeat: number; reason: string; deltas: [number, number] | null } | null;
}

export default function Connect4Page() {
  const { code } = useParams();
  return code ? <Match key={code} code={code.toUpperCase()} /> : <Home />;
}

function Home() {
  const { games } = useMe();
  const s = games.connect4;
  return (
    <GameShell title="Connect Four" kicker="0xHub" back="/games">
      <div className="mx-auto w-full max-w-3xl space-y-6 animate-in">
        <div className="flex items-center gap-4">
          <GameLogo game="connect4" size={56} />
          <div>
            <h1 className="text-3xl font-bold">Connect Four</h1>
            <p className="text-zinc-400">Drop discs, line up four. Real-time 1v1 with a 30-second turn clock.</p>
          </div>
        </div>
        <MatchLobby game="connect4" roomPath={(c) => `/games/connect4/${c}`} quickHint="Get paired with the next player looking for a game." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Rating" value={s.rating} accent="#f43f5e" />
          <StatTile label="Wins" value={s.wins} accent="#34d399" />
          <StatTile label="Losses" value={s.losses} accent="#fb923c" />
          <StatTile label="Draws" value={s.draws} accent="#60a5fa" />
        </div>
        <Card>
          <SectionTitle>Rules</SectionTitle>
          <ul className="space-y-1.5 text-sm text-zinc-400">
            <li>Take turns dropping a disc into one of the 7 columns.</li>
            <li>Four in a row — across, down or diagonal — wins.</li>
            <li>You have 30 seconds per move. Running out of time loses the game.</li>
            <li>Rematches swap who goes first. Wins and losses change your rating.</li>
          </ul>
        </Card>
      </div>
    </GameShell>
  );
}

function Match({ code }: { code: string }) {
  const navigate = useNavigate();
  const me = useMe().user;
  const [v, setV] = useState<C4View | null>(null);
  const deadline = useRef(0);
  const [hover, setHover] = useState<number | null>(null);
  const [, tick] = useState(0);
  const valid = isValidRoomCode(code);
  const lastPhase = useRef("");

  const { sock, status, error } = useRoomSocket(valid ? `/api/ws/connect4/room/${code}` : null, (m) => {
    if (m.t === "state") {
      const nv = m as unknown as C4View;
      deadline.current = performance.now() + nv.turnMsLeft;
      if (nv.lastMove >= 0) sfx.lock();
      if (nv.phase === "ended" && lastPhase.current !== "ended") {
        const mySeat = nv.players.findIndex((p) => p.id === me.id);
        if (nv.result?.winnerSeat === mySeat) sfx.win();
        else sfx.gameOver();
        void refreshMe();
      }
      lastPhase.current = nv.phase;
      setV(nv);
    } else if (m.t === "presence") setV((cur) => (cur ? { ...cur, players: m.players } : cur));
  });

  useEffect(() => {
    const iv = setInterval(() => tick((t) => t + 1), 200);
    return () => clearInterval(iv);
  }, []);

  const leave = () => navigate("/games/connect4");
  const mySeat = v ? v.players.findIndex((p) => p.id === me.id) : -1;
  const myDisc = v && mySeat >= 0 ? (mySeat === v.firstSeat ? 1 : 2) : 0;
  const myTurn = !!v && v.phase === "playing" && v.turn === myDisc;
  const canDropIn = (c: number) => !!v && myTurn && v.board[c] === 0;
  const dropIn = (c: number) => {
    if (canDropIn(c)) sock?.send({ t: "drop", col: c });
  };

  // Keyboard: 1-7 to drop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= C4_COLS) dropIn(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!valid) return <GameShell title="Connect Four" kicker="1v1" back="/games/connect4"><ErrorPanel message="That room code isn't valid." onBack={leave} /></GameShell>;
  if (status === "error") return <GameShell title="Connect Four" kicker="1v1" back="/games/connect4"><ErrorPanel message={error || "Something went wrong."} onBack={leave} /></GameShell>;

  if (!v || (v.phase === "waiting" && v.players.length < 2)) {
    return (
      <GameShell title="Connect Four" kicker="1v1" back="/games/connect4" onBack={leave}>
        <InvitePanel code={code} path={`/games/connect4/${code}`} waitingText={status === "open" ? "Waiting for an opponent to join…" : "Connecting…"}>
          <button className="btn btn-ghost" onClick={leave}>Leave room</button>
        </InvitePanel>
      </GameShell>
    );
  }

  const opp = v.players.find((p) => p.id !== me.id);
  const msLeft = Math.max(0, deadline.current - performance.now());
  const turnPlayer = v.players[v.turn === 1 ? v.firstSeat : 1 - v.firstSeat];
  const winSet = new Set(v.winLine ?? []);
  const cell = "min(11vw, 64px)";

  return (
    <GameShell title="Connect Four" kicker="1v1" back="/games/connect4" onBack={leave}>
      <ConnectionBanner status={status} />
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5">
        {/* players */}
        <div className="glass flex w-full items-center justify-between rounded-2xl px-4 py-3">
          <PlayerChip p={{ ...me, name: me.displayName }} disc={myDisc} active={v.phase === "playing" && myTurn} />
          <div className="text-center">
            {v.phase === "playing" ? (
              <>
                <div className={`text-sm font-semibold ${myTurn ? "text-emerald-300" : "text-zinc-400"}`}>{myTurn ? "Your turn" : `${turnPlayer?.name ?? "Opponent"}'s turn`}</div>
                <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full rounded-full ${msLeft < 8000 ? "bg-rose-400" : "bg-violet-400"}`} style={{ width: `${(msLeft / C4_TURN_MS) * 100}%` }} />
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{Math.ceil(msLeft / 1000)}s</div>
              </>
            ) : (
              <div className="text-sm text-zinc-400">Game over</div>
            )}
          </div>
          {opp ? <PlayerChip p={opp} disc={myDisc === 1 ? 2 : 1} active={v.phase === "playing" && !myTurn} right offline={!opp.connected} /> : <div />}
        </div>

        {/* board */}
        <div className="relative rounded-3xl bg-linear-to-b from-blue-600 to-blue-800 p-3 shadow-[0_20px_60px_-20px_rgba(37,99,235,0.7)] ring-1 ring-white/20" onMouseLeave={() => setHover(null)}>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${C4_COLS}, ${cell})` }}>
            {Array.from({ length: C4_COLS }, (_, c) => (
              <button
                key={`h${c}`}
                aria-label={`Drop in column ${c + 1}`}
                className="grid place-items-center"
                style={{ height: `calc(${cell} * 0.5)` }}
                onClick={() => dropIn(c)}
                onMouseEnter={() => setHover(c)}
                disabled={!canDropIn(c)}
              >
                {hover === c && canDropIn(c) && <span className="block rounded-full opacity-60" style={{ width: `calc(${cell} * 0.8)`, height: `calc(${cell} * 0.4)`, background: DISC[myDisc] }} />}
              </button>
            ))}
            {Array.from({ length: C4_ROWS * C4_COLS }, (_, i) => {
              const c = i % C4_COLS;
              const r = Math.floor(i / C4_COLS);
              const disc = v.board[i];
              const isLast = v.lastMove === c && disc && (r === 0 || v.board[i - C4_COLS] === 0);
              return (
                <button
                  key={i}
                  aria-label={`Column ${c + 1}, row ${r + 1}${disc ? (disc === myDisc ? ", your disc" : ", opponent disc") : ""}`}
                  className={`relative rounded-full bg-blue-950/80 shadow-[inset_0_4px_8px_rgba(0,0,0,0.6)] ${hover === c && canDropIn(c) ? "ring-2 ring-white/20" : ""}`}
                  style={{ width: cell, height: cell }}
                  onClick={() => dropIn(c)}
                  onMouseEnter={() => setHover(c)}
                >
                  {disc > 0 && (
                    <span
                      className={`absolute inset-[6%] rounded-full ${isLast ? "c4-drop" : ""} ${winSet.has(i) ? "c4-win" : ""}`}
                      style={{
                        background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${DISC[disc]} 40%, white), ${DISC[disc]} 55%, color-mix(in srgb, ${DISC[disc]} 70%, black))`,
                        ["--rows" as string]: r + 1,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {v.phase === "ended" && v.result && (
            <div className="absolute inset-0 grid place-items-center rounded-3xl bg-black/55 backdrop-blur-[2px]">
              <ResultCard v={v} mySeat={mySeat} onRematch={() => sock?.send({ t: "rematch" })} onLeave={leave} meId={me.id} />
            </div>
          )}
        </div>
        <div className="text-xs text-zinc-500">Tip: press 1–7 to drop a disc.</div>
      </div>
    </GameShell>
  );
}

function PlayerChip({ p, disc, active, right, offline }: { p: { name: string; avatar: string; color: string }; disc: number; active: boolean; right?: boolean; offline?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${right ? "flex-row-reverse text-right" : ""}`}>
      <Avatar avatar={p.avatar} color={p.color} size={38} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{p.name}</div>
        <div className={`flex items-center gap-1.5 text-xs ${right ? "justify-end" : ""}`}>
          <span className="inline-block size-3 rounded-full" style={{ background: DISC[disc] }} />
          <span className={active ? "text-emerald-300" : "text-zinc-500"}>{offline ? "Disconnected" : active ? "Thinking…" : "Waiting"}</span>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ v, mySeat, onRematch, onLeave, meId }: { v: C4View; mySeat: number; onRematch: () => void; onLeave: () => void; meId: string }) {
  const r = v.result!;
  const outcome = r.winnerSeat === -1 ? "DRAW" : r.winnerSeat === mySeat ? "VICTORY" : "DEFEAT";
  const color = outcome === "VICTORY" ? "text-amber-300" : outcome === "DEFEAT" ? "text-rose-400" : "text-zinc-200";
  const reason = { connect: "Four in a row", draw: "The board is full", timeout: "Ran out of time", forfeit: "Opponent left" }[r.reason] ?? r.reason;
  const delta = r.deltas && mySeat >= 0 ? r.deltas[mySeat] : null;
  const opponentHere = v.players.length === 2;
  const iAsked = v.rematch.includes(meId);
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center animate-in">
      <div className={`text-3xl font-black tracking-wider ${color}`}>{outcome}</div>
      <div className="text-sm text-zinc-300">{r.reason === "forfeit" && r.winnerSeat !== mySeat ? "You left the game" : reason}</div>
      {delta !== null && <div className={`chip ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>Rating {delta >= 0 ? "+" : ""}{delta}</div>}
      <div className="flex gap-2">
        {opponentHere && (
          <button className="btn btn-primary" onClick={onRematch} disabled={iAsked}>
            {iAsked ? "Waiting…" : v.rematch.length ? "Accept rematch" : "Rematch"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>Back</button>
      </div>
    </div>
  );
}
