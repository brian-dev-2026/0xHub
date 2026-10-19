// Connect Four rules (7 columns x 6 rows). The server is fully authoritative;
// clients only send "drop in column c".

export const C4_COLS = 7;
export const C4_ROWS = 6;
export const C4_TURN_MS = 30_000;

/** 0 = empty, 1 = first player, 2 = second player. Row-major, row 0 at the top. */
export type C4Board = number[];

export function emptyBoard(): C4Board {
  return new Array(C4_COLS * C4_ROWS).fill(0);
}

/** Drop a disc; returns the row it landed in, or -1 if the column is full/invalid. */
export function drop(board: C4Board, col: number, player: 1 | 2): number {
  if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) return -1;
  for (let row = C4_ROWS - 1; row >= 0; row--) {
    if (board[row * C4_COLS + col] === 0) {
      board[row * C4_COLS + col] = player;
      return row;
    }
  }
  return -1;
}

export function canDrop(board: C4Board, col: number): boolean {
  return Number.isInteger(col) && col >= 0 && col < C4_COLS && board[col] === 0;
}

/** Winning line through the last move, as cell indexes, or null. */
export function winningLine(board: C4Board, row: number, col: number): number[] | null {
  const p = board[row * C4_COLS + col];
  if (!p) return null;
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    const line = [row * C4_COLS + col];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS && board[r * C4_COLS + c] === p) {
        line.push(r * C4_COLS + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

export function isFull(board: C4Board): boolean {
  return board.slice(0, C4_COLS).every((c) => c !== 0);
}

export interface C4State {
  board: C4Board;
  /** Which seat (0/1) plays disc 1 this game. */
  firstSeat: 0 | 1;
  /** Whose turn: disc 1 or 2. */
  turn: 1 | 2;
  moves: number[];
  winLine: number[] | null;
  winner: 0 | 1 | 2 | 3; // 0 = in progress, 1/2 = disc that won, 3 = draw
  turnEndsAt: number;
}
