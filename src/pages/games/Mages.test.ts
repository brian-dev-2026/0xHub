import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../games/mages/engine", () => ({ mountMages: vi.fn() }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));
const { api } = await import("./Mages");

function answer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error("bad json"); return body; } })));
}
const input = () => api.input("r1", { upTo: 1, actions: [], h: 1 }, { signal: undefined });

afterEach(() => vi.unstubAllGlobals());

describe("Mage Siege api input()", () => {
  it("throws for a body without a boolean ok (a failed request, never a refusal)", async () => {
    answer(200, { pending: true });
    await expect(input()).rejects.toThrow();
    answer(200, undefined);
    await expect(input()).rejects.toThrow();
    answer(500, { error: "boom" });
    await expect(input()).rejects.toThrow("boom");
  });

  it("passes retry:true through untouched", async () => {
    const body = { ok: false, error: "Verification is behind: send this again later", retry: true };
    answer(400, body);
    await expect(input()).resolves.toEqual(body);
  });

  it("returns a normal ok:false refusal (HTTP 400) as data", async () => {
    answer(400, { ok: false, error: "Run failed verification" });
    await expect(input()).resolves.toEqual({ ok: false, error: "Run failed verification" });
  });
});
