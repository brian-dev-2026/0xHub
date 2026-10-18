import { describe, expect, it } from "vitest";
import { STEP_MS } from "../../../shared/tetris/engine";
import { PlayerSim, decodeEvents, runBatch } from "../../../shared/tetris/sim";
import { GameSession } from "./session";

/** Advance a session by n fixed steps the way the frame loop does. */
function steps(s: GameSession, n: number) {
  for (let i = 0; i < n; i++) {
    s.input.update(STEP_MS);
    s.sim.step();
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("GameSession input recording", () => {
  it("endless: what gets uploaded replays to the exact same game, including the final drop", async () => {
    const batches: { upTo: number; ev: number[]; h: number }[] = [];
    let over = false;
    const s = new GameSession({
      mode: "endless",
      onGameOver: () => {
        over = true;
        batches.push(s.flush()); // the page uploads immediately on game over
      },
    });
    s.newGame(1234, 1);
    s.running = true;
    for (let i = 0; i < 200 && !over; i++) {
      s.input.press(i % 2 ? "left" : "cw");
      s.input.release(i % 2 ? "left" : "cw");
      steps(s, 7);
      s.input.press("hard");
      s.input.release("hard");
      if (i % 5 === 4) batches.push(s.flush()); // periodic chunk uploads
      await tick();
    }
    expect(over).toBe(true);

    const replay = new PlayerSim({ mode: "endless", seed: 1234, startLevel: 1 });
    for (const b of batches) {
      runBatch(replay, decodeEvents(b.ev, replay.steps, b.upTo, 1e6)!, b.upTo);
      expect(replay.engine.hash()).toBe(b.h);
    }
    expect(replay.finished).toBe(true);
    expect(replay.engine.score).toBe(s.sim.engine.score);
  });

  it("battle: flushing on every lock never drops the locking input", async () => {
    const batches: { upTo: number; ev: number[]; h: number }[] = [];
    const s = new GameSession({ mode: "battle", onLock: () => batches.push(s.flush()) });
    s.newGame(77);
    s.running = true;
    for (let i = 0; i < 60; i++) {
      s.input.press("soft");
      steps(s, 5);
      s.input.release("soft");
      s.input.press("hard");
      s.input.release("hard");
      await tick();
      steps(s, 3);
    }
    batches.push(s.flush());
    const replay = new PlayerSim({ mode: "battle", seed: 77 });
    for (const b of batches) {
      runBatch(replay, decodeEvents(b.ev, replay.steps, b.upTo, 1e6)!, b.upTo);
      expect(replay.engine.hash()).toBe(b.h);
    }
    expect(replay.topOuts).toBe(s.sim.topOuts);
  });
});
