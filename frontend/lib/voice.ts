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

/* ── the clearest voice the browser has ── */

/**
 * How suitable a voice is (higher is better). Pure. Natural / neural / online voices (Edge's
 * "Microsoft … Online (Natural)", Chrome's "Google …", Safari's "Premium"/"Enhanced") sound far clearer
 * than the old built-in system voices; the user's language comes first, then English.
 */
export function rankVoice(v: { name: string; lang: string; localService?: boolean }, userLang: string): number {
  const lang = (v.lang || "").toLowerCase().replace("_", "-");
  const want = (userLang || "en-US").toLowerCase();
  let score = 0;
  if (lang === want) score += 30;
  else if (lang.split("-")[0] === want.split("-")[0]) score += 20;
  else if (lang.startsWith("en")) score += 10;
  else return -100; // another language would read English questions badly
  const name = v.name.toLowerCase();
  if (/natural|neural/.test(name)) score += 45;
  if (/premium|enhanced/.test(name)) score += 35;
  if (/online/.test(name)) score += 20;
  if (/^google /.test(name)) score += 25;
  if (v.localService === false) score += 5;
  if (/espeak|compact|novelty|whisper|bad news|bells|boing|bubbles|cellos|zarvox|trinoids|albert|jester|organ|superstar/.test(name)) score -= 60;
  return score;
}

let chosenVoice: SpeechSynthesisVoice | null | undefined;

/** The best voice, waiting briefly for the browser's voice list (Chrome loads it asynchronously). */
function bestVoice(): Promise<SpeechSynthesisVoice | null> {
  if (chosenVoice !== undefined) return Promise.resolve(chosenVoice);
  const synth = window.speechSynthesis;
  const pick = () => {
    const voices = synth.getVoices();
    if (!voices.length) return undefined;
    const lang = navigator.language || "en-US";
    const best = [...voices].sort((a, b) => rankVoice(b, lang) - rankVoice(a, lang))[0];
    return rankVoice(best, lang) > -100 ? best : null;
  };
  const now = pick();
  if (now !== undefined) return Promise.resolve((chosenVoice = now));
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener?.("voiceschanged", done);
      clearTimeout(t);
      const v = pick();
      chosenVoice = v === undefined ? undefined : v; // try again next time if still empty
      resolve(v ?? null);
    };
    const t = setTimeout(done, 1_200);
    synth.addEventListener?.("voiceschanged", done);
  });
}

/** Sentences, so long messages are read in parts (Chrome can cut one long utterance short). Pure. */
export function speechChunks(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["')]*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Read text aloud in the clearest voice available. Resolves when it has been spoken; rejects with "blocked" when the browser won't speak yet. */
export function speak(text: string, opts: { onWord?: () => void } = {}): { done: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let cancel = () => { cancelled = true; };
  const done = new Promise<void>((resolve, reject) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    void bestVoice().then((voice) => {
      if (cancelled) return resolve();
      const parts = speechChunks(text);
      let finished = false;
      let guard: ReturnType<typeof setTimeout> | undefined;
      const finish = (ok: boolean, why?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(guard);
        if (ok) resolve();
        else reject(new Error(why || "speech"));
      };
      cancel = () => { cancelled = true; finish(true); synth.cancel(); };
      const sayPart = (i: number) => {
        if (cancelled || finished) return;
        if (i >= parts.length) return finish(true);
        const u = new SpeechSynthesisUtterance(parts[i]);
        if (voice) u.voice = voice;
        u.lang = voice?.lang || navigator.language || "en-US";
        u.rate = 0.97; // a touch slower than default: clearer
        u.pitch = 1;
        u.onend = () => { clearTimeout(guard); sayPart(i + 1); };
        u.onboundary = (e) => { if (!e.name || e.name === "word") opts.onWord?.(); };
        u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled"
          ? finish(true) : finish(false, e.error === "not-allowed" ? "blocked" : e.error));
        // Some browsers never fire onend: move on after a generous estimate of the reading time
        clearTimeout(guard);
        guard = setTimeout(() => sayPart(i + 1), 2_000 + parts[i].split(/\s+/).length * 600);
        synth.speak(u);
      };
      sayPart(0);
    });
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
