import { describe, expect, it } from "vitest";
import { COLS, GARBAGE, PIECES, ROWS, SHAPES, TetrisEngine, type ClearEvent } from "./engine";

function fillRow(e: TetrisEngine, y: number, holes: number[] = []) {
  for (let x = 0; x < COLS; x++) e.board[y][x] = holes.includes(x) ? 0 : GARBAGE;
}

function engine(events: ConstructorParameters<typeof TetrisEngine>[0]["events"] = {}) {
  return new TetrisEngine({ mode: "battle", seed: 42, events });
}

describe("TetrisEngine", () => {
  it("uses a 7-bag randomizer", () => {
    const e = engine();
    const firstBag = [e.active!.type, ...e.queue.slice(0, 6)];
    expect(new Set(firstBag).size).toBe(7);
  });

  it("rotates T clockwise to the correct SRS orientation", () => {
    expect(SHAPES.T[1]).toEqual([[2, 1], [1, 0], [1, 1], [1, 2]]);
    expect(SHAPES.O[1]).toEqual(SHAPES.O[0]);
  });

  it("hard drop locks at the floor and spawns next", () => {
    const e = engine();
    const next = e.queue[0];
    e.hardDrop();
    expect(e.board[ROWS - 1].some((c) => c !== 0)).toBe(true);
    expect(e.active!.type).toBe(next);
  });

  it("hold works once per piece", () => {
    const e = engine();
    const first = e.active!.type;
    expect(e.holdPiece()).toBe(true);
    expect(e.hold).toBe(first);
    expect(e.holdPiece()).toBe(false);
  });

  it("detects a T-spin double and sends 4 lines", () => {
    const clears: ClearEvent[] = [];
    const e = engine({ onClear: (c) => clears.push(c) });
    fillRow(e, 39, [1]);
    fillRow(e, 38, [0, 1, 2]);
    e.board[37][0] = GARBAGE; // overhang
    e.active = { type: "T", x: 0, y: 37, rot: 1 };
    expect(e.rotate(1)).toBe(true);
    expect(e.detectTSpin()).toBe("full");
    e.hardDrop();
    expect(clears[0].lines).toBe(2);
    expect(clears[0].tspin).toBe("full");
    expect(clears[0].attack).toBe(4);
    expect(clears[0].label).toBe("T-SPIN DOUBLE");
  });

  it("a Tetris sends 4, back-to-back Tetris sends 5 plus combo", () => {
    const clears: ClearEvent[] = [];
    const e = engine({ onClear: (c) => clears.push(c) });
    e.board[30][5] = GARBAGE; // stray block so these are not perfect clears
    const tetris = () => {
      for (let y = 36; y < 40; y++) fillRow(e, y, [0]);
      e.active = { type: "I", x: -2, y: 20, rot: 1 };
      e.hardDrop();
    };
    tetris();
    tetris();
    expect(clears[0].attack).toBe(4);
    expect(clears[1].b2b).toBe(true);
    expect(clears[1].combo).toBe(1);
    expect(clears[1].attack).toBe(4 + 1 + 1); // tetris + b2b + combo 1
  });

  it("perfect clear adds bonus garbage", () => {
    const clears: ClearEvent[] = [];
    const e = engine({ onClear: (c) => clears.push(c) });
    for (let y = 36; y < 40; y++) fillRow(e, y, [0]);
    e.active = { type: "I", x: -2, y: 20, rot: 1 };
    e.hardDrop();
    expect(clears[0].perfectClear).toBe(true);
    expect(clears[0].attack).toBe(14);
  });

  it("line clears cancel incoming garbage before sending", () => {
    const clears: ClearEvent[] = [];
    const e = engine({ onClear: (c) => clears.push(c) });
    e.receiveGarbage(3);
    for (let y = 36; y < 40; y++) fillRow(e, y, [0]);
    e.board[35][5] = GARBAGE; // avoid perfect clear
    e.active = { type: "I", x: -2, y: 20, rot: 1 };
    e.hardDrop();
    expect(clears[0].attack).toBe(4);
    expect(clears[0].sent).toBe(1);
    expect(e.incomingTotal).toBe(0);
  });

  it("garbage rises when a piece locks without clearing", () => {
    const e = engine();
    e.receiveGarbage(2);
    e.hardDrop();
    const bottom = e.board[ROWS - 1];
    expect(bottom.filter((c) => c === GARBAGE).length).toBe(COLS - 1);
    // both lines from one attack share a hole column
    const hole1 = e.board[ROWS - 1].indexOf(0);
    const hole2 = e.board[ROWS - 2].indexOf(0);
    expect(hole1).toBe(hole2);
  });

  it("piece locks after lock delay on the ground", () => {
    const e = engine();
    const placed = e.piecesPlaced;
    for (let i = 0; i < 400 && e.piecesPlaced === placed; i++) e.tick(50);
    expect(e.piecesPlaced).toBe(placed + 1);
  });

  it("tops out when spawn is blocked", () => {
    let topped = false;
    const e = engine({ onTopOut: () => (topped = true) });
    for (let y = 18; y < ROWS; y++) fillRow(e, y, [9]);
    e.hardDrop();
    expect(topped).toBe(true);
    expect(e.gameOver).toBe(true);
  });

  it("encodes the visible field", () => {
    const e = engine();
    expect(e.encodeVisible()).toHaveLength(200);
    expect(PIECES).toHaveLength(7);
  });
});
