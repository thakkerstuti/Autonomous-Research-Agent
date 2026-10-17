"use client";

import { useState, useCallback, useRef, useEffect, ReactNode } from "react";
import {
  AlignHorizontalDistributeCenter, RotateCcw, Maximize, Minimize,
  Eye, Layers, Send, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CanvasToolbarProps {
  onArrange: () => void;
  onReset: () => void;
  onToggleFocus: () => void;
  onSpread?: () => void;
  focusMode: boolean;
  panelCount: number;
}

function CanvasToolbar({
  onArrange, onReset, onToggleFocus, onSpread, focusMode, panelCount,
}: CanvasToolbarProps) {
  return (
    <div className="hud-dock absolute right-5 top-4 z-50 flex items-center gap-1 rounded-2xl px-2 py-1.5">
      <span className="mr-2 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        {panelCount} panel{panelCount !== 1 ? "s" : ""}
      </span>
      <div className="h-4 w-px bg-line mx-1" />
      {onSpread && (
        <ToolBtn icon={<Layers size={14} />} label="Spread 5 pages together" onClick={onSpread} />
      )}
      <ToolBtn icon={<AlignHorizontalDistributeCenter size={14} />} label="Arrange" onClick={onArrange} />
      <ToolBtn icon={<RotateCcw size={14} />} label="Reset workspace" onClick={onReset} />
      <ToolBtn
        icon={focusMode ? <Minimize size={14} /> : <Maximize size={14} />}
        label={focusMode ? "Exit focus" : "Focus mode"}
        onClick={onToggleFocus}
      />
    </div>
  );
}

function ToolBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="group relative flex h-9 w-9 items-center justify-center rounded-xl text-ink-faint transition-all hover:bg-blush hover:text-rose"
    >
      {icon}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-ink shadow-panel opacity-0 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

function VoiceOrb() {
  const [state, setState] = useState<VoiceState>("idle");

  const cycle = () => {
    setState((s) => {
      if (s === "idle") return "listening";
      if (s === "listening") return "thinking";
      if (s === "thinking") return "speaking";
      return "idle";
    });
  };

  const label = {
    idle: "Ask Cognexa",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
  }[state];

  return (
    <div className="absolute bottom-5 right-5 z-50 flex flex-col items-center gap-2">
      {state === "listening" && (
        <div className="flex items-end gap-[3px] h-5">
          {[0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.8].map((h, i) => (
            <span
              key={i}
              className="voice-bar w-[3px] rounded-full bg-rose"
              style={{ height: `${h * 100}%`, ["--dur" as string]: `${0.5 + i * 0.12}s`, animationDelay: `${i * 0.07}s` } as React.CSSProperties}
            />
          ))}
        </div>
      )}
      <button
        id="voice-orb-btn"
        onClick={cycle}
        className={cn(
          "orb-core flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all duration-300",
          {
            "border-line bg-surface/80 text-ink-soft hover:border-rose hover:text-rose": state === "idle",
            "border-rose bg-rose/10 text-rose animate-breathe": state === "listening",
            "border-lavender bg-lavender-soft text-lavender animate-breathe": state === "thinking",
            "border-teal bg-teal-soft text-teal": state === "speaking",
          }
        )}
        title={label}
      >
        {state === "idle" && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
        {state === "listening" && <span className="h-3 w-3 rounded-full bg-rose animate-breathe" />}
        {state === "thinking" && <span className="h-3 w-3 rounded-full bg-lavender animate-breathe" />}
        {state === "speaking" && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>
      <span className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">{label}</span>
    </div>
  );
}

export interface CommandDockProps {
  placeholder?: string;
  suggestions?: string[];
  onCommand: (text: string) => void;
}

export function CommandDock({
  placeholder = "Type or say a command…",
  suggestions = [],
  onCommand,
}: CommandDockProps) {
  const [value, setValue] = useState("");

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onCommand(t);
    setValue("");
  };

  return (
    <div className="absolute bottom-4 left-1/2 z-50 w-[min(720px,calc(100%-8rem))] -translate-x-1/2">
      {suggestions.length > 0 && (
        <div className="mb-2 flex flex-wrap justify-center gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onCommand(s)}
              className="rounded-full border border-line bg-surface/80 px-3 py-1 text-[11px] text-ink-soft backdrop-blur-md transition-all hover:border-rose/50 hover:text-rose"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="hud-dock flex items-center gap-2 rounded-2xl px-3 py-2">
        <Sparkles size={14} className="flex-shrink-0 text-rose" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose text-white disabled:opacity-40"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

interface ResearchCanvasProps {
  children: ReactNode;
  hud?: ReactNode;
  panelCount?: number;
  onArrange?: () => void;
  onReset?: () => void;
  onSpread?: () => void;
  showGrid?: boolean;
  className?: string;
  command?: CommandDockProps;
  onViewScale?: (scale: number) => void;
}

export function ResearchCanvas({
  children,
  hud,
  panelCount = 0,
  onArrange,
  onReset,
  onSpread,
  showGrid = true,
  className,
  command,
  onViewScale,
}: ResearchCanvasProps) {
  const [focusMode, setFocusMode] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const panning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

  useEffect(() => {
    onViewScale?.(view.scale);
  }, [view.scale, onViewScale]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 40 && !e.metaKey) {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      return;
    }
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY > 0 ? 0.94 : 1.06;
    setView((v) => {
      const next = Math.min(1.6, Math.max(0.55, v.scale * factor));
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const wx = (cx - v.x) / v.scale;
      const wy = (cy - v.y) / v.scale;
      return { scale: next, x: cx - wx * next, y: cy - wy * next };
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".panel") || target.closest("button") || target.closest("input") || target.closest(".hud-dock")) {
      return;
    }
    panning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [view]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panning.current) return;
    setView((v) => ({
      ...v,
      x: panStart.current.vx + (e.clientX - panStart.current.x),
      y: panStart.current.vy + (e.clientY - panStart.current.y),
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    panning.current = false;
  }, []);

  return (
    <div
      ref={canvasRef}
      className={cn("relative h-full w-full overflow-hidden bg-canvas", showGrid && "canvas-grid", className)}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="aurora aurora-a" aria-hidden />
      <div className="aurora aurora-b" aria-hidden />
      <div className="canvas-grain" aria-hidden />

      <div
        className="canvas-world absolute left-0 top-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>

      {hud && <div className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto">{hud}</div>}

      {!focusMode && (
        <CanvasToolbar
          panelCount={panelCount}
          onArrange={() => onArrange?.()}
          onReset={() => onReset?.()}
          onSpread={onSpread}
          onToggleFocus={() => setFocusMode(true)}
          focusMode={focusMode}
        />
      )}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          className="hud-dock absolute bottom-5 left-5 z-50 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-ink-soft"
        >
          <Eye size={13} /> Exit focus
        </button>
      )}

      {!focusMode && command && <CommandDock {...command} />}
      <VoiceOrb />
    </div>
  );
}
