import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { EndlessEntry } from "../../shared/protocol";
import { Avatar } from "../components/Layout";
import { GameLogo } from "../components/GameLogo";
import { LiveDot } from "../components/marks";
import { IconInfinity, IconPlay, IconSwords } from "../components/icons";
import { Card, Empty, SectionTitle, StatTile } from "../components/ui";
import { GAMES } from "../games/registry";
import { BoardPreview } from "../games/tetris/Customizer";
import { fetchLeaderboard } from "../lib/api";
import { fmtDuration, fmtNum, timeAgo } from "../lib/format";
import { useMe } from "../lib/auth";
import { settingsStore } from "../lib/store";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const me = useMe();
  const profile = me.user;
  const stats = me.stats;
  const settings = settingsStore.use();
  const [top, setTop] = useState<EndlessEntry[] | null>(null);
  const [topErr, setTopErr] = useState(false);

  useEffect(() => {
    fetchLeaderboard("endless")
      .then((r) => setTop(r.slice(0, 5)))
      .catch(() => setTopErr(true));
  }, []);

  const winRate = stats.battles ? Math.round((stats.wins / stats.battles) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="glass relative overflow-hidden rounded-3xl p-6 sm:p-8 animate-in">
        <div className="absolute -top-24 -right-24 size-72 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 size-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="relative flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-lg">
            <div className="flex items-center gap-3">
              <Avatar avatar={profile.avatar} color={profile.color} size={44} />
              <div className="text-sm text-zinc-400">{greeting()},</div>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
              {profile.displayName}
              <span className="text-gradient">.</span>
            </h1>
            <p className="mt-3 text-zinc-400">Ready to stack? Jump into an endless run or challenge someone to a 2-minute Tetris Battle.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/games/tetris/battle" className="btn btn-primary">
                <IconSwords width={18} height={18} /> Battle 1v1
              </Link>
              <Link to="/games/tetris/endless" className="btn btn-ghost">
                <IconInfinity width={18} height={18} /> Endless
              </Link>
            </div>
          </div>
          <div className="hidden rotate-3 sm:block">
            <BoardPreview skinId={settings.skin} themeId={settings.theme} cell={13} />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section>
        <SectionTitle>Your stats</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Best score" value={fmtNum(stats.bestScore)} hint={`${stats.endlessGames} endless runs`} accent="#8b5cf6" />
          <StatTile label="Battle record" value={`${stats.wins}-${stats.losses}`} hint={`${winRate}% win rate`} accent="#22d3ee" />
          <StatTile label="Total KOs" value={fmtNum(stats.kos)} hint="opponents knocked out" accent="#f472b6" />
          <StatTile label="Lines cleared" value={fmtNum(stats.totalLines)} hint={`${fmtDuration(stats.playTimeMs)} played`} accent="#a3e635" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Games */}
        <section className="lg:col-span-3">
          <SectionTitle action={<Link to="/games" className="text-xs text-violet-300 hover:underline">View all</Link>}>Games</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {GAMES.slice(0, 4).map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        </section>

        {/* Top players */}
        <section className="lg:col-span-2">
          <SectionTitle action={<Link to="/leaderboard" className="text-xs text-violet-300 hover:underline">Full board</Link>}>
            Top players · Endless
          </SectionTitle>
          <Card className="p-2">
            {top === null && !topErr && <div className="p-6 text-center text-sm text-zinc-500">Loading…</div>}
            {topErr && <Empty>Leaderboard is offline right now.</Empty>}
            {top && top.length === 0 && <Empty>No scores yet. Be the first!</Empty>}
            {top?.map((e, i) => (
              <div key={e.playerId} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${e.playerId === profile.id ? "bg-violet-500/10" : ""}`}>
                <span className={`w-6 font-mono text-sm font-bold ${["text-amber-300", "text-zinc-300", "text-orange-400"][i] ?? "text-zinc-500"}`}>{i + 1}</span>
                <Avatar avatar={e.avatar} color={e.color} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.name}</span>
                <span className="font-mono text-sm font-bold tabular-nums">{fmtNum(e.score)}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>

      {/* Recent activity */}
      <section>
        <SectionTitle>Recent activity</SectionTitle>
        {me.history.length === 0 ? (
          <Empty>Your recent games will show up here.</Empty>
        ) : (
          <Card className="divide-y divide-white/5 p-0">
            {me.history.slice(0, 6).map((h) => (
              <div key={`${h.mode}-${h.ts}`} className="flex items-center gap-4 px-5 py-3 text-sm">
                <span className="grid size-9 place-items-center rounded-xl bg-white/5 text-zinc-300">{h.mode === "battle" ? <IconSwords width={18} height={18} /> : <IconInfinity width={18} height={18} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {h.mode === "battle" ? (
                      <>
                        <span className={h.result === "win" ? "text-emerald-300" : h.result === "lose" ? "text-rose-300" : "text-zinc-300"}>
                          {h.result === "win" ? "Won" : h.result === "lose" ? "Lost" : "Drew"}
                        </span>{" "}
                        vs {h.opponent}
                      </>
                    ) : (
                      <>Endless run</>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">{timeAgo(h.ts)}</div>
                </div>
                <div className="text-right font-mono text-xs text-zinc-400">
                  {h.mode === "battle" ? `${h.kos} KO · ${h.linesSent} sent` : `${fmtNum(h.score ?? 0)} pts · ${h.lines} lines`}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

export function GameCard({ game }: { game: (typeof GAMES)[number] }) {
  const inner = (
    <div className={`glass relative h-full overflow-hidden rounded-2xl p-5 ${game.status === "live" ? "glass-hover" : "opacity-70"}`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient} opacity-40`} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <GameLogo game={game.id} size={48} />
          {game.status === "live" ? (
            <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><LiveDot /> Live</span>
          ) : (
            <span className="chip text-zinc-400">Coming soon</span>
          )}
        </div>
        <div className="mt-4 text-lg font-bold">{game.title}</div>
        <div className="mt-1 text-sm text-zinc-300/80">{game.tagline}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {game.modes.map((m) => (
            <span key={m} className="chip">{m}</span>
          ))}
          {game.status === "live" && (
            <span className="ml-auto grid size-9 place-items-center rounded-full bg-white text-ink-950">
              <IconPlay width={16} height={16} fill="currentColor" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
  return game.href ? <Link to={game.href}>{inner}</Link> : inner;
}
