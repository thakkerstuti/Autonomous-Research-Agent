/**
 * "Think while you wait": the types the server returns and the small rules the card follows.
 * Pure, no imports and no browser access, so it can be unit-tested with node --test.
 */

/* ── timings and limits, in one place ── */
export const IDLE_BASE_MS = 10_000;        // idle pause: base wait once a question has fully appeared
export const IDLE_PER_WORD_MS = 300;       // plus reading time per word of the question
export const AUTOSAVE_DELAY_MS = 800;      // debounce per question
export const FINISH_THOUGHT_MS = 20_000;  // result ready while typing: feedback after this long without typing
export const PREFETCH_WHEN_LEFT = 2;       // ask for the next batch when this many open questions are left
export const ANSWER_MAX = 1000;            // characters, as on the server

/* ── server shapes (app/reflection_api.py payload) ── */
export type QuestionKind = "prior" | "assumption" | "angle" | "predict" | "connect";
export type ReflectionStatus = "active" | "paused" | "finished" | "failed";
export type PauseReason = "busy" | "idle";

export interface ReflectionQuestion {
  id: string;
  text: string;
  kind: QuestionKind;
  batch: number;
  answer: string | null;
  skipped: boolean;
}

export interface ReflectionFeedback {
  strengths: string[];
  gaps: string[];
  next_questions: string[];
}

export interface Reflection {
  id: string;
  kind: "research" | "paper";
  status: ReflectionStatus;
  pause_reason: PauseReason | null;
  questions: ReflectionQuestion[];
  generating: boolean;
  exhausted: boolean;
  limit_reached: boolean;
  run_done: boolean;
  answered: number;
  feedback: ReflectionFeedback | null;
  feedback_current: boolean;
}

/** What a reflection belongs to: a research run (session id) or a paper. */
export type ReflectionTarget = { kind: "research"; id: string } | { kind: "paper"; id: string };

/* ── rules ── */

export function wordCount(text: string): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/** How long a question may sit untouched before the card pauses itself: base + reading time. */
export function idleTimeoutMs(question: { text: string } | string): number {
  const text = typeof question === "string" ? question : question?.text ?? "";
  return IDLE_BASE_MS + IDLE_PER_WORD_MS * wordCount(text);
}

/** Still waiting for the user: not answered (an empty answer counts as unanswered) and not skipped. */
export function isOpen(q: Pick<ReflectionQuestion, "answer" | "skipped">): boolean {
  return !q.skipped && !(q.answer ?? "").trim();
}

/** Mid-answer when the result arrives: the answer box has focus or a draft isn't saved yet. */
export function isMidThought(s: { focused: boolean; hasPending: boolean }): boolean {
  return s.focused || s.hasPending;
}

/** Open questions after the current one. */
export function remainingAfter(questions: ReflectionQuestion[], currentIndex: number): number {
  return questions.slice(Math.max(currentIndex + 1, 0)).filter(isOpen).length;
}

/** True when the card should quietly ask for the next batch now. */
export function shouldRequestNextBatch(
  r: Pick<Reflection, "questions" | "status" | "exhausted" | "limit_reached" | "generating" | "run_done">,
  currentIndex: number,
): boolean {
  if (r.status !== "active" || r.exhausted || r.limit_reached || r.generating || r.run_done) return false;
  return remainingAfter(r.questions, currentIndex) <= PREFETCH_WHEN_LEFT;
}

/** The next open question after the current one (then any earlier open one), or null when none is left. */
export function nextQuestionIndex(questions: ReflectionQuestion[], currentIndex: number): number | null {
  for (let i = currentIndex + 1; i < questions.length; i++) if (isOpen(questions[i])) return i;
  for (let i = 0; i < Math.min(currentIndex, questions.length); i++) if (isOpen(questions[i])) return i;
  return null;
}

/** Where to start (or resume): the first open question. */
export const firstQuestionIndex = (questions: ReflectionQuestion[]) => nextQuestionIndex(questions, -1);

/* ── autosave: debounced per question, flushable, one retry, never silently lost ── */

export type SaveState = "pending" | "saving" | "saved" | "error";
type Timer = unknown;

export interface AutosaverOptions {
  save: (questionId: string, answer: string, opts: { keepalive: boolean }) => Promise<unknown>;
  delayMs?: number;
  onState?: (questionId: string, state: SaveState) => void;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}

export function createAutosaver(options: AutosaverOptions) {
  const delay = options.delayMs ?? AUTOSAVE_DELAY_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const pending = new Map<string, { text: string; timer: Timer }>();
  const failed = new Map<string, string>(); // question id -> the text that couldn't be saved
  const state = (id: string, s: SaveState) => options.onState?.(id, s);

  async function send(id: string, text: string, keepalive: boolean): Promise<boolean> {
    state(id, "saving");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await options.save(id, text, { keepalive });
        if (pending.has(id)) return true; // a newer draft is waiting; it reports its own state
        failed.delete(id);
        state(id, "saved");
        return true;
      } catch {
        // one retry, then the draft is kept and shown as not saved
      }
    }
    failed.set(id, text);
    state(id, "error");
    return false;
  }

  return {
    /** A keystroke: (re)start this question's timer. */
    change(id: string, text: string) {
      const before = pending.get(id);
      if (before) clearTimer(before.timer);
      const timer = setTimer(() => {
        pending.delete(id);
        void send(id, text, false);
      }, delay);
      pending.set(id, { text, timer });
      state(id, "pending");
    },
    /** Save now whatever is waiting (Next, Skip, "I'm busy", unmount, pagehide). */
    async flush(opts: { keepalive?: boolean } = {}): Promise<boolean> {
      const jobs = [...pending.entries()].map(([id, p]) => {
        clearTimer(p.timer);
        pending.delete(id);
        return send(id, p.text, !!opts.keepalive);
      });
      return (await Promise.all(jobs)).every(Boolean);
    },
    /** Drop a waiting draft without saving it (the question was skipped). */
    discard(id: string) {
      const p = pending.get(id);
      if (p) clearTimer(p.timer);
      pending.delete(id);
      failed.delete(id);
    },
    /** "Not saved, retry". */
    retry(id: string): Promise<boolean> {
      const text = failed.get(id);
      return text === undefined ? Promise.resolve(true) : send(id, text, false);
    },
    hasPending: () => pending.size > 0,
    failedIds: () => [...failed.keys()],
  };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
