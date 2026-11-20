"use client";

/**
 * The voice of "Think while you wait": the landing page's neuron, centred, pulsing as CogNexa speaks
 * and breathing as it listens. The 3D scene loads lazily, pauses when off screen or in a hidden tab,
 * and falls back to a soft glowing orb where WebGL isn't available.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type OrbMode = "idle" | "speaking" | "listening";
const FADE = "radial-gradient(ellipse closest-side at center, #000 45%, transparent 100%)";
export interface VoiceOrbHandle {
  setMode: (mode: OrbMode) => void;
  pulse: (strength?: number) => void;
}

export const VoiceOrb = forwardRef<VoiceOrbHandle, { className?: string }>(function VoiceOrb({ className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<import("@/components/landing/neural-scene").NeuralScene | null>(null);
  const modeRef = useRef<OrbMode>("idle");
  const [mode, setModeState] = useState<OrbMode>("idle"); // drives the fallback orb
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    setMode: (m) => {
      modeRef.current = m;
      setModeState(m);
      sceneRef.current?.setVoiceMode(m);
    },
    pulse: (strength = 0.6) => sceneRef.current?.pulse(strength),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("@/components/landing/neural-scene")
      .then(({ NeuralScene }) => {
        if (disposed) return;
        let s: InstanceType<typeof NeuralScene>;
        try {
          s = new NeuralScene(canvas, { mobile: true, reduced, centered: true, zoom: 2.3, transparent: true });
        } catch {
          setFailed(true);
          return;
        }
        sceneRef.current = s;
        s.setProgress(0);
        s.setVoiceMode(modeRef.current);
        const resize = () => {
          const r = canvas.getBoundingClientRect();
          s.resize(r.width, r.height);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        let visible = true;
        const io = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          if (visible && !document.hidden) s.start();
          else s.stop();
        });
        io.observe(canvas);
        const onVis = () => (document.hidden || !visible ? s.stop() : s.start());
        document.addEventListener("visibilitychange", onVis);
        cleanup.push(() => { ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); });
        s.start();
        requestAnimationFrame(() => setReady(true));
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      cleanup.forEach((f) => f());
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    // No box: the neuron is drawn on the page and its dendrites fade out softly towards the edges
    <div className={cn("relative", className)} style={{ maskImage: FADE, WebkitMaskImage: FADE }} aria-hidden>
      {!failed ? (
        <canvas
          ref={canvasRef}
          // Dark theme: light only adds to the page (dim lines can't darken it); light theme: drawn as is
          className={cn("absolute inset-0 h-full w-full transition-opacity duration-700 ease-out dark:mix-blend-screen", ready ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "h-20 w-20 rounded-full bg-[radial-gradient(circle_at_40%_35%,#9fd0ff,#2f6bff_55%,#0b1a4a)] shadow-[0_0_60px_18px_rgba(47,107,255,0.45)]",
              mode === "speaking" ? "animate-pulse" : mode === "listening" ? "animate-[pulse_2.6s_ease-in-out_infinite]" : "",
            )}
          />
        </div>
      )}
    </div>
  );
});
