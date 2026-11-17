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

/** One state per stage, in order. A finished run shows every stage completed; a failed one keeps where it stopped. */
export function stageStates(progress: RunProgress | null | undefined, status: RunStatus): { key: StageKey; state: StageState }[] {
  const done = status !== "in_progress" && status !== "failed";
  return STAGE_ORDER.map((key) => ({
    key,
    state: done ? "completed" : (progress?.stages?.[key] as StageState) ?? "pending",
  }));
}
