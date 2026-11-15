"use client";

import ReactMarkdown from "react-markdown";
import { ChevronRight } from "lucide-react";
import { useStudyOutputQuery } from "@/lib/queries";
import { KitGate, PageRefs, SectionShell, TextSkeleton } from "./study-shared";

interface Point { text: string; pages: number[] }
interface SummaryContent {
  overview: string;
  key_findings?: Point[];
  key_concepts?: { name: string; definition: string; pages: number[] }[];
  key_numbers?: Point[];
  sections: { key: string; title: string; specified: boolean; body: string; pages: number[] }[];
}

/** Pages the summary leans on most, as a quick way into the paper. */
function importantPages(c: SummaryContent): number[] {
  const count = new Map<number, number>();
  const add = (pages: number[], weight: number) => pages.forEach((p) => count.set(p, (count.get(p) ?? 0) + weight));
  c.key_findings?.forEach((f) => add(f.pages, 3));
  c.key_numbers?.forEach((f) => add(f.pages, 2));
  c.key_concepts?.forEach((f) => add(f.pages, 1));
  c.sections.forEach((s) => add(s.pages, 1));
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8).map(([p]) => p).sort((a, b) => a - b);
}

function OverviewBody({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const q = useStudyOutputQuery<SummaryContent>(paperId, "summary", version, true);
  const c = q.data?.content;
  if (!c) return <TextSkeleton />;
  const covered = c.sections.filter((s) => s.specified);
  const missing = c.sections.filter((s) => !s.specified);
  const pages = importantPages(c);

  return (
    <div className="animate-view-in">
      <p className="mt-7 font-serif text-[19px] leading-[1.7] text-ink">{c.overview}</p>

      {!!c.key_findings?.length && (
        <section className="mt-10" aria-labelledby="ov-findings">
          <h2 id="ov-findings" className="col-label">Main findings</h2>
          <ol className="mt-3 divide-y divide-line border-y border-line">
            {c.key_findings.map((f, i) => (
              <li key={i} className="flex gap-4 py-3">
                <span className="mono w-5 flex-shrink-0 pt-0.5 text-[12px] text-ink-faint">{i + 1}</span>
                <span className="flex-1 text-[15px] leading-relaxed text-ink">{f.text}</span>
                <PageRefs pages={f.pages} onOpenPage={onOpenPage} className="flex-shrink-0 self-start" />
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {!!c.key_concepts?.length && (
          <section aria-labelledby="ov-concepts">
            <h2 id="ov-concepts" className="col-label">Important concepts</h2>
            <dl className="mt-3 grid gap-4">
              {c.key_concepts.map((k) => (
                <div key={k.name}>
                  <dt className="flex items-baseline justify-between gap-3 text-[14.5px] font-semibold text-ink">
                    {k.name}
                    <PageRefs pages={k.pages} onOpenPage={onOpenPage} />
                  </dt>
                  <dd className="mt-0.5 text-[14px] leading-relaxed text-ink-soft">{k.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        <div className="grid content-start gap-10">
          {!!c.key_numbers?.length && (
            <section aria-labelledby="ov-numbers">
              <h2 id="ov-numbers" className="col-label">Key numbers</h2>
              <ul className="mt-3 grid gap-2.5">
                {c.key_numbers.map((n, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 border-l-2 border-accent/50 pl-3 text-[14px] leading-relaxed text-ink">
                    <span>{n.text}</span>
                    <PageRefs pages={n.pages} onOpenPage={onOpenPage} className="flex-shrink-0" />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pages.length > 0 && (
            <section aria-labelledby="ov-pages">
              <h2 id="ov-pages" className="col-label">Important pages</h2>
              <PageRefs pages={pages} onOpenPage={onOpenPage} className="mt-2.5" />
            </section>
          )}
        </div>
      </div>

      <section className="mt-12" aria-labelledby="ov-full">
        <h2 id="ov-full" className="col-label">Full summary</h2>
        <div className="mt-3 border-t border-line">
          {covered.map((s) => (
            <details key={s.key} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center gap-3 py-3.5 text-[15px] font-medium text-ink marker:hidden hover:text-accent">
                <ChevronRight size={15} className="flex-shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-90" />
                <span className="flex-1">{s.title}</span>
                <PageRefs pages={s.pages} onOpenPage={onOpenPage} />
              </summary>
              <div className="report-prose chat-prose pb-5 pl-7">
                <ReactMarkdown>{s.body}</ReactMarkdown>
              </div>
            </details>
          ))}
        </div>
        {missing.length > 0 && (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-faint">
            Not specified in the paper: {missing.map((s) => s.title.toLowerCase()).join(", ")}.
          </p>
        )}
      </section>
    </div>
  );
}

export function OverviewView({ paperId, title, onOpenPage }: { paperId: string; title: string; onOpenPage: (p: number) => void }) {
  return (
    <SectionShell title={title} meta="Overview">
      <KitGate paperId={paperId} kind="summary" title="Summary">
        {({ version }) => <OverviewBody paperId={paperId} version={version} onOpenPage={onOpenPage} />}
      </KitGate>
    </SectionShell>
  );
}
