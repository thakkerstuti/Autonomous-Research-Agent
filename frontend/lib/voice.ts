/**
 * Voice for "Think while you wait": the browser reads a question aloud (speechSynthesis) and listens
 * to the answer (SpeechRecognition). Only browser APIs; nothing new on the server.
 * Note: in Chrome and Edge, speech recognition is done by the browser maker's online service.
 */

/* ── timings, in one place ── */
export const END_OF_ANSWER_MS = 2_200;   // this long without new words after speaking = the answer is finished
export const MAX_ANSWER_MS = 90_000;     // a single spoken answer never listens longer than this

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Can this browser both speak and listen? */
export function voiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && recognitionCtor() !== null;
}

/** The words heard so far, final and interim, as one tidy string. Pure. */
export function joinTranscript(parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Errors that mean voice can't be used here (the page falls back to typing). */
export const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"]);

/** Read text aloud. Resolves when it has been spoken; rejects with "blocked" when the browser won't speak yet. */
export function speak(text: string, opts: { onWord?: () => void } = {}): { done: Promise<void>; cancel: () => void } {
  let cancel = () => {};
  const done = new Promise<void>((resolve, reject) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || "en-US";
    u.rate = 1;
    let finished = false;
    const finish = (ok: boolean, why?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      if (ok) resolve();
      else reject(new Error(why || "speech"));
    };
    u.onend = () => finish(true);
    u.onboundary = (e) => { if (!e.name || e.name === "word") opts.onWord?.(); };
    u.onerror = (e) => finish(e.error === "interrupted" || e.error === "canceled", e.error === "not-allowed" ? "blocked" : e.error);
    // Some browsers never fire onend: give up waiting after a generous estimate of the reading time
    const guard = setTimeout(() => finish(true), 2_000 + text.split(/\s+/).length * 600);
    cancel = () => { finished = true; clearTimeout(guard); synth.cancel(); resolve(); };
    synth.speak(u);
  });
  return { done, cancel: () => cancel() };
}

export interface Listener {
  stop: () => void;   // finish now and report what was heard
  abort: () => void;  // stop without reporting
}

/**
 * Listen for one spoken answer. Calls onHeard with the words so far (live), and onDone with the whole
 * answer once the speaker has paused for END_OF_ANSWER_MS (or "" if nothing was said before the
 * browser stopped listening). onError gets the browser's error code.
 */
export function listen(handlers: {
  onHeard?: (text: string) => void;
  onDone: (text: string) => void;
  onError: (code: string) => void;
}): Listener {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError("not-supported");
    return { stop: () => {}, abort: () => {} };
  }
  const rec = new Ctor();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  const finals: string[] = [];
  let interim = "";
  let reported = false;
  let aborted = false;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const longest = setTimeout(() => rec.stop(), MAX_ANSWER_MS);
  const heard = () => joinTranscript([...finals, interim]);
  const report = () => {
    if (reported || aborted) return;
    reported = true;
    clearTimeout(quiet);
    clearTimeout(longest);
    handlers.onDone(heard());
  };
  rec.onresult = (e) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finals.push(r[0].transcript);
      else interim += r[0].transcript;
    }
    handlers.onHeard?.(heard());
    clearTimeout(quiet);
    quiet = setTimeout(() => rec.stop(), END_OF_ANSWER_MS); // a pause after speaking ends the answer
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return; // onend follows
    if (!aborted) handlers.onError(e.error);
    aborted = true;
  };
  rec.onend = report;
  try {
    rec.start();
  } catch {
    handlers.onError("start-failed");
  }
  return {
    stop: () => rec.stop(),
    abort: () => { aborted = true; clearTimeout(quiet); clearTimeout(longest); try { rec.abort(); } catch {} },
  };
}
