import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { GENERALS_CLOCK, GENERALS_SETUP_MS } from "../../../shared/games/clocks";
import { GeneralsGame, RANK_INFO, neighbors, randomSetup, setupZone, type GGMoveResult, type Placement, type Rank, type Side } from "../../../shared/games/generals";
import { botMove, botObserve, botSetup, type BotMemory } from "../../../shared/games/generalsBot";
import { isValidRoomCode } from "../../../shared/protocol";
import { ConnectionBanner, ErrorPanel, GameShell, InvitePanel, MatchLobby, fmtMs } from "../../components/GameShell";
import { GameLogo } from "../../components/GameLogo";
import { IconPlay } from "../../components/icons";
import { Avatar } from "../../components/marks";
import { Card, SectionTitle, StatTile } from "../../components/ui";
import { GeneralsBoard, useGGBoardSize, type GGCell } from "../../games/generals/Board";
import { GGPieceView } from "../../games/generals/Insignia";
import { CustomizeSection, GeneralsLook } from "../../games/LookPickers";
import { getGGPieces } from "../../games/looks";
import { refreshMe, useMe } from "../../lib/auth";
import { reportCpuResult } from "../../lib/cpuResults";
import { useRoomSocket } from "../../lib/roomSocket";
import { sfx } from "../../lib/sfx";
import { settingsStore } from "../../lib/store";

export default function GeneralsPage() {
  const { code } = useParams();
  if (code === "computer") return <VsComputer />;
  if (code) return <Match key={code} code={code.toUpperCase()} />;
  return <Home />;
}

const REASON: Record<string, string> = {
  "flag-captured": "Flag captured",
  "flag-reached": "Flag reached the far side",
  "no-moves": "No moves left",
  resign: "Resignation",
  timeout: "Time out",
  forfeit: "Opponent left",
  agreement: "Draw agreed",
  aborted: "Game aborted",
};

const rand = () => Math.random();

// ---------- Home ----------

function Home() {
  const navigate = useNavigate();
  const s = useMe().games.generals;
  return (
    <GameShell title="Game of the Generals" kicker="0xHub" back="/games">
      <div className="mx-auto w-full max-w-3xl space-y-6 animate-in">
        <div className="flex items-center gap-4">
          <GameLogo game="generals" size={56} />
          <div>
            <h1 className="text-3xl font-bold">Game of the Generals</h1>
            <p className="text-zinc-400">Set up your army in secret, then outwit your opponent. Only the arbiter knows the ranks.</p>
          </div>
        </div>
        <MatchLobby
          game="generals"
          roomPath={(c) => `/games/generals/${c}`}
          quickHint="Play the next person looking for a game. 3 minutes to set up, then 10 minutes each + 5 s per move."
          extra={
            <button onClick={() => navigate("/games/generals/computer")} className="glass glass-hover flex items-center gap-4 rounded-2xl p-5 text-left sm:col-span-2">
              <span className="grid size-12 place-items-center rounded-xl bg-lime-500/20 text-lime-200 ring-1 ring-lime-400/30"><IconPlay width={20} height={20} /></span>
              <div>
                <div className="text-lg font-bold">Play the computer</div>
                <div className="text-sm text-zinc-400">Set up your army and take on the computer. Wins count on the vs Computer leaderboard.</div>
              </div>
            </button>
          }
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Rating" value={s.rating} accent="#65a30d" />
          <StatTile label="Wins" value={s.wins} accent="#34d399" />
          <StatTile label="Losses" value={s.losses} accent="#f43f5e" />
          <StatTile label="Draws" value={s.draws} accent="#60a5fa" />
        </div>
        <Card>
          <SectionTitle>Rules</SectionTitle>
          <ul className="space-y-1.5 text-sm text-zinc-400">
            <li>Each side has 21 pieces: 5 generals (5★ to 1★), Colonel, Lt Colonel, Major, Captain, 1st and 2nd Lieutenant, Sergeant, 6 Privates, 2 Spies and the Flag.</li>
            <li>Setup: arrange your pieces anywhere in your first three rows. Tap two of your pieces to swap them, or a piece and an empty square to move it.</li>
            <li>Move one square forward, back or sideways. Moving onto an enemy piece is a challenge: the higher rank wins, equal ranks are both eliminated.</li>
            <li>The Spy eliminates every officer (Sergeant and up) but loses to a Private. Any piece eliminates the Flag; a Flag attacking the other Flag wins.</li>
            <li>Win by capturing the enemy Flag, or by bringing your Flag to the far row. If it arrives next to an enemy piece, it must survive one more turn.</li>
            <li>The arbiter never reveals ranks: you only learn which piece was eliminated. Everything is revealed when the game ends.</li>
          </ul>
        </Card>
        <CustomizeSection>
          <GeneralsLook />
        </CustomizeSection>
      </div>
    </GameShell>
  );
}

