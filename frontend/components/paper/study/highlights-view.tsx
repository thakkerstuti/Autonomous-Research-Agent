"use client";

import { useStudyOutputQuery } from "@/lib/queries";
import { groupByCategory, HIGHLIGHT_CATEGORIES } from "@/lib/study-logic";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";
import { EmptyOutput, KitGate, PageRefs, SectionShell } from "./study-shared";

interface HighlightItem {
  id: string;
  category: string;
  text: string;
  why: string;
  pages: number[];
}

const NUMERIC = new Set(["statistic", "formula"]);

function HighlightsBody({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const q = useStudyOutputQuery<{ highlights: HighlightItem[] }>(paperId, "highlights", version, true);
  if (!q.data?.content) {
    return (
      <div className="flex items-center gap-3 px-6 py-16 text-[14px] text-ink-soft" role="status">
        <ThinkingMark active size={18} /> Loading highlights…
      </div>
    );
  }
  const groups = groupByCategory(q.data.content.highlights, HIGHLIGHT_CATEGORIES);
  if (!groups.length) return <SectionShell><EmptyOutput text="No highlights could be drawn from this paper." /></SectionShell>;

  return (
    <SectionShell>
      <div className="grid gap-10">
        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`hl-${g.key}`}>
            <h2 id={`hl-${g.key}`} className="col-label mb-3">{g.label}</h2>
            <ul className="grid gap-2.5">
              {g.items.map((h) => (
                <li key={h.id} className="relative rounded-2xl bg-surface py-4 pl-6 pr-5 shadow-sm">
                  <span aria-hidden className="absolute bottom-4 left-0 top-4 w-[3px] rounded-r-full bg-accent/70" />
                  <p className={cn("leading-relaxed text-ink", NUMERIC.has(h.category) ? "font-mono text-[14.5px]" : "text-[15px] font-medium")}>{h.text}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    {h.why && <p className="text-[13px] leading-relaxed text-ink-soft">{h.why}</p>}
                    <PageRefs pages={h.pages} onOpenPage={onOpenPage} className="ml-auto" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </SectionShell>
  );
}

export function HighlightsView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <KitGate paperId={paperId} kind="highlights" title="Highlights">
      {({ version }) => <HighlightsBody paperId={paperId} version={version} onOpenPage={onOpenPage} />}
    </KitGate>
  );
}
