/** Display name of the Tetris game. */
export const GAME_NAME = "Tetris Battle";

export interface GameMeta {
  id: string;
  title: string;
  tagline: string;
  href?: string;
  status: "live" | "soon";
  modes: string[];
  gradient: string;
}

export const GAMES: GameMeta[] = [
  {
    id: "tetris",
    title: GAME_NAME,
    tagline: "Stack, spin and bury your rival in garbage.",
    href: "/games/tetris",
    status: "live",
    modes: ["Endless", "1v1 Battle"],
    gradient: "from-violet-600/60 via-indigo-600/40 to-cyan-500/40",
  },
  {
    id: "snake",
    title: "Snake Arena",
    tagline: "Classic snake, four players, one arena.",
    status: "soon",
    modes: ["FFA"],
    gradient: "from-lime-500/40 via-emerald-600/30 to-teal-600/30",
  },
  {
    id: "2048",
    title: "2048 Duel",
    tagline: "Race your opponent to the 2048 tile.",
    status: "soon",
    modes: ["Solo", "1v1"],
    gradient: "from-amber-500/40 via-orange-600/30 to-rose-600/30",
  },
  {
    id: "mines",
    title: "Minesweeper Rush",
    tagline: "Sweep faster than anyone on the board.",
    status: "soon",
    modes: ["Time Attack"],
    gradient: "from-slate-500/40 via-zinc-600/30 to-neutral-700/30",
  },
  {
    id: "connect4",
    title: "Connect Four",
    tagline: "Drop discs, connect four, real-time online.",
    status: "soon",
    modes: ["1v1"],
    gradient: "from-rose-500/40 via-pink-600/30 to-fuchsia-600/30",
  },
];
