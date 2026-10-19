import type { Color, PieceType } from "../../../shared/games/chess";
import type { ChessPieceSet } from "../looks";

// Hand-drawn piece shapes on a 45x45 grid (no fonts or emoji, so they look
// the same everywhere). `F` = filled body, `D` = detail lines.

const BASE = <rect x="10.5" y="35" width="24" height="5.5" rx="2" />;

function shapes(type: PieceType) {
  switch (type) {
    case "p":
      return {
        body: (
          <>
            {BASE}
            <path d="M15.5 35.5 Q16 26 20 22.5 L25 22.5 Q29 26 29.5 35.5 Z" />
            <ellipse cx="22.5" cy="21.5" rx="6" ry="2" />
            <circle cx="22.5" cy="14.5" r="5.5" />
          </>
        ),
        detail: null,
      };
    case "r":
      return {
        body: (
          <>
            {BASE}
            <path d="M13.5 35.5 L15 18 H30 L31.5 35.5 Z" />
            <path d="M12 8.5 H16.5 V12 H20.5 V8.5 H24.5 V12 H28.5 V8.5 H33 V18.5 H12 Z" />
          </>
        ),
        detail: <path d="M15 18.5 H30 M14.2 31 H30.8" fill="none" strokeWidth="1.2" />,
      };
    case "n":
      return {
        body: (
          <>
            {BASE}
            <path d="M13 35.5 Q12.5 28 18.5 22.5 Q15 24.5 11.5 23.5 Q9.5 21 11.5 18 Q15 12.5 19 9.5 L18.5 5.5 L22 8.5 Q31.5 9 33 22 Q33.5 30 32 35.5 Z" />
          </>
        ),
        detail: (
          <>
            <circle cx="18" cy="14.5" r="1.3" stroke="none" />
            <path d="M24 11.5 Q29 15 29.5 24" fill="none" strokeWidth="1.2" />
          </>
        ),
      };
    case "b":
      return {
        body: (
          <>
            {BASE}
            <path d="M15 35.5 Q13.5 24 22.5 12.5 Q31.5 24 30 35.5 Z" />
            <circle cx="22.5" cy="9" r="3" />
          </>
        ),
        detail: <path d="M24.5 19 L20 25.5 M17 31 H28" fill="none" strokeWidth="1.4" />,
      };
    case "q":
      return {
        body: (
          <>
            {BASE}
            <path d="M13 35.5 L9.5 15.5 L16 25 L17.5 12.5 L22.5 23.5 L27.5 12.5 L29 25 L35.5 15.5 L32 35.5 Z" />
            <circle cx="9.5" cy="13.5" r="2.4" />
            <circle cx="17.5" cy="10.5" r="2.4" />
            <circle cx="27.5" cy="10.5" r="2.4" />
            <circle cx="35.5" cy="13.5" r="2.4" />
          </>
        ),
        detail: <path d="M14 30.5 Q22.5 28 31 30.5" fill="none" strokeWidth="1.2" />,
      };
    case "k":
      return {
        body: (
          <>
            {BASE}
            <path d="M13.5 35.5 Q10 22 16 18.5 Q22.5 15.5 29 18.5 Q35 22 31.5 35.5 Z" />
            <path d="M21 3.5 H24 V7 H27.5 V10 H24 V16.5 H21 V10 H17.5 V7 H21 Z" />
          </>
        ),
        detail: <path d="M14.5 30.5 Q22.5 27.5 30.5 30.5 M22.5 18 V26" fill="none" strokeWidth="1.2" />,
      };
  }
}

export function ChessPiece({ type, color, set, size }: { type: PieceType; color: Color; set: ChessPieceSet; size: number }) {
  const c = color === "w" ? set.white : set.black;
  const { body, detail } = shapes(type);
  const glow = set.neon ? { filter: `drop-shadow(0 0 ${size * 0.08}px ${c.fill})` } : undefined;
  return (
    <svg viewBox="0 0 45 45" width={size} height={size} style={glow} aria-hidden>
      <g
        fill={set.neon ? "rgba(0,0,0,0.55)" : c.fill}
        stroke={c.stroke}
        strokeWidth={set.neon ? 1.8 : 1.5}
        strokeLinejoin="round"
        style={set.neon ? undefined : { filter: "drop-shadow(0 1.5px 0.5px rgba(0,0,0,0.35))" }}
      >
        {body}
      </g>
      {detail && (
        <g stroke={c.detail} fill={c.detail} strokeLinecap="round">
          {detail}
        </g>
      )}
    </svg>
  );
}
