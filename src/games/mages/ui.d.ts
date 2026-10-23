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
