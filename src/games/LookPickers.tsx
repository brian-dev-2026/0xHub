import { useEffect, useRef, useState, type ReactNode } from "react";
import { SNAKE_H, SNAKE_W, type SnakeSnapshot } from "../../shared/games/snake";
import { IconPalette } from "../components/icons";
import { Card, SectionTitle, Segmented } from "../components/ui";
import { settingsStore, type Settings } from "../lib/store";
import { Board2048 } from "./g2048/Board2048";
import { CHESS_BOARDS, CHESS_PIECE_SETS, GG_BOARDS, GG_PIECE_SETS, getChessBoard, getChessPieces, getGGBoard, getGGPieces, C4_BOARDS, DISC_SETS, MINES_THEMES, SNAKE_ARENAS, SNAKE_SKINS, TILE_SETS, getC4Board, getDiscSet, getMinesTheme, getSnakeArena, getSnakeSkin, getTileSet, tileColors } from "./looks";
import { c4BoardStyle, discStyle, minesCellClass, minesVars } from "./lookStyles";
import { drawArena } from "./snake/render";
import { Customizer } from "./tetris/Customizer";
import { Chess } from "../../shared/games/chess";
import type { Rank } from "../../shared/games/generals";
import { ChessBoard } from "./chess/Board";
import { ChessPiece } from "./chess/Piece";
import { GGPieceView } from "./generals/Insignia";

// ---------- shared bits ----------

function Option({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition ${active ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}
    >
      <span aria-hidden className="contents">{children}</span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-zinc-300">{title}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function Layout({ preview, children }: { preview: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="flex justify-center md:sticky md:top-6">{preview}</div>
      <div className="flex-1 space-y-6">{children}</div>
    </div>
  );
}

const set = (patch: Partial<Settings>) => settingsStore.set(patch);

// ---------- Snake ----------

const at = (x: number, y: number) => y * SNAKE_W + x;
const line = (x: number, y: number, dx: number, dy: number, n: number) => Array.from({ length: n }, (_, i) => at(x - dx * i, y - dy * i));

const SNAKE_DEMO: SnakeSnapshot = {
  tick: 0,
  food: [at(30, 6), at(12, 20), at(24, 15), at(6, 9), at(35, 22)],
  players: [
    { id: "me", name: "", avatar: "", color: "#4ade80", bot: false, body: [...line(20, 8, 1, 0, 6), at(15, 9), at(15, 10), at(15, 11)], alive: true, score: 0, kills: 0, respawnIn: 0 },
    { id: "b", name: "", avatar: "", color: "#60a5fa", bot: true, body: line(9, 16, 0, -1, 7), alive: true, score: 0, kills: 0, respawnIn: 0 },
    { id: "c", name: "", avatar: "", color: "#f472b6", bot: true, body: line(28, 20, -1, 0, 8), alive: true, score: 0, kills: 0, respawnIn: 0 },
    { id: "d", name: "", avatar: "", color: "#facc15", bot: true, body: [at(33, 11), at(33, 12), at(33, 13), at(32, 13), at(31, 13)], alive: true, score: 0, kills: 0, respawnIn: 0 },
  ],
};

