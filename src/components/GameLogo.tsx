// Game logos drawn with CSS boxes — no emoji or image assets.

type Cell = { x: number; y: number; color: string; round?: boolean; label?: string; text?: string };

function Grid({ cols, rows, cells, size, bg }: { cols: number; rows: number; cells: Cell[]; size: number; bg?: string }) {
  const cell = size / Math.max(cols, rows);
  const gap = Math.max(1, Math.round(cell * 0.12));
  return (
    <span
      className="relative block shrink-0 rounded-xl"
      style={{ width: size, height: size, background: bg ?? "rgba(0,0,0,0.25)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
      aria-hidden
    >
      {cells.map((c, i) => (
        <span
          key={i}
          className={`absolute grid place-items-center font-mono font-bold ${c.round ? "rounded-full" : "rounded-[3px]"}`}
          style={{
            left: c.x * cell + gap / 2 + (size - cols * cell) / 2,
            top: c.y * cell + gap / 2 + (size - rows * cell) / 2,
            width: cell - gap,
            height: cell - gap,
            background: c.color,
            boxShadow: c.round ? "inset 0 -2px 0 rgba(0,0,0,0.25)" : "inset 0 -2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.35)",
            color: c.text ?? "#1c1917",
            fontSize: cell * 0.42,
          }}
        >
          {c.label}
        </span>
      ))}
    </span>
  );
}

export function GameLogo({ game, size = 48 }: { game: string; size?: number }) {
  switch (game) {
    case "tetris":
      return (
        <Grid
          cols={4}
          rows={4}
          size={size}
          cells={[
            { x: 1, y: 0, color: "#a855f7" },
            { x: 0, y: 1, color: "#a855f7" },
            { x: 1, y: 1, color: "#a855f7" },
            { x: 2, y: 1, color: "#a855f7" },
            { x: 3, y: 1, color: "#22d3ee" },
            { x: 3, y: 2, color: "#22d3ee" },
            { x: 3, y: 3, color: "#22d3ee" },
            { x: 0, y: 2, color: "#fb923c" },
            { x: 0, y: 3, color: "#fb923c" },
            { x: 1, y: 3, color: "#fb923c" },
            { x: 2, y: 3, color: "#facc15" },
            { x: 2, y: 2, color: "#facc15" },
          ]}
        />
      );
    case "snake":
      return (
        <Grid
          cols={4}
          rows={4}
          size={size}
          cells={[
            ...[[0, 3], [1, 3], [2, 3], [2, 2], [2, 1], [1, 1]].map(([x, y], i) => ({ x, y, color: i === 5 ? "#bef264" : "#4ade80" })),
            { x: 3, y: 0, color: "#f43f5e", round: true },
          ]}
        />
      );
    case "2048":
      return (
        <Grid
          cols={2}
          rows={2}
          size={size}
          bg="rgba(120,90,60,0.35)"
          cells={[
            { x: 0, y: 0, color: "#fde68a", label: "2" },
            { x: 1, y: 0, color: "#fdba74", label: "0" },
            { x: 0, y: 1, color: "#fb923c", label: "4", text: "#fff" },
            { x: 1, y: 1, color: "#f97316", label: "8", text: "#fff" },
          ]}
        />
      );
    case "mines":
      return (
        <Grid
          cols={3}
          rows={3}
          size={size}
          cells={[
            ...Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3), color: i === 4 ? "#3f3f46" : "#a1a1aa", label: i === 1 ? "1" : i === 5 ? "2" : undefined, text: "#1d4ed8" })),
            { x: 1, y: 1, color: "#09090b", round: true },
          ]}
        />
      );
    case "connect4":
      return (
        <Grid
          cols={3}
          rows={3}
          size={size}
          bg="#1d4ed8"
          cells={Array.from({ length: 9 }, (_, i) => ({
            x: i % 3,
            y: Math.floor(i / 3),
            round: true,
            color: [6, 7, 4].includes(i) ? "#f43f5e" : [8, 5].includes(i) ? "#facc15" : "#0b1a3a",
          }))}
        />
      );
    case "chess":
      return (
        <Grid
          cols={4}
          rows={4}
          size={size}
          bg="#3f2a1d"
          cells={Array.from({ length: 16 }, (_, i) => ({
            x: i % 4,
            y: Math.floor(i / 4),
            color: (i % 4) + Math.floor(i / 4) === 3 ? "#facc15" : ((i % 4) + Math.floor(i / 4)) % 2 ? "#b58863" : "#f0d9b5",
          }))}
        />
      );
    case "generals":
      return (
        <Grid
          cols={3}
          rows={3}
          size={size}
          bg="#14261a"
          cells={Array.from({ length: 9 }, (_, i) => ({
            x: i % 3,
            y: Math.floor(i / 3),
            color: i < 3 ? "#e7e5e4" : i > 5 ? "#27272a" : "#3f6212",
            label: i === 1 ? "★" : i === 7 ? "★" : undefined,
            text: i === 1 ? "#ca8a04" : "#facc15",
          }))}
        />
      );
    case "pool":
      return (
        <Grid
          cols={3}
          rows={3}
          size={size}
          bg="#14532d"
          cells={[
            { x: 1, y: 0, color: "#facc15", round: true },
            { x: 0.5, y: 1, color: "#1d4ed8", round: true },
            { x: 1.5, y: 1, color: "#dc2626", round: true },
            { x: 0, y: 2, color: "#7c3aed", round: true },
            { x: 1, y: 2, color: "#18181b", round: true, label: "8", text: "#fafafa" },
            { x: 2, y: 2, color: "#ea580c", round: true },
          ]}
        />
      );
    case "mages":
      return (
        <Grid
          cols={4}
          rows={4}
          size={size}
          bg="#1e1b4b"
          cells={[
            { x: 0, y: 3, color: "#92400e" },
            { x: 1, y: 2, color: "#b45309" },
            { x: 2, y: 1, color: "#b45309" },
            { x: 3, y: 0, color: "#c4b5fd", round: true },
            { x: 2, y: 0, color: "#6d28d9", round: true },
            { x: 3, y: 1, color: "#6d28d9", round: true },
          ]}
        />
      );
    default:
      return <Grid cols={1} rows={1} size={size} cells={[]} />;
  }
}
