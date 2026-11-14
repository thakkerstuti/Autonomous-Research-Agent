"use client";

import { useEffect, useRef } from "react";

/**
 * NeuralField — a living neuron drawn on <canvas>.
 * A glowing core, dendrites reaching to the edges, impulses of mauve, gold
 * and violet travelling inward, and drifting cyan motes.
 *
 * mode="thinking" fires fast and bright; mode="idle" is a slow resting pulse.
 * Always render inside a dark container (see `.lens` in globals.css).
 */

type Mode = "idle" | "thinking";
type RGB = [number, number, number];
interface Pt { x: number; y: number }
interface Branch { pts: Pt[]; cum: number[]; len: number; w: number; depth: number }
interface Impulse { b: number; t: number; speed: number; sprite: number; size: number }
interface Mote { x: number; y: number; z: number; vx: number; vy: number; phase: number; sprite: number }

const TAU = Math.PI * 2;
const IMPULSE_COLORS: RGB[] = [
  [232, 168, 214], // mauve
  [255, 196, 118], // gold
  [255, 150, 92],  // ember
  [168, 140, 255], // violet
];
const MOTE_COLORS: RGB[] = [
  [64, 226, 200],  // teal
  [92, 196, 255],  // cyan
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSprite([r, g, b]: RGB, core = 0.12, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const h = size / 2;
  const grad = x.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(core, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.28)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, size, size);
  return c;
}

