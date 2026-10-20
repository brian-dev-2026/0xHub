/** A finished 8-ball or 9-ball game against the computer. */
export interface PoolResult {
  level: "easy" | "normal" | "hard";
  result: "win" | "loss";
  durationMs: number;
}

/** Mounts the 3D pool game into `host` (inside a shadow root) and returns a cleanup function. */
export function mountPool(host: HTMLElement, opts: { onExit: () => void; onResult?: (r: PoolResult) => void }): () => void;
