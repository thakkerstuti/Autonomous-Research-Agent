"use client";

import { EvidenceSource } from "@/lib/types";

/** Confidence per source as quiet horizontal meters: one hue, value carried by length. */
export function EvidenceChart({ sources }: { sources: EvidenceSource[] }) {
  const sorted = [...sources].sort((a, b) => b.confidence - a.confidence);

  return (
    <ul className="flex flex-col gap-2.5">
      {sorted.map((s, i) => (
        <li key={`${s.domain}-${i}`} className="grid grid-cols-[minmax(0,140px)_1fr_40px] items-center gap-3">
          <span className="truncate text-[12.5px] text-ink-soft" title={s.name || s.domain}>
            {s.domain}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface3">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.max(2, Math.min(100, s.confidence))}%`, opacity: 0.45 + (s.confidence / 100) * 0.55 }}
            />
          </span>
          <span className="mono text-right text-[12px] text-ink">{Math.round(s.confidence)}%</span>
        </li>
      ))}
    </ul>
  );
}
