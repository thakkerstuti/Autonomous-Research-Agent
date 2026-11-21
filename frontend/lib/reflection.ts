/**
 * "Think while you wait": the API calls (always on: every research run asks).
 * The rules and types live in reflection-logic.ts (pure, unit-tested); they are re-exported here.
 */
import { apiClient } from "./api";
import { ApiError } from "./api-error";
import type { PauseReason, Reflection, ReflectionTarget } from "./reflection-logic";

export * from "./reflection-logic";

/* ── API ── */

const base = (t: ReflectionTarget) =>
  t.kind === "research" ? `/research/sessions/${encodeURIComponent(t.id)}/reflection` : `/papers/${encodeURIComponent(t.id)}/reflection`;

const post = (t: ReflectionTarget, tail: string, body?: unknown) =>
  apiClient<Reflection>(`${base(t)}${tail}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });

/** The reflection, or null when there is none (the setting was off, or nothing is being written). */
export async function getReflection(t: ReflectionTarget): Promise<Reflection | null> {
  try {
    return await apiClient<Reflection>(base(t));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export const saveAnswer = (
  t: ReflectionTarget,
  body: { question_id: string; answer?: string | null; skipped?: boolean },
  opts: { keepalive?: boolean } = {},
) => apiClient<Reflection>(`${base(t)}/answers`, { method: "PUT", body: JSON.stringify(body), keepalive: opts.keepalive });

export const pauseReflection = (t: ReflectionTarget, reason: PauseReason) => post(t, "/pause", { reason });
export const resumeReflection = (t: ReflectionTarget) => post(t, "/resume");
export const requestNextBatch = (t: ReflectionTarget) => post(t, "/next-batch");
export const requestFeedback = (t: ReflectionTarget) => post(t, "/feedback");
