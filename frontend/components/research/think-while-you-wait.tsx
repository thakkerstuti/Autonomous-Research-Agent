"use client";

/**
 * "Think while you wait": while a research run (or a Paper Study output) is being written, one
 * question at a time about the user's own topic; when the result is ready, their thinking next to
 * the evidence. Encouraging, never grading.
 *
 * - Answers autosave (debounced per question) and are flushed on Next, Skip, "I'm busy", unmount
 *   and pagehide. A failed save shows "Not saved · Retry".
 * - The next batch is asked for quietly when two questions are left.
 * - "I'm busy", or a question left untouched for its reading time (idleTimeoutMs), collapses the
 *   card into a "Paused · Keep thinking" pill. Any interaction cancels that timer.
 * - The setting "Ask me questions while I wait" (localStorage) turns it all off.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lightbulb, RotateCcw, Sparkles, Volume2, X } from "lucide-react";
import { CitationChip } from "@/components/research/report-body";
import { VoiceQuestion } from "@/components/research/voice-question";
import { VoiceBar } from "@/components/research/voice-bar";
import { useVoiceBar, type BarControls, type BarMode } from "@/lib/voice-bar";
import { speak, voiceSupported } from "@/lib/voice";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { ApiError } from "@/lib/api-error";
import type { ViewEvidence } from "@/lib/research-view";
import {
  ANSWER_MAX, FINISH_THOUGHT_MS, spokenFeedback, voiceIntent, createAutosaver, firstQuestionIndex, getReflection, idleTimeoutMs, isMidThought, isOpen,
  nextQuestionIndex,
  pauseReflection, requestFeedback, requestNextBatch, resumeReflection, saveAnswer, shouldRequestNextBatch,
  type Autosaver, type QuestionKind, type Reflection, type ReflectionTarget, type SaveState,
} from "@/lib/reflection";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<QuestionKind, string> = {
  prior: "What you think",
  assumption: "An assumption",
  angle: "Your angle",
  predict: "A prediction",
  connect: "A connection",
};

const message = (err: unknown) => (err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.");

/* ───────── citations in feedback: [E#] chips (research) or [p.N] chips that open the page (paper) ───────── */