export function NeuralField({
  mode = "thinking",
  seed = 11,
  className,
}: {
  mode?: Mode;
  seed?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, dpr = 1;
    let cx = 0, cy = 0, coreR = 20;
    let branches: Branch[] = [];
    let motes: Mote[] = [];
    let impulses: Impulse[] = [];
    let dendrites: HTMLCanvasElement | null = null;
    let energy = modeRef.current === "thinking" ? 1 : 0.3;
    let flash = 0;
    let spawnAcc = 0;
    let time = 0;
    let last = performance.now();
    let raf = 0;
    let visible = true;

    const impulseSprites = IMPULSE_COLORS.map((c) => makeSprite(c, 0.1));
    const moteSprites = MOTE_COLORS.map((c) => makeSprite(c, 0.18));

    function edgeDistance(angle: number) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const tx = dx > 0 ? (W - cx) / dx : dx < 0 ? -cx / dx : Infinity;
      const ty = dy > 0 ? (H - cy) / dy : dy < 0 ? -cy / dy : Infinity;
      return Math.min(tx, ty);
    }

    function build() {
      const rand = mulberry32(seed);
      cx = W / 2;
      cy = H / 2;
      const m = Math.min(W, H);
      coreR = Math.max(13, Math.min(56, m * 0.085));
      const widthScale = Math.max(0.75, Math.min(1.5, m / 320));
      branches = [];

      const grow = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
        const steps = Math.max(6, Math.round(len / 12));
        const pts: Pt[] = [{ x, y }];
        let ang = a;
        const bend = (rand() - 0.5) * 0.05;
        for (let s = 1; s <= steps; s++) {
          ang += bend + (rand() - 0.5) * 0.24;
          x += (Math.cos(ang) * len) / steps;
          y += (Math.sin(ang) * len) / steps;
          pts.push({ x, y });
        }
        const cum = [0];
        for (let i = 1; i < pts.length; i++) {
          cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        }
        branches.push({ pts, cum, len: cum[cum.length - 1], w, depth });

        if (depth < 3 && len > 26) {
          const kids = depth === 0 ? 2 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 2);
          for (let k = 0; k < kids; k++) {
            const idx = Math.min(steps - 1, Math.floor(steps * (0.25 + rand() * 0.6)));
            const p = pts[idx], q = pts[idx + 1];
            const base = Math.atan2(q.y - p.y, q.x - p.x);
            const da = (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.65);
            grow(p.x, p.y, base + da, len * (0.32 + rand() * 0.3), w * 0.55, depth + 1);
          }
        }
      };

      const primaries = 12 + Math.floor(rand() * 5);
      for (let i = 0; i < primaries; i++) {
        const a = (i / primaries) * TAU + (rand() - 0.5) * 0.45;
        const reach = edgeDistance(a) * (0.8 + rand() * 0.5);
        grow(
          cx + Math.cos(a) * coreR * 0.85,
          cy + Math.sin(a) * coreR * 0.85,
          a,
          Math.max(reach - coreR, 40),
          (1.5 + rand() * 1.3) * widthScale,
          0
        );
      }

      // Pre-render the dendrite tree once; frames only composite it.
      dendrites = document.createElement("canvas");
      dendrites.width = Math.round(W * dpr);
      dendrites.height = Math.round(H * dpr);
      const d = dendrites.getContext("2d")!;
      d.scale(dpr, dpr);
      d.lineCap = "round";
      d.lineJoin = "round";
      d.globalCompositeOperation = "lighter";

      for (const pass of [0, 1] as const) {
        for (const b of branches) {
          const n = b.pts.length;
          for (let i = 1; i < n; i++) {
            const k = i / n;
            const taper = 1 - k * 0.8;
            d.beginPath();
            d.moveTo(b.pts[i - 1].x, b.pts[i - 1].y);
            d.lineTo(b.pts[i].x, b.pts[i].y);
            if (pass === 0) {
              d.shadowBlur = 12;
              d.shadowColor = "rgba(40,100,255,0.9)";
              d.strokeStyle = `rgba(38,92,235,${(0.42 - b.depth * 0.08) * (1 - k * 0.45)})`;
              d.lineWidth = b.w * taper * 1.6;
            } else {
              d.shadowBlur = 0;
              d.strokeStyle = `rgba(150,195,255,${(0.42 - b.depth * 0.09) * (1 - k * 0.6)})`;
              d.lineWidth = Math.max(0.5, b.w * taper * 0.45);
            }
            d.stroke();
          }
        }
      }

      const count = Math.round(Math.max(16, Math.min(90, (W * H) / 8500)));
      motes = Array.from({ length: count }, () => {
        const z = 0.25 + rand() * 0.75;
        return {
          x: rand() * W,
          y: rand() * H,
          z,
          vx: (rand() - 0.5) * 10 * z,
          vy: (rand() - 0.5) * 10 * z,
          phase: rand() * TAU,
          sprite: rand() < 0.6 ? 0 : 1,
        };
      });
      impulses = [];
    }

    function pointAt(b: Branch, t: number): Pt {
      const target = t * b.len;
      let i = 1;
      while (i < b.cum.length - 1 && b.cum[i] < target) i++;
      const seg = b.cum[i] - b.cum[i - 1] || 1;
      const f = Math.min(1, Math.max(0, (target - b.cum[i - 1]) / seg));
      const p = b.pts[i - 1], q = b.pts[i];
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
    }

    function spawn() {
      if (!branches.length) return;
      // Favour the thick primary branches; impulses travel toward the core.
      let b = Math.floor(Math.random() * branches.length);
      for (let tries = 0; tries < 3 && branches[b].depth > 1; tries++) {
        b = Math.floor(Math.random() * branches.length);
      }
      impulses.push({
        b,
        t: 1,
        speed: 70 + Math.random() * 120,
        sprite: Math.floor(Math.random() * impulseSprites.length),
        size: 0.6 + Math.random() * 0.8,
      });
    }

    function drawCore() {
      const pulse = 0.5 + 0.5 * Math.sin(time * (1.3 + energy * 1.9));
      const lift = flash * 0.6 + energy * 0.25;

      // Halo
      const haloR = coreR * (3.6 + pulse * 0.5 + flash * 1.2);
      const halo = ctx!.createRadialGradient(cx, cy, coreR * 0.6, cx, cy, haloR);
      halo.addColorStop(0, `rgba(48,120,255,${0.42 + lift * 0.3})`);
      halo.addColorStop(0.35, `rgba(40,90,240,${0.14 + lift * 0.12})`);
      halo.addColorStop(1, "rgba(30,60,200,0)");
      ctx!.fillStyle = halo;
      ctx!.beginPath();
      ctx!.arc(cx, cy, haloR, 0, TAU);
      ctx!.fill();

      // Sphere
      const r = coreR * (1 + pulse * 0.025 + flash * 0.05);
      const sphere = ctx!.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
      sphere.addColorStop(0, "rgba(150,205,255,1)");
      sphere.addColorStop(0.45, "rgba(54,132,255,0.98)");
      sphere.addColorStop(0.85, "rgba(30,86,235,0.95)");
      sphere.addColorStop(1, "rgba(30,80,220,0.6)");
      ctx!.fillStyle = sphere;
      ctx!.beginPath();
      ctx!.arc(cx, cy, r, 0, TAU);
      ctx!.fill();

      // Inner filament ring — the bright swirl inside the cell
      ctx!.lineWidth = Math.max(0.8, coreR * 0.035);
      for (let ring = 0; ring < 3; ring++) {
        ctx!.beginPath();
        const base = r * (0.5 + ring * 0.07);
        for (let s = 0; s <= 72; s++) {
          const a = (s / 72) * TAU;
          const wob =
            1 +
            0.035 * Math.sin(a * 6 + time * (1.6 + ring * 0.7)) +
            0.025 * Math.sin(a * 3 - time * 1.3 + ring * 2);
          const x = cx + Math.cos(a) * base * wob;
          const y = cy + Math.sin(a) * base * wob;
          if (s === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.strokeStyle = `rgba(215,240,255,${(0.3 + pulse * 0.35 + flash * 0.3) * (ring === 0 ? 1 : 0.45 / ring)})`;
        ctx!.stroke();
      }

      // Hot centre
      const hot = ctx!.createRadialGradient(cx, cy, 0, cx, cy, r * 0.5);
      hot.addColorStop(0, `rgba(235,248,255,${0.35 + flash * 0.5})`);
      hot.addColorStop(1, "rgba(235,248,255,0)");
      ctx!.fillStyle = hot;
      ctx!.beginPath();
      ctx!.arc(cx, cy, r * 0.5, 0, TAU);
      ctx!.fill();
    }

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;

      const target = modeRef.current === "thinking" ? 1 : 0.3;
      energy += (target - energy) * Math.min(1, dt * 1.8);

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);
      ctx!.globalCompositeOperation = "lighter";

      // Motes
      const drift = 0.35 + energy * 0.9;
      for (const m of motes) {
        m.x += m.vx * dt * drift;
        m.y += m.vy * dt * drift;
        if (m.x < -10) m.x = W + 10; else if (m.x > W + 10) m.x = -10;
        if (m.y < -10) m.y = H + 10; else if (m.y > H + 10) m.y = -10;
        const tw = 0.5 + 0.5 * Math.sin(time * 1.2 + m.phase);
        const size = (5 + m.z * 12) * (0.85 + tw * 0.3);
        ctx!.globalAlpha = (0.18 + 0.6 * tw) * m.z;
        ctx!.drawImage(moteSprites[m.sprite], m.x - size / 2, m.y - size / 2, size, size);
      }

      // Dendrites + impulses share one gently swaying frame
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(Math.sin(time * 0.07) * 0.035);
      const breath = 1 + Math.sin(time * 0.55) * 0.008;
      ctx!.scale(breath, breath);
      ctx!.translate(-cx, -cy);

      if (dendrites) {
        ctx!.globalAlpha = 0.7 + 0.3 * energy + flash * 0.15;
        ctx!.drawImage(dendrites, 0, 0, W, H);
      }

      spawnAcc += dt * (1.2 + energy * 11);
      while (spawnAcc >= 1) { spawn(); spawnAcc -= 1; }

      for (let i = impulses.length - 1; i >= 0; i--) {
        const imp = impulses[i];
        const b = branches[imp.b];
        imp.t -= (imp.speed * (0.5 + energy * 0.8) * dt) / b.len;
        if (imp.t <= 0) {
          if (b.depth === 0) flash = Math.min(1, flash + 0.22);
          impulses.splice(i, 1);
          continue;
        }
        const sprite = impulseSprites[imp.sprite];
        const fadeIn = Math.min(1, (1 - imp.t) * 6);
        for (let k = 3; k >= 0; k--) {
          const tt = Math.min(1, imp.t + k * (6 / b.len));
          const p = pointAt(b, tt);
          const s = (8 + imp.size * 12) * (1 - k * 0.2) * (0.7 + energy * 0.4);
          ctx!.globalAlpha = fadeIn * (k === 0 ? 1 : 0.35 / k);
          ctx!.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);
        }
      }
      ctx!.restore();

      ctx!.globalAlpha = 1;
      drawCore();
      flash *= Math.exp(-dt * 2.6);

      if (!reduceMotion && visible) raf = requestAnimationFrame(frame);
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = rect.width;
      H = rect.height;
      canvas!.width = Math.round(W * dpr);
      canvas!.height = Math.round(H * dpr);
      build();
      if (reduceMotion) {
        // A single, settled frame with a few impulses in flight.
        time = 2.4;
        for (let i = 0; i < 18; i++) { spawn(); impulses[i].t = Math.random(); }
        frame(performance.now());
      }
    }

    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (!reduceMotion && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { resize(); start(); }, W ? 120 : 0);
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else cancelAnimationFrame(raf);
    });
    io.observe(canvas);

    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener("visibilitychange", onVis);

    resize();
    start();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [seed]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
