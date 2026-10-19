import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { SNAKE_H, SNAKE_MAX_PLAYERS, SNAKE_ROUND_MS, SNAKE_TICK_MS, SNAKE_W, type SnakeSnapshot } from "../../../shared/games/snake";
import { isValidRoomCode, randomRoomCode } from "../../../shared/protocol";
import { ConnectionBanner, ErrorPanel, GameShell, InvitePanel, MatchLobby, fmtMs } from "../../components/GameShell";
import { GameLogo } from "../../components/GameLogo";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconPlay } from "../../components/icons";
import { Avatar, RankBadge } from "../../components/marks";
import { Card, SectionTitle, StatTile } from "../../components/ui";
import { refreshMe, useMe } from "../../lib/auth";
import { useRoomSocket } from "../../lib/roomSocket";
import { sfx } from "../../lib/sfx";
import { settingsStore } from "../../lib/store";
import { getSnakeArena, getSnakeSkin } from "../../games/looks";
import { drawArena } from "../../games/snake/render";
import { SnakeLook, CustomizeSection } from "../../games/LookPickers";

export default function SnakePage() {
  const { code } = useParams();
  return code ? <Room key={code} code={code.toUpperCase()} /> : <Home />;
}

function Home() {
  const navigate = useNavigate();
  const s = useMe().games.snake;
  return (
    <GameShell title="Snake Arena" kicker="0xHub" back="/games">
      <div className="mx-auto w-full max-w-3xl space-y-6 animate-in">
        <div className="flex items-center gap-4">
          <GameLogo game="snake" size={56} />
          <div>
            <h1 className="text-3xl font-bold">Snake Arena</h1>
            <p className="text-zinc-400">Up to four snakes, one arena, two minutes. Eat to grow, trap rivals for kills.</p>
          </div>
        </div>
        <MatchLobby
          game="snake"
          roomPath={(c, auto) => `/games/snake/${c}${auto ? "?auto=1" : ""}`}
          quickHint="Join the next round with other players. Empty slots are filled with bots."
          extra={
            <button onClick={() => navigate(`/games/snake/${randomRoomCode()}?practice=1`)} className="glass glass-hover flex items-center gap-4 rounded-2xl p-5 text-left sm:col-span-2">
              <span className="grid size-12 place-items-center rounded-xl bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30"><IconPlay width={20} height={20} /></span>
              <div>
                <div className="text-lg font-bold">Practice vs bots</div>
                <div className="text-sm text-zinc-400">Jump straight into a round against three bots.</div>
              </div>
            </button>
          }
        />
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Rounds" value={s.played} accent="#4ade80" />
          <StatTile label="Wins" value={s.wins} accent="#facc15" />
          <StatTile label="Best score" value={s.bestScore} accent="#60a5fa" />
        </div>
        <Card>
          <SectionTitle>Rules</SectionTitle>
          <ul className="space-y-1.5 text-sm text-zinc-400">
            <li>Steer with arrow keys / WASD, or swipe. Food is +1 point.</li>
            <li>Crash into a wall or a snake and you respawn a few seconds later. If you crashed into someone else, they get +5.</li>
            <li>Highest score after two minutes wins.</li>
          </ul>
        </Card>
        <CustomizeSection>
          <SnakeLook />
        </CustomizeSection>
      </div>
    </GameShell>
  );
}

interface Lobby {
  phase: "lobby" | "countdown" | "playing" | "ended";
  players: { id: string; name: string; avatar: string; color: string; connected: boolean }[];
  hostId: string;
  auto: boolean;
  fillBots: boolean;
  autoStartIn: number;
  startsIn: number;
  results: { id: string; name: string; avatar: string; color: string; bot: boolean; place: number; score: number; kills: number }[] | null;
}

