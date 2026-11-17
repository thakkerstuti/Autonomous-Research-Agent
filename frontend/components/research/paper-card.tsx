"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Download, FileText, Loader2, RotateCcw } from "lucide-react";
import { DocumentSummary, downloadPaperPdf, getDocument, getRun, requestPaper } from "@/lib/research-runs";
import { cn } from "@/lib/utils";

/** The research paper that belongs to one research turn: shown in the chat as a card, opened as a document. */

function wordCount(text: string) {
  return (text.match(/\S+/g) || []).length;
}

export function PaperCard({ sessionId, initial }: { sessionId: string; initial: DocumentSummary | null }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [override, setOverride] = useState<DocumentSummary | null>(null); // after "write again"
  const base = override ?? initial;

  // While the paper is being written, follow it through the run
  const run = useQuery({
    queryKey: ["research-run", sessionId],
    queryFn: () => getRun(sessionId),
    enabled: base?.status === "generating",
    refetchInterval: (q) => (!q.state.data || q.state.data.document?.status === "generating" ? 3000 : false),
  });
  const doc = base?.status === "generating" && run.data?.document ? run.data.document : base;

  const detail = useQuery({
    queryKey: ["research-doc", doc?.id, doc?.current_version],
    queryFn: () => getDocument(doc!.id),
    enabled: doc?.status === "ready",
    staleTime: 60_000,
  });

  async function retry() {
    setError(null);
    try {
      qc.removeQueries({ queryKey: ["research-run", sessionId] });
      setOverride(await requestPaper(sessionId));
    } catch (e: any) {
      setError(e?.message || "Couldn't start writing the paper.");
    }
  }

  async function download() {
    if (!doc) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadPaperPdf(doc.id);
    } catch (e: any) {
      setError(e?.message || "Couldn't make the PDF.");
    } finally {
      setDownloading(false);
    }
  }

  if (!doc) return null;

  if (doc.status === "generating") {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-surface px-5 py-4 shadow-sm">
        <Loader2 size={16} className="animate-spin text-accent" />
        <span className="text-[14px] text-ink-soft">Writing the research paper… it opens here when it&apos;s ready.</span>
      </div>
    );
  }

  if (doc.status === "failed") {
    return (
      <div className="rounded-2xl bg-surface px-5 py-4 shadow-sm">
        <p className="flex items-start gap-2 text-[14px] text-ink">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-warn" />
          {doc.error || "The research paper couldn't be written."}
        </p>
        <p className="mt-1 pl-[23px] text-[13px] text-ink-soft">The research and its sources are saved; only the paper is missing.</p>
        <button onClick={retry} className="pressable ml-[23px] mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:border-line-hover">
          <RotateCcw size={13} /> Write the paper again
        </button>
        {error && <p className="mt-2 pl-[23px] text-[13px] text-bad">{error}</p>}
      </div>
    );
  }

  const content = detail.data?.content;
  const words = content ? wordCount([content.abstract, ...content.sections.map((s) => s.body)].join(" ")) : null;
  const sections = content?.sections.filter((s) => s.level === 1).length ?? null;

  return (
    <div className="group overflow-hidden rounded-2xl bg-surface shadow-sm transition-shadow duration-200 hover:shadow-panel">
      <div className="flex gap-4 px-5 pb-4 pt-5 sm:px-6">
        <div aria-hidden className="hidden h-[76px] w-[58px] flex-shrink-0 flex-col gap-[5px] rounded-[6px] border border-line bg-bg p-2 sm:flex">
          <span className="h-[3px] w-3/4 rounded bg-ink/40" />
          <span className="h-[2px] w-full rounded bg-ink/15" />
          <span className="h-[2px] w-full rounded bg-ink/15" />
          <span className="h-[2px] w-5/6 rounded bg-ink/15" />
          <span className="mt-1 h-[2px] w-full rounded bg-ink/15" />
          <span className="h-[2px] w-2/3 rounded bg-ink/15" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-faint">
            <span className="inline-flex items-center gap-1.5 font-medium text-accent"><FileText size={13} /> Research paper</span>
            {doc.edited && <span>· Edited</span>}
            {doc.current_version > 1 && <span className="mono">· v{doc.current_version}</span>}
          </div>
          <h3 className="mt-1.5 font-serif text-[20px] font-medium leading-snug text-ink">{doc.title || "Research paper"}</h3>
          {content?.abstract ? (
            <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-ink-soft">{content.abstract}</p>
          ) : (
            <div className="mt-3 space-y-2" aria-hidden>
              <div className="h-3 w-full animate-pulse rounded bg-ink/[0.06]" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-ink/[0.06]" />
            </div>
          )}
          {content && (
            <p className="mono mt-3 text-[11.5px] text-ink-faint">
              {sections} sections · {words?.toLocaleString()} words · {content.references.length} references
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 sm:px-6">
        <Link
          href={`/research/paper/${doc.id}`}
          className="pressable inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-3.5 text-[13px] font-medium text-on-primary"
        >
          Open &amp; edit <ArrowRight size={14} />
        </Link>
        <button
          onClick={download}
          disabled={downloading}
          className={cn("pressable inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink disabled:opacity-50")}
        >
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download PDF
        </button>
        {error && <span className="text-[13px] text-bad">{error}</span>}
      </div>
    </div>
  );
}
