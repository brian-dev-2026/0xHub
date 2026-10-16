import { useEffect, useState } from "react";
import { Avatar } from "../components/Layout";
import { Card, PageHeader, SectionTitle, StatTile } from "../components/ui";
import { fetchPlayerSummary } from "../lib/api";
import { fmtDuration, fmtNum } from "../lib/format";
import { ACCENTS, AVATARS, profileStore, statsStore } from "../lib/store";

export default function Profile() {
  const profile = profileStore.use();
  const stats = statsStore.use();
  const [name, setName] = useState(profile.name);
  const [saved, setSaved] = useState(false);
  const [rating, setRating] = useState<number | null>(null);

  useEffect(() => {
    fetchPlayerSummary(profile.id)
      .then((s) => setRating(s.battle?.rating ?? null))
      .catch(() => {});
  }, [profile.id]);

  const saveName = () => {
    const n = name.trim().slice(0, 20);
    if (!n) return;
    profileStore.set({ name: n });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <PageHeader title="Profile" subtitle="How other players see you." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Avatar emoji={profile.avatar} color={profile.color} size={88} />
            <div className="text-xl font-bold">{profile.name}</div>
            <div className="chip">{rating !== null ? `Battle rating ${rating}` : "Unranked in battle"}</div>
          </div>
          <div className="mt-4 space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Display name</label>
              <div className="flex gap-2">
                <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveName()} />
                <button className="btn btn-primary" onClick={saveName}>{saved ? "Saved" : "Save"}</button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-zinc-400">Avatar</div>
              <div className="grid grid-cols-8 gap-1.5">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    onClick={() => profileStore.set({ avatar: a })}
                    className={`grid aspect-square place-items-center rounded-lg text-lg transition ${profile.avatar === a ? "bg-violet-500/25 ring-2 ring-violet-400" : "bg-white/5 hover:bg-white/10"}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-zinc-400">Accent color</div>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    aria-label={c}
                    onClick={() => profileStore.set({ color: c })}
                    className={`size-8 rounded-full transition ${profile.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-ink-900" : ""}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              You're playing as a guest. Your identity is stored in this browser — clearing site data creates a new player.
            </p>
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <section>
            <SectionTitle>Endless</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile label="Best score" value={fmtNum(stats.bestScore)} accent="#8b5cf6" />
              <StatTile label="Runs" value={stats.endlessGames} accent="#6366f1" />
              <StatTile label="Lines" value={fmtNum(stats.totalLines)} accent="#a3e635" />
            </div>
          </section>
          <section>
            <SectionTitle>Battle</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Played" value={stats.battles} accent="#22d3ee" />
              <StatTile label="Wins" value={stats.wins} accent="#34d399" />
              <StatTile label="Losses" value={stats.losses} accent="#f43f5e" />
              <StatTile label="KOs" value={stats.kos} accent="#f472b6" />
            </div>
          </section>
          <StatTile label="Time played" value={fmtDuration(stats.playTimeMs)} accent="#fb923c" />
          <button
            className="btn btn-ghost text-rose-300"
            onClick={() => {
              if (confirm("Reset all local stats and history? Global leaderboard entries are kept.")) {
                statsStore.set((s) => ({ ...s, endlessGames: 0, bestScore: 0, totalLines: 0, battles: 0, wins: 0, losses: 0, draws: 0, kos: 0, playTimeMs: 0, history: [], highScores: [] }));
              }
            }}
          >
            Reset local stats
          </button>
        </div>
      </div>
    </>
  );
}