function SnakeCanvas({ skinId, arenaId, cell }: { skinId: string; arenaId: string; cell: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = SNAKE_W * cell * dpr;
    c.height = SNAKE_H * cell * dpr;
    c.style.width = `${SNAKE_W * cell}px`;
    c.style.height = `${SNAKE_H * cell}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawArena(ctx, { prev: null, cur: SNAKE_DEMO, t: 1, cell, meId: "me", skin: getSnakeSkin(skinId), arena: getSnakeArena(arenaId) });
  }, [skinId, arenaId, cell]);
  return <canvas ref={ref} className="block rounded-xl" />;
}

export function SnakeLook() {
  const s = settingsStore.use();
  return (
    <Layout preview={<SnakeCanvas skinId={s.snakeSkin} arenaId={s.snakeArena} cell={8} />}>
      <Group title="Snake style">
        {SNAKE_SKINS.map((k) => (
          <Option key={k.id} label={k.name} active={getSnakeSkin(s.snakeSkin).id === k.id} onClick={() => set({ snakeSkin: k.id })}>
            <MiniSnake skinId={k.id} arenaId={s.snakeArena} />
          </Option>
        ))}
      </Group>
      <Group title="Arena">
        {SNAKE_ARENAS.map((a) => (
          <Option key={a.id} label={a.name} active={getSnakeArena(s.snakeArena).id === a.id} onClick={() => set({ snakeArena: a.id })}>
            <span className="block h-10 w-full rounded-md" style={{ background: a.bg, boxShadow: `inset 0 0 0 2px ${a.frame}` }}>
              <span className="mt-4 ml-3 inline-block size-2.5 rounded-full" style={{ background: a.food, boxShadow: `0 0 8px ${a.foodGlow}` }} />
            </span>
          </Option>
        ))}
      </Group>
    </Layout>
  );
}

const MINI: SnakeSnapshot = {
  tick: 0,
  food: [at(9, 1)],
  players: [{ id: "x", name: "", avatar: "", color: "#4ade80", bot: false, body: [at(6, 1), at(5, 1), at(4, 1), at(3, 1), at(2, 1), at(1, 1)], alive: true, score: 0, kills: 0, respawnIn: 0 }],
};

function MiniSnake({ skinId, arenaId }: { skinId: string; arenaId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const cell = 11;
    const w = 11 * cell;
    const h = 3 * cell;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    drawArena(ctx, { prev: null, cur: MINI, t: 1, cell, meId: "", skin: getSnakeSkin(skinId), arena: getSnakeArena(arenaId) });
    ctx.restore();
  }, [skinId, arenaId]);
  return <canvas ref={ref} className="block rounded-md" />;
}

// ---------- 2048 ----------

const DEMO_2048 = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 0, 4, 2, 0, 0];

export function Look2048() {
  const s = settingsStore.use();
  return (
    <Layout preview={<Board2048 board={DEMO_2048} size={240} />}>
      <Group title="Tile set">
        {TILE_SETS.map((t) => (
          <Option key={t.id} label={t.name} active={getTileSet(s.tiles2048).id === t.id} onClick={() => set({ tiles2048: t.id })}>
            <span className="flex gap-1 p-1" style={{ background: t.board, borderRadius: t.pixel ? 0 : 8 }}>
              {[2, 8, 64, 2048].map((v) => {
                const [bg, fg] = tileColors(t, v);
                return (
                  <span
                    key={v}
                    className={`grid size-7 place-items-center text-[9px] font-bold ${t.pixel ? "font-mono" : ""}`}
                    style={{ background: t.neon ? "rgba(0,0,0,0.4)" : bg, color: fg, borderRadius: Math.min(t.radius, 6), border: t.neon ? `1.5px solid ${bg}` : undefined }}
                  >
                    {v}
                  </span>
                );
              })}
            </span>
          </Option>
        ))}
      </Group>
    </Layout>
  );
}

// ---------- Minesweeper ----------

// 7x5 demo: numbers for open cells, "f" flag, "." closed, " " empty open.
const MINES_DEMO = ["  1f1..", "  112..", "11  1f.", "f1  123", "11   1."];

function MinesBoardPreview({ themeId, cell = 26 }: { themeId: string; cell?: number }) {
  const t = getMinesTheme(themeId);
  return (
    <div className="grid gap-px rounded-lg p-px" style={{ gridTemplateColumns: `repeat(7, ${cell}px)`, ...minesVars(t) }}>
      {MINES_DEMO.join("").split("").map((ch, i) => {
        const open = ch === " " || /\d/.test(ch);
        const n = /\d/.test(ch) ? Number(ch) : 0;
        return (
          <span key={i} className={minesCellClass(t, open, false)} style={{ width: cell, height: cell, fontSize: cell * 0.55, color: n ? t.numbers[n - 1] : undefined, borderRadius: t.radius }}>
            {n || null}
            {ch === "f" && <span className="mines-flag" aria-hidden />}
          </span>
        );
      })}
    </div>
  );
}

export function MinesLook() {
  const s = settingsStore.use();
  return (
    <Layout preview={<MinesBoardPreview themeId={s.minesTheme} cell={30} />}>
      <Group title="Board theme">
        {MINES_THEMES.map((t) => (
          <Option key={t.id} label={t.name} active={getMinesTheme(s.minesTheme).id === t.id} onClick={() => set({ minesTheme: t.id })}>
            <MinesBoardPreview themeId={t.id} cell={14} />
          </Option>
        ))}
      </Group>
    </Layout>
  );
}

// ---------- Connect Four ----------

// 7x6, top row first: 1 / 2 discs.
const C4_DEMO = ["0000000", "0000000", "0002000", "0021100", "0212120", "1121210"];

function C4Preview({ discsId, boardId, cell = 30 }: { discsId: string; boardId: string; cell?: number }) {
  const discs = getDiscSet(discsId);
  const b = getC4Board(boardId);
  return (
    <div className="rounded-2xl p-2 ring-1 ring-white/20" style={c4BoardStyle(b)}>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(7, ${cell}px)` }}>
        {C4_DEMO.join("").split("").map((ch, i) => (
          <span key={i} className="relative rounded-full shadow-[inset_0_3px_6px_rgba(0,0,0,0.6)]" style={{ width: cell, height: cell, background: b.hole }}>
            {ch !== "0" && <span className="absolute inset-[6%] rounded-full" style={discStyle(discs, Number(ch))} />}
          </span>
        ))}
      </div>
    </div>
  );
}

