/** The Working Flow's stages, as pure data (no imports, so it can be unit-tested with node --test). */

export type StageKey = "understanding" | "discovering" | "gathering" | "evaluating" | "comparing" | "preparing";
export type StageState = "pending" | "in_progress" | "completed";
export type RunStatus = "in_progress" | "ready" | "review" | "partial" | "failed";

export const STAGE_ORDER: StageKey[] = ["understanding", "discovering", "gathering", "evaluating", "comparing", "preparing"];

export interface RunProgress {
  stage: StageKey | null;
  stages: Partial<Record<StageKey, StageState>>;
  detail: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** A server timestamp in ms. Times without a zone are UTC (the server stores UTC), never local time. */
export function parseServerTime(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

const MAX_RUN_SECONDS = 6 * 3600; // anything longer is not a real run time

/**
 * How long this run took (or has been running), from its own start and finish.
 * Returns null when that isn't known, so no misleading figure is shown.
 */
export function runSeconds(progress: RunProgress | null | undefined, status: RunStatus, now: number = Date.now()): number | null {
  const start = parseServerTime(progress?.started_at);
  if (Number.isNaN(start)) return null;
  const end = status === "in_progress" ? now : parseServerTime(progress?.finished_at);
  if (Number.isNaN(end)) return null;
  const seconds = (end - start) / 1000;
  if (seconds < 0 || seconds > MAX_RUN_SECONDS) return null;
  return status === "in_progress" ? Math.floor(seconds) : Math.round(seconds);
}

/** One state per stage, in order. A finished run shows every stage completed; a failed one keeps where it stopped. */
export function stageStates(progress: RunProgress | null | undefined, status: RunStatus): { key: StageKey; state: StageState }[] {
  const done = status !== "in_progress" && status !== "failed";
  return STAGE_ORDER.map((key) => ({
    key,
    state: done ? "completed" : (progress?.stages?.[key] as StageState) ?? "pending",
  }));
}
