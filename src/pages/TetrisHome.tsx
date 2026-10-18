import { Link } from "react-router";
import { IconInfinity, IconPalette, IconSwords } from "../components/icons";
import { Card, PageHeader, SectionTitle, StatTile } from "../components/ui";
import { Customizer } from "../games/tetris/Customizer";
import { fmtNum, timeAgo } from "../lib/format";
import { useMe } from "../lib/auth";

export default function TetrisHome() {
  const me = useMe();
  const stats = me.stats;
  return (
    <div className="space-y-8">
      <PageHeader
        title={<>Tetris <span className="text-gradient">Battle</span></>}
        subtitle="Competitive block stacking: SRS rotation, hold, T-spins, combos and garbage. Every game is verified by the server."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/games/tetris/endless" className="glass glass-hover group relative overflow-hidden rounded-3xl p-6">
          <div className="absolute -top-16 -right-10 size-48 rounded-full bg-violet-600/30 blur-3xl transition group-hover:bg-violet-500/40" />
          <div className="relative">
            <div className="mb-5 grid size-12 place-items-center rounded-xl bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/30">
              <IconInfinity />
            </div>
            <div className="text-2xl font-bold">Endless</div>
            <p className="mt-1 text-sm text-zinc-400">Survive as long as you can. Speed rises every 10 lines. Your best run goes on the global leaderboard.</p>
            <div className="mt-5 flex items-center gap-3 text-sm">
              <span className="chip">Best {fmtNum(stats.bestScore)}</span>
              <span className="chip">{stats.endlessGames} runs</span>
            </div>
          </div>
        </Link>
        <Link to="/games/tetris/battle" className="glass glass-hover group relative overflow-hidden rounded-3xl p-6">
          <div className="absolute -top-16 -right-10 size-48 rounded-full bg-cyan-500/25 blur-3xl transition group-hover:bg-cyan-400/35" />
          <div className="relative">
            <div className="mb-5 grid size-12 place-items-center rounded-xl bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/30">
              <IconSwords />
            </div>
            <div className="text-2xl font-bold">Battle 1v1</div>
            <p className="mt-1 text-sm text-zinc-400">Real-time 2-minute duels. Watch your rival's board, send garbage, rack up KOs. Quick match or private room.</p>
            <div className="mt-5 flex items-center gap-3 text-sm">
              <span className="chip">{stats.wins}W · {stats.losses}L</span>
              <span className="chip">{stats.kos} KOs</span>
            </div>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Best score" value={fmtNum(stats.bestScore)} accent="#8b5cf6" />
        <StatTile label="Wins" value={stats.wins} accent="#22d3ee" />
        <StatTile label="KOs" value={stats.kos} accent="#f472b6" />
        <StatTile label="Lines" value={fmtNum(stats.totalLines)} accent="#a3e635" />
      </div>

      <section>
        <SectionTitle>
          <span className="inline-flex items-center gap-2"><IconPalette width={16} height={16} /> Customize</span>
        </SectionTitle>
        <Card>
          <Customizer />
        </Card>
      </section>

      <section>
        <SectionTitle>Personal top 10 · Endless</SectionTitle>
        <Card className="p-2">
          {me.highScores.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">No runs yet.</div>
          ) : (
            me.highScores.map((h, i) => (
              <div key={h.ts} className="flex items-center gap-4 rounded-xl px-3 py-2 text-sm">
                <span className="w-6 font-mono font-bold text-zinc-500">{i + 1}</span>
                <span className="flex-1 font-mono font-bold">{fmtNum(h.score)}</span>
                <span className="text-xs text-zinc-400">Lv {h.level} · {h.lines} lines</span>
                <span className="w-20 text-right text-xs text-zinc-500">{timeAgo(h.ts)}</span>
              </div>
            ))
          )}
        </Card>
      </section>
    </div>
  );
}
