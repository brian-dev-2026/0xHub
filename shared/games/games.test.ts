import { describe, expect, it } from "vitest";
import { C4_COLS, canDrop, drop, emptyBoard, isFull, winningLine } from "./connect4";
import { G2048 } from "./g2048";
import { MinesBoard } from "./mines";
import { SNAKE_H, SNAKE_W, SnakeSim } from "./snake";

describe("Connect Four", () => {
  it("stacks discs and detects horizontal, vertical and diagonal wins", () => {
    const b = emptyBoard();
    for (let c = 0; c < 3; c++) expect(winningLine(b, drop(b, c, 1), c)).toBeNull();
    const r = drop(b, 3, 1);
    expect(winningLine(b, r, 3)).toHaveLength(4);

    const v = emptyBoard();
    let row = 0;
    for (let i = 0; i < 4; i++) row = drop(v, 2, 2);
    expect(winningLine(v, row, 2)).not.toBeNull();

    // diagonal ↗ for player 1
    const d = emptyBoard();
    drop(d, 0, 1);
    drop(d, 1, 2), drop(d, 1, 1);
    drop(d, 2, 2), drop(d, 2, 2), drop(d, 2, 1);
    drop(d, 3, 2), drop(d, 3, 2), drop(d, 3, 2);
    const top = drop(d, 3, 1);
    expect(winningLine(d, top, 3)).not.toBeNull();
  });

  it("rejects full and invalid columns and detects a full board", () => {
    const b = emptyBoard();
    for (let i = 0; i < 6; i++) drop(b, 0, (i % 2) + 1 as 1 | 2);
    expect(canDrop(b, 0)).toBe(false);
    expect(drop(b, 0, 1)).toBe(-1);
    expect(drop(b, 7, 1)).toBe(-1);
    expect(drop(b, -1, 1)).toBe(-1);
    const full = new Array(C4_COLS * 6).fill(1);
    expect(isFull(full)).toBe(true);
  });
});

describe("2048", () => {
  it("merges each tile once per move and scores merges", () => {
    const g = new G2048(1);
    g.board = [2, 2, 2, 2, 4, 4, 8, 8, 0, 0, 0, 0, 2, 0, 0, 2];
    g.move(3); // left
    expect(g.board.slice(0, 4)).toEqual([4, 4, 0, 0]);
    expect(g.board.slice(4, 8)).toEqual([8, 16, 0, 0]);
    expect(g.board[12]).toBe(4);
    expect(g.score).toBe(4 + 4 + 8 + 16 + 4);
  });

  it("refuses moves that change nothing", () => {
    const g = new G2048(1);
    g.board = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
    expect(g.canMove()).toBe(false);
    expect(g.move(0)).toBe(false);
    expect(g.moves).toBe(0);
  });

  it("is deterministic: same seed + same moves = same game; round-trips state", () => {
    const a = new G2048(42);
    const b = new G2048(42);
    const dirs = [0, 1, 2, 3, 3, 2, 1, 0, 1, 1, 2, 3] as const;
    for (let i = 0; i < 300; i++) {
      a.move(dirs[i % dirs.length]);
      b.move(dirs[i % dirs.length]);
    }
    expect(a.hash()).toBe(b.hash());
    expect(a.score).toBe(b.score);
    const c = G2048.deserialize(JSON.parse(JSON.stringify(a.serialize())));
    a.move(1);
    c.move(1);
    expect(c.hash()).toBe(a.hash());
  });

  it("a client that slides and places the server's tiles stays identical, without the RNG", () => {
    const server = new G2048(7);
    const client = G2048.fromView(JSON.parse(JSON.stringify(server.view())));
    expect(JSON.stringify(client.view())).not.toContain("rng");
    const dirs = [0, 3, 2, 1, 3, 3, 2, 0] as const;
    for (let i = 0; i < 400 && !server.over; i++) {
      const d = dirs[i % dirs.length];
      const moved = client.slide(d);
      expect(server.slide(d)).toBe(moved);
      if (!moved) continue;
      expect(client.hash()).toBe(server.hash());
      const cell = server.spawn();
      server.over = !server.canMove();
      client.place(cell, server.board[cell]);
      expect(client.view()).toEqual(server.view());
    }
  });
});

