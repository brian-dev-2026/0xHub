import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Chess, type Color, type Outcome, type Promotion } from "../../../shared/games/chess";
import { BOT_LEVELS, botMove, type BotLevel } from "../../../shared/games/chessBot";
import { CHESS_TIME_CONTROLS, DEFAULT_CHESS_TC, chessTimeControl } from "../../../shared/games/clocks";
import { isValidRoomCode } from "../../../shared/protocol";
import { ConnectionBanner, ErrorPanel, GameShell, InvitePanel, MatchLobby, fmtMs } from "../../components/GameShell";
import { GameLogo } from "../../components/GameLogo";
import { IconPlay } from "../../components/icons";
import { Avatar } from "../../components/marks";
import { Card, SectionTitle, Segmented, StatTile } from "../../components/ui";
import { ChessBoard, useChessBoardSize } from "../../games/chess/Board";
import { ChessLook, CustomizeSection } from "../../games/LookPickers";
import { refreshMe, useMe } from "../../lib/auth";
import { reportCpuResult } from "../../lib/cpuResults";
import { useRoomSocket } from "../../lib/roomSocket";
import { sfx } from "../../lib/sfx";

export default function ChessPage() {
  const { code } = useParams();
  if (code === "computer") return <VsComputer />;
  if (code) return <Match key={code} code={code.toUpperCase()} />;
  return <Home />;
}

const REASON: Record<string, string> = {
  checkmate: "Checkmate",
  resign: "Resignation",
  timeout: "Time out",
  forfeit: "Opponent left",
  stalemate: "Stalemate",
  insufficient: "Insufficient material",
  threefold: "Threefold repetition",
  fivefold: "Fivefold repetition",
  fifty: "50-move rule",
  seventyfive: "75-move rule",
  agreement: "Draw agreed",
  "timeout-vs-insufficient": "Time out, but no mating material",
  aborted: "Game aborted",
};

// ---------- Home ----------

