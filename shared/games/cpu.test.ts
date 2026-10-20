import { describe, expect, it } from "vitest";
import { cpuLevelLabel, parseCpuResult } from "./cpu";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("parseCpuResult", () => {
  it("scores wins by level and gives no points otherwise", () => {
    expect(parseCpuResult({ game: "chess", gameId: id, level: "4", result: "win", durationMs: 60_000 })).toMatchObject({ points: 4 });
    expect(parseCpuResult({ game: "pool", gameId: id, level: "hard", result: "win", durationMs: 90_000 })).toMatchObject({ points: 3 });
    expect(parseCpuResult({ game: "chess", gameId: id, level: "4", result: "loss", durationMs: 1_000 })).toMatchObject({ points: 0 });
    expect(parseCpuResult({ game: "generals", gameId: id, level: "standard", result: "draw", durationMs: 5_000 })).toMatchObject({ points: 0 });
  });

  it("rejects unknown games, levels and results", () => {
    expect(parseCpuResult({ game: "tetris", gameId: id, level: "1", result: "win", durationMs: 60_000 })).toBeTypeOf("string");
    expect(parseCpuResult({ game: "chess", gameId: id, level: "9", result: "win", durationMs: 60_000 })).toBeTypeOf("string");
    expect(parseCpuResult({ game: "pool", gameId: id, level: "hard", result: "victory", durationMs: 60_000 })).toBeTypeOf("string");
    expect(parseCpuResult({ game: "pool", gameId: "x", level: "hard", result: "win", durationMs: 60_000 })).toBeTypeOf("string");
  });

  it("rejects impossibly quick wins and bad durations", () => {
    expect(parseCpuResult({ game: "chess", gameId: id, level: "1", result: "win", durationMs: 2_000 })).toBeTypeOf("string");
    expect(parseCpuResult({ game: "pool", gameId: id, level: "easy", result: "win", durationMs: Number.NaN })).toBeTypeOf("string");
    expect(parseCpuResult({ game: "pool", gameId: id, level: "easy", result: "win", durationMs: -5 })).toBeTypeOf("string");
  });

  it("names the hardest level beaten", () => {
    expect(cpuLevelLabel("chess", 3)).toBe("Club");
    expect(cpuLevelLabel("pool", 0)).toBe("—");
  });
});
