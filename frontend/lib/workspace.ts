/**
 * The user's open workspace: which paper and page they were reading, and
 * which research sessions make up the current thread.
 *
 * Only identifiers are kept here; the work itself lives on the server and
 * is always fetched with the user's own credentials. Entries are keyed by
 * user id, so one person's pointer can never open for someone else, and
 * they are removed when that user explicitly signs out.
 */
import { useUiStore } from "./store";

export interface PendingResearch {
  question: string;
  format: string;
  startedAt: number;
  /** Session ids that existed before this question was sent (null until known). */
  knownIds: string[] | null;
}

export interface Workspace {
  paper?: {
    id: string;
    page?: number;
    tab?: string;
    /** Paper Study workspace: open section, reader layout, side pane (open, which tab), page list */
    view?: string;
    reader?: unknown;
    assistant?: boolean;
    companion?: string;
    rail?: boolean;
  } | null;
  research?: { sessionIds: string[]; pending?: PendingResearch | null } | null;
}

const PREFIX = "cognexa-workspace:";

function currentUserId(): string | null {
  return useUiStore.getState().user?.id ?? null;
}

export function readWorkspace(): Workspace {
  const uid = currentUserId();
  if (!uid || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFIX + uid);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function updateWorkspace(change: (current: Workspace) => Workspace) {
  const uid = currentUserId();
  if (!uid || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + uid, JSON.stringify(change(readWorkspace())));
  } catch {
    // Storage unavailable (private mode, quota): navigation still works in memory
  }
}

export function clearWorkspace(userId: string | null | undefined) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREFIX + userId);
  } catch {}
}