function Home() {
  const navigate = useNavigate();
  const s = useMe().games.chess;
  const [tc, setTc] = useState(DEFAULT_CHESS_TC);
  const [level, setLevel] = useState<BotLevel>(2);
  const [color, setColor] = useState<"w" | "b" | "random">("random");
  const t = chessTimeControl(tc);
  return (
    <GameShell title="Chess" kicker="0xHub" back="/games">
      <div className="mx-auto w-full max-w-3xl space-y-6 animate-in">
        <div className="flex items-center gap-4">
          <GameLogo game="chess" size={56} />
          <div>
            <h1 className="text-3xl font-bold">Chess</h1>
            <p className="text-zinc-400">Official FIDE rules with real clocks. Rated online games, or practise against the computer.</p>
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold tracking-wider text-zinc-400 uppercase">Time control</div>
          <div className="flex flex-wrap gap-2">
            {CHESS_TIME_CONTROLS.map((x) => (
              <button
                key={x.id}
                onClick={() => setTc(x.id)}
                aria-pressed={tc === x.id}
                className={`rounded-xl border px-4 py-2 text-left transition ${tc === x.id ? "border-violet-400 bg-violet-500/15" : "border-white/10 bg-black/20 hover:border-white/25"}`}
              >
                <div className="font-mono text-lg font-bold">{x.id}</div>
                <div className="text-xs text-zinc-400">{x.name}</div>
              </button>
            ))}
          </div>
        </div>
        <MatchLobby
          key={tc}
          game="chess"
          queueParams={`tc=${encodeURIComponent(tc)}`}
          roomPath={(c) => `/games/chess/${c}?tc=${encodeURIComponent(tc)}`}
          quickHint={`Play the next person looking for a ${t.id} ${t.name.toLowerCase()} game.`}
        />
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30"><IconPlay width={20} height={20} /></span>
            <div className="flex-1">
              <div className="text-lg font-bold">Play the computer</div>
              <div className="text-sm text-zinc-400">No clock. Wins count on the vs Computer leaderboard.</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Segmented<string> value={String(level)} onChange={(v) => setLevel(Number(v) as BotLevel)} options={BOT_LEVELS.map((b) => ({ value: String(b.level), label: b.name }))} />
            <Segmented<"w" | "b" | "random"> value={color} onChange={setColor} options={[{ value: "w", label: "White" }, { value: "random", label: "Random" }, { value: "b", label: "Black" }]} />
            <button className="btn btn-primary" onClick={() => navigate(`/games/chess/computer?level=${level}&color=${color === "random" ? (Math.random() < 0.5 ? "w" : "b") : color}`)}>
              Start
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Rating" value={s.rating} accent="#d6b48a" />
          <StatTile label="Wins" value={s.wins} accent="#34d399" />
          <StatTile label="Losses" value={s.losses} accent="#f43f5e" />
          <StatTile label="Draws" value={s.draws} accent="#60a5fa" />
        </div>
        <Card>
          <SectionTitle>Rules</SectionTitle>
          <ul className="space-y-1.5 text-sm text-zinc-400">
            <li>Full FIDE rules: castling, en passant, promotion, check, checkmate and stalemate.</li>
            <li>Draws: insufficient material and fivefold repetition / 75-move rule end the game automatically; threefold repetition and the 50-move rule can be claimed; you can offer a draw.</li>
            <li>Running out of time loses, unless your opponent has no way to checkmate (then it's a draw).</li>
            <li>Clocks start after each side's first move. If a player doesn't make their first move within 30 seconds, the game is aborted and unrated.</li>
            <li>Tap a piece, then tap where it should go.</li>
          </ul>
        </Card>
        <CustomizeSection>
          <ChessLook />
        </CustomizeSection>
      </div>
    </GameShell>
  );
}

// ---------- Shared bits ----------

function MoveList({ san }: { san: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [san.length]);
  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < san.length; i += 2) rows.push([san[i], san[i + 1]]);
  return (
    <div ref={ref} className="max-h-56 overflow-y-auto rounded-xl bg-black/20 p-2 font-mono text-sm lg:max-h-80" aria-label="Moves">
      {rows.length === 0 && <div className="p-2 text-center text-xs text-zinc-500">No moves yet</div>}
      {rows.map(([w, b], i) => (
        <div key={i} className="grid grid-cols-[2.5rem_1fr_1fr] gap-1 rounded px-1 py-0.5 odd:bg-white/5">
          <span className="text-zinc-500">{i + 1}.</span>
          <span>{w}</span>
          <span>{b ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

function PlayerBar({ name, avatar, color, rating, clock, active, low, offline, material }: {
  name: string;
  avatar: string;
  color: string;
  rating?: number;
  clock?: string;
  active: boolean;
  low?: boolean;
  offline?: boolean;
  material?: string;
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <Avatar avatar={avatar} color={color} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {name}
          {offline && <span className="ml-2 text-xs text-amber-300">(disconnected)</span>}
        </div>
        <div className="text-xs text-zinc-500">
          {rating !== undefined && <>Rating {rating}</>}
          {material && <span className="ml-2 text-zinc-300">{material}</span>}
        </div>
      </div>
      {clock !== undefined && (
        <div className={`rounded-lg px-3 py-1.5 font-mono text-xl font-bold tabular-nums ${active ? (low ? "bg-rose-500 text-white" : "bg-white text-black") : "bg-white/10 text-zinc-300"}`}>{clock}</div>
      )}
    </div>
  );
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** "+3" style material lead for `color`, or "". */
function materialLead(chess: Chess, color: Color): string {
  let diff = 0;
  for (const p of chess.board) if (p) diff += (p.color === color ? 1 : -1) * VALUE[p.type];
  return diff > 0 ? `+${diff}` : "";
}

function resultText(winner: Color | null, mine: Color, reason: string) {
  if (reason === "aborted") return { title: "ABORTED", tone: "text-zinc-200" };
  if (winner === null) return { title: "DRAW", tone: "text-zinc-200" };
  return winner === mine ? { title: "VICTORY", tone: "text-amber-300" } : { title: "DEFEAT", tone: "text-rose-400" };
}

// ---------- Online match ----------

interface ChessView {
  phase: "waiting" | "playing" | "ended";
  players: { id: string; name: string; avatar: string; color: string; rating?: number; connected: boolean }[];
  white: string;
  tc: string;
  moves: string[];
  san: string[];
  fen: string;
  turn: Color;
  check: boolean;
  lastMove: { from: number; to: number } | null;
  clocks: { w: number; b: number };
  clockRunning: boolean;
  firstMoveMsLeft: number;
  drawOffer: Color | null;
  canClaim: boolean;
  rematch: string[];
  result: { winner: Color | null; reason: string; deltas: Record<string, number> | null } | null;
}

function Match({ code }: { code: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useMe().user;
  const size = useChessBoardSize();
  const valid = isValidRoomCode(code);
  const tc = chessTimeControl(params.get("tc")).id;
  const [v, setV] = useState<ChessView | null>(null);
  const received = useRef(0);
  const [, tick] = useState(0);
  const [confirmResign, setConfirmResign] = useState(false);
  const lastPhase = useRef("");

  const { sock, status, error } = useRoomSocket(valid ? `/api/ws/chess/room/${code}?tc=${encodeURIComponent(tc)}` : null, (m) => {
    if (m.t === "state") {
      const s = m as unknown as ChessView;
      received.current = performance.now();
      setV((prev) => {
        if (prev && s.moves.length > prev.moves.length) sfx.move();
        return s;
      });
      if (s.phase === "ended" && lastPhase.current === "playing") {
        const mine = s.white === me.id ? "w" : "b";
        if (s.result?.winner === mine) sfx.win();
        else if (s.result?.winner) sfx.gameOver();
        void refreshMe();
      }
      lastPhase.current = s.phase;
      setConfirmResign(false);
    } else if (m.t === "presence") setV((cur) => (cur ? { ...cur, players: m.players } : cur));
  });

  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(iv);
  }, []);

  const chess = useMemo(() => (v ? new Chess(v.fen) : new Chess()), [v?.fen]);
  const leave = () => navigate("/games/chess");
  const shell = (body: React.ReactNode) => (
    <GameShell title="Chess" kicker={tc} back="/games/chess" onBack={leave}>
      {body}
    </GameShell>
  );
  if (!valid) return shell(<ErrorPanel message="That room code isn't valid." onBack={leave} />);
  if (status === "error") return shell(<ErrorPanel message={error || "Something went wrong."} onBack={leave} />);
  if (!v || (v.phase === "waiting" && v.players.length < 2)) {
    return shell(
      <InvitePanel code={code} path={`/games/chess/${code}?tc=${encodeURIComponent(tc)}`} waitingText={status === "open" ? `Waiting for an opponent · ${tc}` : "Connecting…"}>
        <button className="btn btn-ghost" onClick={leave}>Leave room</button>
      </InvitePanel>,
    );
  }

  const mine: Color = v.white === me.id ? "w" : "b";
  const opp = v.players.find((p) => p.id !== me.id);
  const meP = v.players.find((p) => p.id === me.id);
  const elapsed = performance.now() - received.current;
  const clock = (c: Color) => {
    const left = v.clocks[c] - (v.clockRunning && v.turn === c ? elapsed : 0);
    return { text: fmtMs(left), low: left < 20_000 };
  };
  const playing = v.phase === "playing";
  const myTurn = playing && v.turn === mine;
  const send = (m: Record<string, unknown>) => sock?.send(m as { t: string });
  const firstMoveLeft = v.firstMoveMsLeft - elapsed;
  const r = v.result;

  return shell(
    <>
      <ConnectionBanner status={status} />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex flex-col items-center gap-2" style={{ width: size }}>
          <PlayerBar
            name={opp?.name ?? "Opponent"}
            avatar={opp?.avatar ?? "none"}
            color={opp?.color ?? "#71717a"}
            rating={opp?.rating}
            clock={clock(mine === "w" ? "b" : "w").text}
            low={clock(mine === "w" ? "b" : "w").low}
            active={playing && v.turn !== mine}
            offline={opp ? !opp.connected : false}
            material={materialLead(chess, mine === "w" ? "b" : "w")}
          />
          <div className="relative">
            <ChessBoard chess={chess} orientation={mine} size={size} interactive={myTurn} lastMove={v.lastMove} onMove={(mv) => send({ t: "move", uci: toUci(mv) })} />
            {r && (
              <div className="absolute inset-0 grid place-items-center bg-black/50">
                <div className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center animate-in">
                  <div className={`text-3xl font-black ${resultText(r.winner, mine, r.reason).tone}`}>{resultText(r.winner, mine, r.reason).title}</div>
                  <div className="text-sm text-zinc-300">{REASON[r.reason] ?? r.reason}</div>
                  {r.deltas && <div className={`chip ${(r.deltas[me.id] ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>Rating {(r.deltas[me.id] ?? 0) >= 0 ? "+" : ""}{r.deltas[me.id] ?? 0}</div>}
                  <div className="flex gap-2">
                    {v.players.length === 2 && (
                      <button className="btn btn-primary" disabled={v.rematch.includes(me.id)} onClick={() => send({ t: "rematch" })}>
                        {v.rematch.includes(me.id) ? "Waiting…" : v.rematch.length ? "Accept rematch" : "Rematch"}
                      </button>
                    )}
                    <button className="btn btn-ghost" onClick={leave}>Back</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <PlayerBar
            name={meP?.name ?? me.displayName}
            avatar={me.avatar}
            color={me.color}
            rating={meP?.rating}
            clock={clock(mine).text}
            low={clock(mine).low}
            active={myTurn}
            material={materialLead(chess, mine)}
          />
        </div>
        <div className="w-full max-w-sm space-y-3" style={{ maxWidth: Math.max(280, Math.min(size, 360)) }}>
          <div className="glass rounded-2xl p-3 text-center text-sm">
            {playing ? (
              <>
                <span className="font-semibold">{myTurn ? "Your move" : `${opp?.name ?? "Opponent"} to move`}</span>
                {v.check && <span className="ml-2 font-bold text-rose-300">Check</span>}
                {!v.clockRunning && firstMoveLeft > 0 && <div className="mt-1 text-xs text-amber-300">First move within {Math.ceil(firstMoveLeft / 1000)}s or the game is aborted</div>}
              </>
            ) : (
              <span className="text-zinc-400">Game over</span>
            )}
          </div>
          <MoveList san={v.san} />
          {playing && (
            <div className="space-y-2">
              {v.drawOffer && v.drawOffer !== mine && (
                <div className="rounded-xl bg-violet-500/15 p-3 text-center text-sm ring-1 ring-violet-400/30">
                  {opp?.name ?? "Opponent"} offers a draw
                  <div className="mt-2 flex justify-center gap-2">
                    <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => send({ t: "draw-accept" })}>Accept</button>
                    <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => send({ t: "draw-decline" })}>Decline</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {v.canClaim ? (
                  <button className="btn btn-primary text-xs" onClick={() => send({ t: "claim-draw" })}>Claim draw</button>
                ) : (
                  <button className="btn btn-ghost text-xs" disabled={v.drawOffer === mine || v.moves.length < 2} onClick={() => send({ t: "draw-offer" })}>
                    {v.drawOffer === mine ? "Draw offered" : "Offer draw"}
                  </button>
                )}
                {confirmResign ? (
                  <button className="btn btn-danger text-xs" onClick={() => send({ t: "resign" })}>{v.moves.length < 2 ? "Confirm abort" : "Confirm resign"}</button>
                ) : (
                  <button className="btn btn-ghost text-xs text-rose-300" onClick={() => setConfirmResign(true)}>{v.moves.length < 2 ? "Abort" : "Resign"}</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
  );
}

function toUci(m: { from: number; to: number; promotion?: Promotion }) {
  const n = (i: number) => "abcdefgh"[i % 8] + (Math.floor(i / 8) + 1);
  return n(m.from) + n(m.to) + (m.promotion ?? "");
}

// ---------- vs computer ----------

function VsComputer() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useMe().user;
  const size = useChessBoardSize();
  const level = (Math.min(4, Math.max(1, Number(params.get("level")) || 2)) as BotLevel);
  const mine: Color = params.get("color") === "b" ? "b" : "w";
  const game = useRef(new Chess());
  const [, redraw] = useState(0);
  const [over, setOver] = useState<Outcome | null>(null);
  const [thinking, setThinking] = useState(false);
  const botName = BOT_LEVELS.find((b) => b.level === level)?.name ?? "Computer";
  const chess = game.current;
  // One leaderboard report per game; a take-back makes the game not count.
  const run = useRef({ id: crypto.randomUUID(), start: Date.now(), reported: false, tookBack: false });

  useEffect(() => {
    const r = run.current;
    if (!over || r.reported || r.tookBack) return;
    r.reported = true;
    reportCpuResult("chess", r.id, String(level), over.winner === null ? "draw" : over.winner === mine ? "win" : "loss", Date.now() - r.start);
  }, [over, level, mine]);

  const finishIfOver = () => {
    const o = chess.outcome();
    if (o) {
      setOver(o);
      if (o.winner === mine) sfx.win();
      else if (o.winner) sfx.gameOver();
      return true;
    }
    return false;
  };

  // The computer moves on its turn (after a short pause so it feels natural).
  useEffect(() => {
    if (over || chess.turn === mine) return;
    setThinking(true);
    const t = setTimeout(() => {
      const mv = botMove(chess, level);
      chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      sfx.move();
      setThinking(false);
      redraw((n) => n + 1);
      finishIfOver();
    }, 350);
    return () => clearTimeout(t);
  });

  const play = (mv: { from: number; to: number; promotion?: Promotion }) => {
    if (!chess.move(mv)) return;
    sfx.move();
    redraw((n) => n + 1);
    finishIfOver();
  };
  const undo = () => {
    // Take back your last move (and the computer's reply).
    run.current.tookBack = true;
    chess.undo();
    if (chess.turn !== mine) chess.undo();
    setOver(null);
    redraw((n) => n + 1);
  };
  const restart = () => {
    game.current = new Chess();
    run.current = { id: crypto.randomUUID(), start: Date.now(), reported: false, tookBack: false };
    setOver(null);
    redraw((n) => n + 1);
  };
  const last = chess.history[chess.history.length - 1];
  const claim = chess.canClaimThreefold() || chess.canClaimFifty();

  return (
    <GameShell title="vs Computer" kicker={botName} back="/games/chess" onBack={() => navigate("/games/chess")}>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex flex-col items-center gap-2" style={{ width: size }}>
          <PlayerBar name={`Computer · ${botName}`} avatar="t-I" color="#a1a1aa" active={!over && chess.turn !== mine} material={materialLead(chess, mine === "w" ? "b" : "w")} />
          <div className="relative">
            <ChessBoard chess={chess} orientation={mine} size={size} interactive={!over && chess.turn === mine} lastMove={last ? { from: last.from, to: last.to } : null} onMove={play} />
            {over && (
              <div className="absolute inset-0 grid place-items-center bg-black/50">
                <div className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center animate-in">
                  <div className={`text-3xl font-black ${resultText(over.winner, mine, over.reason).tone}`}>{resultText(over.winner, mine, over.reason).title}</div>
                  <div className="text-sm text-zinc-300">{REASON[over.reason] ?? over.reason}</div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={restart}>Play again</button>
                    <button className="btn btn-ghost" onClick={undo}>Take back</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <PlayerBar name={me.displayName} avatar={me.avatar} color={me.color} active={!over && chess.turn === mine} material={materialLead(chess, mine)} />
        </div>
        <div className="w-full max-w-sm space-y-3" style={{ maxWidth: Math.max(280, Math.min(size, 360)) }}>
          <div className="glass rounded-2xl p-3 text-center text-sm">
            {over ? "Game over" : thinking ? "Computer is thinking…" : "Your move"}
            {!over && chess.inCheck() && <span className="ml-2 font-bold text-rose-300">Check</span>}
          </div>
          <MoveList san={chess.history.map((m) => m.san)} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-ghost text-xs" disabled={thinking || chess.history.length < 1} onClick={undo}>Take back</button>
            {claim && !over ? (
              <button className="btn btn-primary text-xs" onClick={() => setOver({ winner: null, reason: chess.canClaimThreefold() ? "threefold" : "fifty" })}>Claim draw</button>
            ) : (
              <button className="btn btn-ghost text-xs text-rose-300" disabled={!!over} onClick={() => setOver({ winner: mine === "w" ? "b" : "w", reason: "resign" as Outcome["reason"] })}>Resign</button>
            )}
          </div>
          <div className="text-center text-xs text-zinc-500">
            {run.current.tookBack ? "You took back a move, so this game won't count on the leaderboard." : "Wins count on the vs Computer leaderboard. Taking back a move stops this game from counting."}
          </div>
        </div>
      </div>
    </GameShell>
  );
}
