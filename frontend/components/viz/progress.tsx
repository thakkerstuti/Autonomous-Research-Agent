"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Ring that draws from zero to its value once, on mount. */
export function ProgressRing({
  value,
  size = 44,
  stroke = 3,
  className,
  children,
  tone = "accent",
}: {
  value: number; // 0–1
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  tone?: "accent" | "ok" | "warn";
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(Math.max(0, Math.min(1, value))));
    return () => cancelAnimationFrame(id);
  }, [value]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === "ok" ? "rgb(var(--ok))" : tone === "warn" ? "rgb(var(--warn))" : "rgb(var(--accent))";

  return (
    <div className={cn("relative flex-shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--ink) / 0.09)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{ transition: "stroke-dashoffset 1100ms cubic-bezier(0.23, 1, 0.32, 1)" }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

const PAGE_TONE: Record<string, string> = {
  ready: "bg-accent",
  processing: "bg-accent/45 animate-pulse",
  pending: "bg-ink/10",
  failed: "bg-bad",
  no_text: "bg-ink/20",
};

/** One hairline segment per page — the paper's reading map. */
export function PageStrip({ pages, className }: { pages: { page_number: number; status: string }[]; className?: string }) {
  if (!pages.length) return null;
  return (
    <div
      className={cn("flex h-2.5 w-full items-stretch gap-[2px]", className)}
      role="img"
      aria-label={`${pages.filter((p) => p.status === "ready").length} of ${pages.length} pages summarised`}
    >
      {pages.map((p) => (
        <span
          key={p.page_number}
          title={`Page ${p.page_number}: ${p.status}`}
          className={cn("min-w-[2px] flex-1 rounded-[1px]", PAGE_TONE[p.status] ?? "bg-ink/10")}
        />
      ))}
    </div>
  );
}

/** Proportion of supporting, refuting and contextual evidence. */
export function StanceBar({
  supports,
  refutes,
  neutral,
  className,
}: {
  supports: number;
  refutes: number;
  neutral: number;
  className?: string;
}) {
  const total = supports + refutes + neutral;
  if (!total) return <div className={cn("h-1.5 rounded-full bg-ink/[0.07]", className)} />;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className={cn("fill-grow flex h-1.5 overflow-hidden rounded-full bg-ink/[0.07]", className)}>
      <span className="bg-ok" style={{ width: seg(supports) }} />
      <span className="bg-bad" style={{ width: seg(refutes) }} />
      <span className="bg-ink-faint/40" style={{ width: seg(neutral) }} />
    </div>
  );
}
