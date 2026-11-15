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

/** While the overview is written: the same two columns, drawn as quiet lines. */
function OverviewPlaceholder({ still }: { still: boolean }) {
  return (
    <div className="split-aside" aria-hidden>
      <div>
        <TextSkeleton lines={4} still={still} />
        <div className="mt-12 h-3 w-40 rounded-full bg-ink/[0.06]" />
        <TextSkeleton lines={5} still={still} />
      </div>
      <div className="split-side"><TextSkeleton lines={6} still={still} /></div>
    </div>
  );
}

function OverviewBody({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const q = useStudyOutputQuery<SummaryContent>(paperId, "summary", version, true);
  const c = q.data?.content;
  if (!c) return <OverviewPlaceholder still={false} />;
  const covered = c.sections.filter((s) => s.specified);
  const missing = c.sections.filter((s) => !s.specified);
  const pages = importantPages(c);
  const hasAside = !!(c.key_numbers?.length || c.key_concepts?.length || pages.length);

  return (
    <div className={hasAside ? "split-aside" : ""}>
      <div className="min-w-0">
        <section aria-labelledby="ov-summary">
          <h2 id="ov-summary" className="sr-only">Summary</h2>
          <p className="t-lead max-w-[64ch]">{c.overview}</p>
        </section>

        {!!c.key_findings?.length && (
          <section className="mt-14" aria-labelledby="ov-findings">
            <h2 id="ov-findings" className="t-heading">Main findings</h2>
            <ol className="mt-4 border-t border-line">
              {c.key_findings.map((f, i) => (
                <li key={i} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 border-b border-line py-4 sm:grid-cols-[32px_minmax(0,1fr)_auto]">
                  <span className="font-display text-[17px] italic leading-[1.5] text-accent">{i + 1}</span>
                  <span className="t-body max-w-[66ch]">{f.text}</span>
                  <PageRefs pages={f.pages} onOpenPage={onOpenPage} className="col-start-2 mt-1 sm:col-start-3 sm:mt-0 sm:self-start sm:pt-0.5" />
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mt-14" aria-labelledby="ov-full">
          <h2 id="ov-full" className="t-heading">The paper, section by section</h2>
          <div className="mt-4 border-t border-line">
            {covered.map((s) => (
              <details key={s.key} className="group border-b border-line">
                <summary className="flex cursor-pointer list-none items-center gap-3 py-4 marker:hidden">
                  <ChevronRight size={15} className="flex-shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-90" />
                  <span className="flex-1 text-[15px] font-medium text-ink transition-colors group-hover:text-accent">{s.title}</span>
                  <PageRefs pages={s.pages} onOpenPage={onOpenPage} />
                </summary>
                <div className="report-prose pb-6 pl-7 !text-[17px]">
                  <ReactMarkdown>{s.body}</ReactMarkdown>
                </div>
              </details>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="t-body-sm mt-4 max-w-[66ch] text-ink-faint">
              Not specified in the paper: {missing.map((s) => s.title.toLowerCase()).join(", ")}.
            </p>
          )}
        </section>
      </div>

      {hasAside && (
        <aside className="split-side min-w-0" aria-label="At a glance">
          {!!c.key_numbers?.length && (
            <section aria-labelledby="ov-numbers">
              <h2 id="ov-numbers" className="t-heading-sm">Key numbers</h2>
              <ul className="mt-3">
                {c.key_numbers.map((n, i) => (
                  <li key={i} className="border-t border-line py-3">
                    <p className="text-[14.5px] font-medium leading-[1.55] text-ink">{n.text}</p>
                    <PageRefs pages={n.pages} onOpenPage={onOpenPage} className="-ml-1 mt-1" />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!c.key_concepts?.length && (
            <section className={c.key_numbers?.length ? "mt-10" : ""} aria-labelledby="ov-concepts">
              <h2 id="ov-concepts" className="t-heading-sm">Important concepts</h2>
              <dl className="mt-3">
                {c.key_concepts.map((k) => (
                  <div key={k.name} className="border-t border-line py-3">
                    <dt className="flex items-baseline justify-between gap-3">
                      <span className="t-subheading">{k.name}</span>
                      <PageRefs pages={k.pages} onOpenPage={onOpenPage} className="flex-shrink-0" />
                    </dt>
                    <dd className="t-body-sm mt-1">{k.definition}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {pages.length > 0 && (
            <section className="mt-10" aria-labelledby="ov-pages">
              <h2 id="ov-pages" className="t-heading-sm">Where to read</h2>
              <p className="t-body-sm mt-1.5">The pages this overview draws on most.</p>
              <PageRefs pages={pages} onOpenPage={onOpenPage} className="-ml-1 mt-2.5" />
            </section>
          )}
        </aside>
      )}
    </div>
  );
}

export function OverviewView({ paperId, onOpenPage }: { paperId: string; title?: string; onOpenPage: (p: number) => void }) {
  return (
    <SectionShell title="Overview" meta="What the paper sets out to do, what it found, and where in the paper each point comes from.">
      <KitGate paperId={paperId} kind="summary" title="Overview" placeholder={(still) => (still ? null : <OverviewPlaceholder still={false} />)}>
        {({ version }) => <OverviewBody paperId={paperId} version={version} onOpenPage={onOpenPage} />}
      </KitGate>
    </SectionShell>
  );
}
