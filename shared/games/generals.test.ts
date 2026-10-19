import { describe, expect, it } from "vitest";
import { Rng } from "../tetris/engine";
import {
  ARMY,
  GG_COLS,
  GeneralsGame,
  RANKS,
  RANK_INFO,
  challenge,
  randomSetup,
  setupZone,
  validateSetup,
  type GGPiece,
  type GGState,
  type Rank,
  type Side,
} from "./generals";
import { botMove, botObserve, botSetup, type BotMemory } from "./generalsBot";

const at = (r: number, c: number) => r * GG_COLS + c;
const rng = (seed: number) => {
  const r = new Rng(seed);
  return () => r.next();
};

/** A hand-made position: [cell, side, rank]. */
function position(pieces: [number, Side, Rank][], turn: Side = 0): GeneralsGame {
  const cells: (GGPiece | null)[] = new Array(72).fill(null);
  pieces.forEach(([cell, side, rank], i) => (cells[cell] = { id: side * 100 + i, side, rank }));
  const s: GGState = { cells, turn, winner: null, reason: null, pendingFlag: null, moves: 0, captured: [[], []] };
  return GeneralsGame.deserialize(s);
}

const OFFICERS: Rank[] = ["G5", "G4", "G3", "G2", "G1", "COL", "LTC", "MAJ", "CPT", "1LT", "2LT", "SGT"];

describe("Generals challenge table", () => {
  it("resolves every rank pair", () => {
    for (const a of RANKS) {
      for (const d of RANKS) {
        let want: string;
        if (d === "FLG") want = "attacker";
        else if (a === "FLG") want = "defender";
        else if (a === d) want = "both";
        else if (a === "SPY") want = d === "PVT" ? "defender" : "attacker";
        else if (d === "SPY") want = a === "PVT" ? "attacker" : "defender";
        else want = RANK_INFO[a].power > RANK_INFO[d].power ? "attacker" : "defender";
        expect(challenge(a, d), `${a} vs ${d}`).toBe(want);
      }
    }
  });

  it("spells out the special cases", () => {
    for (const o of OFFICERS) {
      expect(challenge("SPY", o)).toBe("attacker");
      expect(challenge(o, "SPY")).toBe("defender");
      expect(challenge("PVT", o)).toBe("defender");
    }
    expect(challenge("PVT", "SPY")).toBe("attacker");
    expect(challenge("SPY", "PVT")).toBe("defender");
    expect(challenge("SPY", "SPY")).toBe("both");
    expect(challenge("PVT", "PVT")).toBe("both");
    expect(challenge("G5", "G5")).toBe("both");
    expect(challenge("FLG", "FLG")).toBe("attacker");
    expect(challenge("PVT", "FLG")).toBe("attacker");
    expect(challenge("FLG", "PVT")).toBe("defender");
    expect(challenge("G5", "G4")).toBe("attacker");
    expect(challenge("SGT", "PVT")).toBe("attacker");
    expect(challenge("MAJ", "COL")).toBe("defender");
  });
});

describe("Generals setup", () => {
  it("has a 21-piece army and 27-cell zones", () => {
    expect(ARMY).toHaveLength(21);
    expect(ARMY[0]).toBe("G5");
    expect(ARMY.filter((r) => r === "PVT")).toHaveLength(6);
    expect(ARMY.filter((r) => r === "SPY")).toHaveLength(2);
    for (const side of [0, 1] as Side[]) {
      const z = setupZone(side);
      expect(z).toHaveLength(27);
      const rows = new Set(z.map((c) => Math.floor(c / GG_COLS)));
      expect([...rows].sort()).toEqual(side === 0 ? [0, 1, 2] : [5, 6, 7]);
    }
  });

  it("validates setups", () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(validateSetup(0, randomSetup(0, rng(seed)))).toBe(true);
      expect(validateSetup(1, randomSetup(1, rng(seed)))).toBe(true);
    }
    const ok = randomSetup(0, rng(7));
    expect(validateSetup(1, ok)).toBe(false); // wrong zone
    expect(validateSetup(0, ok.slice(1))).toBe(false); // too few
    expect(validateSetup(0, [...ok, { cell: 26, rank: "PVT" }])).toBe(false); // too many
    const dup = ok.map((p) => ({ ...p }));
    dup[1].cell = dup[0].cell;
    expect(validateSetup(0, dup)).toBe(false);
    const wrongCount = ok.map((p) => ({ ...p }));
    wrongCount[wrongCount.findIndex((p) => p.rank === "PVT")].rank = "G5";
    expect(validateSetup(0, wrongCount)).toBe(false);
    const outside = ok.map((p) => ({ ...p }));
    outside[0].cell = at(3, 0);
    expect(validateSetup(0, outside)).toBe(false);
    for (const junk of [null, undefined, 5, "x", {}, [1, 2], ok.map(() => null), ok.map((p) => ({ ...p, rank: "KING" })), ok.map((p) => ({ ...p, cell: p.cell + 0.5 }))]) {
      expect(validateSetup(0, junk)).toBe(false);
    }
    expect(() => new GeneralsGame(ok, ok)).toThrow();
  });
});