// ---------- shared ----------

/** Board cells for the setup screen: your placement only. */
function setupCells(side: Side, placement: Placement): GGCell[] {
  const cells: GGCell[] = new Array(72).fill(null);
  placement.forEach((p, i) => (cells[p.cell] = { id: i, side, rank: p.rank }));
  return cells;
}

/** Tap-to-swap editing of a placement inside your setup zone. */
function useSetupEditor(side: Side, placement: Placement, onChange: (p: Placement) => void, locked: boolean) {
  const [sel, setSel] = useState<number | null>(null);
  const zone = useMemo(() => setupZone(side), [side]);
  const tap = (cell: number) => {
    if (locked || !zone.includes(cell)) return setSel(null);
    const here = placement.findIndex((p) => p.cell === cell);
    if (sel === null) {
      if (here >= 0) setSel(cell);
      return;
    }
    if (sel === cell) return setSel(null);
    const from = placement.findIndex((p) => p.cell === sel);
    const next = placement.map((p) => ({ ...p }));
    if (from >= 0) {
      if (here >= 0) next[here].cell = sel; // swap
      next[from].cell = cell;
      onChange(next);
    }
    setSel(null);
  };
  const empties = zone.filter((c) => !placement.some((p) => p.cell === c));
  return { sel, tap, marked: sel !== null ? zone.filter((c) => c !== sel) : empties };
}

function SetupLegend() {
  const set = getGGPieces(settingsStore.use().ggPieces);
  const order: Rank[] = ["G5", "G4", "G3", "G2", "G1", "COL", "LTC", "MAJ", "CPT", "1LT", "2LT", "SGT", "PVT", "SPY", "FLG"];
  return (
    <details className="glass rounded-2xl p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Ranks, strongest first</summary>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {order.map((r) => (
          <div key={r} className="flex flex-col items-center gap-1 text-center text-[11px] text-zinc-300">
            <GGPieceView rank={r} mine set={set} size={34} />
            {RANK_INFO[r].name}
            {RANK_INFO[r].count > 1 ? ` ×${RANK_INFO[r].count}` : ""}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-400">Spy beats Sergeant and every officer; Private beats Spy; anything beats the Flag.</p>
    </details>
  );
}

/** Legal targets for a piece of yours: orthogonal neighbours not holding your own piece. */
function targetsFor(cells: GGCell[], me: Side, from: number | null): number[] {
  if (from === null || cells[from]?.side !== me) return [];
  return neighbors(from).filter((c) => cells[c]?.side !== me);
}

/** One line describing the last move from your point of view. */
function lastMoveText(last: GGMoveResult | null, me: Side): string {
  if (!last) return "";
  const mine = last.side === me;
  if (!last.challenge) return mine ? "You moved." : "Opponent moved.";
  if (last.challenge === "both") return "Challenge: both pieces were eliminated.";
  const attackerWon = last.challenge === "attacker";
  return mine === attackerWon ? "Challenge won: an enemy piece was eliminated." : "Challenge lost: you lost a piece.";
}

function Losses({ lost, killed }: { lost: Rank[]; killed: number | Rank[] }) {
  const set = getGGPieces(settingsStore.use().ggPieces);
  return (
    <div className="glass space-y-2 rounded-2xl p-3 text-sm">
      <div className="flex justify-between">
        <span className="text-zinc-400">Enemy pieces eliminated</span>
        <b>{typeof killed === "number" ? killed : killed.length}</b>
      </div>
      {Array.isArray(killed) && killed.length > 0 && (
        <div className="flex flex-wrap gap-1">{killed.map((r, i) => <GGPieceView key={i} rank={r} mine={false} set={set} size={26} label={false} />)}</div>
      )}
      <div className="flex justify-between">
        <span className="text-zinc-400">Your losses</span>
        <b>{lost.length}</b>
      </div>
      {lost.length > 0 && <div className="flex flex-wrap gap-1">{lost.map((r, i) => <GGPieceView key={i} rank={r} mine set={set} size={26} label={false} />)}</div>}
    </div>
  );
}

