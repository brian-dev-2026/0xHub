// Time controls for Chess and Game of the Generals ("minutes+increment").

export interface TimeControl {
  id: string;
  name: string;
  baseMs: number;
  incMs: number;
}

export const CHESS_TIME_CONTROLS: TimeControl[] = [
  { id: "1+0", name: "Bullet", baseMs: 60_000, incMs: 0 },
  { id: "3+2", name: "Blitz", baseMs: 180_000, incMs: 2_000 },
  { id: "5+0", name: "Blitz", baseMs: 300_000, incMs: 0 },
  { id: "10+0", name: "Rapid", baseMs: 600_000, incMs: 0 },
  { id: "15+10", name: "Rapid", baseMs: 900_000, incMs: 10_000 },
];
export const DEFAULT_CHESS_TC = "5+0";

export function chessTimeControl(id: string | null | undefined): TimeControl {
  return CHESS_TIME_CONTROLS.find((t) => t.id === id) ?? CHESS_TIME_CONTROLS.find((t) => t.id === DEFAULT_CHESS_TC)!;
}

/** Game of the Generals: 10 minutes each plus 5 seconds per move, after a 3-minute setup. */
export const GENERALS_CLOCK: TimeControl = { id: "10+5", name: "Standard", baseMs: 600_000, incMs: 5_000 };
export const GENERALS_SETUP_MS = 180_000;

/** If a player hasn't made their first move by then, the game is aborted (no rating change). */
export const FIRST_MOVE_MS = 30_000;
