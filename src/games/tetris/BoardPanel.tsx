import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLS, VISIBLE_ROWS } from "../../../shared/tetris/engine";
import { drawField, drawPreview, setupCanvas } from "./render";
import { getSkin, getTheme } from "./skins";
import type { PanelState, Popup } from "./session";

interface Props {
  getState: () => PanelState | null;
  getPopups?: () => Popup[];
  getShakeAt?: () => number;
  skinId: string;
  themeId: string;
  cell: number;
  ghost?: boolean;
  nextCount?: number;
  /** Rendered under the HOLD box. */
  side?: ReactNode;
  /** Centered over the playfield (countdown, KO, game over...). */
  overlay?: ReactNode;
  header?: ReactNode;
}

export function BoardPanel({
  getState,
  getPopups,
  getShakeAt,
  skinId,
  themeId,
  cell,
  ghost = true,
  nextCount = 5,
  side,
  overlay,
  header,
}: Props) {
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const holdRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const lastPopupId = useRef(0);

  const skin = getSkin(skinId);
  const theme = getTheme(themeId);
  const pv = Math.round(cell * 0.72); // preview cell size
  const boxW = pv * 4 + 16;

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const st = getState();
      if (st && fieldRef.current && holdRef.current && nextRef.current) {
        const f = setupCanvas(fieldRef.current, COLS * cell, VISIBLE_ROWS * cell);
        drawField(f, st.view, skin, theme, cell, ghost);

        const h = setupCanvas(holdRef.current, boxW, pv * 3);
        h.clearRect(0, 0, boxW, pv * 3);
        drawPreview(h, st.hold, skin, 0, 0, boxW, pv * 3, pv, st.holdUsed);

        const slot = pv * 2.6;
        const n = setupCanvas(nextRef.current, boxW, slot * nextCount);
        n.clearRect(0, 0, boxW, slot * nextCount);
        st.next.slice(0, nextCount).forEach((t, i) => {
          const s = i === 0 ? pv : Math.round(pv * 0.85);
          drawPreview(n, t, skin, 0, i * slot, boxW, slot, s);
        });

        if (meterRef.current) {
          const pct = Math.min(1, st.incoming / VISIBLE_ROWS) * 100;
          meterRef.current.style.height = `${pct}%`;
          meterRef.current.dataset.hot = st.incoming >= 6 ? "1" : "0";
        }
      }
      if (getShakeAt && wrapRef.current) {
        const age = performance.now() - getShakeAt();
        if (age < 260) {
          const amp = (1 - age / 260) * 5;
          wrapRef.current.style.transform = `translate(${(Math.random() - 0.5) * amp}px, ${amp * 0.6}px)`;
        } else wrapRef.current.style.transform = "";
      }
      if (getPopups) {
        const ps = getPopups();
        const lastId = ps.length ? ps[ps.length - 1].id : 0;
        if (lastId !== lastPopupId.current) {
          lastPopupId.current = lastId;
          setPopups(ps);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getState, getPopups, getShakeAt, skin, theme, cell, ghost, nextCount, pv, boxW]);

  const labelCls = "text-[10px] font-bold tracking-[0.2em] uppercase";

  return (
    <div className="flex flex-col items-center gap-2" style={{ color: theme.text }}>
      {header}
      <div className="flex items-start gap-2 sm:gap-3">
        {/* Left column: hold + stats */}
        <div className="flex flex-col gap-2" style={{ width: boxW }}>
          <div className="panel-box rounded-xl p-1.5" style={{ ["--frame" as string]: theme.frame }}>
            <div className={`${labelCls} px-1 opacity-70`}>Hold</div>
            <canvas ref={holdRef} />
          </div>
          {side}
        </div>

        {/* Garbage meter + field */}
        <div
          ref={wrapRef}
          className="relative flex rounded-xl p-1.5 board-frame"
          style={{ ["--frame" as string]: theme.frame, ["--glow" as string]: theme.glow }}
        >
          <div className="relative mr-1.5 w-2 overflow-hidden rounded-full bg-black/40" style={{ height: VISIBLE_ROWS * cell }}>
            <div ref={meterRef} className="garbage-meter absolute bottom-0 left-0 right-0 rounded-full" style={{ height: 0 }} />
          </div>
          <div className="relative overflow-hidden rounded-md">
            <canvas ref={fieldRef} className="block" />
            <div className="pointer-events-none absolute inset-x-0 top-1/3 flex flex-col items-center gap-1">
              {popups.map((p) => (
                <div key={p.id} className={`popup popup-${p.kind}`}>
                  {p.text}
                  {p.sub && <span className="ml-1 text-[0.6em] opacity-80">{p.sub}</span>}
                </div>
              ))}
            </div>
            {overlay && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">{overlay}</div>
            )}
          </div>
        </div>

        {/* Next queue */}
        <div className="panel-box rounded-xl p-1.5" style={{ width: boxW, ["--frame" as string]: theme.frame }}>
          <div className={`${labelCls} px-1 opacity-70`}>Next</div>
          <canvas ref={nextRef} />
        </div>
      </div>
    </div>
  );
}

/** Pick a cell size that fits the viewport. */
export function useCellSize(scale = 1, reserve = 260): number {
  const calc = () => {
    if (typeof window === "undefined") return 28;
    const byH = (window.innerHeight - reserve) / VISIBLE_ROWS;
    const byW = (window.innerWidth - 40) / (COLS + 9);
    return Math.max(12, Math.min(34, Math.floor(Math.min(byH, byW) * scale)));
  };
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const on = () => setSize(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, reserve]);
  return size;
}