describe("Generals moves", () => {
  it("allows only orthogonal single steps, in turn, not onto own pieces", () => {
    const g = position([
      [at(3, 4), 0, "MAJ"],
      [at(3, 5), 0, "SGT"],
      [at(0, 0), 0, "FLG"],
      [at(7, 8), 1, "FLG"],
      [at(6, 8), 1, "PVT"],
    ]);
    const tos = g.legalMoves().filter((m) => m.from === at(3, 4)).map((m) => m.to).sort((a, b) => a - b);
    expect(tos).toEqual([at(2, 4), at(3, 3), at(4, 4)]);
    expect(g.legalMoves(1)).toEqual([]);
    const before = JSON.stringify(g.serialize());
    expect(g.move(0, at(3, 4), at(4, 5))).toBeNull(); // diagonal
    expect(g.move(0, at(3, 4), at(5, 4))).toBeNull(); // two squares
    expect(g.move(0, at(3, 4), at(3, 5))).toBeNull(); // own piece
    expect(g.move(1, at(6, 8), at(5, 8))).toBeNull(); // wrong turn
    expect(g.move(0, at(5, 5), at(4, 5))).toBeNull(); // empty square
    expect(g.move(0, at(0, 8), at(0, 9))).toBeNull(); // off the row
    expect(g.move(0, -1, 0)).toBeNull();
    expect(g.move(0, 71, 72)).toBeNull();
    expect(JSON.stringify(g.serialize())).toBe(before);
    expect(g.move(0, at(3, 4), at(4, 4))).toEqual({ from: at(3, 4), to: at(4, 4), side: 0 });
    expect(g.turn).toBe(1);
    expect(g.moves).toBe(1);
    expect(g.move(0, at(4, 4), at(5, 4))).toBeNull();
  });

  it("removes the right pieces in challenges and records them", () => {
    const g = position(
      [
        [at(3, 0), 0, "COL"],
        [at(4, 0), 1, "MAJ"],
        [at(3, 4), 0, "PVT"],
        [at(4, 4), 1, "PVT"],
        [at(3, 8), 0, "SPY"],
        [at(4, 8), 1, "PVT"],
        [at(0, 4), 0, "FLG"],
        [at(7, 4), 1, "FLG"],
      ],
      0,
    );
    const r1 = g.move(0, at(3, 0), at(4, 0))!;
    expect(r1.challenge).toBe("attacker");
    expect(r1).not.toHaveProperty("rank");
    expect(g.cells[at(4, 0)]?.rank).toBe("COL");
    expect(g.cells[at(3, 0)]).toBeNull();
    expect(g.captured[1].map((p) => p.rank)).toEqual(["MAJ"]);

    const r2 = g.move(1, at(4, 4), at(3, 4))!;
    expect(r2.challenge).toBe("both");
    expect(g.cells[at(3, 4)]).toBeNull();
    expect(g.cells[at(4, 4)]).toBeNull();

    const r3 = g.move(0, at(3, 8), at(4, 8))!;
    expect(r3.challenge).toBe("defender");
    expect(g.cells[at(4, 8)]?.rank).toBe("PVT");
    expect(g.cells[at(3, 8)]).toBeNull();
    expect(g.captured[0].map((p) => p.rank)).toEqual(["PVT", "SPY"]);
    expect(g.captured[1].map((p) => p.rank)).toEqual(["MAJ", "PVT"]);
    expect(g.winner).toBeNull();
  });

  it("capturing the flag wins, and the attacking flag beats a flag", () => {
    const g = position([
      [at(3, 3), 0, "PVT"],
      [at(4, 3), 1, "FLG"],
      [at(0, 0), 0, "FLG"],
    ]);
    const r = g.move(0, at(3, 3), at(4, 3))!;
    expect(r).toMatchObject({ challenge: "attacker", winner: 0, reason: "flag-captured" });
    expect(g.winner).toBe(0);
    expect(g.legalMoves(1)).toEqual([]);
    expect(g.move(1, at(0, 0), at(1, 0))).toBeNull();

    const f = position([
      [at(4, 3), 0, "FLG"],
      [at(3, 3), 1, "FLG"],
      [at(7, 0), 0, "PVT"],
    ], 1);
    expect(f.move(1, at(3, 3), at(4, 3))).toMatchObject({ winner: 1, reason: "flag-captured" });

    // A flag attacking anything else loses itself.
    const h = position([
      [at(4, 3), 0, "FLG"],
      [at(5, 3), 1, "PVT"],
      [at(7, 0), 1, "FLG"],
    ]);
    expect(h.move(0, at(4, 3), at(5, 3))).toMatchObject({ challenge: "defender", winner: 1, reason: "flag-captured" });
  });
});

