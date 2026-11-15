"use client";

import { useStudyOutputQuery } from "@/lib/queries";
import { groupByCategory, HIGHLIGHT_CATEGORIES } from "@/lib/study-logic";
import { cn } from "@/lib/utils";
import { EmptyOutput, KitGate, PageRefs, SectionShell, TextSkeleton } from "./study-shared";

interface Insight {
  id: string;
  category: string;
  text: string;
  why: string;
  pages: number[];
}

const NUMERIC = new Set(["statistic", "formula"]);

function Insights({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const q = useStudyOutputQuery<{ highlights: Insight[] }>(paperId, "highlights", version, true);
  if (!q.data?.content) return <TextSkeleton />;
  const groups = groupByCategory(q.data.content.highlights, HIGHLIGHT_CATEGORIES);
  if (!groups.length) return <EmptyOutput text="No insights could be drawn from this paper." />;

  return (
    <div className="animate-view-in mt-8 grid gap-10">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`in-${g.key}`}>
          <h2 id={`in-${g.key}`} className="col-label">{g.label}</h2>
          <ul className="mt-2 border-t border-line">
            {g.items.map((h) => (
              <li key={h.id} className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-line py-3.5">
                {/* Clicking an insight takes the reader to its source page */}
                <button
                  type="button"
                  onClick={() => h.pages[0] && onOpenPage(h.pages[0])}
                  disabled={!h.pages.length}
                  className="text-left disabled:cursor-default"
                  title={h.pages.length ? `Open page ${h.pages[0]}` : undefined}
                >
                  <span className={cn("block leading-relaxed text-ink group-hover:text-accent", NUMERIC.has(h.category) ? "font-mono text-[14px]" : "text-[15px]")}>{h.text}</span>
                  {h.why && <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">{h.why}</span>}
                </button>
                <PageRefs pages={h.pages} onOpenPage={onOpenPage} className="self-start" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function InsightsView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <SectionShell title="Key insights" meta="Findings, numbers, arguments and conclusions worth remembering, each with its source page.">
      <KitGate paperId={paperId} kind="highlights" title="Key insights">
        {({ version }) => <Insights paperId={paperId} version={version} onOpenPage={onOpenPage} />}
      </KitGate>
    </SectionShell>
  );
}