function CitedText({ text, evidence, onOpenPage }: {
  text: string;
  evidence?: Map<string, ViewEvidence>;
  onOpenPage?: (page: number) => void;
}) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const ids = part.match(/^\[(E\d+(?:\s*,\s*E\d+)*)\]$/);
        if (ids) {
          return ids[1].split(",").map((raw) => {
            const id = raw.trim();
            return <CitationChip key={`${i}-${id}`} ev={evidence?.get(id)} label={id} />;
          });
        }
        const pages = part.match(/^\[((?:p\.?\s*\d+\s*,?\s*)+)\]$/i);
        if (pages) {
          return (pages[1].match(/\d+/g) ?? []).map((n) => (
            <button
              key={`${i}-p${n}`}
              type="button"
              onClick={() => onOpenPage?.(Number(n))}
              disabled={!onOpenPage}
              title={onOpenPage ? `Open page ${n}` : `Page ${n}`}
              className="mono relative -top-[0.35em] ml-0.5 inline-flex h-[18px] items-center rounded-[5px] bg-accent-soft px-1 text-[10.5px] font-medium leading-none text-accent transition-colors enabled:hover:bg-accent enabled:hover:text-on-primary"
            >
              p.{n}
            </button>
          ));
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/* ───────── the card ───────── */

export function ThinkWhileYouWait({
  target: targetProp,
  running,
  evidence,
  onAsk,
  onOpenPage,
  className,
  surface = "inline",
}: {
  target: ReflectionTarget;
  /** The run (or the paper's output) is still being written. */
  running: boolean;
  /** Research: the public evidence, for [E#] chips in the feedback. */
  evidence?: ViewEvidence[];
  /** A suggested next question was clicked. */
  onAsk?: (question: string) => void;
  /** Paper: a [p.N] chip was clicked. */
  onOpenPage?: (page: number) => void;
  className?: string;
  /** Where the voice shows: "composer" = the page's message bar becomes the voice (Research);
   *  "inline" = a voice bar here (Paper Study, which has no message bar). */
  surface?: "composer" | "inline";
}) {
  const enabled = true; // always on: every research run asks by voice
  const queryClient = useQueryClient();
  // Stable while it's the same run or paper (the page passes a new object on every render)
  const { kind: targetKind, id: targetId } = targetProp;
  const target = useMemo(() => ({ kind: targetKind, id: targetId }) as ReflectionTarget, [targetKind, targetId]);
  const key = useMemo(() => ["reflection", targetKind, targetId], [targetKind, targetId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => getReflection(target),
    enabled,
    staleTime: 1_000,
    refetchInterval: (q) => {
      const r = q.state.data as Reflection | null | undefined;
      if (!running) return false;
      if (r === null && q.state.dataUpdateCount > 4) return false; // no questions for this run
      return !r || r.generating || !r.questions.length ? 2_500 : 8_000;
    },
  });
  const r = query.data ?? null;
  const setR = useCallback((next: Reflection) => queryClient.setQueryData(key, next), [queryClient, key]);

  // When the run finishes, read the final state once (questions stop, feedback can start)
  useEffect(() => {
    if (!running && enabled) void queryClient.invalidateQueries({ queryKey: key });
  }, [running, enabled, queryClient, key]);

  /* ── drafts and autosave ── */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const saverRef = useRef<Autosaver | null>(null);
  if (!saverRef.current) {
    saverRef.current = createAutosaver({
      save: (id, text, opts) => saveAnswer(target, { question_id: id, answer: text }, opts).then(setR),
      onState: (id, s) => setSaveState((m) => ({ ...m, [id]: s })),
    });
  }
  const saver = saverRef.current;
  useEffect(() => {
    const onHide = () => void saver.flush({ keepalive: true });
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void saver.flush({ keepalive: true });
    };
  }, [saver]);

  const questions = useMemo(
    () => (r?.questions ?? []).map((q) => (q.id in drafts ? { ...q, answer: drafts[q.id] } : q)),
    [r?.questions, drafts],
  );

  /* ── which question is shown ── */
  const [index, setIndex] = useState<number | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!questions.length) return;
    if (!started.current) {
      started.current = true;
      setIndex(firstQuestionIndex(questions));
    } else if (index === null) {
      setIndex(firstQuestionIndex(questions)); // new questions arrived while waiting
    }
  }, [questions, index]);

  /* ── the next batch, quietly, when two are left ── */
  const asking = useRef(false);
  useEffect(() => {
    if (!r || !running || asking.current) return;
    if (!shouldRequestNextBatch({ ...r, questions }, index ?? questions.length)) return;
    asking.current = true;
    requestNextBatch(target)
      .then(setR)
      .catch(() => undefined) // the run ended, a pause, or the cap: the next poll shows the state
      .finally(() => { asking.current = false; });
  }, [r, questions, index, running, target, setR]);

  /* ── idle: after the question has appeared, its reading time without any interaction ── */
  const [appeared, setAppeared] = useState(false);
  const [touched, setTouched] = useState(false);
  const current = index !== null ? questions[index] : undefined;
  // A new question, or the questions coming back after a pause: the idle timer starts afresh
  const status = r?.status;
  useEffect(() => {
    setAppeared(false);
    setTouched(false);
    const t = setTimeout(() => setAppeared(true), 450); // also when animations are off
    return () => clearTimeout(t);
  }, [current?.id, status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(async (name: string, fn: () => Promise<Reflection | null | void>) => {
    setBusy(name);
    setError(null);
    try {
      const next = await fn();
      if (next) setR(next);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }, [setR]);

  /* ── voice: questions are spoken and answered aloud; typing only when voice can't work here ── */
  const [voice, setVoice] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  useEffect(() => setVoice(voiceSupported()), []);
  const heardRef = useRef("");  // words heard for the current question (the user is mid-answer)
  const voiceRef = useRef(false);
  voiceRef.current = voice;
  // The voice bar: this run (or paper) owns it while CogNexa talks
  const owner = `${targetKind}:${targetId}`;
  const voiceMode = useRef<BarMode>("idle");
  const flare = useCallback((strength: number) => useVoiceBar.getState().flare(owner, strength), [owner]);
  const [blocked, setBlocked] = useState(false);  // the browser won't speak until the page is clicked
  const [voiceRetry, setVoiceRetry] = useState(0);

  /* ── the answer is ready: the encouraging message, said aloud through the voice bar ── */
  const [sayingFeedback, setSayingFeedback] = useState(false);
  const feedbackSpeech = useRef<{ cancel: () => void } | null>(null);
  const sayFeedback = useCallback((text: string) => {
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    feedbackSpeech.current?.cancel();
    setSayingFeedback(true);
    const speech = speak(text, { onWord: () => flare(0.45) });
    feedbackSpeech.current = speech;
    speech.done.catch(() => undefined).finally(() => {
      if (feedbackSpeech.current === speech) setSayingFeedback(false);
    });
  }, [flare]);
  useEffect(() => () => feedbackSpeech.current?.cancel(), []);

  const pause = useCallback((reason: "busy" | "idle") =>
    act("pause", async () => {
      await saver.flush();
      return pauseReflection(target, reason);
    }), [act, saver, target]);
  const pauseRef = useRef(pause);
  pauseRef.current = pause;

  // Depends only on the question itself, so the regular status checks never restart the timer
  const currentText = current?.text;
  useEffect(() => {
    if (voice || !currentText || !appeared || touched || !running || status !== "active") return;
    const t = setTimeout(() => void pauseRef.current("idle"), idleTimeoutMs(currentText));
    return () => clearTimeout(t);
  }, [voice, currentText, appeared, touched, running, status]);
  const touch = () => { if (!touched) setTouched(true); };

  /* ── feedback, once the result is ready and something is answered ── */
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const feedbackAsked = useRef(false);
  const getFeedback = useCallback(async () => {
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      await saver.flush(); // the last answer is always included
      const next = await requestFeedback(target);
      setR(next);
      // Written just now (not reopened later): say it aloud when the user answers by voice
      if (voiceRef.current && next.feedback) sayFeedback(spokenFeedback(next.feedback));
    } catch (err) {
      setFeedbackError(err instanceof ApiError && err.status === 400 ? null : message(err));
    } finally {
      setFeedbackBusy(false);
    }
  }, [saver, setR, target, sayFeedback]);
  // The result arrived while the user was mid-answer: "Finish your thought?" instead of feedback at once.
  // Declared before the automatic feedback below, so it decides first.
  const focusedRef = useRef(false);
  const finishingRef = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [typedAt, setTypedAt] = useState(0);
  // Decided in the same render in which the run finishes (not in an effect after it), so the card never
  // shows the result for one frame first: that would unmount the voice question and speak it again.
  const [prevRunning, setPrevRunning] = useState(running);
  if (prevRunning !== running) {
    setPrevRunning(running);
    if (prevRunning && !running
      && isMidThought({ focused: focusedRef.current || !!heardRef.current, hasPending: saver.hasPending() })) {
      finishingRef.current = true;
      setFinishing(true);
    }
  }
  const finishThought = useCallback(() => {
    if (!finishingRef.current) return;
    finishingRef.current = false;
    setFinishing(false);
    feedbackAsked.current = true;
    void getFeedback();
  }, [getFeedback]);
  useEffect(() => { // feedback after FINISH_THOUGHT_MS without typing
    if (!finishing) return;
    const t = setTimeout(finishThought, FINISH_THOUGHT_MS);
    return () => clearTimeout(t);
  }, [finishing, typedAt, finishThought]);

  useEffect(() => {
    if (!r || running || !r.run_done || r.feedback || r.answered < 1 || feedbackAsked.current || finishingRef.current) return;
    feedbackAsked.current = true;
    void getFeedback();
  }, [r, running, getFeedback, finishing]);

  const answerByVoice = useCallback(async (questionId: string, text: string) => {
    heardRef.current = "";
    const intent = voiceIntent(text);
    if (intent === "stop") return void pauseRef.current("busy"); // "stop", "I don't want to answer": quietly ends
    if (intent === "skip") {
      const next = await saveAnswer(target, { question_id: questionId, skipped: true }).catch(() => null);
      if (next) {
        setR(next);
        setIndex(nextQuestionIndex(next.questions, index ?? -1));
      }
      return;
    }
    const answer = text.slice(0, ANSWER_MAX);
    setDrafts((d) => ({ ...d, [questionId]: answer }));
    saver.change(questionId, answer);
    if (!(await saver.flush())) return; // kept as "Not saved · Retry"
    if (finishingRef.current) return finishThought();
    setIndex((i) => {
      const qs = (queryClient.getQueryData(key) as Reflection | null)?.questions ?? questions;
      return nextQuestionIndex(qs.map((q) => (q.id === questionId ? { ...q, answer } : q)), i ?? -1);
    });
  }, [saver, finishThought, queryClient, key, questions, target, setR, index]);

  /** "Get feedback" while the user is still talking: what was heard so far counts as their answer. */
  const finishVoice = useCallback(() => {
    if (current && heardRef.current) saver.change(current.id, heardRef.current.slice(0, ANSWER_MAX));
    heardRef.current = "";
    finishThought();
  }, [current, saver, finishThought]);

  const evidenceMap = useMemo(() => new Map((evidence ?? []).map((e) => [e.id, e])), [evidence]);
  const [dismissed, setDismissed] = useState(false);

  const waitingNow = !current || (!isOpen(current) && nextQuestionIndex(questions, index ?? -1) === null);
  const resultShown = !running || !!r?.run_done || r?.status === "finished";
  const voiceFinishing = !!(finishing && current && voice);
  const voiceAsking = !voiceFinishing && !resultShown && voice && !!r && r.status !== "paused"
    && !(r.status === "failed" && !questions.length);
  const barOn = enabled && !dismissed && !!r && (voiceFinishing || voiceAsking || sayingFeedback);
  const controls: BarControls = {}; // no buttons: the user answers, says "skip" or "stop", or stays silent
  useEffect(() => {
    const bar = useVoiceBar.getState();
    if (!barOn) return bar.release(owner);
    bar.claim(owner, controls);
    bar.setMode(owner, sayingFeedback && !voiceFinishing && !voiceAsking ? "speaking" : voiceMode.current);
  });
  useEffect(() => () => useVoiceBar.getState().release(owner), [owner]);

  /* ───────── render ───────── */

  if (!enabled || !r || dismissed) return null;

  const saving = current ? saveState[current.id] : undefined;
  const draftText = current ? current.answer ?? "" : "";
  const saveNote = current && (
    <span className="ml-auto text-[12px] text-ink-faint" aria-live="polite">
      {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? (
        <button type="button" onClick={() => void saver.retry(current.id)} className="text-bad underline underline-offset-2">
          Not saved · Retry
        </button>
      ) : null}
    </span>
  );
  const answerBox = current && (
    <textarea
      value={draftText}
      onChange={(e) => {
        const text = e.target.value.slice(0, ANSWER_MAX);
        setDrafts((d) => ({ ...d, [current.id]: text }));
        saver.change(current.id, text);
        setTypedAt(Date.now());
      }}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => { focusedRef.current = false; }}
      rows={3}
      maxLength={ANSWER_MAX}
      placeholder="Your thoughts, in a few words…"
      aria-label={`Your answer to: ${current.text}`}
      className="mt-3 block w-full resize-y rounded-xl border border-line bg-bg px-3 py-2.5 text-[14.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent/60"
    />
  );

  // Voice: no card. The question is spoken and the answer heard through the voice bar (the message bar on
  // Research, or a bar here in Paper Study). The same shape for asking and "Finish your thought?", so a
  // spoken answer in progress survives the switch.
  const voiceCard = (question: typeof current) => (
    <>
      {question && (
        <VoiceQuestion
          key={question.id}
          question={question}
          silenceMs={idleTimeoutMs(question.text)}
          retry={voiceRetry}
          onAnswer={(text) => answerByVoice(question.id, text)}
          onSilent={() => void (finishingRef.current ? finishVoice() : pause("idle"))}
          onStop={() => { heardRef.current = ""; if (finishingRef.current) finishVoice(); else void pause("busy"); }}
          onHeard={(text) => { heardRef.current = text; setTypedAt(Date.now()); flare(0.45); }}
          onWord={() => flare(0.35)}
          onPhase={(phase) => {
            if (phase === "blocked") return void pause("idle"); // the browser won't speak here: stop quietly
            voiceMode.current = phase === "speaking" ? "speaking" : phase === "listening" ? "listening" : "idle";
            useVoiceBar.getState().setMode(owner, voiceMode.current);
          }}
          onFallback={() => {
            setVoice(false); // no microphone here: the questions stop quietly
            void pause("idle");
          }}
        />
      )}
      {surface === "inline" && <VoiceBar className={cn("w-full", className)} />}
      {saving === "error" && question && <div className="mt-2 flex">{saveNote}</div>}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-bad">{error}</p>}
    </>
  );

  // The result arrived mid-answer: let them finish, then compare
  if (voiceFinishing) return voiceCard(current);
  if (finishing && current) {
    return (
      <section aria-label="Finish your thought" className={cn("animate-msg-in rounded-2xl border border-line bg-surface p-4 sm:p-5", className)}>
        <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Sparkles size={15} className="text-accent" /> Research is ready. Finish your thought?
        </p>
        <p className="mt-3 text-[15px] leading-snug text-ink">{current.text}</p>
        {answerBox}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={finishThought}
            className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-on-primary"
          >
            Get feedback <ArrowRight size={13} />
          </button>
          {saveNote}
        </div>
      </section>
    );
  }

  // The result is ready: the comparison (only if something was answered)
  if (!running || r.run_done || r.status === "finished") {
    if (r.answered < 1 && !r.feedback) return null;
    return (
      <section aria-label="Your thinking vs the evidence" className={cn("animate-msg-in rounded-2xl border border-line bg-surface p-4 sm:p-5", className)}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <Sparkles size={15} className="text-accent" /> Your thinking vs the evidence
          </h3>
          {r.kind === "paper" && (
            <button type="button" onClick={() => setDismissed(true)} aria-label="Close" className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:text-ink">
              <X size={14} />
            </button>
          )}
        </div>
        {sayingFeedback && surface === "inline" && <VoiceBar className="mt-3" />}
        {r.feedback && spokenFeedback(r.feedback) && (
          <div className="mt-3 flex items-start gap-2">
            <p className="flex-1 text-[15.5px] leading-relaxed text-ink">{spokenFeedback(r.feedback)}</p>
          </div>
        )}
        {r.feedback ? (
          <div className="mt-3 grid gap-4 text-[14px] leading-relaxed text-ink">
            {r.feedback.strengths.length > 0 && (
              <div>
                <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-faint">What you saw</p>
                <ul className="mt-1.5 grid gap-1.5">
                  {r.feedback.strengths.map((s, i) => (
                    <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.6em] h-1 w-1 flex-shrink-0 rounded-full bg-ok" /><span><CitedText text={s} evidence={evidenceMap} onOpenPage={onOpenPage} /></span></li>
                  ))}
                </ul>
              </div>
            )}
            {r.feedback.gaps.length > 0 && (
              <div>
                <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-faint">Worth thinking about</p>
                <ul className="mt-1.5 grid gap-1.5">
                  {r.feedback.gaps.map((s, i) => (
                    <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.6em] h-1 w-1 flex-shrink-0 rounded-full bg-accent" /><span><CitedText text={s} evidence={evidenceMap} onOpenPage={onOpenPage} /></span></li>
                  ))}
                </ul>
              </div>
            )}
            {r.feedback.next_questions.length > 0 && (
              <div>
                <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-faint">Ask next</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.feedback.next_questions.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onAsk?.(q)}
                      disabled={!onAsk}
                      className="pressable inline-flex max-w-full items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-left text-[13px] text-ink transition-colors enabled:hover:border-accent/50 enabled:hover:bg-accent-soft"
                    >
                      <span className="min-w-0">{q}</span> <ArrowRight size={12} className="flex-shrink-0 text-accent" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : feedbackBusy ? (
          <p className="mt-3 flex items-center gap-2 text-[13.5px] text-ink-soft" role="status">
            <ThinkingMark active size={13} /> Comparing your thinking with the evidence…
          </p>
        ) : feedbackError ? (
          <div className="mt-3 text-[13.5px]">
            <p className="text-ink-soft">{feedbackError}</p>
            <button type="button" onClick={() => void getFeedback()} className="mt-2 inline-flex items-center gap-1.5 font-medium text-ink underline decoration-accent/50 underline-offset-4 hover:decoration-accent">
              <RotateCcw size={13} /> Try again
            </button>
          </div>
        ) : (
          <p className="mt-3 text-[13.5px] text-ink-soft">Your answers are saved.</p>
        )}
      </section>
    );
  }

  // Stopped (silence, or the user said "stop"): nothing comes back for this run
  if (r.status === "paused") return null;

  // Asking
  const waiting = !current || !isOpen(current) && nextQuestionIndex(questions, index ?? -1) === null;
  const moreComing = r.generating || (r.status === "active" && !r.exhausted && !r.limit_reached);
  // Voice: the orb stays while the next question is on its way (no thinking text)
  if (voiceAsking) return voiceCard(waiting ? undefined : current);

  return null; // no voice here (no microphone, or a browser that can't listen): nothing is shown
}
