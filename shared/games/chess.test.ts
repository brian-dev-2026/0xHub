import { describe, expect, it } from "vitest";
import { Chess, START_FEN, sqIndex, sqName } from "./chess";
import { BOT_LEVELS, botMove } from "./chessBot";

function perft(c: Chess, depth: number): number {
  const ms = c.moves();
  if (depth === 1) return ms.length;
  let n = 0;
  for (const m of ms) {
    c.move(m);
    n += perft(c, depth - 1);
    c.undo();
  }
  return n;
}

function play(c: Chess, ...sans: string[]): void {
  for (const s of sans) {
    if (!c.move(s)) throw new Error(`illegal ${s} in ${c.fen()}`);
  }
}

describe("Chess perft", () => {
  const cases: [string, string, number[]][] = [
    ["start", START_FEN, [20, 400, 8902, 197281]],
    ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]],
    ["position 3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]],
    ["position 4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]],
    ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379]],
  ];
  for (const [name, fen, counts] of cases) {
    it(`${name} depth 1..${counts.length}`, () => {
      const c = new Chess(fen);
      counts.forEach((n, i) => expect(perft(c, i + 1)).toBe(n));
      expect(c.fen()).toBe(fen);
    }, 30_000);
  }
});

describe("Chess rules", () => {
  it("converts squares", () => {
    expect(sqName(0)).toBe("a1");
    expect(sqName(63)).toBe("h8");
    expect(sqIndex("e4")).toBe(28);
    expect(sqIndex("i9")).toBe(-1);
  });

  it("round-trips FEN and rejects invalid FEN", () => {
    for (const fen of [
      START_FEN,
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
    ]) {
      expect(new Chess(fen).fen()).toBe(fen);
    }
    const c = new Chess();
    play(c, "e4");
    expect(c.fen()).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
    expect(() => new Chess("not a fen")).toThrow();
    expect(() => new Chess("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow();
    expect(() => new Chess("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1")).toThrow();
  });

  it("generates SAN with disambiguation, promotion, castling and mate", () => {
    const n = new Chess("r3k3/8/8/8/8/8/8/1N1N2K1 w - - 0 1");
    // knights on b1 and d1 both reach c3 -> file disambiguation
    expect(n.moves().map((m) => m.san)).toEqual(expect.arrayContaining(["Nbc3", "Ndc3"]));
    const nb = new Chess("1n2k3/8/5n2/8/8/8/8/4K3 b - - 0 1");
    expect(nb.moves().map((m) => m.san)).toEqual(expect.arrayContaining(["Nbd7", "Nfd7"]));
    const r = new Chess("k7/8/8/8/8/4R3/8/4R1K1 w - - 0 1");
    // rooks on e1 and e3 both reach e2 -> rank disambiguation
    expect(r.moves().map((m) => m.san)).toEqual(expect.arrayContaining(["R1e2", "R3e2"]));
    const q = new Chess("4k3/8/8/8/8/Q7/8/Q1Q1K3 w - - 0 1");
    // queens a1, c1, a3 all reach b2 -> a1 needs full square
    expect(q.moves().map((m) => m.san)).toContain("Qa1b2");

    const p = new Chess("6k1/3P4/8/8/8/8/8/4K3 w - - 0 1");
    expect(p.moves().map((m) => m.san)).toEqual(expect.arrayContaining(["d8=Q+", "d8=R+", "d8=B", "d8=N"]));
    const p2 = new Chess("2k5/4P3/8/8/8/8/8/4K3 w - - 0 1");
    expect(p2.move("e7e8q")?.san).toBe("e8=Q+");

    const castle = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const sans = castle.moves().map((m) => m.san);
    expect(sans).toEqual(expect.arrayContaining(["O-O", "O-O-O"]));
    const oo = castle.move("O-O")!;
    expect(oo.flags).toBe("k");
    expect(castle.fen()).toBe("r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1");
    expect(castle.move("0-0-0")?.san).toBe("O-O-O");
    expect(castle.fen()).toBe("2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2");

    const mate = new Chess("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
    expect(mate.move("Ra8")?.san).toBe("Ra8#");
  });

  it("accepts SAN, UCI and objects; rejects illegal moves without changing state", () => {
    const c = new Chess();
    expect(c.move("e4")?.uci).toBe("e2e4");
    expect(c.move("e7e5")?.san).toBe("e5");
    expect(c.move({ from: sqIndex("g1"), to: sqIndex("f3") })?.san).toBe("Nf3");
    const fen = c.fen();
    expect(c.move("e5")).toBeNull();
    expect(c.move("e8e6")).toBeNull();
    expect(c.move("Ke7+")).not.toBeNull();
    c.undo();
    expect(c.move({ from: sqIndex("e8"), to: sqIndex("e6") })).toBeNull();
    expect(c.move("xyz")).toBeNull();
    expect(c.fen()).toBe(fen);
    expect(c.history.length).toBe(3);
    expect(c.pgnMoves()).toBe("1. e4 e5 2. Nf3");

    const promo = new Chess("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1");
    expect(promo.move("b7b8")).toBeNull();
    expect(promo.move({ from: sqIndex("b7"), to: sqIndex("b8") })).toBeNull();
    expect(promo.move("b8")).toBeNull();
    const m = promo.move({ from: sqIndex("b7"), to: sqIndex("b8"), promotion: "n" })!;
    expect(m.promotion).toBe("n");
    expect(m.flags).toBe("p");
    expect(promo.board[sqIndex("b8")]).toEqual({ color: "w", type: "n" });
    promo.undo();
    expect(promo.move("b8=R")?.san).toBe("b8=R+");
  });

  it("handles en passant and its flags", () => {
    const c = new Chess();
    play(c, "e4", "a6", "e5", "d5");
    const ep = c.move("exd6")!;
    expect(ep.flags).toBe("e");
    expect(ep.captured).toBe("p");
    expect(c.board[sqIndex("d5")]).toBeNull();
    c.undo();
    play(c, "a3", "h6");
    expect(c.move("exd6")).toBeNull();
  });

  it("detects checkmate and stalemate", () => {
    const c = new Chess();
    play(c, "f3", "e5", "g4", "Qh4#");
    expect(c.isCheckmate()).toBe(true);
    expect(c.history[3].san).toBe("Qh4#");
    expect(c.outcome()).toEqual({ winner: "b", reason: "checkmate" });
    const s = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(s.isStalemate()).toBe(true);
    expect(s.outcome()).toEqual({ winner: null, reason: "stalemate" });
    expect(new Chess().outcome()).toBeNull();
  });

  it("detects insufficient material per FIDE dead positions", () => {
    const ins = (fen: string) => new Chess(fen).isInsufficientMaterial();
    expect(ins("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toBe(true);
    expect(ins("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1")).toBe(true);
    expect(ins("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1")).toBe(true);
    expect(ins("2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1")).toBe(false); // c8 light, c1 dark
    expect(ins("3bk3/8/8/8/8/8/8/2B1K3 w - - 0 1")).toBe(true); // d8 dark, c1 dark
    expect(ins("4k3/8/8/8/8/8/8/NN2K3 w - - 0 1")).toBe(false);
    expect(ins("4k3/8/8/8/8/8/8/1N1BK3 w - - 0 1")).toBe(false);
    expect(ins("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1")).toBe(false);
    expect(new Chess("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1").outcome()).toEqual({ winner: null, reason: "insufficient" });
  });

  it("tracks repetitions: threefold claim, fivefold automatic", () => {
    const c = new Chess();
    expect(c.repetitionCount()).toBe(1);
    play(c, "Nf3", "Nf6", "Ng1", "Ng8");
    expect(c.repetitionCount()).toBe(2);
    expect(c.canClaimThreefold()).toBe(false);
    play(c, "Nf3", "Nf6", "Ng1", "Ng8");
    expect(c.repetitionCount()).toBe(3);
    expect(c.canClaimThreefold()).toBe(true);
    expect(c.outcome()).toBeNull();
    c.undo();
    expect(c.canClaimThreefold()).toBe(false);
    play(c, "Ng8", "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8");
    expect(c.repetitionCount()).toBe(5);
    expect(c.outcome()).toEqual({ winner: null, reason: "fivefold" });
    expect(c.clone().repetitionCount()).toBe(5);
  });

  it("counts en passant in repetition only when the capture is legal", () => {
    // After d4 with no black pawn able to capture, the ep square is irrelevant.
    const a = new Chess("4k3/8/8/8/8/8/3P4/4K1N1 w - - 0 1");
    play(a, "d4", "Kd7", "Nf3", "Ke8", "Ng1", "Kd7", "Nf3", "Ke8", "Ng1");
    // positions with black to move: after d4, after Ng1, after Ng1 -> all equal
    expect(a.repetitionCount()).toBe(3);
    // With a black pawn on e4, ep after d4 is legal -> first position differs.
    const b = new Chess("4k3/8/8/8/4p3/8/3P4/4K1N1 w - - 0 1");
    play(b, "d4", "Kd7", "Nf3", "Ke8", "Ng1", "Kd7", "Nf3", "Ke8", "Ng1");
    expect(b.repetitionCount()).toBe(2);
  });

  it("applies the 50 and 75 move rules", () => {
    expect(new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 99 80").canClaimFifty()).toBe(false);
    const c = new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 100 80");
    expect(c.canClaimFifty()).toBe(true);
    expect(c.outcome()).toBeNull();
    const d = new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 149 80");
    play(d, "Ra2");
    expect(d.outcome()).toEqual({ winner: null, reason: "seventyfive" });
    // checkmate on the 150th half-move still counts as mate
    const m = new Chess("6k1/5ppp/8/8/8/8/8/R5K1 w - - 149 80");
    play(m, "Ra8#");
    expect(m.outcome()).toEqual({ winner: "w", reason: "checkmate" });
  });

  it("loses castling rights when king or rook moves or a rook is captured", () => {
    const c = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    play(c, "Rxa8+");
    expect(c.castling).toBe("Kk");
    const d = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    play(d, "Ke2");
    expect(d.castling).toBe("kq");
    // cannot castle through an attacked square
    const e = new Chess("4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1");
    const sans = e.moves().map((m) => m.san);
    expect(sans).not.toContain("O-O");
    expect(sans).toContain("O-O-O");
  });

  it("reports whether a side can still mate", () => {
    const c = (fen: string) => new Chess(fen);
    expect(c("4k3/8/8/8/8/8/8/4K3 w - - 0 1").canMate("w")).toBe(false);
    expect(c("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1").canMate("w")).toBe(false);
    expect(c("4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1").canMate("w")).toBe(true); // c1 dark, f1 light
    expect(c("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1").canMate("w")).toBe(false);
    expect(c("4k3/8/8/8/8/8/8/NN2K3 w - - 0 1").canMate("w")).toBe(true);
    expect(c("4k3/8/8/8/8/8/8/1N1BK3 w - - 0 1").canMate("w")).toBe(true);
    expect(c("4k3/8/8/8/8/8/P7/4K3 w - - 0 1").canMate("w")).toBe(true);
    expect(c("4k3/8/8/8/8/8/P7/4K3 w - - 0 1").canMate("b")).toBe(false);
  });
});

describe("Chess bot", () => {
  const positions = [
    START_FEN,
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1",
  ];

  it("returns a legal move at every level", () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const { level } of BOT_LEVELS) {
      for (const fen of positions) {
        const c = new Chess(fen);
        const m = botMove(c, level, rng);
        expect(c.fen()).toBe(fen);
        expect(c.moves().map((x) => x.uci)).toContain(m.uci);
      }
    }
  }, 30_000);

  it("finds a back-rank mate in one at levels 2-4", () => {
    for (const level of [2, 3, 4] as const) {
      for (let i = 0; i < 3; i++) {
        const c = new Chess("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1");
        expect(botMove(c, level).san).toBe("Rd8#");
      }
    }
  });

  it("level 4 answers quickly from a middlegame", () => {
    const c = new Chess("r2q1rk1/pp2bppp/2n1bn2/2pp4/3P4/2PBPN2/PP1N1PPP/R1BQ1RK1 w - - 0 9");
    const t = performance.now();
    const m = botMove(c, 4);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(c.moves().map((x) => x.uci)).toContain(m.uci);
  });
});
