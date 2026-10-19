import { useEffect, useState } from "react";
import { GG_COLS, GG_ROWS, RANK_INFO, type Rank, type Side } from "../../../shared/games/generals";
import { settingsStore } from "../../lib/store";
import { getGGBoard, getGGPieces } from "../looks";
import { GGPieceView } from "./Insignia";

export type GGCell = { id: number; side: Side; rank?: Rank } | null;

/**
 * The 9x8 board from `me`'s point of view (your army at the bottom).
 * `marked` cells get a dot (legal targets / setup slots), `selected` a ring.
 */
export function GeneralsBoard({ cells, me, size, onTap, selected, marked, last, pending, dimEnemy }: {
  cells: GGCell[];
  me: Side;
  size: number;
  onTap?: (cell: number) => void;
  selected?: number | null;
  marked?: number[];
  last?: { from: number; to: number } | null;
  pending?: number | null;
  dimEnemy?: boolean;
}) {
  const look = settingsStore.use();
  const set = getGGPieces(look.ggPieces);
  const b = getGGBoard(look.ggBoard);
  const cell = size / GG_COLS;
  const pos = (i: number) => {
    const r = Math.floor(i / GG_COLS);
    const c = i % GG_COLS;
    return me === 0 ? { x: c, y: GG_ROWS - 1 - r } : { x: GG_COLS - 1 - c, y: r };
  };
  return (
    <div className="relative overflow-hidden rounded-lg shadow-2xl select-none" style={{ width: size, height: cell * GG_ROWS, background: b.line }}>
      {cells.map((p, i) => {
        const { x, y } = pos(i);
        const isLast = last && (i === last.from || i === last.to);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onTap?.(i)}
            aria-label={`Square ${String.fromCharCode(65 + (i % GG_COLS))}${Math.floor(i / GG_COLS) + 1}${p ? (p.side === me ? `, your ${p.rank ? RANK_INFO[p.rank].name : "piece"}` : p.rank ? `, enemy ${RANK_INFO[p.rank].name}` : ", enemy piece") : ""}`}
            className="absolute grid place-items-center"
            style={{
              left: x * cell + 0.5,
              top: y * cell + 0.5,
              width: cell - 1,
              height: cell - 1,
              background: (x + y) % 2 ? b.dark : b.light,
              cursor: onTap ? "pointer" : "default",
            }}
          >
            {isLast && <span className="absolute inset-0 bg-yellow-300/25" />}
            {i === pending && <span className="absolute inset-0 animate-pulse bg-rose-500/35" />}
            {p && (
              <span className={`relative transition ${selected === i ? "-translate-y-1 drop-shadow-[0_6px_6px_rgba(0,0,0,0.5)]" : ""} ${dimEnemy && p.side !== me ? "opacity-80" : ""}`}>
                <GGPieceView rank={p.rank} mine={p.side === me} set={set} size={cell * 0.9} />
              </span>
            )}
            {selected === i && <span className="absolute inset-0.5 rounded-md ring-2 ring-yellow-300" />}
            {marked?.includes(i) && (
              <span className={`absolute rounded-full ${p ? "inset-1 ring-2 ring-rose-400/80" : "size-[26%] bg-black/35"}`} />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function useGGBoardSize(max = 540) {
  const calc = () => Math.floor(Math.min(max, window.innerWidth - 32, ((window.innerHeight - 250) * GG_COLS) / GG_ROWS) / GG_COLS) * GG_COLS;
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const on = () => setSize(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  });
  return Math.max(270, size);
}