describe("Generals flag reaching the back row", () => {
  it("wins immediately with no adjacent enemy", () => {
    const g = position([
      [at(6, 4), 0, "FLG"],
      [at(7, 0), 1, "FLG"],
      [at(5, 8), 1, "G5"],
    ]);
    expect(g.move(0, at(6, 4), at(7, 4))).toMatchObject({ winner: 0, reason: "flag-reached" });
    expect(g.reason).toBe("flag-reached");

    const s1 = position([
      [at(1, 4), 1, "FLG"],
      [at(7, 0), 0, "FLG"],
    ], 1);
    expect(s1.move(1, at(1, 4), at(0, 4))).toMatchObject({ winner: 1, reason: "flag-reached" });
  });

  const pendingPos = () =>
    position([
      [at(6, 4), 0, "FLG"],
      [at(7, 5), 1, "SGT"],
      [at(7, 0), 1, "FLG"],
      [at(0, 0), 0, "PVT"],
    ]);

  it("next to an enemy, survives the opponent's move and wins", () => {
    const g = pendingPos();
    const r = g.move(0, at(6, 4), at(7, 4))!;
    expect(r.flagPending).toBe(true);
    expect(r.winner).toBeUndefined();
    expect(g.pendingFlag).toEqual({ side: 0, cell: at(7, 4) });
    expect(g.winner).toBeNull();
    const r2 = g.move(1, at(7, 0), at(6, 0))!;
    expect(r2).toMatchObject({ winner: 0, reason: "flag-reached" });
    expect(g.winner).toBe(0);
  });

  it("next to an enemy, is captured on the opponent's move and loses", () => {
    const g = pendingPos();
    g.move(0, at(6, 4), at(7, 4));
    const r2 = g.move(1, at(7, 5), at(7, 4))!;
    expect(r2).toMatchObject({ challenge: "attacker", winner: 1, reason: "flag-captured" });
    expect(g.winner).toBe(1);
    expect(g.captured[0].map((p) => p.rank)).toEqual(["FLG"]);
  });

  it("survives a serialize round-trip while pending", () => {
    const g = pendingPos();
    g.move(0, at(6, 4), at(7, 4));
    const h = GeneralsGame.deserialize(JSON.parse(JSON.stringify(g.serialize())));
    expect(h.pendingFlag).toEqual({ side: 0, cell: at(7, 4) });
    expect(h.move(1, at(7, 0), at(6, 0))).toMatchObject({ winner: 0, reason: "flag-reached" });
  });
});

