import { describe, expect, it } from "vitest";
import { applyOutcome, checkStart, unlocked, type Progress } from "./progress";
import type { Outcome } from "./replay";

const fresh = (): Progress => ({ cleared: {}, endlessBest: 0 });
const outcome = (over: Partial<Outcome> = {}): Outcome => ({ won: true, wavesCleared: 10, lives: 20, stars: 3, score: 0, ticks: 1000, ...over });

describe("mage siege progress", () => {
  it("fresh progress unlocks the starting kit and stage 1 only", () => {
    expect(unlocked(fresh())).toEqual({ mages: ["fire", "ice", "lightning"], traps: ["spike"], spells: ["meteor"], endless: false, stages: [1] });
  });

  it("clearing a stage unlocks its rewards and the next stage", () => {
    const u = unlocked({ cleared: { 1: 2, 2: 1 }, endlessBest: 0 });
    expect(u.mages).toEqual(["fire", "ice", "lightning", "earth"]);
    expect(u.traps).toEqual(["spike", "barricade"]);
    expect(u.stages).toEqual([1, 2, 3]);
    expect(u.endless).toBe(false);
  });

  it("clearing everything unlocks Endless and all of World 1", () => {
    const u = unlocked({ cleared: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 1 }, endlessBest: 0 });
    expect(u.mages).toEqual(["fire", "ice", "lightning", "earth", "poison", "wind"]);
    expect(u.traps).toEqual(["spike", "barricade", "frost", "mine"]);
    expect(u.spells).toEqual(["meteor", "freeze", "surge"]);
    expect(u.stages).toEqual([1, 2, 3, 4, 5]);
    expect(u.endless).toBe(true);
  });

  describe("checkStart", () => {
    const six: Progress = { cleared: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 }, endlessBest: 0 };

    it("accepts a valid start", () => {
      expect(checkStart(fresh(), "stage", 1, ["fire", "ice", "lightning"])).toBeNull();
      expect(checkStart(six, "endless", 0, ["fire", "ice", "lightning", "earth", "wind"])).toBeNull();
      expect(checkStart(six, "stage", 5, ["fire", "ice", "lightning", "earth", "poison"])).toBeNull();
    });

    it("rejects a locked stage or mode", () => {
      expect(checkStart(fresh(), "stage", 3, ["fire", "ice", "lightning"])).toBe("stage is locked");
      expect(checkStart(fresh(), "stage", 6, ["fire", "ice", "lightning"])).toBe("stage is locked");
      expect(checkStart(fresh(), "stage", 1.5, ["fire", "ice", "lightning"])).toBe("stage is locked");
      expect(checkStart(fresh(), "endless", 1, ["fire", "ice", "lightning"])).toBe("Endless is locked");
      expect(checkStart(fresh(), "campaign" as never, 1, ["fire", "ice", "lightning"])).toBe("unknown mode");
    });

    it("rejects bad teams", () => {
      expect(checkStart(fresh(), "stage", 1, ["fire"])).toBe("team must have 3 mages");
      expect(checkStart(fresh(), "stage", 1, ["fire", "ice"])).toBe("team must have 3 mages");
      expect(checkStart(fresh(), "stage", 1, ["fire", "ice", "earth"])).toBe("team has a locked or unknown mage");
      expect(checkStart(fresh(), "stage", 1, ["fire", "fire", "ice"])).toBe("team has the same mage twice");
      expect(checkStart(six, "stage", 1, ["fire", "ice", "lightning", "earth", "earth"])).toBe("team has the same mage twice");
      expect(checkStart(fresh(), "stage", 1, [])).toBe("team must have 3 mages");
      expect(checkStart(fresh(), "stage", 1, "fire")).toBe("team must have 3 mages");
      expect(checkStart(fresh(), "stage", 1, [1, 2, 3])).toBe("team has a locked or unknown mage");
      expect(checkStart(six, "stage", 1, ["fire", "ice", "lightning", "earth"])).toBe("team must have 5 mages");
      expect(checkStart(six, "stage", 1, ["fire", "ice", "lightning", "earth", "poison", "wind"])).toBe("team must have 5 mages");
    });
  });

  describe("applyOutcome", () => {
    it("keeps the best stars", () => {
      let p = applyOutcome(fresh(), "stage", 1, outcome({ stars: 2 }));
      expect(p.cleared[1]).toBe(2);
      p = applyOutcome(p, "stage", 1, outcome({ stars: 1 }));
      expect(p.cleared[1]).toBe(2);
      p = applyOutcome(p, "stage", 1, outcome({ stars: 3 }));
      expect(p.cleared[1]).toBe(3);
    });

    it("ignores a lost stage and does not mutate its input", () => {
      const p = fresh();
      expect(applyOutcome(p, "stage", 2, outcome({ won: false, stars: 0 }))).toEqual(fresh());
      applyOutcome(p, "stage", 1, outcome());
      expect(p).toEqual(fresh());
    });

    it("keeps the best Endless score", () => {
      let p = applyOutcome(fresh(), "endless", 0, outcome({ won: false, stars: 0, score: 704 }));
      expect(p.endlessBest).toBe(704);
      p = applyOutcome(p, "endless", 0, outcome({ won: false, stars: 0, score: 300 }));
      expect(p.endlessBest).toBe(704);
      expect(p.cleared).toEqual({});
    });
  });
});
