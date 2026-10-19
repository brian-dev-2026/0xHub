import { useEffect, useRef } from "react";
import type { Dir } from "../../../shared/games/g2048";
import { settingsStore } from "../../lib/store";
import { getTileSet, tileColors, type TileSet } from "../looks";

export function Board2048({
  board,
  size = 320,
  merged = [],
  spawn = -1,
  dim = false,
  overlay,
  tileSet,
}: {
  board: number[];
  size?: number;
  merged?: number[];
  spawn?: number;
  dim?: boolean;
  overlay?: React.ReactNode;
  /** Defaults to the player's chosen tile set. */
  tileSet?: TileSet;
}) {
  const chosen = settingsStore.use().tiles2048;
  const set = tileSet ?? getTileSet(chosen);
  const gap = Math.round(size * 0.03);
  const cell = (size - gap * 5) / 4;
  return (
    <div
      className="relative p-0"
      style={{ width: size, height: size, background: set.board, borderRadius: set.pixel ? 0 : 16, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
    >
      {board.map((v, i) => {
        const x = i % 4;
        const y = Math.floor(i / 4);
        const [bg, fg] = v > 0 ? tileColors(set, v) : ["", ""];
        const digits = String(v).length;
        return (
          <div
            key={i}
            className="absolute"
            style={{ left: gap + x * (cell + gap), top: gap + y * (cell + gap), width: cell, height: cell, background: set.empty, borderRadius: set.radius }}
          >
            {v > 0 && (
              <div
                className={`grid h-full w-full place-items-center font-bold ${set.pixel ? "font-mono" : ""} ${merged.includes(i) ? "t2048-pop" : ""} ${spawn === i ? "t2048-spawn" : ""}`}
                style={{
                  background: set.neon ? "rgba(0,0,0,0.35)" : bg,
                  color: fg,
                  borderRadius: set.radius,
                  border: set.neon ? `2px solid ${bg}` : undefined,
                  textShadow: set.neon ? `0 0 8px ${bg}` : undefined,
                  fontSize: cell * (digits <= 2 ? 0.45 : digits === 3 ? 0.36 : 0.28),
                  boxShadow: set.neon
                    ? `0 0 ${6 + Math.log2(v) * 1.5}px ${bg}, inset 0 0 10px ${bg}55`
                    : set.pixel
                      ? "inset -4px -4px 0 rgba(0,0,0,0.25), inset 4px 4px 0 rgba(255,255,255,0.25)"
                      : v >= 128
                        ? `0 0 ${Math.min(30, Math.log2(v) * 2)}px ${bg}`
                        : "inset 0 -3px 0 rgba(0,0,0,0.12)",
                }}
              >
                {v}
              </div>
            )}
          </div>
        );
      })}
      {(dim || overlay) && (
        <div className={`absolute inset-0 grid place-items-center ${set.pixel ? "" : "rounded-2xl"} ${dim ? "bg-black/55 backdrop-blur-[1px]" : ""}`}>{overlay}</div>
      )}
    </div>
  );
}

/** Arrow keys / WASD and swipe gestures → move(dir). */
export function useMoveInput(onMove: (d: Dir) => void, enabled: boolean, target?: React.RefObject<HTMLElement | null>) {
  const cb = useRef(onMove);
  cb.current = onMove;
  useEffect(() => {
    if (!enabled) return;
    const keys: Record<string, Dir> = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const d = keys[e.code];
      if (d === undefined) return;
      e.preventDefault();
      if (!e.repeat) cb.current(d);
    };
    let start: { x: number; y: number } | null = null;
    const el = target?.current ?? window;
    const down = (e: Event) => {
      const p = e as PointerEvent;
      start = { x: p.clientX, y: p.clientY };
    };
    const up = (e: Event) => {
      const p = e as PointerEvent;
      if (!start) return;
      const dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      cb.current(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
    };
    window.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
    };
  }, [enabled, target]);
}

export function useBoardSize(max = 380) {
  const calc = () => Math.min(max, Math.floor(window.innerWidth - 40), Math.floor(window.innerHeight - 280));
  const ref = useRef(calc());
  return Math.max(220, ref.current);
}
