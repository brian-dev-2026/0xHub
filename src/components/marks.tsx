// Small visual marks drawn purely with CSS — no emoji or icon fonts.
import { avatarShape } from "../../shared/avatars";

/** Player avatar: a block shape tinted with the player's accent color. */
export function Avatar({ avatar, color, size = 36 }: { avatar: string; color: string; size?: number }) {
  const shape = avatarShape(avatar);
  const box = {
    width: size,
    height: size,
    background: `linear-gradient(135deg, ${color}40, ${color}14)`,
    boxShadow: `inset 0 0 0 1px ${color}66`,
  };
  if (!shape) {
    // Neutral placeholder for deleted/unknown players: a simple silhouette.
    return (
      <span className="relative block shrink-0 overflow-hidden rounded-xl bg-zinc-700/40" style={{ width: size, height: size }} aria-hidden>
        <span className="absolute left-1/2 top-[22%] block -translate-x-1/2 rounded-full bg-zinc-500" style={{ width: size * 0.32, height: size * 0.32 }} />
        <span className="absolute left-1/2 top-[60%] block -translate-x-1/2 rounded-t-full bg-zinc-500" style={{ width: size * 0.6, height: size * 0.5 }} />
      </span>
    );
  }
  const w = Math.max(...shape.cells.map((c) => c[0])) + 1;
  const h = Math.max(...shape.cells.map((c) => c[1])) + 1;
  const cell = Math.floor((size * 0.8) / Math.max(w, h, 3));
  const gap = Math.max(1, Math.round(cell * 0.1));
  const ox = (size - w * cell) / 2;
  const oy = (size - h * cell) / 2;
  return (
    <span className="relative block shrink-0 rounded-xl" style={box} aria-hidden>
      {shape.cells.map(([x, y]) => (
        <span
          key={`${x}-${y}`}
          className="absolute block rounded-[2px]"
          style={{
            left: ox + x * cell + gap / 2,
            top: oy + y * cell + gap / 2,
            width: cell - gap,
            height: cell - gap,
            background: `linear-gradient(160deg, color-mix(in srgb, ${color} 70%, white), ${color})`,
            boxShadow: `inset 0 -${Math.max(1, cell * 0.12)}px 0 color-mix(in srgb, ${color} 65%, black)`,
          }}
        />
      ))}
    </span>
  );
}

export function Star({ className = "" }: { className?: string }) {
  return <span className={`mark-star ${className}`} aria-hidden />;
}

export function Check({ className = "" }: { className?: string }) {
  return <span className={`mark-check ${className}`} aria-hidden />;
}

export function LiveDot() {
  return <span className="mark-live" aria-hidden />;
}

/** Rank badge: gold/silver/bronze medal for the top 3, plain number otherwise. */
export function RankBadge({ rank }: { rank: number }) {
  const tier = ["gold", "silver", "bronze"][rank - 1];
  if (!tier) return <span className="font-mono text-zinc-500">{rank}</span>;
  return (
    <span className={`mark-medal mark-medal-${tier}`} aria-label={`Rank ${rank}`}>
      {rank}
    </span>
  );
}
