"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight, FileText, Download, Loader2 } from "lucide-react";
import { usePapersQuery, useThreadsQuery } from "@/lib/queries";
import { MODE_LABEL, ThreadSummary, downloadPaperPdf } from "@/lib/research-runs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The archive of everything the user has worked on. Research conversations
 * own their answers and any research paper written from them; Paper Study
 * documents are listed alongside.
 */

type Filter = "all" | "research" | "papers" | "study";

interface Row {
  key: string;
  kind: "research" | "study";
  title: string;
  at: number; // last activity, ms
  thread?: ThreadSummary;
  studyHref?: string;
  studyStatus?: string;
}

const STATUS: Record<string, { label: string; variant: "default" | "review" | "bad" }> = {
  in_progress: { label: "In progress", variant: "default" },
  review: { label: "Needs review", variant: "review" },
  partial: { label: "Partly complete", variant: "review" },
  failed: { label: "Didn't finish", variant: "bad" },
};

function toTime(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`); // the server stores UTC without a zone
}

function monthKey(t: number) {
  if (Number.isNaN(t)) return { key: "earlier", label: "Earlier", day: "" };
  const d = new Date(t);
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    day: d.toLocaleDateString(undefined, { day: "numeric" }),
  };
}

function when(t: number) {
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function PaperDownload({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(false);
        try { await downloadPaperPdf(id); } catch { setFailed(true); } finally { setBusy(false); }
      }}
      disabled={busy}
      aria-label="Download the latest saved PDF"
      title={failed ? "Couldn't make the PDF. Try again." : "Download the latest saved PDF"}
      className={cn("pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium hover:bg-surface3 disabled:opacity-50", failed ? "text-bad" : "text-ink-soft hover:text-ink")}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
    </button>
  );
}

function ResearchMeta({ t }: { t: ThreadSummary }) {
  const status = STATUS[t.status];
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span>{(t.modes?.length ? t.modes : [t.output_format]).map((m) => MODE_LABEL[m] ?? m).join(" · ")}</span>
      {t.turns > 1 && <span>· {t.turns} runs</span>}
      {t.has_paper && (
        <span className="inline-flex items-center gap-1 text-ink-soft">
          · <FileText size={12} /> Paper{t.paper_edited ? " · edited" : ""}
          {t.paper_saved_at && t.paper_edited && <span className="text-ink-faint">, saved {when(toTime(t.paper_saved_at))}</span>}
        </span>
      )}
      {t.paper_status === "generating" && <span>· Writing paper…</span>}
      {t.paper_status === "failed" && <span>· Paper not written</span>}
      {status && <Badge variant={status.variant}>{status.label}</Badge>}
    </span>
  );
}

export default function HistoryPage() {
  const { data: threads, isLoading: tLoading } = useThreadsQuery();
  const { data: papers, isLoading: pLoading } = usePapersQuery();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows: Row[] = useMemo(() => {
    const out: Row[] = (threads ?? []).map((t) => ({
      key: `t-${t.thread_id}`, kind: "research", title: t.title, at: toTime(t.updated_at), thread: t,
    }));
    for (const p of papers ?? []) {
      out.push({
        key: `p-${p.id}`, kind: "study", title: p.title, at: Date.parse(p.uploaded),
        studyHref: `/paper-study?paperId=${p.id}`, studyStatus: p.status,
      });
    }
    return out.sort((a, b) => (Number.isNaN(b.at) ? -1 : b.at) - (Number.isNaN(a.at) ? -1 : a.at));
  }, [threads, papers]);

  const visible = rows.filter((r) => {
    if (filter === "research" && r.kind !== "research") return false;
    if (filter === "papers" && !r.thread?.has_paper) return false;
    if (filter === "study" && r.kind !== "study") return false;
    return r.title.toLowerCase().includes(query.toLowerCase());
  });

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: (Row & { day: string })[] }[] = [];
    visible.forEach((r) => {
      const m = monthKey(r.at);
      let g = out.find((x) => x.key === m.key);
      if (!g) { g = { key: m.key, label: m.label, items: [] }; out.push(g); }
      g.items.push({ ...r, day: m.day });
    });
    return out;
  }, [visible]);

  const isLoading = tLoading || pLoading;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-5 pb-20 pt-10 sm:px-10 sm:pt-14">
        <PageHeader
          className="animate-view-in"
          title="History"
          description="Every investigation, the research papers written from them, and your paper studies."
        />

        <div className="animate-view-in sticky top-0 z-20 -mx-5 mt-10 flex flex-wrap items-center justify-between gap-3 bg-bg/90 px-5 py-3 backdrop-blur-md sm:-mx-10 sm:px-10" style={{ animationDelay: "70ms" }}>
          <Tabs value={filter} onValueChange={(v: string) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="research">Research</TabsTrigger>
              <TabsTrigger value="papers">Research papers</TabsTrigger>
              <TabsTrigger value="study">Paper study</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by question or title" aria-label="Search history" className="pl-10" />
          </div>
        </div>

        <div className="animate-view-in mt-6" style={{ animationDelay: "120ms" }}>
          {isLoading &&
            [0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[120px_1fr] gap-6 border-t border-line py-6">
                <div className="h-4 w-20 animate-pulse rounded bg-ink/[0.06]" />
                <div className="h-5 w-3/4 animate-pulse rounded bg-ink/[0.06]" />
              </div>
            ))}

          {!isLoading && groups.map((g) => (
            <section key={g.key} className="grid gap-x-10 border-t border-line pt-6 md:grid-cols-[180px_1fr]">
              <div className="mb-3 md:sticky md:top-20 md:mb-0 md:self-start">
                <h2 className="font-display text-title-sm font-semibold text-ink">{g.label}</h2>
                <p className="mt-1 text-meta text-ink-faint">{g.items.length} {g.items.length === 1 ? "item" : "items"}</p>
              </div>
              <ol className="pb-8">
                {g.items.map((r) => {
                  const t = r.thread;
                  const href = t ? `/research?thread=${t.thread_id}` : r.studyHref!;
                  return (
                    <li key={r.key} className="group relative rounded-xl transition-colors duration-150 hover:bg-surface2 md:-mx-3">
                      <Link href={href} className="grid grid-cols-[36px_1fr_auto] items-start gap-4 px-3 py-4">
                        <span className="figure pt-0.5 text-[22px] text-ink-faint">{r.day}</span>
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium leading-snug text-ink">{r.title}</span>
                          {t ? (
                            <ResearchMeta t={t} />
                          ) : (
                            <span className="mt-1.5 flex items-center gap-2 text-meta text-ink-faint">
                              <span className="h-1.5 w-1.5 rounded-full bg-steel" /> Paper study
                              {r.studyStatus && r.studyStatus !== "ready" && <Badge variant={r.studyStatus === "failed" ? "bad" : "default"}>{r.studyStatus === "failed" ? "Failed" : "Processing"}</Badge>}
                            </span>
                          )}
                        </span>
                        <ArrowUpRight
                          size={16}
                          className="mt-1 text-ink-faint transition-[transform,color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                        />
                      </Link>
                      {t?.has_paper && t.document_id && (
                        <div className="-mt-2 flex flex-wrap items-center gap-1 pb-3 pl-[64px] pr-3">
                          <Link
                            href={`/research/paper/${t.document_id}`}
                            className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-ink-soft hover:bg-surface3 hover:text-ink"
                          >
                            <FileText size={13} /> {t.paper_edited ? "Continue editing" : "Open paper"}
                          </Link>
                          <PaperDownload id={t.document_id} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {!isLoading && visible.length === 0 && (
            <div className="border-t border-line py-20 text-center">
              <p className="font-display text-title-sm font-semibold text-ink">{query ? "Nothing matches that search" : filter === "papers" ? "No research papers yet" : "Nothing here yet"}</p>
              <p className="mt-2 text-body text-ink-soft">
                {query
                  ? "Try a shorter phrase, or switch to All."
                  : filter === "papers"
                  ? "Choose “Research paper” when you ask a question, and the paper you can edit and download will be kept here."
                  : "Your investigations, research papers and paper studies will collect here."}
              </p>
              {!query && (
                <Link href="/research" className="pressable mt-6 inline-flex h-10 items-center rounded-[11px] bg-primary px-4 text-[13px] font-medium text-on-primary">
                  Start an investigation
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
