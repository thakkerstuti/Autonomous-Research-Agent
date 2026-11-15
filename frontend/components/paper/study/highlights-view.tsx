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
    <div className="grid gap-14">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`in-${g.key}`}>
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
            <h2 id={`in-${g.key}`} className="t-heading">{g.label}</h2>
            <span className="t-meta">{g.items.length}</span>
          </div>
          <ul className="insight-cols">
            {g.items.map((h) => (
              <li key={h.id} className="group border-b border-line py-5">
                {/* Clicking an insight takes the reader to its source page */}
                <button
                  type="button"
                  onClick={() => h.pages[0] && onOpenPage(h.pages[0])}
                  disabled={!h.pages.length}
                  className="block w-full text-left disabled:cursor-default"
                  title={h.pages.length ? `Open page ${h.pages[0]}` : undefined}
                >
                  <span
                    className={cn(
                      "block text-ink transition-colors group-hover:text-accent",
                      NUMERIC.has(h.category) ? "font-display text-[19px] leading-[1.45] [font-variant-numeric:lining-nums]" : "text-[15.5px] font-medium leading-[1.55]"
                    )}
                  >
                    {h.text}
                  </span>
                  {h.why && <span className="t-body-sm mt-1.5 block max-w-[62ch]">{h.why}</span>}
                </button>
                <PageRefs pages={h.pages} onOpenPage={onOpenPage} className="-ml-1 mt-2" />
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
    <SectionShell title="Key insights" meta="Findings, numbers, arguments and limitations worth remembering, each linked to the page it comes from.">
      <KitGate paperId={paperId} kind="highlights" title="Key insights">
        {({ version }) => <Insights paperId={paperId} version={version} onOpenPage={onOpenPage} />}
      </KitGate>
    </SectionShell>
  );
}
