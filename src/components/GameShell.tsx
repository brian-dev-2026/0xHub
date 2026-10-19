import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { isValidRoomCode, randomRoomCode } from "../../shared/protocol";
import { useMatchmaking } from "../lib/roomSocket";
import { IconAlert, IconArrowLeft, IconBolt, IconCopy } from "./icons";

/** Full-screen game page frame with a back button and title. */
export function GameShell({ title, kicker, back, onBack, right, children }: {
  title: string;
  kicker: string;
  back: string;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="app-bg" />
      <header className="flex items-center justify-between px-4 py-4">
        {onBack ? (
          <button onClick={onBack} className="btn btn-ghost px-3 py-2" aria-label="Leave">
            <IconArrowLeft /> <span className="hidden sm:inline">Leave</span>
          </button>
        ) : (
          <Link to={back} className="btn btn-ghost px-3 py-2" aria-label="Back">
            <IconArrowLeft /> <span className="hidden sm:inline">Back</span>
          </Link>
        )}
        <div className="text-center">
          <div className="text-xs font-bold tracking-[0.3em] text-violet-300 uppercase">{kicker}</div>
          <div className="text-lg font-bold">{title}</div>
        </div>
        <div className="flex w-19 justify-end">{right}</div>
      </header>
      <div className="flex flex-1 flex-col px-3 pb-8">{children}</div>
    </div>
  );
}

export function ErrorPanel({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center" role="alert">
      <div className="grid size-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
        <IconAlert width={28} height={28} />
      </div>
      <div className="text-xl font-bold">{message}</div>
      <button className="btn btn-primary" onClick={onBack}>Back</button>
    </div>
  );
}

/** Quick match + private room + join-by-code, shared by the multiplayer games. */
export function MatchLobby({ game, roomPath, quickLabel = "Quick match", quickHint, extra, queueParams }: {
  game: "snake" | "2048" | "connect4" | "chess" | "generals";
  /** Extra query string for the matchmaking queue (e.g. a chess time control). */
  queueParams?: string;
  roomPath: (code: string, auto?: boolean) => string;
  quickLabel?: string;
  quickHint: string;
  extra?: ReactNode;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const mm = useMatchmaking(game, (room, auto) => navigate(roomPath(room, auto), { replace: true }), queueParams);

  if (mm.searching) {
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="pulse-ring grid size-24 place-items-center rounded-full bg-violet-500/20 text-violet-200">
          <IconBolt width={40} height={40} />
        </div>
        <div>
          <div className="text-2xl font-bold">Finding players…</div>
          <div className="mt-1 text-sm text-zinc-400">
            {game === "snake" ? `${Math.max(1, mm.queue)} in the queue — empty slots get bots.` : "Waiting for an opponent."}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={mm.stop}>Cancel</button>
      </div>
    );
  }

  const join = () => {
    const c = code.trim().toUpperCase();
    if (isValidRoomCode(c)) navigate(roomPath(c));
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {mm.error && <div role="alert" className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300 ring-1 ring-rose-500/30 sm:col-span-2">{mm.error}</div>}
      <button onClick={mm.start} className="glass glass-hover rounded-2xl p-6 text-left">
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-linear-to-br from-violet-500 to-cyan-400 text-white">
          <IconBolt />
        </div>
        <div className="text-lg font-bold">{quickLabel}</div>
        <div className="mt-1 text-sm text-zinc-400">{quickHint}</div>
      </button>
      <div className="glass rounded-2xl p-6">
        <div className="text-lg font-bold">Play with friends</div>
        <div className="mt-1 mb-4 text-sm text-zinc-400">Create a private room and share the link, or enter a code.</div>
        <button onClick={() => navigate(roomPath(randomRoomCode()))} className="btn btn-primary w-full">Create private room</button>
        <div className="mt-3 flex gap-2">
          <input
            className="input font-mono tracking-[0.3em] uppercase"
            placeholder="CODE"
            aria-label="Room code"
            maxLength={5}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button onClick={join} className="btn btn-ghost" disabled={!isValidRoomCode(code)}>Join</button>
        </div>
      </div>
      {extra}
    </div>
  );
}

/** Invite panel shown while a private room waits for players. */
export function InvitePanel({ code, path, waitingText, children }: { code: string; path: string; waitingText: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}${path}`;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 py-8 text-center animate-in">
      <div className="text-sm text-zinc-400">Room code</div>
      <div className="font-mono text-5xl font-bold tracking-[0.35em] text-gradient">{code}</div>
      <div className="flex w-full max-w-md gap-2">
        <input readOnly className="input text-xs" aria-label="Invite link" value={url} onFocus={(e) => e.target.select()} />
        <button
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* blocked */
            }
          }}
        >
          <IconCopy width={16} height={16} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="flex items-center gap-3 text-zinc-400" aria-live="polite">
        <span className="inline-block size-2 animate-pulse rounded-full bg-cyan-400" /> {waitingText}
      </div>
      {children}
    </div>
  );
}

export function ConnectionBanner({ status }: { status: string }) {
  if (status !== "reconnecting") return null;
  return (
    <div role="status" className="mx-auto mb-3 rounded-xl bg-amber-500/15 px-4 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
      Connection lost — reconnecting…
    </div>
  );
}

export function fmtMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
