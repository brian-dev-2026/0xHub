import { afterEach, describe, expect, it, vi } from "vitest";
import { bossHpText, clearPendingRun, loadPendingRun, savePendingRun } from "./ui";

/** A minimal in-memory localStorage. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("pending run storage", () => {
  it("pending batches round-trip through storage in order", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    const run = {
      runId: "0f8e2a52-4d0e-4a43-9b0e-6f1f0e3c2b11",
      batches: [
        { upTo: 812, actions: [{ t: 3, type: "place", mage: "fire", tile: 40 }, { t: 90, type: "startWave" }], h: 123456 },
        { upTo: 1500, actions: [], h: 98765 },
        { upTo: 2210, actions: [{ t: 2000, type: "sell", tile: 40 }], h: 4242, final: true },
      ],
    };
    savePendingRun(run);
    expect([...store.data.keys()]).toEqual(["0xhubms.pending"]);
    const back = loadPendingRun();
    expect(back).toEqual(run);
    expect(back!.batches.map((b) => b.upTo)).toEqual([812, 1500, 2210]);
  });

  it("clearPendingRun removes it", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    savePendingRun({ runId: "r", batches: [{ upTo: 1, actions: [], h: 1 }] });
    clearPendingRun();
    expect(store.data.size).toBe(0);
    expect(loadPendingRun()).toBeNull();
  });

  it("storage errors are swallowed", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    });
    expect(() => savePendingRun({ runId: "r", batches: [] })).not.toThrow();
    expect(loadPendingRun()).toBeNull();
    expect(() => clearPendingRun()).not.toThrow();
  });

  it("ignores a stored value that is not a pending run", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    store.setItem("0xhubms.pending", "{not json");
    expect(loadPendingRun()).toBeNull();
    store.setItem("0xhubms.pending", JSON.stringify({ runId: 5, batches: "x" }));
    expect(loadPendingRun()).toBeNull();
  });
});

describe("boss bar text", () => {
  it("never shows more HP than the maximum, for fractional HP", () => {
    // Scaled boss HP is fractional (e.g. 480 x 1.1^9 = 1131.79...); a full-health boss used to read "1,132 / 1,131"
    const max = 480 * 1.1 ** 9;
    expect(bossHpText(max, max)).toBe("1,132 / 1,132");
    expect(bossHpText(max - 0.5, max)).toBe("1,132 / 1,132");
    expect(bossHpText(1000.2, max)).toBe("1,001 / 1,132");
    expect(bossHpText(-3, max)).toBe("0 / 1,132");
  });
});