export function C4Look() {
  const s = settingsStore.use();
  return (
    <Layout preview={<C4Preview discsId={s.c4Discs} boardId={s.c4Board} />}>
      <Group title="Discs">
        {DISC_SETS.map((d) => (
          <Option key={d.id} label={d.name} active={getDiscSet(s.c4Discs).id === d.id} onClick={() => set({ c4Discs: d.id })}>
            <span className="flex gap-1.5 rounded-lg bg-black/40 p-1.5">
              {[1, 2].map((n) => (
                <span key={n} className="block size-8 rounded-full" style={discStyle(d, n)} />
              ))}
            </span>
          </Option>
        ))}
      </Group>
      <Group title="Board">
        {C4_BOARDS.map((b) => (
          <Option key={b.id} label={b.name} active={getC4Board(s.c4Board).id === b.id} onClick={() => set({ c4Board: b.id })}>
            <span className="flex h-10 w-full items-center justify-center gap-1 rounded-md" style={c4BoardStyle(b)}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="block size-5 rounded-full" style={{ background: b.hole }} />
              ))}
            </span>
          </Option>
        ))}
      </Group>
    </Layout>
  );
}

// ---------- Chess ----------

const CHESS_PREVIEW = new Chess("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5");

export function ChessLook() {
  const s = settingsStore.use();
  return (
    <Layout preview={<ChessBoard chess={CHESS_PREVIEW} orientation="w" size={256} interactive={false} lastMove={{ from: 11, to: 19 }} />}>
      <Group title="Board">
        {CHESS_BOARDS.map((b) => (
          <Option key={b.id} label={b.name} active={getChessBoard(s.chessBoard).id === b.id} onClick={() => set({ chessBoard: b.id })}>
            <span className="grid grid-cols-4 overflow-hidden rounded-md">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="block size-6" style={{ background: (i + Math.floor(i / 4)) % 2 ? b.dark : b.light }} />
              ))}
            </span>
          </Option>
        ))}
      </Group>
      <Group title="Pieces">
        {CHESS_PIECE_SETS.map((p) => (
          <Option key={p.id} label={p.name} active={getChessPieces(s.chessPieces).id === p.id} onClick={() => set({ chessPieces: p.id })}>
            <span className="flex rounded-md bg-zinc-500/40 px-1">
              <ChessPiece type="k" color="w" set={p} size={32} />
              <ChessPiece type="n" color="b" set={p} size={32} />
            </span>
          </Option>
        ))}
      </Group>
    </Layout>
  );
}

// ---------- Game of the Generals ----------

