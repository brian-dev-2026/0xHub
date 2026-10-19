import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { BattleEntry, EndlessEntry, RatingEntry, ScoreEntry } from "../../shared/protocol";
import { GameLogo } from "../components/GameLogo";
import { Avatar, RankBadge } from "../components/marks";
import { Card, Empty, PageHeader, Segmented } from "../components/ui";
import { useMe } from "../lib/auth";
import { fmtNum, timeAgo } from "../lib/format";

type GameKey = "tetris" | "snake" | "2048" | "mines" | "connect4";

interface Column {
  label: string;
  value: (e: any) => React.ReactNode;
  strong?: boolean;
}

const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const record = (e: RatingEntry) => `${e.wins}-${e.losses}${e.draws ? `-${e.draws}` : ""}`;

const BOARDS: Record<GameKey, { title: string; modes: { value: string; label: string; columns: Column[] }[] }> = {
  tetris: {
    title: "Tetris Battle",
    modes: [
      {
        value: "endless",
        label: "Endless",
        columns: [
          { label: "Score", value: (e: EndlessEntry) => fmtNum(e.score), strong: true },
          { label: "Lines", value: (e: EndlessEntry) => e.lines },
          { label: "Level", value: (e: EndlessEntry) => e.level },
          { label: "When", value: (e: EndlessEntry) => timeAgo(e.ts) },
        ],
      },
      {
        value: "battle",
        label: "Battle",
        columns: [
          { label: "Rating", value: (e: BattleEntry) => e.rating, strong: true },
          { label: "W-L-D", value: (e: BattleEntry) => `${e.wins}-${e.losses}-${e.draws}` },
          { label: "KOs", value: (e: BattleEntry) => e.kos },
        ],
      },
    ],
  },
  snake: {
    title: "Snake Arena",
    modes: [
      { value: "score", label: "Best round", columns: [{ label: "Score", value: (e: ScoreEntry) => e.score, strong: true }, { label: "When", value: (e: ScoreEntry) => timeAgo(e.ts) }] },
      { value: "wins", label: "Most wins", columns: [{ label: "Wins", value: (e: RatingEntry) => e.wins, strong: true }, { label: "Rounds", value: (e: RatingEntry) => e.played }] },
    ],
  },
  "2048": {
    title: "2048",
    modes: [
      { value: "solo", label: "Solo", columns: [{ label: "Score", value: (e: ScoreEntry) => fmtNum(e.score), strong: true }, { label: "When", value: (e: ScoreEntry) => timeAgo(e.ts) }] },
      { value: "duel", label: "Duel", columns: [{ label: "Rating", value: (e: RatingEntry) => e.rating, strong: true }, { label: "W-L-D", value: record }] },
    ],
  },
  mines: {
    title: "Minesweeper Rush",
    modes: ["beginner", "intermediate", "expert"].map((d) => ({
      value: d,
      label: d[0].toUpperCase() + d.slice(1),
      columns: [
        { label: "Time", value: (e: ScoreEntry) => fmtSecs(e.score), strong: true },
        { label: "When", value: (e: ScoreEntry) => timeAgo(e.ts) },
      ],
    })),
  },
  connect4: {
    title: "Connect Four",
    modes: [{ value: "rating", label: "Rating", columns: [{ label: "Rating", value: (e: RatingEntry) => e.rating, strong: true }, { label: "W-L-D", value: record }] }],
  },
};

const GAME_KEYS = Object.keys(BOARDS) as GameKey[];

export default function Leaderboard() {
  const profile = useMe().user;
  const [params, setParams] = useSearchParams();
  const game = (GAME_KEYS.includes(params.get("game") as GameKey) ? params.get("game") : "tetris") as GameKey;
  const board = BOARDS[game];
  const mode = board.modes.find((m) => m.value === params.get("mode")) ?? board.modes[0];
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setRows(null);
    setError(false);
    let cancelled = false;
    fetch(`/api/leaderboard?game=${game}&mode=${mode.value}`)
      .then((r) => (r.ok ? (r.json() as Promise<any[]>) : Promise.reject()))
      .then((d) => !cancelled && setRows(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [game, mode.value]);

  const select = (g: GameKey, m?: string) => setParams(m ? { game: g, mode: m } : { game: g }, { replace: true });

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Global rankings across all 0xHub players." />
      <div className="mb-4 flex flex-wrap gap-2">
        {GAME_KEYS.map((g) => (
          <button
            key={g}
            onClick={() => select(g)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${g === game ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}
          >
            <GameLogo game={g} size={22} />
            {BOARDS[g].title}
          </button>
        ))}
      </div>
      {board.modes.length > 1 && (
        <div className="mb-4">
          <Segmented value={mode.value} onChange={(m) => select(game, m)} options={board.modes.map((m) => ({ value: m.value, label: m.label }))} />
        </div>
      )}
      <Card className="overflow-x-auto p-0">
        {error && <div className="p-6"><Empty>Couldn't load the leaderboard. Try again in a moment.</Empty></div>}
        {!error && rows === null && <div className="p-10 text-center text-sm text-zinc-500">Loading…</div>}
        {!error && rows?.length === 0 && <div className="p-6"><Empty>No entries yet — go set the first record.</Empty></div>}
        {!error && rows && rows.length > 0 && (
          <table className="w-full min-w-120 text-sm">
            <thead className="text-left text-xs tracking-wide text-zinc-500 uppercase">
              <tr className="border-b border-white/5">
                <th className="w-16 px-5 py-3">#</th>
                <th className="px-2 py-3">Player</th>
                {mode.columns.map((c) => (
                  <th key={c.label} className="px-4 py-3 text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.playerId} className={`border-b border-white/5 last:border-0 ${e.playerId === profile.id ? "bg-violet-500/10" : ""}`}>
                  <td className="px-5 py-3"><RankBadge rank={i + 1} /></td>
                  <td className="px-2 py-3">
                    <span className="flex items-center gap-2.5"><Avatar avatar={e.avatar} color={e.color} size={28} /><span className="font-medium">{e.name}</span></span>
                  </td>
                  {mode.columns.map((c) => (
                    <td key={c.label} className={`px-4 py-3 text-right font-mono ${c.strong ? "font-bold" : "text-zinc-300"}`}>{c.value(e)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
