/**
 * "Think while you wait": the API calls, and the "Ask me questions while I wait" setting.
 * The rules and types live in reflection-logic.ts (pure, unit-tested); they are re-exported here.
 */
import { useEffect, useState } from "react";
import { apiClient } from "./api";
import { ApiError } from "./api-error";
import type { PauseReason, Reflection, ReflectionTarget } from "./reflection-logic";

export * from "./reflection-logic";

/* ── setting: on unless the user turned it off; read only in the browser ── */

const SETTING_KEY = "cognexa-ask-while-waiting";
const SETTING_EVENT = "cognexa-ask-while-waiting-change";

export function getAskQuestions(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SETTING_KEY) !== "off";
  } catch {
    return true; // storage blocked: the default
  }
}

export function setAskQuestions(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTING_KEY, on ? "on" : "off");
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  window.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: on }));
}

/** The setting as React state, in sync across tabs and components. Starts as "on" during server rendering. */
export function useAskQuestions(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(getAskQuestions());
    const sync = () => setOn(getAskQuestions());
    const local = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener("storage", sync);
    window.addEventListener(SETTING_EVENT, local);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SETTING_EVENT, local);
    };
  }, []);
  return [on, (next: boolean) => { setOn(next); setAskQuestions(next); }];
}

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
