"use client";

/**
 * One question by voice: CogNexa says it aloud, then listens. When the user pauses after speaking,
 * the answer is saved and the card moves on. Nothing is written on screen: what is happening is shown
 * by the voice bar (onPhase, onWord, onHeard), and the question is available to screen readers.
 *
 * "Stop" is heard at any moment:
 * - while CogNexa is still speaking (a listener for clear requests only, so its own voice can't set it
 *   off: a question that itself contains a stop phrase isn't interruptible);
 * - while the user is answering, before they pause (clear requests such as "stop talking", "I'm busy");
 * - when the reply is complete (the card also checks "stop", "cancel", "skip" there).
 */
import { useEffect, useRef, useState } from "react";
import { FATAL_ERRORS, listen, speak, type Listener } from "@/lib/voice";
import { voiceIntent } from "@/lib/reflection-logic";

export type Phase = "speaking" | "listening" | "saving" | "blocked";

const RESTART_DELAY_MS = 350; // let the previous listener finish before the next one starts

export function VoiceQuestion({
  question,
  silenceMs,
  onAnswer,
  onSilent,
  onStop,
  onHeard,
  onFallback,
  onPhase,
  onWord,
  retry = 0,
}: {
  question: { id: string; text: string };
  /** Stop the questions if nothing is said this long after listening starts. */
  silenceMs: number;
  onAnswer: (text: string) => Promise<void>;
  onSilent: () => void;
  /** The user asked to stop ("stop talking", "I'm busy", "I don't want to answer"…). */
  onStop: () => void;
  /** Words heard so far (the user is mid-answer). */
  onHeard?: (text: string) => void;
  /** Voice can't be used here (no microphone, blocked, offline). */
  onFallback: (reason: string) => void;
  onPhase?: (phase: Phase) => void;
  /** A word was spoken aloud. */
  onWord?: () => void;
  /** Increase to try speaking again after the browser refused ("blocked"). */
  retry?: number;
}) {
  const [phase, setPhase] = useState<Phase>("speaking");
  const handlers = useRef({ onAnswer, onSilent, onStop, onHeard, onFallback, onWord });
  handlers.current = { onAnswer, onSilent, onStop, onHeard, onFallback, onWord };
  const phaseRef = useRef(onPhase);
  phaseRef.current = onPhase;
  useEffect(() => phaseRef.current?.(phase), [phase]);

  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    let listener: Listener | null = null;
    let commands: Listener | null = null;
    let silence: ReturnType<typeof setTimeout> | undefined;
    let restart: ReturnType<typeof setTimeout> | undefined;
    let heardAnything = false;
    let startFailures = 0;
    setPhase("speaking");

    const stopNow = () => {
      if (stopped || cancelled) return;
      stopped = true;
      clearTimeout(silence);
      clearTimeout(restart);
      speech.cancel();
      commands?.abort();
      listener?.abort();
      handlers.current.onStop();
    };

    const startListening = () => {
      if (cancelled || stopped) return;
      setPhase("listening");
      listener = listen({
        onHeard: (text) => {
          if (!text) return;
          if (voiceIntent(text, { live: true }) === "stop") return stopNow(); // no need to wait for the pause
          heardAnything = true;
          clearTimeout(silence);
          handlers.current.onHeard?.(text);
        },
        onDone: (text) => {
          if (cancelled || stopped) return;
          if (text) {
            clearTimeout(silence);
            setPhase("saving");
            void handlers.current.onAnswer(text);
          } else if (!heardAnything) {
            restart = setTimeout(startListening, RESTART_DELAY_MS); // stopped early: keep listening until the silence limit
          }
        },
        onError: (code) => {
          if (cancelled || stopped) return;
          if (code === "start-failed" && startFailures++ < 3) {
            restart = setTimeout(startListening, RESTART_DELAY_MS); // the previous listener hadn't finished yet
          } else if (FATAL_ERRORS.has(code) || code === "not-supported" || code === "start-failed") {
            handlers.current.onFallback(code);
          }
        },
      });
    };

    // While the question is being spoken: listen for clear requests to stop (and nothing else)
    if (voiceIntent(question.text, { live: true }) !== "stop") {
      commands = listen({
        onHeard: (text) => { if (voiceIntent(text, { live: true }) === "stop") stopNow(); },
        onDone: () => undefined,
        onError: () => undefined, // the answer listener reports real problems
      });
    }

    const speech = speak(question.text, { onWord: () => handlers.current.onWord?.() });
    speech.done
      .then(() => {
        if (cancelled || stopped) return;
        commands?.abort();
        commands = null;
        silence = setTimeout(() => {
          if (cancelled || stopped || heardAnything) return;
          listener?.abort();
          handlers.current.onSilent();
        }, silenceMs);
        restart = setTimeout(startListening, RESTART_DELAY_MS);
      })
      .catch((err: Error) => {
        if (cancelled || stopped) return;
        commands?.abort();
        commands = null;
        if (err.message === "blocked") setPhase("blocked"); // the browser won't speak here
        else restart = setTimeout(startListening, RESTART_DELAY_MS);
      });

    return () => {
      cancelled = true;
      clearTimeout(silence);
      clearTimeout(restart);
      speech.cancel();
      commands?.abort();
      listener?.abort();
    };
  }, [question.id, question.text, silenceMs, retry]);

  return <p className="sr-only" aria-live="polite">{question.text}</p>;
}
