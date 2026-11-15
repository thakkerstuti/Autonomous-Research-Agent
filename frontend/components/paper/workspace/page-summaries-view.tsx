"use client";

/**
 * Page-by-page explanations. They're generated when the reader first opens this
 * section (POST /papers/{id}/explain from the navigation), then read from the
 * existing /papers endpoints. Opening it again never re-generates anything.
 */
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, RotateCcw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useOutlineQuery, usePageExplanationQuery, usePaperQuery, usePaperStatusQuery } from "@/lib/queries";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { SectionShell, TextSkeleton } from "@/components/paper/study/study-shared";
import { cn } from "@/lib/utils";

const LEVELS = ["Beginner", "Medium", "Pro"] as const;
const WORKING = new Set(["pending", "processing"]);

export function PageSummariesView({
  paperId,
  page,
  onPageChange,
  onOpenInReader,
  onRequest,
}: {
  paperId: string;
  page: number | null;
  onPageChange: (page: number) => void;
  onOpenInReader: (page: number) => void;
  onRequest: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const paperQuery = usePaperQuery(paperId);
  const outline = useOutlineQuery(paperId);
  const status = usePaperStatusQuery(paperId).data;
  const level = paperQuery.data?.level ?? null;
  const textPages = useMemo(() => (outline.data?.pages ?? []).filter((p) => p.has_text), [outline.data]);
  const requested = textPages.filter((p) => p.explanation);
  const ready = requested.filter((p) => p.explanation === "ready").length;
  const failed = requested.filter((p) => p.explanation === "failed").length;
  const working = requested.some((p) => WORKING.has(p.explanation!));

  const current = page && textPages.some((p) => p.page_number === page) ? page : textPages[0]?.page_number ?? null;
  const currentStatus = textPages.find((p) => p.page_number === current)?.explanation ?? null;
  const index = textPages.findIndex((p) => p.page_number === current);
  const explanation = usePageExplanationQuery(paperId, current, level, currentStatus);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [current]);

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
    if (next === level) return;
    const form = new FormData();
    form.append("level", next);
    void run("level", () => apiClient(`/papers/${paperId}`, { method: "PATCH", body: form }));
  };

  const meta = requested.length
    ? `${ready} of ${textPages.length} pages explained${failed ? ` · ${failed} failed` : ""}`
    : "Each page explained at the level you choose";

  return (
    <SectionShell
      title="Page summaries"
      meta={meta}
      actions={
        requested.length > 0 && (
          <div role="radiogroup" aria-label="Explanation level" className="flex gap-3 text-[13px]">
            {LEVELS.map((l) => (
              <button
                key={l}
                role="radio"
                aria-checked={level === l}
                disabled={busy !== null}
                onClick={() => changeLevel(l)}
                className={cn("pressable border-b pb-0.5 transition-colors disabled:opacity-50", level === l ? "border-accent font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink")}
              >
                {l}
              </button>
            ))}
          </div>
        )
      }
    >
      {outline.isLoading ? (
        <TextSkeleton />
      ) : textPages.length === 0 ? (
        <p className="mt-8 text-[14px] text-ink-soft">This PDF has no selectable text, so there is nothing to explain. Scanned papers need OCR first.</p>
      ) : requested.length === 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-y border-line py-4 text-[14px] text-ink-soft">
          <span>Page summaries haven&rsquo;t been generated for this paper yet.</span>
          <button
            onClick={() => run("request", onRequest)}
            disabled={busy !== null}
            className="pressable font-medium text-ink underline decoration-accent/60 underline-offset-4 hover:decoration-accent disabled:opacity-50"
          >
            {busy === "request" ? "Starting…" : "Generate page summaries"}
          </button>
        </div>
      ) : (
        <>
          {working && (
            <div className="mt-5" role="status" aria-live="polite">
              <div className="flex items-center gap-2.5 text-[13px] text-ink-soft">
                <ThinkingMark active size={14} /> Explaining pages… you can read finished ones now.
              </div>
              <div className="mt-2 h-px bg-line">
                <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(Math.round(((ready + failed) / requested.length) * 100), 2)}%` }} />
              </div>
            </div>
          )}
          {!working && failed > 0 && (
            <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 border-y border-bad/25 py-2.5 text-[13px]">
              <AlertCircle size={14} className="text-bad" /> {status?.message ?? `${failed} page(s) couldn't be explained.`}
              <button onClick={() => run("all", () => apiClient(`/papers/${paperId}/retry-failed`, { method: "POST" }))} disabled={busy !== null} className="pressable ml-auto flex items-center gap-1.5 font-medium text-ink hover:text-accent">
                {busy === "all" ? <ThinkingMark active size={13} /> : <RotateCcw size={13} />} Retry failed pages
              </button>
            </div>
          )}

          {/* Page stepper */}
          <div className="mt-6 flex items-center gap-2">
            <button onClick={() => index > 0 && onPageChange(textPages[index - 1].page_number)} disabled={index <= 0} title="Previous page" className="pressable flex h-8 w-8 items-center justify-center rounded-md text-ink-soft hover:bg-ink/[0.05] hover:text-ink disabled:opacity-30">
              <ArrowLeft size={15} />
            </button>
            <select
              aria-label="Page"
              value={current ?? ""}
              onChange={(e) => onPageChange(Number(e.target.value))}
              className="mono h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink"
            >
              {textPages.map((p) => (
                <option key={p.page_number} value={p.page_number}>
                  Page {p.page_number}{p.explanation === "failed" ? " · failed" : WORKING.has(p.explanation ?? "") ? " · in progress" : ""}
                </option>
              ))}
            </select>
            <button onClick={() => index < textPages.length - 1 && onPageChange(textPages[index + 1].page_number)} disabled={index < 0 || index >= textPages.length - 1} title="Next page" className="pressable flex h-8 w-8 items-center justify-center rounded-md text-ink-soft hover:bg-ink/[0.05] hover:text-ink disabled:opacity-30">
              <ArrowRight size={15} />
            </button>
            {current && (
              <button onClick={() => onOpenInReader(current)} className="pressable ml-auto flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink" title="Open this page in the reader">
                <BookOpen size={14} /> Open page {current} in reader
              </button>
            )}
          </div>

          <article key={`${current}-${level}`} className="animate-view-in mt-6 border-t border-line pt-6">
            {currentStatus === "ready" && explanation.data?.status === "ready" ? (
              <>
                <div className="report-prose chat-prose"><ReactMarkdown>{explanation.data.summary || ""}</ReactMarkdown></div>
                {!!explanation.data.key_points?.length && (
                  <section className="mt-8">
                    <h2 className="col-label">Key points</h2>
                    <ul className="mt-2.5 grid gap-2">
                      {explanation.data.key_points.map((k, i) => (
                        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
                          <span className="mt-[10px] h-1 w-1 flex-shrink-0 rounded-full bg-accent" aria-hidden />
                          <span>{k}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {explanation.data.terms && Object.keys(explanation.data.terms).length > 0 && (
                  <section className="mt-8">
                    <h2 className="col-label">Terms</h2>
                    <dl className="mt-2.5 grid gap-3">
                      {Object.entries(explanation.data.terms).map(([term, def]) => (
                        <div key={term} className="border-l-2 border-line pl-3">
                          <dt className="text-[14px] font-semibold text-ink">{term}</dt>
                          <dd className="text-[14px] leading-relaxed text-ink-soft">{def}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
                {explanation.data.figures && Object.keys(explanation.data.figures).length > 0 && (
                  <section className="mt-8">
                    <h2 className="col-label">Figures and equations</h2>
                    <dl className="mt-2.5 grid gap-3">
                      {Object.entries(explanation.data.figures).map(([fig, desc]) => (
                        <div key={fig} className="border-l-2 border-line pl-3">
                          <dt className="text-[14px] font-semibold text-ink">{fig}</dt>
                          <dd className="text-[14px] leading-relaxed text-ink-soft">{desc}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </>
            ) : currentStatus === "failed" ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-[14px]">
                <AlertCircle size={16} className="text-bad" />
                <span>{(explanation.data?.status === "failed" && explanation.data.error) || "This page couldn't be explained."}</span>
                <button
                  onClick={() => run("page", () => apiClient(`/papers/${paperId}/pages/${current}/regenerate?level=${encodeURIComponent(level || "Medium")}`, { method: "POST" }))}
                  disabled={busy !== null}
                  className="pressable ml-auto flex items-center gap-1.5 font-medium text-ink hover:text-accent"
                >
                  {busy === "page" ? <ThinkingMark active size={13} /> : <RotateCcw size={13} />} Retry this page
                </button>
              </div>
            ) : (
              <div role="status">
                <p className="flex items-center gap-2.5 text-[13.5px] text-ink-soft">
                  <ThinkingMark active size={14} /> {currentStatus === "processing" ? "Explaining this page now…" : currentStatus === "ready" ? "Loading…" : "Waiting its turn…"}
                </p>
                <TextSkeleton lines={4} />
              </div>
            )}
            {error && <p role="alert" className="mt-4 text-[13px] text-bad">{error}</p>}
          </article>
        </>
      )}
    </SectionShell>
  );
}
