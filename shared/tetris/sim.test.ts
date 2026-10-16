import { describe, expect, it } from "vitest";
import { TetrisEngine } from "./engine";
import { Ev, KO_FREEZE_STEPS, PlayerSim, decodeEvents, runBatch } from "./sim";

/** Play a pseudo-random game, recording every successful input like the client does. */
function playRecorded(mode: "endless" | "battle", seed: number, steps: number, garbage?: Map<number, number>) {
  const log: number[] = [];
  const sim = new PlayerSim({ mode, seed, resolveGarbage: (id) => garbage?.get(id) ?? null });
  let r = 12345;
  const rand = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
  let nextGarbage = 0;
  for (let s = 0; s < steps; s++) {
    const roll = rand();
    const codes = [Ev.Left, Ev.Right, Ev.RotateCW, Ev.RotateCCW, Ev.HardDrop, Ev.Hold];
    if (roll < 0.12) {
      const c = codes[Math.floor(rand() * codes.length)];
      if (sim.apply(c)) log.push(sim.steps, c, 0);
    } else if (roll < 0.13) {
      const on = sim.sdf === 0;
      const code = on ? Ev.SoftOn : Ev.SoftOff;
      const arg = on ? 20 : 0;
      sim.apply(code, arg);
      log.push(sim.steps, code, arg);
    }
    if (garbage && s % 300 === 150 && garbage.has(nextGarbage)) {
      sim.apply(Ev.Garbage, nextGarbage);
      log.push(sim.steps, Ev.Garbage, nextGarbage);
      nextGarbage++;
    }
    sim.step();
    if (sim.finished) break;
  }
  return { sim, log };
}

describe("PlayerSim determinism", () => {
  it("replaying the input log reproduces the exact game (endless)", () => {
    const { sim, log } = playRecorded("endless", 99, 20_000);
    const replay = new PlayerSim({ mode: "endless", seed: 99 });
    const events = decodeEvents(log, 0, sim.steps, 1_000_000)!;
    runBatch(replay, events, sim.steps);
    expect(replay.engine.score).toBe(sim.engine.score);
    expect(replay.engine.lines).toBe(sim.engine.lines);
    expect(replay.engine.piecesPlaced).toBe(sim.engine.piecesPlaced);
    expect(replay.engine.hash()).toBe(sim.engine.hash());
    expect(sim.engine.piecesPlaced).toBeGreaterThan(5);
  });

  it("replays battles with garbage and KOs identically, in chunks", () => {
    const garbage = new Map(Array.from({ length: 40 }, (_, i) => [i, (i % 4) + 1]));
    const { sim, log } = playRecorded("battle", 7, 7200, garbage);
    const replay = new PlayerSim({ mode: "battle", seed: 7, resolveGarbage: (id) => garbage.get(id) ?? null });
    // Feed the log in 50ms-ish batches like the network does.
    let i = 0;
    for (let upTo = 3; upTo <= sim.steps; upTo += 3) {
      const batch: number[] = [];
      while (i < log.length && log[i] <= upTo) batch.push(log[i], log[i + 1], log[i + 2]), (i += 3);
      runBatch(replay, decodeEvents(batch, replay.steps, upTo)!, upTo);
    }
    runBatch(replay, [], sim.steps);
    expect(replay.topOuts).toBe(sim.topOuts);
    expect(replay.engine.linesSent).toBe(sim.engine.linesSent);
    expect(replay.engine.hash()).toBe(sim.engine.hash());
  });

  it("serialize/deserialize round-trips exactly mid-game", () => {
    const { sim } = playRecorded("battle", 3, 2000);
    const copy = PlayerSim.deserialize(JSON.parse(JSON.stringify(sim.serialize())), {});
    expect(copy.engine.hash()).toBe(sim.engine.hash());
    for (let s = 0; s < 600; s++) {
      if (s % 40 === 0) (sim.apply(Ev.HardDrop), copy.apply(Ev.HardDrop));
      sim.step();
      copy.step();
    }
    expect(copy.engine.hash()).toBe(sim.engine.hash());
    expect(copy.engine.score).toBe(sim.engine.score);
  });

  it("KO freezes for a second then resets the field", () => {
    const sim = new PlayerSim({ mode: "battle", seed: 1 });
    let kos = 0;
    let resets = 0;
    sim.setEvents({ onKO: () => kos++, onReset: () => resets++ });
    for (let y = 18; y < 40; y++) sim.engine.board[y] = new Array(10).fill(8).map((c, x) => (x === 9 ? 0 : c));
    sim.apply(Ev.HardDrop);
    expect(kos).toBe(1);
    expect(sim.apply(Ev.Left)).toBe(false); // frozen
    for (let s = 0; s <= KO_FREEZE_STEPS; s++) sim.step();
    expect(resets).toBe(1);
    expect(sim.engine.board.flat().every((c) => c === 0)).toBe(true);
    expect(sim.engine.gameOver).toBe(false);
  });

  it("rejects malformed or out-of-order event batches", () => {
    expect(decodeEvents([5, 0, 0, 4, 0, 0], 0, 10)).toBeNull(); // out of order
    expect(decodeEvents([5, 99, 0], 0, 10)).toBeNull(); // bad code
    expect(decodeEvents([11, 0, 0], 0, 10)).toBeNull(); // beyond upTo
    expect(decodeEvents([1, 0], 0, 10)).toBeNull(); // not triplets
    expect(decodeEvents([1.5, 0, 0], 0, 10)).toBeNull(); // not integers
    expect(decodeEvents("x", 0, 10)).toBeNull();
    expect(decodeEvents([1, 0, 0, 1, 4, 0], 0, 10)).toEqual([[1, 0, 0], [1, 4, 0]]);
  });

  it("engine state hash differs when boards differ", () => {
    const a = new TetrisEngine({ mode: "battle", seed: 5 });
    const b = new TetrisEngine({ mode: "battle", seed: 5 });
    expect(a.hash()).toBe(b.hash());
    b.move(1);
    expect(a.hash()).not.toBe(b.hash());
  });
});
