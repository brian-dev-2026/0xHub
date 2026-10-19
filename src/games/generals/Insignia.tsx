import { RANK_INFO, type Rank } from "../../../shared/games/generals";
import type { GGPieceSet } from "../looks";

// Rank insignia drawn in SVG: stars for generals, suns for field officers,
// triangles for company officers, chevrons for the sergeant and private,
// an eye for the spy and a pennant for the flag.

function star(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return <polygon key={`${cx},${cy}`} points={pts.join(" ")} />;
}

function sun(cx: number, cy: number, r: number) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return `M${cx + Math.cos(a) * r * 0.62} ${cy + Math.sin(a) * r * 0.62} L${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`;
  }).join(" ");
  return (
    <g key={`${cx},${cy}`}>
      <circle cx={cx} cy={cy} r={r * 0.45} />
      <path d={rays} fill="none" strokeWidth={r * 0.22} />
    </g>
  );
}

function tri(cx: number, cy: number, r: number) {
  return <polygon key={`${cx},${cy}`} points={`${cx},${cy - r} ${cx + r * 0.9},${cy + r * 0.7} ${cx - r * 0.9},${cy + r * 0.7}`} />;
}

/** x positions for n marks centred on a 40-wide row. */
const row = (n: number, gap: number) => Array.from({ length: n }, (_, i) => 20 + (i - (n - 1) / 2) * gap);

function marks(rank: Rank) {
  const y = 15;
  switch (rank) {
    case "G5":
      return [...row(3, 11).map((x) => star(x, 10, 5)), ...row(2, 11).map((x) => star(x, 20, 5))];
    case "G4":
      return [...row(2, 11).map((x) => star(x, 10, 5)), ...row(2, 11).map((x) => star(x, 20, 5))];
    case "G3":
      return row(3, 11).map((x) => star(x, y, 5.5));
    case "G2":
      return row(2, 12).map((x) => star(x, y, 6));
    case "G1":
      return [star(20, y, 7)];
    case "COL":
      return row(3, 11).map((x) => sun(x, y, 5));
    case "LTC":
      return row(2, 12).map((x) => sun(x, y, 5.5));
    case "MAJ":
      return [sun(20, y, 6.5)];
    case "CPT":
      return row(3, 10).map((x) => tri(x, y, 4.5));
    case "1LT":
      return row(2, 11).map((x) => tri(x, y, 5));
    case "2LT":
      return [tri(20, y, 5.5)];
    case "SGT":
      return [0, 5, 10].map((d) => <path key={d} d={`M11 ${9 + d} L20 ${14 + d} L29 ${9 + d}`} fill="none" strokeWidth="2.6" strokeLinejoin="round" />);
    case "PVT":
      return [<path key="p" d="M11 12 L20 18 L29 12" fill="none" strokeWidth="3" strokeLinejoin="round" />];
    case "SPY":
      return [
        <path key="e" d="M7 15 Q20 4 33 15 Q20 26 7 15 Z" fill="none" strokeWidth="2" />,
        <circle key="i" cx="20" cy="15" r="4" />,
      ];
    case "FLG":
      return [
        <path key="pole" d="M12 5 V26" fill="none" strokeWidth="2.2" strokeLinecap="round" />,
        <path key="cloth" d="M13 6 Q20 3 29 7 Q24 10 29 14 Q20 11 13 15 Z" />,
      ];
  }
}

/** A piece tile. Without a rank (an enemy piece you can't see) it's a blank tile. */
export function GGPieceView({ rank, set, mine, size, label = true }: { rank?: Rank; set: GGPieceSet; mine: boolean; size: number; label?: boolean }) {
  const c = mine ? set.mine : set.theirs;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <rect x="1.5" y="3" width="37" height="34" rx="5" fill={c.tile} stroke={c.edge} strokeWidth="2" />
      <rect x="1.5" y="33" width="37" height="4" rx="2" fill="rgba(0,0,0,0.18)" />
      {rank && (
        <g fill={c.mark} stroke={c.mark} strokeWidth="0.6">
          {marks(rank)}
        </g>
      )}
      {rank && label && (
        <text x="20" y="33" textAnchor="middle" fontSize="7" fontWeight="700" fill={c.mark} style={{ fontFamily: "inherit" }}>
          {RANK_INFO[rank].short.replace("★", "")}
          {rank.startsWith("G") ? "-Star" : ""}
        </text>
      )}
    </svg>
  );
}