/** A 9x3 strip: two of the opponent's (hidden) pieces and a few of yours. */
const GG_PREVIEW: (null | { mine: boolean; rank?: Rank })[] = [
  null, { mine: false }, null, { mine: false }, null, null, { mine: false }, null, null,
  null, null, { mine: true, rank: "SPY" }, null, { mine: true, rank: "G5" }, null, null, { mine: true, rank: "PVT" }, null,
  { mine: true, rank: "CPT" }, null, { mine: true, rank: "FLG" }, { mine: true, rank: "COL" }, null, { mine: true, rank: "SGT" }, null, null, { mine: true, rank: "G3" },
];

function GGStrip({ piecesId, boardId, cell = 34 }: { piecesId: string; boardId: string; cell?: number }) {
  const set = getGGPieces(piecesId);
  const b = getGGBoard(boardId);
  return (
    <div className="grid gap-px rounded-lg p-px" style={{ gridTemplateColumns: `repeat(9, ${cell}px)`, background: b.line }}>
      {GG_PREVIEW.map((p, i) => (
        <span key={i} className="grid place-items-center" style={{ width: cell, height: cell, background: (Math.floor(i / 9) + i) % 2 ? b.dark : b.light }}>
          {p && <GGPieceView rank={p.rank} mine={p.mine} set={set} size={cell - 4} />}
        </span>
      ))}
    </div>
  );
}

export function GeneralsLook() {
  const s = settingsStore.use();
  return (
    <Layout preview={<GGStrip piecesId={s.ggPieces} boardId={s.ggBoard} cell={30} />}>
      <Group title="Pieces">
        {GG_PIECE_SETS.map((p) => (
          <Option key={p.id} label={p.name} active={getGGPieces(s.ggPieces).id === p.id} onClick={() => set({ ggPieces: p.id })}>
            <span className="flex gap-1">
              <GGPieceView rank="G5" mine set={p} size={34} label={false} />
              <GGPieceView mine={false} set={p} size={34} />
            </span>
          </Option>
        ))}
      </Group>
      <Group title="Board">
        {GG_BOARDS.map((b) => (
          <Option key={b.id} label={b.name} active={getGGBoard(s.ggBoard).id === b.id} onClick={() => set({ ggBoard: b.id })}>
            <span className="grid grid-cols-5 gap-px overflow-hidden rounded-md" style={{ background: b.line }}>
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="block size-5" style={{ background: (i + Math.floor(i / 5)) % 2 ? b.dark : b.light }} />
              ))}
            </span>
          </Option>
        ))}
      </Group>
    </Layout>
  );
}

// ---------- all games (Settings → Look) ----------

type LookGame = "tetris" | "snake" | "2048" | "mines" | "connect4" | "chess" | "generals";

export function GameLooks({ cell = 18 }: { cell?: number }) {
  const [game, setGame] = useState<LookGame>("tetris");
  return (
    <div className="space-y-5">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <Segmented<LookGame>
          value={game}
          onChange={setGame}
          options={[
            { value: "tetris", label: "Tetris" },
            { value: "snake", label: "Snake" },
            { value: "2048", label: "2048" },
            { value: "mines", label: "Mines" },
            { value: "connect4", label: "Connect 4" },
            { value: "chess", label: "Chess" },
            { value: "generals", label: "Generals" },
          ]}
        />
      </div>
      {game === "tetris" && <Customizer cell={cell} />}
      {game === "snake" && <SnakeLook />}
      {game === "2048" && <Look2048 />}
      {game === "mines" && <MinesLook />}
      {game === "connect4" && <C4Look />}
      {game === "chess" && <ChessLook />}
      {game === "generals" && <GeneralsLook />}
    </div>
  );
}

/** The "Customize" block on a game's home page. */
export function CustomizeSection({ children }: { children: ReactNode }) {
  return (
    <section>
      <SectionTitle>
        <span className="inline-flex items-center gap-2"><IconPalette width={16} height={16} /> Customize</span>
      </SectionTitle>
      <Card>{children}</Card>
    </section>
  );
}
