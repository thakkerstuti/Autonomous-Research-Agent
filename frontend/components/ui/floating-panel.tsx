"use client";

import { useRef, useState, useCallback, useEffect, ReactNode } from "react";
import { X, Minus, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PanelType =
  | "paper"
  | "summary"
  | "concept"
  | "evidence"
  | "notes"
  | "comparison"
  | "insight"
  | "research";

interface PanelConfig {
  color: string;
  label: string;
}

const PANEL_CONFIGS: Record<PanelType, PanelConfig> = {
  paper:      { color: "var(--teal)",     label: "Paper" },
  summary:    { color: "var(--rose)",     label: "Summary" },
  concept:    { color: "var(--lavender)", label: "Concept" },
  evidence:   { color: "var(--warn)",     label: "Evidence" },
  notes:      { color: "var(--ok)",       label: "Notes" },
  comparison: { color: "var(--lavender)", label: "Compare" },
  insight:    { color: "var(--rose)",     label: "Insight" },
  research:   { color: "var(--teal)",     label: "Research" },
};

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface FloatingPanelProps {
  id: string;
  type: PanelType;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  initialX?: number;
  initialY?: number;
  initialW?: number;
  initialH?: number;
  zIndex?: number;
  isNew?: boolean;
  layoutNonce?: number;
  scale?: number;
  onClose?: (id: string) => void;
  onFocus?: (id: string) => void;
  className?: string;
}

const MIN_W = 240;
const MIN_H = 180;

export function FloatingPanel({
  id,
  type,
  title,
  subtitle,
  children,
  initialX = 80,
  initialY = 80,
  initialW = 420,
  initialH = 360,
  zIndex = 10,
  isNew = false,
  layoutNonce = 0,
  scale = 1,
  onClose,
  onFocus,
  className,
}: FloatingPanelProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ w: initialW, h: initialH });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [revealed, setRevealed] = useState(!isNew);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resStart = useRef({ mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0, edge: "se" as ResizeEdge });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef({ dist: 0, w: 0, h: 0 });

  const config = PANEL_CONFIGS[type];
  const worldScale = Math.max(0.25, scale);

  useEffect(() => {
    if (isNew) requestAnimationFrame(() => setRevealed(true));
    else setRevealed(true);
  }, [isNew]);

  useEffect(() => {
    setPos({ x: initialX, y: initialY });
    setSize({ w: initialW, h: initialH });
    setMinimized(false);
    // Only re-seat when the workspace asks to spread/reset — not on every parent render.
  }, [layoutNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = useCallback(
    (clientX: number, clientY: number) => ({
      x: clientX / worldScale,
      y: clientY / worldScale,
    }),
    [worldScale]
  );

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      onFocus?.(id);
      const p = toWorld(e.clientX, e.clientY);
      dragStart.current = { mx: p.x, my: p.y, px: pos.x, py: pos.y };
      setDragging(true);
    },
    [pos, id, onFocus, toWorld]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      setPos({
        x: dragStart.current.px + (p.x - dragStart.current.mx),
        y: dragStart.current.py + (p.y - dragStart.current.my),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, toWorld]);

  const beginResize = useCallback(
    (edge: ResizeEdge, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      onFocus?.(id);
      const p = toWorld(e.clientX, e.clientY);
      resStart.current = { mx: p.x, my: p.y, x: pos.x, y: pos.y, w: size.w, h: size.h, edge };
      setResizing(true);
    },
    [pos, size, id, onFocus, toWorld]
  );

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      const dw = p.x - resStart.current.mx;
      const dh = p.y - resStart.current.my;
      const { edge, x, y, w, h } = resStart.current;
      let nextX = x;
      let nextY = y;
      let nextW = w;
      let nextH = h;
      if (edge.includes("e")) nextW = w + dw;
      if (edge.includes("s")) nextH = h + dh;
      if (edge.includes("w")) {
        nextW = w - dw;
        nextX = x + dw;
      }
      if (edge.includes("n")) {
        nextH = h - dh;
        nextY = y + dh;
      }
      if (nextW < MIN_W) {
        if (edge.includes("w")) nextX = x + (w - MIN_W);
        nextW = MIN_W;
      }
      if (nextH < MIN_H) {
        if (edge.includes("n")) nextY = y + (h - MIN_H);
        nextH = MIN_H;
      }
      setPos({ x: nextX, y: nextY });
      setSize({ w: nextW, h: nextH });
    };
    const onUp = () => setResizing(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing, toWorld]);

  const onPanelPointerDown = useCallback(
    (e: React.PointerEvent) => {
      onFocus?.(id);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const pts = [...pointers.current.values()];
        pinchStart.current = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          w: size.w,
          h: size.h,
        };
      }
    },
    [id, onFocus, size]
  );

  const onPanelPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size !== 2) return;
    const pts = [...pointers.current.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (pinchStart.current.dist < 8) return;
    const factor = dist / pinchStart.current.dist;
    setSize({
      w: Math.max(MIN_W, pinchStart.current.w * factor),
      h: Math.max(MIN_H, pinchStart.current.h * factor),
    });
  }, []);

  const onPanelPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  }, []);

  const animClass = isNew && !revealed ? "opacity-0" : isNew ? "panel-reveal panel-shimmer" : "";

  return (
    <div
      ref={panelRef}
      id={`panel-${id}`}
      className={cn("panel no-transition select-none", animClass, {
        "panel-dragging": dragging || resizing,
      }, className)}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? "auto" : size.h,
        zIndex,
        minWidth: MIN_W,
        minHeight: minimized ? undefined : MIN_H,
        touchAction: "none",
      }}
      onPointerDown={onPanelPointerDown}
      onPointerMove={onPanelPointerMove}
      onPointerUp={onPanelPointerUp}
      onPointerCancel={onPanelPointerUp}
    >
      <div
        className="h-[3px] w-full flex-shrink-0"
        style={{ background: `linear-gradient(90deg, ${config.color}, var(--lavender), var(--teal))` }}
      />

      <div className="panel-header" onPointerDown={onHeaderPointerDown}>
        <span
          className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
          style={{ backgroundColor: config.color }}
        >
          {config.label}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium leading-tight text-ink">{title}</span>
          {subtitle && (
            <span className="truncate text-[11px] text-ink-faint leading-tight">{subtitle}</span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5 ml-1">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMinimized((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface3 hover:text-ink-soft"
            title={minimized ? "Expand" : "Minimise"}
          >
            {minimized ? <Maximize2 size={12} /> : <Minus size={12} />}
          </button>
          {onClose && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onClose(id)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-bad/10 hover:text-bad"
              title="Close"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {!minimized && <div className="panel-body">{children}</div>}

      {!minimized && (
        <>
          <div className="resize-n" onPointerDown={(e) => beginResize("n", e)} />
          <div className="resize-s" onPointerDown={(e) => beginResize("s", e)} />
          <div className="resize-e" onPointerDown={(e) => beginResize("e", e)} />
          <div className="resize-w" onPointerDown={(e) => beginResize("w", e)} />
          <div className="resize-ne" onPointerDown={(e) => beginResize("ne", e)} />
          <div className="resize-nw" onPointerDown={(e) => beginResize("nw", e)} />
          <div className="resize-se" onPointerDown={(e) => beginResize("se", e)} />
          <div className="resize-sw" onPointerDown={(e) => beginResize("sw", e)} />
        </>
      )}
    </div>
  );
}