describe("Generals views and state", () => {
  it("hides enemy ranks unless revealAll", () => {
    const g = new GeneralsGame(randomSetup(0, rng(1)), randomSetup(1, rng(2)));
    const v = g.viewFor(0);
    expect(v.filter(Boolean)).toHaveLength(42);
    for (const p of v) {
      if (!p) continue;
      if (p.side === 0) expect(p.rank).toBeDefined();
      else expect(p).toEqual({ id: p.id, side: 1 });
    }
    const all = g.viewFor(0, true);
    expect(all.every((p) => !p || p.rank)).toBe(true);
    const ids = g.cells.filter(Boolean).map((p) => p!.id);
    expect(new Set(ids).size).toBe(42);
    // Mutating a view doesn't touch the game.
    const mine = v.find((p) => p?.side === 0)!;
    mine.rank = "G5";
    expect(g.viewFor(0).filter((p) => p?.rank === "G5")).toHaveLength(1);
  });

  it("round-trips serialize/deserialize", () => {
    const g = new GeneralsGame(randomSetup(0, rng(3)), randomSetup(1, rng(4)), 1);
    const r = rng(5);
    for (let i = 0; i < 30 && g.winner === null; i++) {
      const ms = g.legalMoves();
      const m = ms[Math.floor(r() * ms.length)];
      g.move(g.turn, m.from, m.to);
    }
    const s = g.serialize();
    const h = GeneralsGame.deserialize(JSON.parse(JSON.stringify(s)));
    expect(h.serialize()).toEqual(s);
    expect(h.legalMoves()).toEqual(g.legalMoves());
    // Independent copies.
    s.cells.fill(null);
    expect(h.cells.some(Boolean)).toBe(true);
  });

  it("a side with no legal moves has none listed (and would lose)", () => {
    // Under these rules a side only lacks moves when it fills the whole board,
    // so check the move generator on that position directly.
    const cells: [number, Side, Rank][] = [];
    for (let i = 0; i < 72; i++) cells.push([i, 1, i === 0 ? "FLG" : "PVT"]);
    const g = position(cells, 1);
    expect(g.legalMoves(1)).toEqual([]);
    expect(g.legalMoves(0)).toEqual([]);
  });

  it("declares a no-moves loss after a move leaves the opponent stuck", () => {
    // Craft: side 1 fills every cell but one; side 0's lone piece captures into it?
    // Unreachable in real play; emulate by moving into a board where side 1 has
    // nothing but a boxed-in cluster is impossible, so we patch legalMoves.
    const g = position([
      [at(3, 3), 0, "PVT"],
      [at(0, 0), 0, "FLG"],
      [at(7, 7), 1, "FLG"],
    ]);
    const orig = g.legalMoves.bind(g);
    g.legalMoves = (side?: Side) => (side === 1 ? [] : orig(side));
    expect(g.move(0, at(3, 3), at(4, 3))).toMatchObject({ winner: 0, reason: "no-moves" });
    expect(g.winner).toBe(0);
  });
});

describe("Generals bot", () => {
  it("produces valid setups for both sides", () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const side of [0, 1] as Side[]) {
        const p = botSetup(side, rng(seed * 2 + side));
        expect(validateSetup(side, p)).toBe(true);
        const flag = p.find((x) => x.rank === "FLG")!;
        expect(Math.floor(flag.cell / GG_COLS)).toBe(side === 0 ? 0 : 7);
        for (const s of p.filter((x) => x.rank === "SPY")) expect(Math.floor(s.cell / GG_COLS)).not.toBe(side === 0 ? 2 : 5);
      }
    }
  });

  it("plays 50 full games against itself", () => {
    const reasons: Record<string, number> = {};
    let total = 0;
    let capped = 0;
    const CAP = 2000;
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed * 7919);
      const g = new GeneralsGame(botSetup(0, r), botSetup(1, r), (seed % 2) as Side);
      const mem: [BotMemory, BotMemory] = [{}, {}];
      while (g.winner === null && g.moves < CAP) {
        const side = g.turn;
        const m = botMove(g, side, mem[side], r);
        expect(m).not.toBeNull();
        const legal = g.legalMoves(side);
        expect(legal.some((x) => x.from === m!.from && x.to === m!.to)).toBe(true);
        const attackerId = g.cells[m!.from]!.id;
        const defenderId = g.cells[m!.to]?.id ?? null;
        const res = g.move(side, m!.from, m!.to);
        expect(res).not.toBeNull();
        for (const s of [0, 1] as Side[]) botObserve(mem[s], g, s, res!, attackerId, defenderId);
      }
      if (g.winner === null) capped++;
      else {
        reasons[g.reason!] = (reasons[g.reason!] ?? 0) + 1;
        expect(botMove(g, g.turn, mem[g.turn], r)).toBeNull();
      }
      total += g.moves;
    }
    console.log(`generals bot-vs-bot: avg ${(total / 50).toFixed(1)} moves, capped ${capped}, reasons`, reasons);
    expect(capped).toBeLessThanOrEqual(3);
  });
});
