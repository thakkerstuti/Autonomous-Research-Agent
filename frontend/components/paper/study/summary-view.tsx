"use client";

import ReactMarkdown from "react-markdown";
import { useStudyOutputQuery } from "@/lib/queries";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { KitGate, PageRefs, SectionShell } from "./study-shared";

interface SummaryContent {
  overview: string;
  sections: { key: string; title: string; specified: boolean; body: string; pages: number[] }[];
}

function SummaryBody({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const q = useStudyOutputQuery<SummaryContent>(paperId, "summary", version, true);
  const content = q.data?.content;
  if (!content) {
    return (
      <div className="flex items-center gap-3 px-6 py-16 text-[14px] text-ink-soft" role="status">
        <ThinkingMark active size={18} /> Loading the summary…
      </div>
    );
  }
  const covered = content.sections.filter((s) => s.specified);
  const missing = content.sections.filter((s) => !s.specified);

  return (
    <SectionShell>
      <section className="animate-view-in rounded-[20px] bg-surface p-6 shadow-sm sm:p-7">
        <div className="col-label">In short</div>
        <p className="mt-3 font-serif text-[18px] leading-[1.65] text-ink">{content.overview}</p>
      </section>

      <div className="mt-10 grid gap-10">
        {covered.map((s) => (
          <section key={s.key} aria-labelledby={`sum-${s.key}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
              <h2 id={`sum-${s.key}`} className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">{s.title}</h2>
              <PageRefs pages={s.pages} onOpenPage={onOpenPage} />
            </div>
            <div className="report-prose chat-prose mt-2.5">
              <ReactMarkdown>{s.body}</ReactMarkdown>
            </div>
          </section>
        ))}
      </div>

      {missing.length > 0 && (
        <section className="mt-12 rounded-2xl border border-line p-5">
          <div className="col-label">Not specified in the paper</div>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            The paper doesn&rsquo;t cover: {missing.map((s) => s.title.toLowerCase()).join(", ")}.
          </p>
        </section>
      )}
    </SectionShell>
  );
}

export function SummaryView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <KitGate paperId={paperId} kind="summary" title="Summary">
      {({ version }) => <SummaryBody paperId={paperId} version={version} onOpenPage={onOpenPage} />}
    </KitGate>
  );
}
