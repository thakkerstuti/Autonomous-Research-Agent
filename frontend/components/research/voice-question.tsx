"use client";

/**
 * One question by voice: CogNexa says it aloud, then listens. When the user pauses after speaking,
 * the answer is saved and the card moves on. Nothing is written on screen: what is happening is shown
 * by the orb (onPhase, onWord, onHeard), and the question is available to screen readers.
 */
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { FATAL_ERRORS, listen, speak, type Listener } from "@/lib/voice";

export type Phase = "speaking" | "listening" | "saving" | "blocked";

export function VoiceQuestion({
  question,
  silenceMs,
  onAnswer,
  onSilent,
  onHeard,
  onFallback,
  onPhase,
  onWord,
}: {
  question: { id: string; text: string };
  /** Pause the questions if nothing is said this long after listening starts. */
  silenceMs: number;
  onAnswer: (text: string) => Promise<void>;
  onSilent: () => void;
  /** Words heard so far (the user is mid-answer). */
  onHeard?: (text: string) => void;
  /** Voice can't be used here (no microphone, blocked, offline): switch to typing. */
  onFallback: (reason: string) => void;
  onPhase?: (phase: Phase) => void;
  /** A word was spoken aloud. */
  onWord?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("speaking");
  const [attempt, setAttempt] = useState(0); // "Tap to start" after the browser refused to speak
  const handlers = useRef({ onAnswer, onSilent, onHeard, onFallback, onWord });
  handlers.current = { onAnswer, onSilent, onHeard, onFallback, onWord };
  const phaseRef = useRef(onPhase);
  phaseRef.current = onPhase;
  useEffect(() => phaseRef.current?.(phase), [phase]);

  useEffect(() => {
    let cancelled = false;
    let listener: Listener | null = null;
    let silence: ReturnType<typeof setTimeout> | undefined;
    let heardAnything = false;
    setPhase("speaking");

    const startListening = () => {
      if (cancelled) return;
      setPhase("listening");
      listener = listen({
        onHeard: (text) => {
          if (!text) return;
          heardAnything = true;
          clearTimeout(silence);
          handlers.current.onHeard?.(text);
        },
        onDone: (text) => {
          if (cancelled) return;
          if (text) {
            clearTimeout(silence);
            setPhase("saving");
            void handlers.current.onAnswer(text);
          } else if (!heardAnything) {
            startListening(); // the browser stopped listening early: keep listening until the silence limit
          }
        },
        onError: (code) => {
          if (cancelled) return;
          if (FATAL_ERRORS.has(code) || code === "not-supported" || code === "start-failed") handlers.current.onFallback(code);
        },
      });
    };

    const speech = speak(question.text, { onWord: () => handlers.current.onWord?.() });
    speech.done
      .then(() => {
        if (cancelled) return;
        silence = setTimeout(() => {
          if (cancelled || heardAnything) return;
          listener?.abort();
          handlers.current.onSilent();
        }, silenceMs);
        startListening();
      })
      .catch((err: Error) => {
        if (cancelled) return;
        if (err.message === "blocked") setPhase("blocked"); // the page hasn't been clicked yet
        else startListening();
      });

    return () => {
      cancelled = true;
      clearTimeout(silence);
      speech.cancel();
      listener?.abort();
    };
  }, [question.id, question.text, silenceMs, attempt]);

  return (
    <>
      <p className="sr-only" aria-live="polite">{question.text}</p>
      {phase === "blocked" && (
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          aria-label="Start talking"
          title="Start talking"
          className="pressable absolute inset-0 z-10 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/90 text-on-primary shadow-panel"
        >
          <Play size={20} className="ml-0.5" />
        </button>
      )}
    </>
  );
}
