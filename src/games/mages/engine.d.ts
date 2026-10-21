/** Server calls for Mage Siege; each resolves to the parsed JSON body. */
export interface MagesApi {
  /** GET /api/mages/progress */
  progress(): Promise<unknown>;
  /** POST /api/mages/start */
  start(body: unknown): Promise<unknown>;
  /** POST /api/mages/runs/:id/input (one wave's chunk) */
  input(runId: string, batch: unknown): Promise<unknown>;
}

/** Mounts Mage Siege into `host` (inside a shadow root) and returns a cleanup function. */
export function mountMages(host: HTMLElement, opts: { onExit: () => void; api: MagesApi }): () => void;
