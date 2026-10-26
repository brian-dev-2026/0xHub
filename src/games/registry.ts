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
    href: "/games/snake",
    status: "live",
    modes: ["4-player FFA", "vs bots"],
    gradient: "from-lime-500/40 via-emerald-600/30 to-teal-600/30",
  },
  {
    id: "2048",
    title: "2048 Duel",
    tagline: "Race your opponent to the 2048 tile.",
    href: "/games/2048",
    status: "live",
    modes: ["Solo", "1v1"],
    gradient: "from-amber-500/40 via-orange-600/30 to-rose-600/30",
  },
  {
    id: "mines",
    title: "Minesweeper Rush",
    tagline: "Sweep faster than anyone on the board.",
    href: "/games/mines",
    status: "live",
    modes: ["Time attack", "3 difficulties"],
    gradient: "from-slate-500/40 via-zinc-600/30 to-neutral-700/30",
  },
  {
    id: "connect4",
    title: "Connect Four",
    tagline: "Drop discs, connect four, real-time online.",
    href: "/games/connect4",
    status: "live",
    modes: ["1v1"],
    gradient: "from-rose-500/40 via-pink-600/30 to-fuchsia-600/30",
  },
  {
    id: "chess",
    title: "Chess",
    tagline: "Official rules, real clocks, rated games.",
    href: "/games/chess",
    status: "live",
    modes: ["1v1", "vs computer"],
    gradient: "from-amber-700/40 via-yellow-800/30 to-stone-700/30",
  },
  {
    id: "generals",
    title: "Game of the Generals",
    tagline: "Hidden ranks, a secret setup and a silent arbiter.",
    href: "/games/generals",
    status: "live",
    modes: ["1v1", "vs computer"],
    gradient: "from-lime-700/40 via-green-800/30 to-stone-700/30",
  },
  {
    id: "pool",
    title: "8-Ball Pool",
    tagline: "Real-time 3D pool with spin, skins and a bot.",
    href: "/games/pool",
    status: "live",
    modes: ["8-Ball", "9-Ball", "vs computer"],
    gradient: "from-emerald-600/40 via-teal-700/30 to-amber-700/30",
  },
  {
    id: "mages",
    title: "Mage Siege",
    tagline: "Merge mages, master the terrain, hold the line.",
    href: "/games/mages",
    status: "live",
    modes: ["Campaign", "Endless"],
    gradient: "from-violet-700/40 via-indigo-800/30 to-amber-600/30",
  },
];
