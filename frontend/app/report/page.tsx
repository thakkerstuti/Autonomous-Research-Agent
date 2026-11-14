"use client";

import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { useReportQuery } from "@/lib/queries";
import { EvidenceChart } from "@/components/chat/evidence-chart";
import { cn } from "@/lib/utils";
import { STATUS_TONE } from "@/lib/research-view";

export default function ReportPage() {
  const { data: report, isLoading } = useReportQuery();

  if (!isLoading && !report) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[560px] flex-col justify-center px-5 py-14 sm:px-10">
          <h1 className="font-serif text-display font-normal text-ink">No report yet</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
            Run a research question with the Full report depth and your latest report will appear here, with findings, confidence and citations.
          </p>
          <Link
            href="/research"
            className="pressable mt-8 inline-flex h-10 w-fit items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-medium text-on-primary"
          >
            Start research <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !report) {
    return (
      <div className="mx-auto max-w-[760px] px-5 pt-14 sm:px-10">
        <div className="h-3 w-40 animate-pulse rounded bg-surface3" />
        <div className="mt-5 h-9 w-4/5 animate-pulse rounded-lg bg-surface3" />
        <div className="mt-3 h-9 w-3/5 animate-pulse rounded-lg bg-surface3" />
        <div className="mt-8 space-y-2.5">
          <div className="h-3.5 animate-pulse rounded bg-surface3" />
          <div className="h-3.5 animate-pulse rounded bg-surface3" />
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface3" />
        </div>
      </div>
    );
  }

  const citationIndex = (id: string) => report.citations.findIndex((c) => c.id === id) + 1;

  return (
    <div className="h-full overflow-y-auto">
      <article className="mx-auto max-w-[760px] px-5 pb-20 pt-10 sm:px-10 sm:pt-14">
        <header className="animate-view-in">
          <p className="text-[13px] text-ink-faint">Research report · updated {report.updated}</p>
          <h1 className="mt-4 font-serif text-display font-normal text-ink">
            {report.question}
          </h1>
          <p className="report-prose mt-7 !text-[19px]">{report.summary}</p>
        </header>

        <section className="animate-view-in mt-14" style={{ animationDelay: "70ms" }}>
          <h2 className="font-serif text-title-sm font-normal text-ink">Findings</h2>
          <ol className="mt-4 border-t border-line">
            {report.findings.map((f, i) => (
              <li key={f.id} className="grid grid-cols-[28px_1fr] gap-x-3 border-b border-line py-5 sm:grid-cols-[28px_1fr_auto] sm:gap-x-6">
                <span className="mono pt-0.5 text-[13px] text-ink-faint">{i + 1}</span>
                <div className="min-w-0">
                  {(() => {
                    const m = f.text.match(/^\[([A-Z_]+)\]\s*(.*)$/);
                    const tone = m ? STATUS_TONE[m[1].toLowerCase()] : undefined;
                    return (
                      <>
                        {tone && (
                          <span className={cn("mb-1.5 flex items-center gap-1.5 text-[12px] font-medium", tone.cls)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} /> {tone.label}
                          </span>
                        )}
                        <p className="font-serif text-[18px] leading-[1.55] text-ink">{m ? m[2] : f.text}</p>
                      </>
                    );
                  })()}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {f.citationIds.map((cid) => (
                      <a
                        key={cid}
                        href={`#${cid}`}
                        className="mono rounded-md bg-surface3/70 px-1.5 py-0.5 text-[11.5px] text-ink-soft transition-colors hover:bg-accent-soft hover:text-accent"
                      >
                        [{citationIndex(cid)}]
                      </a>
                    ))}
                  </div>
                </div>
                <div className="col-start-2 mt-3 sm:col-start-3 sm:mt-0 sm:text-right">
                  <div className="figure text-[26px] text-ink">{f.confidence}%</div>
                  <div className="mt-1 text-[11.5px] text-ink-faint">confidence</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="animate-view-in mt-14 rounded-2xl bg-surface p-6 shadow-sm" style={{ animationDelay: "120ms" }}>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Evidence strength by source</h2>
          <p className="mb-5 mt-1 text-[13px] text-ink-soft">How much each source supports the findings above.</p>
          <EvidenceChart sources={report.sources} />
        </section>

        <section className="mt-14">
          <h2 className="font-serif text-title-sm font-normal text-ink">Citations</h2>
          <ol className="mt-4 border-t border-line">
            {report.citations.map((c, i) => (
              <li key={c.id} id={c.id} className="grid scroll-mt-8 grid-cols-[28px_1fr] gap-3 border-b border-line py-4 target:bg-accent-soft">
                <span className="mono pt-0.5 text-[13px] text-ink-faint">{i + 1}</span>
                <div className="min-w-0">
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-start gap-1 text-[14.5px] font-medium text-ink hover:text-accent"
                    >
                      {c.title}
                      <ArrowUpRight size={14} className="mt-0.5 flex-shrink-0 text-ink-faint transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
                    </a>
                  ) : (
                    <div className="text-[14.5px] font-medium text-ink">{c.title}</div>
                  )}
                  <p className="mt-0.5 text-[13px] text-ink-faint">
                    {c.domain} · {c.note}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </article>
    </div>
  );
}