function Bar({ name, avatar, color, clock, active, low, note }: { name: string; avatar: string; color: string; clock?: string; active: boolean; low?: boolean; note?: string }) {
  return (
    <div className="flex w-full items-center gap-3">
      <Avatar avatar={avatar} color={color} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        {note && <div className="text-xs text-zinc-500">{note}</div>}
      </div>
      {clock !== undefined && (
        <div className={`rounded-lg px-3 py-1 font-mono text-lg font-bold tabular-nums ${active ? (low ? "bg-rose-500 text-white" : "bg-white text-black") : "bg-white/10 text-zinc-300"}`}>{clock}</div>
      )}
    </div>
  );
}

function outcomeTitle(winner: Side | null, me: Side, reason: string) {
  if (reason === "aborted") return { title: "ABORTED", tone: "text-zinc-200" };
  if (winner === null) return { title: "DRAW", tone: "text-zinc-200" };
  return winner === me ? { title: "VICTORY", tone: "text-amber-300" } : { title: "DEFEAT", tone: "text-rose-400" };
}

// ---------- online ----------

interface GGView {
  phase: "waiting" | "setup" | "playing" | "ended";
  players: { id: string; name: string; avatar: string; color: string; rating?: number; connected: boolean }[];
  side0: string;
  you: Side;
  setupMsLeft: number;
  mySetup: Placement | null;
  ready: string[];
  cells: GGCell[] | null;
  turn: Side;
  moves: number;
  pendingFlag: { side: Side; cell: number } | null;
  lost: Rank[];
  killed: number | Rank[];
  last: GGMoveResult | null;
  clocks: [number, number];
  clockRunning: boolean;
  firstMoveMsLeft: number;
  drawOffer: Side | null;
  rematch: string[];
  result: { winner: Side | null; reason: string; deltas: Record<string, number> | null } | null;
}

