import { useEffect, useState } from "react";
import { sqName, type Chess, type Color, type Move, type Promotion } from "../../../shared/games/chess";
import { settingsStore } from "../../lib/store";
import { getChessBoard, getChessPieces } from "../looks";
import { ChessPiece } from "./Piece";

/**
 * Tap-to-move chess board. Tap one of your pieces to see its legal moves,
 * then tap a target square (tap the piece again to deselect). Promotions ask
 * which piece to promote to.
 */
export function ChessBoard({
  chess,
  orientation,
  size,
  interactive,
  onMove,
  lastMove,
  boardId,
  piecesId,
}: {
  chess: Chess;
  orientation: Color;
  size: number;
  /** Whether the player may move now (their turn, game running). */
  interactive: boolean;
  onMove?: (m: { from: number; to: number; promotion?: Promotion }) => void;
  lastMove?: { from: number; to: number } | null;
  /** Override the player's chosen look (used by previews). */
  boardId?: string;
  piecesId?: string;
}) {
  const look = settingsStore.use();
  const theme = getChessBoard(boardId ?? look.chessBoard);
  const pieces = getChessPieces(piecesId ?? look.chessPieces);
  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const cell = size / 8;
  const fen = chess.fen();

  // A new position (opponent moved, resync) clears any pending selection.
  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [fen]);

  const targets: Move[] = selected !== null && interactive ? chess.movesFrom(selected) : [];
  const kingInCheck = chess.inCheck() ? chess.board.findIndex((p) => p?.type === "k" && p.color === chess.turn) : -1;

  const tap = (sq: number) => {
    if (!interactive) return;
    const p = chess.board[sq];
    if (selected !== null) {
      const ms = targets.filter((m) => m.to === sq);
      if (ms.length) {
        if (ms.some((m) => m.promotion)) setPromo({ from: selected, to: sq });
        else onMove?.({ from: selected, to: sq });
        setSelected(null);
        return;
      }
    }
    if (p && p.color === chess.turn && sq !== selected) setSelected(sq);
    else setSelected(null);
  };

  // Screen position of a square for the given orientation.
  const pos = (sq: number) => {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    return orientation === "w" ? { x: file, y: 7 - rank } : { x: 7 - file, y: rank };
  };

  const squares = [];
  for (let sq = 0; sq < 64; sq++) {
    const { x, y } = pos(sq);
    const light = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;
    const p = chess.board[sq];
    const isTarget = targets.some((m) => m.to === sq);
    const hl = sq === selected || (lastMove && (sq === lastMove.from || sq === lastMove.to));
    squares.push(
      <button
        key={sq}
        type="button"
        onClick={() => tap(sq)}
        aria-label={`${sqName(sq)}${p ? `, ${p.color === "w" ? "white" : "black"} ${PIECE_NAME[p.type]}` : ""}`}
        className="absolute grid place-items-center"
        style={{ left: x * cell, top: y * cell, width: cell, height: cell, background: light ? theme.light : theme.dark, cursor: interactive ? "pointer" : "default" }}
      >
        {hl && <span className="absolute inset-0" style={{ background: theme.highlight }} />}
        {sq === kingInCheck && <span className="absolute inset-0" style={{ background: "radial-gradient(circle, rgba(239,68,68,0.9) 0%, rgba(239,68,68,0.45) 45%, transparent 75%)" }} />}
        {/* coordinates on the edge squares */}
        {x === 0 && (
          <span className="absolute top-0.5 left-1 font-bold" style={{ fontSize: cell * 0.18, color: light ? theme.coordLight : theme.coordDark }}>
            {Math.floor(sq / 8) + 1}
          </span>
        )}
        {y === 7 && (
          <span className="absolute right-1 bottom-0 font-bold" style={{ fontSize: cell * 0.18, color: light ? theme.coordLight : theme.coordDark }}>
            {"abcdefgh"[sq % 8]}
          </span>
        )}
        {p && (
          <span className="relative">
            <ChessPiece type={p.type} color={p.color} set={pieces} size={cell * 0.9} />
          </span>
        )}
        {isTarget &&
          (p ? (
            <span className="absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 ${cell * 0.08}px rgba(0,0,0,0.3)` }} />
          ) : (
            <span className="absolute rounded-full" style={{ width: cell * 0.3, height: cell * 0.3, background: "rgba(0,0,0,0.25)" }} />
          ))}
      </button>,
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg shadow-2xl ring-1 ring-black/40 select-none" style={{ width: size, height: size }}>
      {squares}
      {promo && (
        <div className="absolute inset-0 grid place-items-center bg-black/55">
          <div className="glass flex gap-2 rounded-2xl p-3" role="dialog" aria-label="Promote to">
            {(["q", "r", "b", "n"] as Promotion[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-label={`Promote to ${PIECE_NAME[t]}`}
                className="rounded-xl bg-white/10 p-1 hover:bg-white/20"
                onClick={() => {
                  onMove?.({ from: promo.from, to: promo.to, promotion: t });
                  setPromo(null);
                }}
              >
                <ChessPiece type={t} color={chess.turn} set={pieces} size={cell * 0.9} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const PIECE_NAME: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/** Board size that fits the screen. */
export function useChessBoardSize(max = 560) {
  const calc = () => Math.floor(Math.min(max, window.innerWidth - 32, window.innerHeight - 230) / 8) * 8;
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const on = () => setSize(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  });
  return Math.max(256, size);
}
