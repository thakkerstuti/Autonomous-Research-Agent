import { Mode } from "./types";

// Route for each chat mode. Used by the dashboard, history and sidebar so
// the paths live in exactly one place.
export function modeHref(mode: Mode, sessionId?: string) {
  const base = mode === "research" ? "/research" : "/paper-study";
  return sessionId ? `${base}?session=${sessionId}` : base;
}
