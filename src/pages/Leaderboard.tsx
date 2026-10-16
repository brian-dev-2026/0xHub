import { useEffect, useState } from "react";
import type { BattleEntry, EndlessEntry } from "../../shared/protocol";
import { Card, Empty, PageHeader, Segmented } from "../components/ui";
import { fetchLeaderboard } from "../lib/api";
import { fmtNum, timeAgo } from "../lib/format";
import { profileStore } from "../lib/store";

type Mode = "endless" | "battle";

export default function Leaderboard() {
  const profile = profileStore.use();
  const [mode, setMode] = useState<Mode>("endless");
  const [endless, setEndless] = useState<EndlessEntry[] | null>(null);
  const [battle, setBattle] = useState<BattleEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    const req = mode === "endless" ? fetchLeaderboard("endless").then(setEndless) : fetchLeaderboard("battle").then(setBattle);
    req.catch(() => setError(true));
  }, [mode]);

  const rows = mode === "endless" ? endless : battle;
  const medal = (i: number) => ["🥇", "🥈", "🥉"][i] ?? <span className="font-mono text-zinc-500">{i + 1}</span>;

  return (
    <>
      <PageHeader
        title="Leaderboard"
        subtitle="Global rankings across all 0xHub players."
        action={
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "endless", label: "Endless" },
              { value: "battle", label: "Battle" },
            ]}
          />
        }
      />
      <Card className="overflow-x-auto p-0">
        {error && <div className="p-6"><Empty>Couldn't load the leaderboard. Try again in a moment.</Empty></div>}
        {!error && rows === null && <div className="p-10 text-center text-sm text-zinc-500">Loading…</div>}
        {!error && rows?.length === 0 && <div className="p-6"><Empty>No entries yet — go set the first record.</Empty></div>}
        {!error && rows && rows.length > 0 && (
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs tracking-wide text-zinc-500 uppercase">
              <tr className="border-b border-white/5">
                <th className="w-16 px-5 py-3">#</th>
                <th className="px-2 py-3">Player</th>
                {mode === "endless" ? (
                  <>
                    <th className="px-2 py-3 text-right">Score</th>
                    <th className="px-2 py-3 text-right">Lines</th>
                    <th className="px-2 py-3 text-right">Level</th>
                    <th className="px-5 py-3 text-right">When</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-3 text-right">Rating</th>
                    <th className="px-2 py-3 text-right">W-L-D</th>
                    <th className="px-5 py-3 text-right">KOs</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {mode === "endless"
                ? endless!.map((e, i) => (
                    <tr key={e.playerId} className={`border-b border-white/5 last:border-0 ${e.playerId === profile.id ? "bg-violet-500/10" : ""}`}>
                      <td className="px-5 py-3 text-lg">{medal(i)}</td>
                      <td className="px-2 py-3"><span className="mr-2">{e.avatar}</span><span className="font-medium">{e.name}</span></td>
                      <td className="px-2 py-3 text-right font-mono font-bold">{fmtNum(e.score)}</td>
                      <td className="px-2 py-3 text-right font-mono text-zinc-300">{e.lines}</td>
                      <td className="px-2 py-3 text-right font-mono text-zinc-300">{e.level}</td>
                      <td className="px-5 py-3 text-right text-xs text-zinc-500">{timeAgo(e.ts)}</td>
                    </tr>
                  ))
                : battle!.map((e, i) => (
                    <tr key={e.playerId} className={`border-b border-white/5 last:border-0 ${e.playerId === profile.id ? "bg-violet-500/10" : ""}`}>
                      <td className="px-5 py-3 text-lg">{medal(i)}</td>
                      <td className="px-2 py-3"><span className="mr-2">{e.avatar}</span><span className="font-medium">{e.name}</span></td>
                      <td className="px-2 py-3 text-right font-mono font-bold">{e.rating}</td>
                      <td className="px-2 py-3 text-right font-mono text-zinc-300">{e.wins}-{e.losses}-{e.draws}</td>
                      <td className="px-5 py-3 text-right font-mono text-zinc-300">{e.kos}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