describe("Minesweeper", () => {
  it("never puts a mine under or next to the first click, and flood-fills", () => {
    for (let seed = 1; seed < 30; seed++) {
      const b = new MinesBoard(9, 9, 10, seed);
      const first = 40; // centre
      const cells = b.reveal(first);
      expect(b.lost).toBe(false);
      expect(cells[0]).toEqual([first, 0]); // centre is a zero (neighbours are safe)
      expect(cells.length).toBeGreaterThan(1);
      expect(b.mineList()).toHaveLength(10);
    }
  });

  it("detects a win and a loss", () => {
    const b = new MinesBoard(9, 9, 10, 7);
    b.reveal(0);
    const mines = new Set(b.mineList());
    for (let i = 0; i < 81; i++) if (!mines.has(i)) b.reveal(i);
    expect(b.won).toBe(true);

    const l = new MinesBoard(9, 9, 10, 7);
    l.reveal(0);
    l.reveal([...mines][0]);
    expect(l.lost).toBe(true);
    expect(l.reveal(5)).toEqual([]); // nothing after losing
  });

  it("chords only when the right number of flags are placed", () => {
    const b = new MinesBoard(9, 9, 10, 3);
    b.reveal(40);
    const mines = new Set(b.mineList());
    const st = b.serialize();
    // find a revealed numbered cell
    const numbered = st.revealed.find((i) => b.count(i) > 0)!;
    const x = numbered % 9, y = Math.floor(numbered / 9);
    const nbs: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < 9 && ny < 9) nbs.push(ny * 9 + nx);
    }
    expect(b.chord(numbered, new Set())).toEqual([]); // not enough flags
    const correctFlags = new Set(nbs.filter((i) => mines.has(i)));
    b.chord(numbered, correctFlags);
    expect(b.lost).toBe(false);
  });
});

describe("Snake Arena", () => {
  const members = (n: number, bot = false) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, avatar: "t-T", color: "#fff", bot }));

  it("moves one cell per tick and ignores reversing", () => {
    const sim = new SnakeSim(1, members(1));
    const s = sim.snakes[0];
    const head = s.body[0];
    const dir = s.dir;
    sim.setDir("p0", (dir + 2) % 4); // reverse: ignored
    sim.food.clear();
    sim.step();
    const dx = [0, 1, 0, -1][dir], dy = [-1, 0, 1, 0][dir];
    expect(s.body[0]).toBe(head + dx + dy * SNAKE_W);
    expect(s.body).toHaveLength(4);
  });

  it("dies on the wall, drops food, respawns, and credits kills", () => {
    const sim = new SnakeSim(2, members(2));
    const [a, b] = sim.snakes;
    // Put A facing B's body side-on.
    b.body = [5 * SNAKE_W + 10, 5 * SNAKE_W + 11, 5 * SNAKE_W + 12, 5 * SNAKE_W + 13];
    b.dir = 3;
    a.body = [4 * SNAKE_W + 12, 3 * SNAKE_W + 12, 2 * SNAKE_W + 12, 1 * SNAKE_W + 12];
    a.dir = 2; // moving down into B's body
    sim.food.clear();
    sim.step();
    expect(a.alive).toBe(false);
    expect(b.kills).toBe(1);
    expect(b.score).toBe(5);
    expect(sim.food.size).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) sim.step();
    expect(a.alive || a.respawnAt > 0).toBe(true);

    const w = new SnakeSim(3, members(1));
    const s = w.snakes[0];
    s.body = [0, 1, 2, 3];
    s.dir = 3; // into the left wall
    w.step();
    expect(s.alive).toBe(false);
    expect(s.deaths).toBe(1);
  });

  it("bots survive for a while and eat", () => {
    const sim = new SnakeSim(9, members(4, true));
    for (let i = 0; i < 600; i++) sim.step();
    const totalScore = sim.snakes.reduce((t, s) => t + s.score, 0);
    expect(totalScore).toBeGreaterThan(10);
    const st = sim.standings();
    expect(st[0].place).toBe(1);
    expect(st).toHaveLength(4);
  });

  it("spawns snakes facing open space (at least 10 cells to the wall)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const sim = new SnakeSim(seed, members(4));
      for (const s of sim.snakes) {
        const x = s.body[0] % SNAKE_W;
        const y = Math.floor(s.body[0] / SNAKE_W);
        const room = [y, SNAKE_W - 1 - x, SNAKE_H - 1 - y, x][s.dir];
        expect(room).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("resumes exactly from a serialized state", () => {
    const a = new SnakeSim(77, members(4, true));
    for (let i = 0; i < 300; i++) a.step();
    const b = SnakeSim.deserialize(JSON.parse(JSON.stringify(a.serialize())));
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.standings()).toEqual(a.standings());
  });
});
