import { G2048, type Dir, type G2048Spawn, type G2048View } from "../../../shared/games/g2048";

const MAX_QUEUED = 3;

/**
 * The browser's copy of a 2048 game whose tiles come from the server. A move
 * slides the tiles at once; the new tile arrives in the server's reply. Moves
 * pressed while waiting for that tile are queued and played in order.
 */
export class RemoteBoard {
  game: G2048;
  private queue: Dir[] = [];
  private waiting = false;

  constructor(
    view: G2048View,
    private sendMove: (n: number, d: Dir, h: number) => void,
    /** Called whenever the board changes; `slid` is true right after one of our moves. */
    private onChange: (g: G2048, slid: boolean) => void,
  ) {
    this.game = G2048.fromView(view);
  }

  press(d: Dir) {
    if (this.game.over) return;
    if (this.waiting) {
      if (this.queue.length < MAX_QUEUED) this.queue.push(d);
      return;
    }
    this.apply(d);
  }

  private apply(d: Dir) {
    if (!this.game.slide(d)) return;
    this.waiting = true;
    this.sendMove(this.game.moves, d, this.game.hash());
    this.onChange(this.game, true);
  }

  /** The server's tile for our last move. */
  spawn(s: G2048Spawn) {
    if (!this.waiting || s.n !== this.game.moves) return;
    this.game.place(s.cell, s.value);
    this.game.over = s.over;
    this.waiting = false;
    this.onChange(this.game, false);
    while (this.queue.length && !this.waiting && !this.game.over) this.apply(this.queue.shift()!);
  }

  /** Replace our copy with the server's (on connect or after a mismatch). */
  reset(view: G2048View) {
    this.game = G2048.fromView(view);
    this.queue = [];
    this.waiting = false;
    this.onChange(this.game, false);
  }
}
