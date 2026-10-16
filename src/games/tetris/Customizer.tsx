import { useEffect, useRef } from "react";
import { settingsStore } from "../../lib/store";
import { COLS, VISIBLE_ROWS, decodeCell, type PieceType } from "./engine";
import { drawField, drawPreview, setupCanvas } from "./render";
import { SKINS, THEMES, getSkin, getTheme } from "./skins";

// A small hand-made stack used for previews.
const DEMO = [
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "........I.",
  "Z.......I.",
  "ZZ...O..IL",
  "JZ.TTOO.LL",
  "JJJTSSLLLL",
  "GGGG.GGGGG",
  "GGGG.GGGGG",
].join("");

function demoCells() {
  const rows: number[][] = [];
  for (let y = 0; y < VISIBLE_ROWS; y++) {
    rows.push([...DEMO.slice(y * COLS, y * COLS + COLS)].map(decodeCell));
  }
  return rows;
}

export function BoardPreview({ skinId, themeId, cell = 16 }: { skinId: string; themeId: string; cell?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ctx = setupCanvas(ref.current, COLS * cell, VISIBLE_ROWS * cell);
    drawField(
      ctx,
      { cells: demoCells(), active: { type: "T", x: 4, y: 6, rot: 2 }, ghostY: 14 },
      getSkin(skinId),
      getTheme(themeId),
      cell,
    );
  }, [skinId, themeId, cell]);
  const theme = getTheme(themeId);
  return (
    <div className="board-frame inline-block rounded-xl p-1.5" style={{ ["--frame" as string]: theme.frame, ["--glow" as string]: theme.glow }}>
      <canvas ref={ref} className="block rounded-md" />
    </div>
  );
}

function SkinSwatch({ skinId }: { skinId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ctx = setupCanvas(ref.current, 126, 48);
    ctx.clearRect(0, 0, 126, 48);
    const skin = getSkin(skinId);
    (["T", "S", "I"] as PieceType[]).forEach((t, i) => drawPreview(ctx, t, skin, i * 42, 0, 42, 48, 11));
  }, [skinId]);
  return <canvas ref={ref} className="block" />;
}

export function Customizer({ cell = 16 }: { cell?: number }) {
  const settings = settingsStore.use();
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="flex justify-center md:sticky md:top-6">
        <BoardPreview skinId={settings.skin} themeId={settings.theme} cell={cell} />
      </div>
      <div className="flex-1 space-y-6">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-300">Block skin</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {SKINS.map((s) => (
              <button
                key={s.id}
                onClick={() => settingsStore.set({ skin: s.id })}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition ${
                  settings.skin === s.id ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-black/20 hover:border-white/25"
                }`}
              >
                <SkinSwatch skinId={s.id} />
                <span className="text-xs font-medium">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-300">Board theme</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => settingsStore.set({ theme: t.id })}
                className={`overflow-hidden rounded-xl border text-left transition ${
                  settings.theme === t.id ? "border-violet-400 ring-2 ring-violet-500/30" : "border-white/10 hover:border-white/25"
                }`}
              >
                <div className="h-14" style={{ background: `linear-gradient(180deg, ${t.bg[0]}, ${t.bg[1]})`, boxShadow: `inset 0 0 0 2px ${t.frame}, inset 0 0 20px ${t.glow}` }} />
                <div className="bg-black/30 px-2.5 py-1.5 text-xs font-medium">{t.name}</div>
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-violet-500" checked={settings.ghost} onChange={(e) => settingsStore.set({ ghost: e.target.checked })} />
          Show ghost piece
        </label>
      </div>
    </div>
  );
}
