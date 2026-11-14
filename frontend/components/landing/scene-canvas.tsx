"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Mounts the 3D neuron scene on a canvas: lazy-loaded, paused when off screen or hidden. */
export function SceneCanvas({
  getStage,
  reduced,
  mobile,
  centered = false,
}: {
  getStage: () => number;
  reduced: boolean;
  mobile: boolean;
  centered?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;
    let scene: import("./neural-scene").NeuralScene | null = null;
    let raf = 0;
    let visible = true;
    const cleanup: (() => void)[] = [];

    import("./neural-scene")
      .then(({ NeuralScene }) => {
        if (disposed) return;
        try {
          scene = new NeuralScene(canvas, { mobile, reduced, centered });
        } catch {
          setFailed(true);
          return;
        }
        const s = scene;
        const resize = () => {
          const r = canvas.getBoundingClientRect();
          s.resize(r.width, r.height);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        cleanup.push(() => ro.disconnect());

        // Feed scroll progress every frame (cheap: one rect read)
        let lastStage = -1;
        const tick = () => {
          const st = getStage();
          if (st !== lastStage) {
            s.setProgress(st);
            lastStage = st;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        cleanup.push(() => cancelAnimationFrame(raf));

        const onMove = (e: PointerEvent) => {
          s.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
        };
        if (!reduced) {
          window.addEventListener("pointermove", onMove, { passive: true });
          cleanup.push(() => window.removeEventListener("pointermove", onMove));
        }

        const io = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          if (visible && !document.hidden) s.start();
          else s.stop();
        });
        io.observe(canvas);
        cleanup.push(() => io.disconnect());

        const onVis = () => {
          if (!document.hidden && visible) s.start();
        };
        document.addEventListener("visibilitychange", onVis);
        cleanup.push(() => document.removeEventListener("visibilitychange", onVis));

        s.start();
        requestAnimationFrame(() => setReady(true));
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      cleanup.forEach((f) => f());
      scene?.dispose();
    };
  }, [getStage, reduced, mobile, centered]);

  return (
    <div className="landing-ground absolute inset-0" aria-hidden>
      {!failed && (
        <canvas
          ref={ref}
          className={cn("absolute inset-0 h-full w-full transition-opacity duration-[1200ms] ease-out", ready ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
}

