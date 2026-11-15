"use client";

/**
 * Notes for the page being read: its summary, key findings, concepts and
 * figures, where else the paper discusses it, and a box to ask about it.
 * Notes are written for the whole paper the first time the reader asks for
 * them (POST /papers/{id}/explain), then read from the saved results.
 */
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUp, RotateCcw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useOutlineQuery, usePageExplanationQuery, usePaperQuery, usePaperStatusQuery, useStudyOutputQuery, useStudyStatusQuery } from "@/lib/queries";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { TextSkeleton } from "@/components/paper/study/study-shared";
import { cn } from "@/lib/utils";

const LEVELS = ["Beginner", "Medium", "Pro"] as const;
const WORKING = new Set(["pending", "processing"]);

interface Point { text: string; pages: number[] }
interface SummaryContent {
  key_findings?: Point[];
  key_concepts?: { name: string; definition: string; pages: number[] }[];
  key_numbers?: Point[];
  sections?: { key: string; title: string; specified: boolean; body: string; pages: number[] }[];
}

function PageLink({ page, onOpenPage }: { page: number; onOpenPage: (p: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpenPage(page)}
      title={`Go to page ${page}`}
      className="mono rounded-[4px] px-1 text-[12px] text-accent underline decoration-accent/30 underline-offset-2 transition-colors hover:bg-accent-soft hover:decoration-accent"
    >
      p.{page}
    </button>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="t-subheading mb-2.5 mt-8">{children}</h3>;
}

export function PageNotes({
  paperId, page, pageCount, onOpenPage, onRequest, onAsk, asking,
}: {
  paperId: string;
  page: number;
  pageCount: number;
  onOpenPage: (page: number) => void;
  onRequest: () => Promise<void>;
  onAsk: (question: string, page: number) => void;
  asking: boolean;
}) {
  const queryClient = useQueryClient();
  const paper = usePaperQuery(paperId).data;
  const outline = useOutlineQuery(paperId);
  const level = paper?.level ?? null;
  const pages = useMemo(() => outline.data?.pages ?? [], [outline.data]);
  const textPages = pages.filter((p) => p.has_text);
  const requested = textPages.filter((p) => p.explanation);
  const ready = requested.filter((p) => p.explanation === "ready").length;
  const failed = requested.filter((p) => p.explanation === "failed").length;
  const working = requested.some((p) => WORKING.has(p.explanation!));
  const info = pages.find((p) => p.page_number === page);
  const status = info?.explanation ?? null;
  const explanation = usePageExplanationQuery(paperId, page, level, status);
  const paperStatus = usePaperStatusQuery(paperId).data;

  const kit = useStudyStatusQuery(paperId).data;
  const summaryReady = kit?.outputs?.summary?.status === "ready";
  const summary = useStudyOutputQuery<SummaryContent>(paperId, "summary", kit?.outputs?.summary?.updated_at ?? null, summaryReady).data?.content;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  useEffect(() => setError(null), [page]);

  const refresh = () =>
    Promise.all(
      [["paper-outline", paperId], ["paper-status", paperId], ["paper-pages", paperId], ["paper", paperId], ["papers"]].map((key) =>
        queryClient.invalidateQueries({ queryKey: key })
      ).concat([Promise.resolve(queryClient.removeQueries({ queryKey: ["paper-page", paperId] }))])
    );
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const changeLevel = (next: string) => {
    if (next === level || busy) return;
    const form = new FormData();
    form.append("level", next);
    void run("level", () => apiClient(`/papers/${paperId}`, { method: "PATCH", body: form }));
  };

  // Where else the paper's overview leans on this page
  const related = useMemo(() => {
    if (!summary) return [];
    const items: { text: string; pages: number[] }[] = [];
    summary.key_findings?.forEach((f) => f.pages.includes(page) && items.push(f));
    summary.key_numbers?.forEach((f) => f.pages.includes(page) && items.push(f));
    summary.key_concepts?.forEach((c) => c.pages.includes(page) && items.push({ text: `${c.name}: ${c.definition}`, pages: c.pages }));
    return items.slice(0, 6);
  }, [summary, page]);

  const ask = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (q.length < 3 || asking) return;
    onAsk(q, page);
    setQuestion("");
  };

  const data = explanation.data;
  const terms = data?.terms ? Object.entries(data.terms) : [];
  const figures = data?.figures ? Object.entries(data.figures) : [];

  let body: React.ReactNode;
  if (outline.isLoading) body = <TextSkeleton lines={5} />;
  else if (info && !info.has_text) {
    body = <p className="mt-5 text-[14px] leading-relaxed text-ink-soft">This page has no selectable text (it may be a figure or a scan), so there are no notes for it.</p>;
  } else if (!textPages.length) {
    body = <p className="mt-5 text-[14px] leading-relaxed text-ink-soft">This PDF has no selectable text, so notes can&rsquo;t be written. Scanned papers need OCR first.</p>;
  } else if (!requested.length) {
    body = (
      <div className="mt-5">
        <p className="text-[14.5px] leading-[1.65] text-ink-soft">
          Plain-language notes beside every page: what it says, its key findings and the concepts it introduces. They&rsquo;re written once for the whole paper and saved.
        </p>
        <button
          type="button"
          onClick={() => run("request", onRequest)}
          disabled={busy !== null}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-[7px] bg-primary px-4 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "request" ? <ThinkingMark active size={13} /> : null}
          {busy === "request" ? "Starting…" : "Write page notes"}
        </button>
      </div>
    );
  } else if (status === "ready" && data?.status === "ready") {
    body = (
      <div key={`${page}-${level}`} className="animate-view-in">
        <div className="notes-prose mt-5 text-[14.5px] leading-[1.7] text-ink">
          <ReactMarkdown>{data.summary || ""}</ReactMarkdown>
        </div>
        {!!data.key_points?.length && (
          <section aria-label="Key findings">
            <Heading>Key findings</Heading>
            <ul className="grid gap-2">
              {data.key_points.map((k, i) => (
                <li key={i} className="grid grid-cols-[12px_1fr] gap-2 text-[14px] leading-[1.6] text-ink">
                  <span aria-hidden className="mt-[0.7em] h-px w-2 bg-accent" />
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {terms.length > 0 && (
          <section aria-label="Important concepts">
            <Heading>Important concepts</Heading>
            <dl className="grid gap-3">
              {terms.map(([term, def]) => (
                <div key={term}>
                  <dt className="text-[13.5px] font-semibold text-ink">{term}</dt>
                  <dd className="mt-0.5 text-[13.5px] leading-[1.6] text-ink-soft">{def}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {figures.length > 0 && (
          <section aria-label="Figures and equations">
            <Heading>Figures and equations</Heading>
            <dl className="grid gap-3">
              {figures.map(([fig, desc]) => (
                <div key={fig}>
                  <dt className="text-[13.5px] font-semibold text-ink">{fig}</dt>
                  <dd className="mt-0.5 text-[13.5px] leading-[1.6] text-ink-soft">{desc}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    );
  } else if (status === "failed") {
    body = (
      <div role="alert" className="mt-5 text-[14px] leading-relaxed">
        <p className="flex items-start gap-2 text-ink"><AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-bad" />{(data?.status === "failed" && data.error) || "Notes for this page couldn't be written."}</p>
        <button
          type="button"
          onClick={() => run("page", () => apiClient(`/papers/${paperId}/pages/${page}/regenerate?level=${encodeURIComponent(level || "Medium")}`, { method: "POST" }))}
          disabled={busy !== null}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink underline decoration-accent/50 underline-offset-4 hover:decoration-accent disabled:opacity-50"
        >
          {busy === "page" ? <ThinkingMark active size={13} /> : <RotateCcw size={13} />} Try this page again
        </button>
      </div>
    );
  } else {
    body = (
      <div role="status" className="mt-5">
        <p className="flex items-center gap-2 text-[13px] text-ink-soft">
          <ThinkingMark active size={13} />
          {status === "processing" ? "Writing notes for this page…" : status === "ready" ? "Loading…" : "Waiting its turn…"}
        </p>
        <TextSkeleton lines={4} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5" data-page-notes={page}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="t-heading !text-[24px]">Page {page}</h2>
          <span className="t-meta">of {pageCount}</span>
        </div>

        {requested.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line pb-3">
            <div role="radiogroup" aria-label="Explanation level" className="flex items-center gap-3 text-[12.5px]">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={level === l}
                  disabled={busy !== null}
                  onClick={() => changeLevel(l)}
                  className={cn("border-b pb-0.5 transition-colors disabled:opacity-50", level === l ? "border-accent font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink")}
                >
                  {l}
                </button>
              ))}
            </div>
            <span className="t-meta" aria-live="polite">
              {`${ready} of ${textPages.length} pages written${failed ? ` · ${failed} failed` : ""}`}
            </span>
          </div>
        )}
        {working && (
          <div className="h-px bg-line" aria-hidden>
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(Math.round(((ready + failed) / requested.length) * 100), 2)}%` }} />
          </div>
        )}
        {!working && failed > 0 && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-snug text-ink-soft">
            <span className="flex items-start gap-1.5"><AlertCircle size={13} className="mt-px flex-shrink-0 text-bad" />{paperStatus?.message || `${failed} page${failed > 1 ? "s" : ""} couldn't be explained.`}</span>
            <button type="button" onClick={() => run("all", () => apiClient(`/papers/${paperId}/retry-failed`, { method: "POST" }))} disabled={busy !== null} className="inline-flex items-center gap-1 font-medium text-ink underline decoration-accent/50 underline-offset-4 hover:decoration-accent disabled:opacity-50">
              {busy === "all" ? <ThinkingMark active size={12} /> : null} Retry failed pages
            </button>
          </div>
        )}

        {body}

        {related.length > 0 && (
          <section aria-label="In the paper overview">
            <Heading>In the paper&rsquo;s overview</Heading>
            <ul className="grid gap-2.5">
              {related.map((r, i) => {
                const others = r.pages.filter((p) => p !== page);
                return (
                  <li key={i} className="text-[13.5px] leading-[1.6] text-ink-soft">
                    {r.text}
                    {others.length > 0 && (
                      <span className="ml-1 inline-flex flex-wrap items-center gap-0.5 align-baseline">
                        <span className="text-[12px] text-ink-faint">also</span>
                        {others.slice(0, 4).map((p) => <PageLink key={p} page={p} onOpenPage={onOpenPage} />)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {error && <p role="alert" className="mt-4 text-[13px] text-bad">{error}</p>}
      </div>

      {info?.has_text !== false && textPages.length > 0 && (
        <form onSubmit={ask} className="flex-shrink-0 border-t border-line px-4 py-3">
          <div className="flex items-end gap-2 rounded-[8px] border border-line bg-bg px-2 py-1.5 transition-colors focus-within:border-accent/50">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask();
                }
              }}
              rows={1}
              maxLength={500}
              placeholder={`Ask about page ${page}…`}
              aria-label={`Ask about page ${page}`}
              className="max-h-28 min-h-[30px] flex-1 resize-none bg-transparent px-1 py-1 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button type="submit" disabled={question.trim().length < 3 || asking} aria-label={`Ask about page ${page}`} title="Ask (Enter)" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[6px] bg-primary text-on-primary transition-opacity disabled:opacity-30">
              {asking ? <ThinkingMark active size={13} /> : <ArrowUp size={14} />}
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[11.5px] text-ink-faint">Answers use only page {page}, with quotes checked against it.</p>
        </form>
      )}
    </div>
  );
}
