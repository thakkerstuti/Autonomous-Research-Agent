"use client";

/**
 * The message bar as CogNexa's voice: flowing sound lines that move with the voice (lively while it
 * speaks, gentle while it listens, a flare on each word), and small icon controls. No text and no logo;
 * no buttons; what is happening is announced to screen readers only.
 */
import { useEffect, useRef } from "react";
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

/** The bar itself, the same size and shape as the message box it replaces. */
export function VoiceBar({ className }: { className?: string }) {
  const mode = useVoiceBar((s) => s.mode);
  return (
    <div
      className={cn("animate-msg-in flex h-[56px] items-center rounded-[18px] bg-surface px-3 py-2 shadow-panel", className)}
      role="group"
      aria-label="CogNexa voice"
    >
      <span className="sr-only" aria-live="polite">
        {mode === "speaking" ? "CogNexa is speaking" : mode === "listening" ? "CogNexa is listening" : ""}
      </span>
      <Wave className="h-full min-w-0 flex-1" />
    </div>
  );
}