function Match({ code }: { code: string }) {
  const navigate = useNavigate();
  const me = useMe().user;
  const size = useGGBoardSize();
  const valid = isValidRoomCode(code);
  const [v, setV] = useState<GGView | null>(null);
  const [draft, setDraft] = useState<Placement | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const received = useRef(0);
  const lastPhase = useRef("");
  const [, tick] = useState(0);

  const { sock, status, error } = useRoomSocket(valid ? `/api/ws/generals/room/${code}` : null, (m) => {
    if (m.t === "state") {
      const s = m as unknown as GGView;
      received.current = performance.now();
      if (s.phase === "setup" && lastPhase.current !== "setup") setDraft(s.mySetup);
      if (s.phase === "playing" && s.moves > 0 && s.last) {
        if (s.last.challenge) sfx.lock();
        else sfx.move();
      }
      if (s.phase === "ended" && lastPhase.current === "playing") {
        if (s.result?.winner === s.you) sfx.win();
        else if (s.result?.winner !== null) sfx.gameOver();
        void refreshMe();
      }
      lastPhase.current = s.phase;
      setSel(null);
      setConfirmResign(false);
      setV(s);
    } else if (m.t === "presence") setV((cur) => (cur ? { ...cur, players: m.players } : cur));
  });

  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, []);

  // Keep the server's copy of your setup current, so it's used if setup time runs out.
  useEffect(() => {
    if (v?.phase !== "setup" || !draft) return;
    const t = setTimeout(() => sock?.send({ t: "setup", placement: draft }), 400);
    return () => clearTimeout(t);
  }, [draft, v?.phase, sock]);

  const iAmReady = !!v && v.ready.includes(me.id);
  const editor = useSetupEditor(v?.you ?? 0, draft ?? [], setDraft, iAmReady);

  const leave = () => navigate("/games/generals");
  const shell = (body: React.ReactNode) => (
    <GameShell title="Game of the Generals" kicker="1v1" back="/games/generals" onBack={leave}>
      {body}
    </GameShell>
  );
  if (!valid) return shell(<ErrorPanel message="That room code isn't valid." onBack={leave} />);
  if (status === "error") return shell(<ErrorPanel message={error || "Something went wrong."} onBack={leave} />);
  if (!v || (v.phase === "waiting" && v.players.length < 2)) {
    return shell(
      <InvitePanel code={code} path={`/games/generals/${code}`} waitingText={status === "open" ? "Waiting for an opponent to join…" : "Connecting…"}>
        <button className="btn btn-ghost" onClick={leave}>Leave room</button>
      </InvitePanel>,
    );
  }

  const opp = v.players.find((p) => p.id !== me.id);
  const meSide = v.you;
  const oppSide: Side = meSide === 0 ? 1 : 0;
  const elapsed = performance.now() - received.current;
  const send = (m: Record<string, unknown>) => sock?.send(m as { t: string });

  if (v.phase === "setup") {
    const left = v.setupMsLeft - elapsed;
    const oppReady = !!opp && v.ready.includes(opp.id);
    return shell(
      <>
        <ConnectionBanner status={status} />
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
          <div className="flex flex-col items-center gap-2" style={{ width: size }}>
            <div className="w-full text-center text-sm text-zinc-400">{opp?.name ?? "Opponent"} is setting up too · {oppReady ? <b className="text-emerald-300">ready</b> : "not ready"}</div>
            <GeneralsBoard cells={setupCells(meSide, draft ?? [])} me={meSide} size={size} onTap={editor.tap} selected={editor.sel} marked={iAmReady ? [] : editor.marked} />
          </div>
          <div className="w-full max-w-sm space-y-3">
            <div className="glass rounded-2xl p-4 text-center">
              <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">Setup time</div>
              <div className={`font-mono text-3xl font-bold ${left < 30_000 ? "text-rose-400" : ""}`}>{fmtMs(left)}</div>
              <div className="mt-1 text-xs text-zinc-400">Tap two pieces to swap them, or a piece then an empty square.</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-ghost" disabled={iAmReady} onClick={() => setDraft(randomSetup(meSide, rand))}>Randomize</button>
              {iAmReady ? (
                <button className="btn btn-ghost" onClick={() => send({ t: "unready" })}>Edit again</button>
              ) : (
                <button className="btn btn-primary" disabled={!draft} onClick={() => send({ t: "ready", placement: draft })}>Ready</button>
              )}
            </div>
            {iAmReady && <div className="text-center text-sm text-emerald-300">Ready. Waiting for {opp?.name ?? "your opponent"}…</div>}
            <SetupLegend />
          </div>
        </div>
      </>,
    );
  }

  const cells = v.cells ?? [];
  const playing = v.phase === "playing";
  const myTurn = playing && v.turn === meSide;
  const targets = myTurn ? targetsFor(cells, meSide, sel) : [];
  const tap = (c: number) => {
    if (!myTurn) return;
    if (sel !== null && targets.includes(c)) {
      send({ t: "move", from: sel, to: c });
      setSel(null);
      return;
    }
    setSel(cells[c]?.side === meSide && c !== sel ? c : null);
  };
  const clock = (s: Side) => {
    const left = v.clocks[s] - (v.clockRunning && v.turn === s ? elapsed : 0);
    return { text: fmtMs(left), low: left < 30_000 };
  };
  const r = v.result;
  const firstMoveLeft = v.firstMoveMsLeft - elapsed;

  return shell(
    <>
      <ConnectionBanner status={status} />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex flex-col items-center gap-2" style={{ width: size }}>
          <Bar name={opp?.name ?? "Opponent"} avatar={opp?.avatar ?? "none"} color={opp?.color ?? "#71717a"} clock={clock(oppSide).text} low={clock(oppSide).low} active={playing && v.turn === oppSide} note={opp && !opp.connected ? "disconnected" : opp?.rating ? `Rating ${opp.rating}` : undefined} />
          <div className="relative">
            <GeneralsBoard cells={cells} me={meSide} size={size} onTap={tap} selected={sel} marked={targets} last={v.last} pending={v.pendingFlag?.cell ?? null} />
            {r && (
              <div className="absolute inset-x-0 top-1/3 flex justify-center">
                <div className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center animate-in">
                  <div className={`text-3xl font-black ${outcomeTitle(r.winner, meSide, r.reason).tone}`}>{outcomeTitle(r.winner, meSide, r.reason).title}</div>
                  <div className="text-sm text-zinc-300">{REASON[r.reason] ?? r.reason} · all ranks revealed</div>
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
          <Bar name={me.displayName} avatar={me.avatar} color={me.color} clock={clock(meSide).text} low={clock(meSide).low} active={myTurn} />
        </div>
        <div className="w-full max-w-sm space-y-3">
          <div className="glass rounded-2xl p-3 text-center text-sm">
            {playing ? <b>{myTurn ? "Your move" : `${opp?.name ?? "Opponent"} to move`}</b> : <span className="text-zinc-400">Game over</span>}
            {v.last && <div className="mt-1 text-xs text-zinc-300">{lastMoveText(v.last, meSide)}</div>}
            {v.pendingFlag && playing && (
              <div className="mt-1 text-xs font-semibold text-rose-300">
                {v.pendingFlag.side === meSide ? "Your Flag reached the far row. It wins if it survives this turn." : "The enemy Flag reached your back row. Eliminate it now or lose."}
              </div>
            )}
            {playing && !v.clockRunning && firstMoveLeft > 0 && <div className="mt-1 text-xs text-amber-300">First move within {Math.ceil(firstMoveLeft / 1000)}s or the game is aborted</div>}
          </div>
          <Losses lost={v.lost} killed={v.killed} />
          {playing && (
            <div className="space-y-2">
              {v.drawOffer !== null && v.drawOffer !== meSide && (
                <div className="rounded-xl bg-violet-500/15 p-3 text-center text-sm ring-1 ring-violet-400/30">
                  {opp?.name ?? "Opponent"} offers a draw
                  <div className="mt-2 flex justify-center gap-2">
                    <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => send({ t: "draw-accept" })}>Accept</button>
                    <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => send({ t: "draw-decline" })}>Decline</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-ghost text-xs" disabled={v.drawOffer === meSide || v.moves < 2} onClick={() => send({ t: "draw-offer" })}>{v.drawOffer === meSide ? "Draw offered" : "Offer draw"}</button>
                {confirmResign ? (
                  <button className="btn btn-danger text-xs" onClick={() => send({ t: "resign" })}>{v.moves < 2 ? "Confirm abort" : "Confirm resign"}</button>
                ) : (
                  <button className="btn btn-ghost text-xs text-rose-300" onClick={() => setConfirmResign(true)}>{v.moves < 2 ? "Abort" : "Resign"}</button>
                )}
              </div>
            </div>
          )}
          <div className="text-center text-xs text-zinc-500">Clock: {GENERALS_CLOCK.baseMs / 60_000} min + {GENERALS_CLOCK.incMs / 1000} s per move</div>
        </div>
      </div>
    </>,
  );
}

// ---------- vs computer ----------

function VsComputer() {
  const navigate = useNavigate();
  const me = useMe().user;
  const size = useGGBoardSize();
  const ME: Side = 0;
  const BOT: Side = 1;
  const [phase, setPhase] = useState<"setup" | "playing" | "ended">("setup");
  const [draft, setDraft] = useState<Placement>(() => randomSetup(ME, rand));
  const game = useRef<GeneralsGame | null>(null);
  const memory = useRef<BotMemory>({});
  const [last, setLast] = useState<GGMoveResult | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [, redraw] = useState(0);
  const editor = useSetupEditor(ME, draft, setDraft, phase !== "setup");
  // One leaderboard report per game.
  const run = useRef({ id: "", start: 0, reported: false });

  useEffect(() => {
    const g = game.current, r = run.current;
    if (phase !== "ended" || !g || r.reported) return;
    r.reported = true;
    reportCpuResult("generals", r.id, "standard", g.winner === null ? "draw" : g.winner === ME ? "win" : "loss", Date.now() - r.start);
  }, [phase]);

  const start = () => {
    game.current = new GeneralsGame(draft, botSetup(BOT, rand), ME);
    run.current = { id: crypto.randomUUID(), start: Date.now(), reported: false };
    memory.current = {};
    setLast(null);
    setPhase("playing");
  };

  const apply = (side: Side, from: number, to: number) => {
    const g = game.current!;
    const attackerId = g.cells[from]?.id ?? -1;
    const defenderId = g.cells[to]?.id ?? null;
    const res = g.move(side, from, to);
    if (!res) return;
    botObserve(memory.current, g, BOT, res, attackerId, defenderId);
    if (res.challenge) sfx.lock();
    else sfx.move();
    setLast(res);
    if (g.winner !== null) {
      setPhase("ended");
      if (g.winner === ME) sfx.win();
      else sfx.gameOver();
    }
    redraw((n) => n + 1);
  };

  // Computer's turn.
  useEffect(() => {
    const g = game.current;
    if (phase !== "playing" || !g || g.turn !== BOT || g.winner !== null) return;
    const t = setTimeout(() => {
      const mv = botMove(g, BOT, memory.current, rand);
      if (mv) apply(BOT, mv.from, mv.to);
    }, 550);
    return () => clearTimeout(t);
  });

  const g = game.current;
  const back = () => navigate("/games/generals");

  if (phase === "setup" || !g) {
    return (
      <GameShell title="vs Computer" kicker="Game of the Generals" back="/games/generals" onBack={back}>
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
          <GeneralsBoard cells={setupCells(ME, draft)} me={ME} size={size} onTap={editor.tap} selected={editor.sel} marked={editor.marked} />
          <div className="w-full max-w-sm space-y-3">
            <div className="glass rounded-2xl p-4 text-sm text-zinc-300">Arrange your army in your three rows. Tap two pieces to swap them, or a piece and then an empty square. The computer sets up in secret.</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-ghost" onClick={() => setDraft(randomSetup(ME, rand))}>Randomize</button>
              <button className="btn btn-primary" onClick={start}>Start battle</button>
            </div>
            <SetupLegend />
          </div>
        </div>
      </GameShell>
    );
  }

  const over = phase === "ended";
  const cells = g.viewFor(ME, over) as GGCell[];
  const myTurn = !over && g.turn === ME;
  const targets = myTurn ? targetsFor(cells, ME, sel) : [];
  const tap = (c: number) => {
    if (!myTurn) return;
    if (sel !== null && targets.includes(c)) {
      apply(ME, sel, c);
      setSel(null);
      return;
    }
    setSel(cells[c]?.side === ME && c !== sel ? c : null);
  };
  const t = over ? outcomeTitle(g.winner, ME, g.reason ?? "") : null;

  return (
    <GameShell title="vs Computer" kicker="Game of the Generals" back="/games/generals" onBack={back}>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex flex-col items-center gap-2" style={{ width: size }}>
          <Bar name="Computer" avatar="t-I" color="#a1a1aa" active={!over && g.turn === BOT} />
          <div className="relative">
            <GeneralsBoard cells={cells} me={ME} size={size} onTap={tap} selected={sel} marked={targets} last={last} pending={g.pendingFlag?.cell ?? null} />
            {over && t && (
              <div className="absolute inset-x-0 top-1/3 flex justify-center">
                <div className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center animate-in">
                  <div className={`text-3xl font-black ${t.tone}`}>{t.title}</div>
                  <div className="text-sm text-zinc-300">{REASON[g.reason ?? ""] ?? g.reason} · all ranks revealed</div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={() => { setPhase("setup"); game.current = null; }}>Play again</button>
                    <button className="btn btn-ghost" onClick={back}>Back</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <Bar name={me.displayName} avatar={me.avatar} color={me.color} active={myTurn} />
        </div>
        <div className="w-full max-w-sm space-y-3">
          <div className="glass rounded-2xl p-3 text-center text-sm">
            {over ? <span className="text-zinc-400">Game over</span> : <b>{myTurn ? "Your move" : "Computer is thinking…"}</b>}
            {last && <div className="mt-1 text-xs text-zinc-300">{lastMoveText(last, ME)}</div>}
            {g.pendingFlag && !over && (
              <div className="mt-1 text-xs font-semibold text-rose-300">
                {g.pendingFlag.side === ME ? "Your Flag reached the far row. It wins if it survives this turn." : "The enemy Flag reached your back row. Eliminate it now or lose."}
              </div>
            )}
          </div>
          <Losses lost={g.captured[ME].map((p) => p.rank)} killed={over ? g.captured[BOT].map((p) => p.rank) : g.captured[BOT].length} />
          {!over && (
            <button
              className="btn btn-ghost w-full text-xs text-rose-300"
              onClick={() => {
                g.winner = BOT;
                g.reason = "resign";
                setPhase("ended");
              }}
            >
              Resign
            </button>
          )}
          <div className="text-center text-xs text-zinc-500">Wins count on the vs Computer leaderboard. Setup time: {GENERALS_SETUP_MS / 60_000} min online.</div>
        </div>
      </div>
    </GameShell>
  );
}
