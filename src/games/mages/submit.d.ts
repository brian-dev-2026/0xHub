import type { Sim, SimEvent } from "../../../shared/games/mages/sim";

/** One chunk of a run as posted to /api/mages/runs/:id/input (see worker/mages.ts). */
export interface PendingBatch {
  upTo: number;
  actions: unknown[];
  h: number;
  final?: boolean;
}
export interface PendingRun {
  runId: string;
  batches: PendingBatch[];
}
export function savePendingRun(run: PendingRun): void;
export function loadPendingRun(): PendingRun | null;
export function clearPendingRun(): void;
export function takePendingRun(): PendingRun | null;

export const CHUNK_TICKS: number;
export const REQUEST_TIMEOUT_MS: number;

export interface SubmitApi {
  input(runId: string, batch: unknown, opts?: { signal?: AbortSignal }): Promise<unknown>;
}
export interface SubmitHandlers {
  onResult(res: any): void;
  onReject(error: string): void;
  onStatus(state: "ok" | "failed", final: boolean): void;
}
export interface RunSubmitter {
  readonly runId: string;
  afterTick(sim: Sim, log: readonly unknown[], events: readonly SimEvent[]): void;
  finish(sim: Sim, log: readonly unknown[]): void;
  retry(): void;
  readonly unsent: boolean;
  readonly finalUnsent: boolean;
  readonly failures: number;
  drop(): void;
  stop(): void;
}
export function createRunSubmitter(api: SubmitApi, runId: string, handlers: SubmitHandlers, batches?: PendingBatch[]): RunSubmitter;