function Room({ code }: { code: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const auto = params.get("auto") === "1";
  const practice = params.get("practice") === "1";
  const me = useMe().user;
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const snaps = useRef<{ prev: SnakeSnapshot | null; cur: SnakeSnapshot | null; at: number; msLeft: number }>({ prev: null, cur: null, at: 0, msLeft: SNAKE_ROUND_MS });
  const timers = useRef({ autoAt: 0, startAt: 0 });
  const [, redraw] = useState(0);
  const valid = isValidRoomCode(code);
  const startedPractice = useRef(false);
  const lastPhase = useRef("");

  const { sock, status, error } = useRoomSocket(
    valid ? `/api/ws/snake/room/${code}` : null,
    (m) => {
      if (m.t === "lobby") {
        const l = m as unknown as Lobby;
        const now = performance.now();
        timers.current = { autoAt: now + l.autoStartIn, startAt: now + l.startsIn };
        if (l.phase === "countdown" && lastPhase.current !== "countdown") sfx.countdown(false);
        if (l.phase === "playing" && lastPhase.current !== "playing") sfx.countdown(true);
        lastPhase.current = l.phase;
        setLobby(l);
      } else if (m.t === "tick") {
        const s = snaps.current;
        const prevMine = s.cur?.players.find((p) => p.id === me.id);
        const nowMine = (m.s as SnakeSnapshot).players.find((p) => p.id === me.id);
        if (prevMine && nowMine && prevMine.alive && !nowMine.alive) sfx.ko();
        if (prevMine && nowMine && nowMine.score > prevMine.score) sfx.clear(1);
        snaps.current = { prev: s.cur, cur: m.s, at: performance.now(), msLeft: m.msLeft };
      } else if (m.t === "end") {
        sfx.win();
        void refreshMe();
      } else if (m.t === "presence") {
        setLobby((cur) => (cur ? { ...cur, players: m.players } : cur));
      }
    },
    (s) => s.send({ t: "hello", auto }),
  );

  // Practice: the host starts immediately (bots fill the arena).
  useEffect(() => {
    if (practice && lobby?.phase === "lobby" && lobby.hostId === me.id && !startedPractice.current && sock) {
      startedPractice.current = true;
      sock.send({ t: "start" });
    }
  }, [practice, lobby, me.id, sock]);

  useEffect(() => {
    const iv = setInterval(() => redraw((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, []);

  // Steering
  useEffect(() => {
    const keys: Record<string, number> = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
    const onKey = (e: KeyboardEvent) => {
      const d = keys[e.code];
      if (d === undefined || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      sock?.send({ t: "dir", d });
    };
    let start: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => (start = { x: e.clientX, y: e.clientY });
    const up = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
      sock?.send({ t: "dir", d: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0 });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [sock]);

  const leave = () => navigate("/games/snake");
  if (!valid) return <GameShell title="Snake Arena" kicker="Arena" back="/games/snake"><ErrorPanel message="That room code isn't valid." onBack={leave} /></GameShell>;
  if (status === "error") return <GameShell title="Snake Arena" kicker="Arena" back="/games/snake"><ErrorPanel message={error || "Something went wrong."} onBack={leave} /></GameShell>;
  if (!lobby) return <GameShell title="Snake Arena" kicker="Arena" back="/games/snake" onBack={leave}><div className="py-16 text-center text-zinc-400">Connecting…</div></GameShell>;

  const isHost = lobby.hostId === me.id;
  const now = performance.now();

  if (lobby.phase === "lobby" || (lobby.phase === "ended" && !lobby.results)) {
    const autoIn = Math.max(0, Math.ceil((timers.current.autoAt - now) / 1000));
    return (
      <GameShell title="Snake Arena" kicker="Lobby" back="/games/snake" onBack={leave}>
        <ConnectionBanner status={status} />
        {!lobby.auto && !practice && <InvitePanel code={code} path={`/games/snake/${code}`} waitingText={`${lobby.players.length} of ${SNAKE_MAX_PLAYERS} players`} />}
        <div className="mx-auto w-full max-w-xl space-y-4">
          <Card className="space-y-2">
            {Array.from({ length: SNAKE_MAX_PLAYERS }, (_, i) => {
              const p = lobby.players[i];
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
                  {p ? <Avatar avatar={p.avatar} color={p.color} size={30} /> : <span className="size-[30px] rounded-xl border border-dashed border-white/15" />}
                  <span className="flex-1 text-sm font-medium">{p ? p.name : lobby.fillBots ? "Bot (fills at start)" : "Open slot"}</span>
                  {p?.id === lobby.hostId && <span className="chip">Host</span>}
                </div>
              );
            })}
          </Card>
          {lobby.auto ? (
            <div className="text-center text-sm text-zinc-400">Round starts in <b className="font-mono text-white">{autoIn}s</b>…</div>
          ) : isHost ? (
            <div className="flex flex-col items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-violet-500" checked={lobby.fillBots} onChange={(e) => sock?.send({ t: "bots", on: e.target.checked })} />
                Fill empty slots with bots
              </label>
              <button className="btn btn-primary pulse-ring" onClick={() => sock?.send({ t: "start" })}>Start round</button>
            </div>
          ) : (
            <div className="text-center text-sm text-zinc-400">Waiting for the host to start…</div>
          )}
        </div>
      </GameShell>
    );
  }

  if (lobby.phase === "ended" && lobby.results) {
    return (
      <GameShell title="Snake Arena" kicker="Results" back="/games/snake" onBack={leave}>
        <div className="mx-auto w-full max-w-xl space-y-4 animate-in">
          <Card className="space-y-2">
            {lobby.results.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${r.id === me.id ? "bg-violet-500/15 ring-1 ring-violet-400/30" : "bg-white/5"}`}>
                <RankBadge rank={r.place} />
                <Avatar avatar={r.avatar} color={r.color} size={30} />
                <span className="flex-1 text-sm font-medium">{r.name}</span>
                <span className="text-xs text-zinc-400">{r.kills} kills</span>
                <span className="w-14 text-right font-mono font-bold">{r.score}</span>
              </div>
            ))}
          </Card>
          <div className="flex justify-center gap-2">
            {isHost && <button className="btn btn-primary" onClick={() => sock?.send({ t: "again" })}>Back to lobby</button>}
            <button className="btn btn-ghost" onClick={leave}>Leave</button>
          </div>
        </div>
      </GameShell>
    );
  }

  // countdown / playing
  const startsIn = Math.max(0, Math.ceil((timers.current.startAt - now) / 1000));
  const cur = snaps.current.cur;
  const msLeft = cur ? snaps.current.msLeft - (now - snaps.current.at) : SNAKE_ROUND_MS;
  const players = cur ? [...cur.players].sort((a, b) => b.score - a.score) : [];
  const mine = cur?.players.find((p) => p.id === me.id);

  return (
    <GameShell title="Snake Arena" kicker="Arena" back="/games/snake" onBack={leave}>
      <ConnectionBanner status={status} />
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-start justify-center gap-4">
        <div className="flex flex-col items-center gap-3">
          {/* Phones: time and your score above the arena; the full panel is below the controls. */}
          <div className="flex w-full items-center justify-between px-1 text-sm sm:hidden">
            <span className={`font-mono text-lg font-bold ${msLeft < 15000 ? "text-rose-400" : ""}`}>{fmtMs(msLeft)}</span>
            <span>You <b className="font-mono">{mine?.score ?? 0}</b></span>
          </div>
          <div className="relative">
            <Arena snaps={snaps} meId={me.id} />
            {lobby.phase === "countdown" && (
              <div className="absolute inset-0 grid place-items-center bg-black/40">
                <div key={startsIn} className="countdown text-7xl font-bold text-white">{startsIn || "GO!"}</div>
              </div>
            )}
            {mine && !mine.alive && lobby.phase === "playing" && (
              <div className="absolute inset-x-0 top-1/3 text-center">
                <div className="inline-block rounded-xl bg-black/60 px-4 py-2 text-sm">Respawning in {Math.ceil(mine.respawnIn / 10)}…</div>
              </div>
            )}
          </div>
          <TouchPad onDir={(d) => sock?.send({ t: "dir", d })} />
        </div>
        <div className="w-full max-w-xs space-y-3 sm:w-56">
          <div className="glass hidden rounded-2xl p-4 text-center sm:block">
            <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">Time left</div>
            <div className={`font-mono text-3xl font-bold ${msLeft < 15000 ? "text-rose-400" : ""}`}>{fmtMs(msLeft)}</div>
          </div>
          <div className="glass space-y-1.5 rounded-2xl p-3">
            {players.map((p) => (
              <div key={p.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.id === me.id ? "bg-white/10" : ""} ${p.alive ? "" : "opacity-50"}`}>
                <span className="size-3 rounded-full" style={{ background: p.color }} />
                <span className="flex-1 truncate text-sm">{p.name}</span>
                <span className="font-mono text-sm font-bold">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GameShell>
  );
}

function TouchPad({ onDir }: { onDir: (d: number) => void }) {
  const b = "grid h-14 place-items-center rounded-2xl bg-white/8 ring-1 ring-white/15 active:bg-violet-500/40 touch-none";
  const icon = { width: 26, height: 26 };
  return (
    <div className="hidden w-full max-w-xs grid-cols-3 gap-2 pointer-coarse:grid">
      <span />
      <button className={b} aria-label="Up" onPointerDown={() => onDir(0)}><IconChevronDown {...icon} className="rotate-180" /></button>
      <span />
      <button className={b} aria-label="Left" onPointerDown={() => onDir(3)}><IconChevronLeft {...icon} /></button>
      <button className={b} aria-label="Down" onPointerDown={() => onDir(2)}><IconChevronDown {...icon} /></button>
      <button className={b} aria-label="Right" onPointerDown={() => onDir(1)}><IconChevronRight {...icon} /></button>
    </div>
  );
}

function Arena({ snaps, meId }: { snaps: React.RefObject<{ prev: SnakeSnapshot | null; cur: SnakeSnapshot | null; at: number; msLeft: number }>; meId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { snakeSkin, snakeArena } = settingsStore.use();
  const skin = getSnakeSkin(snakeSkin);
  const arena = getSnakeArena(snakeArena);
  const cell = Math.max(9, Math.min(20, Math.floor(Math.min(window.innerWidth - 32, 900) / SNAKE_W), Math.floor((window.innerHeight - 200) / SNAKE_H)));
  const W = SNAKE_W * cell;
  const H = SNAKE_H * cell;

  useEffect(() => {
    let raf = 0;
    const canvas = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = () => {
      const { prev, cur, at } = snaps.current!;
      const t = Math.min(1, (performance.now() - at) / SNAKE_TICK_MS);
      drawArena(ctx, { prev, cur, t, cell, meId, skin, arena });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [snaps, meId, W, H, cell, skin, arena]);

  return <canvas ref={ref} className="block rounded-2xl ring-1" style={{ ["--tw-ring-color" as string]: arena.frame }} aria-label="Snake arena" />;
}
