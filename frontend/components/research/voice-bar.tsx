"use client";

/**
 * The message bar as CogNexa's voice: flowing sound lines that move with the voice (lively while it
 * speaks, gentle while it listens, a flare on each word), and small icon controls. No text and no logo;
 * what is happening is announced to screen readers only.
 */
import { useEffect, useRef } from "react";
import { Pause, Play, PowerOff, SkipForward, Sparkles, Square } from "lucide-react";
import { useVoiceBar, type BarMode } from "@/lib/voice-bar";
import { cn } from "@/lib/utils";

// Lines: [hue, frequency, speed, phase, weight]
const LINES: [number, number, number, number, number][] = [
  [222, 1.6, 1.9, 0, 1],
  [262, 2.3, -1.4, 1.7, 0.8],
  [192, 1.1, 2.6, 3.1, 0.65],
  [292, 2.9, -2.2, 4.4, 0.5],
];
const TARGET: Record<BarMode, number> = { speaking: 1, listening: 0.42, idle: 0.12 };

function Wave({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let level = 0;
    let flare = 0;
    let lastPulse = useVoiceBar.getState().pulse.n;
    const unsub = useVoiceBar.subscribe((s) => {
      if (s.pulse.n !== lastPulse) {
        lastPulse = s.pulse.n;
        flare = Math.max(flare, s.pulse.strength);
      }
    });
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const pr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * pr));
      canvas.height = Math.max(1, Math.round(r.height * pr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const start = performance.now();
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const { mode } = useVoiceBar.getState();
      level += (TARGET[mode] - level) * 0.08;
      flare *= 0.9;
      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      // speaking: an uneven, syllable-like beat; listening: a slow swell
      const beat = mode === "speaking" ? 0.55 + 0.45 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1)) : 0.75 + 0.25 * Math.sin(t * 1.8);
      const amp = (h * 0.42) * Math.min(1, level * beat + flare * 0.6);
      for (const [hue, freq, speed, phase, weight] of LINES) {
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, `hsla(${hue}, 95%, 66%, 0)`);
        grad.addColorStop(0.5, `hsla(${hue}, 95%, 68%, ${0.55 + 0.4 * weight})`);
        grad.addColorStop(1, `hsla(${hue + 30}, 95%, 66%, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1, (h / 26) * weight);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 3) {
          const u = x / w;
          const env = Math.pow(Math.sin(Math.PI * u), 2); // calm at the ends, full in the middle
          const y = mid + amp * weight * env * Math.sin(u * Math.PI * 2 * freq + (reduced ? 0 : t * speed) + phase);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}

function Control({ label, onClick, children, primary }: { label: string; onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "pressable flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] transition-colors",
        primary ? "bg-primary text-on-primary" : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** The bar itself, the same size and shape as the message box it replaces. */
export function VoiceBar({ className }: { className?: string }) {
  const mode = useVoiceBar((s) => s.mode);
  const c = useVoiceBar((s) => s.controls);
  return (
    <div
      className={cn("animate-msg-in flex h-[56px] items-center gap-1 rounded-[18px] bg-surface py-2 pl-3 pr-2 shadow-panel", className)}
      role="group"
      aria-label="CogNexa voice"
    >
      <span className="sr-only" aria-live="polite">
        {mode === "speaking" ? "CogNexa is speaking" : mode === "listening" ? "CogNexa is listening" : ""}
      </span>
      <Wave className="h-full min-w-0 flex-1" />
      {c.start && <Control label="Start talking" onClick={c.start} primary><Play size={16} className="ml-0.5" /></Control>}
      {c.feedback && <Control label="Get feedback" onClick={c.feedback} primary><Sparkles size={16} /></Control>}
      {c.skip && <Control label="Skip this question" onClick={c.skip}><SkipForward size={15} /></Control>}
      {c.pause && <Control label="I'm busy: pause the questions" onClick={c.pause}><Pause size={15} /></Control>}
      {c.off && <Control label="Stop asking me questions while I wait" onClick={c.off}><PowerOff size={15} /></Control>}
      {c.stop && <Control label="Stop" onClick={c.stop}><Square size={13} className="fill-current" /></Control>}
    </div>
  );
}
