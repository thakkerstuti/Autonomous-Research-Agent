"use client";

/**
 * The Paper Study workspace for an uploaded paper: processing status,
 * difficulty, the page list, and each page's explanation as the backend's
 * worker finishes it. Everything shown comes from the /papers endpoints.
 */
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowRight, FileText, Plus, RotateCcw, ScanText } from "lucide-react";
import { apiClient } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { usePageExplanationQuery, usePaperPagesQuery, usePaperQuery, usePaperStatusQuery } from "@/lib/queries";
import { readWorkspace, updateWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";
import { SummaryView } from "@/components/paper/study/summary-view";
import { FlashcardsView } from "@/components/paper/study/flashcards-view";
import { QuestionsView } from "@/components/paper/study/questions-view";
import { HighlightsView } from "@/components/paper/study/highlights-view";
import { StudyStatusStrip } from "@/components/paper/study/study-shared";

const IN_PROGRESS = new Set(["pending", "processing"]);
const LEVELS = ["Beginner", "Medium", "Pro"] as const;
const TABS = [
  { key: "read", label: "Read" },
  { key: "summary", label: "Summary" },
  { key: "flashcards", label: "Flashcards" },
  { key: "qa", label: "Q&A" },
  { key: "highlights", label: "Highlights" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const isTab = (v: unknown): v is Tab => TABS.some((t) => t.key === v);

function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
        status === "ready" && "bg-ok",
        status === "failed" && "bg-bad",
        IN_PROGRESS.has(status) && "animate-pulse bg-accent",
        !["ready", "failed", "pending", "processing"].includes(status) && "bg-ink-faint"
      )}
    />
  );
}

export function PaperReader({ paperId, onStudyAnother }: { paperId: string; onStudyAnother: () => void }) {
  const queryClient = useQueryClient();
  const paperQuery = usePaperQuery(paperId);
  const pagesQuery = usePaperPagesQuery(paperId);
  const statusQuery = usePaperStatusQuery(paperId);
  const paper = paperQuery.data;
  const status = statusQuery.data;
  const pages = useMemo(() => pagesQuery.data?.pages ?? [], [pagesQuery.data]);

  // Restore the page this user was on for this paper
  const [current, setCurrent] = useState<number | null>(() => {
    const saved = readWorkspace().paper;
    return saved?.id === paperId && saved.page ? saved.page : null;
  });

  useEffect(() => {
    if (!pages.length) return;
    if (current == null || !pages.some((p) => p.page_number === current)) setCurrent(pages[0].page_number);
  }, [pages, current]);

  // The open study section is remembered too, so returning lands in the same place
  const [tab, setTab] = useState<Tab>(() => {
    const saved = readWorkspace().paper;
    return saved?.id === paperId && isTab(saved.tab) ? saved.tab : "read";
  });

  useEffect(() => {
    updateWorkspace((w) => ({
      ...w,
      paper: { id: paperId, page: current ?? (w.paper?.id === paperId ? w.paper.page : undefined), tab },
    }));
  }, [paperId, current, tab]);

  // Page references in the study sections open that page in Read
  const openPage = (n: number) => {
    setTab("read");
    if (pages.some((p) => p.page_number === n)) setCurrent(n);
  };

  const total = pages.length;
  const ready = pages.filter((p) => p.status === "ready").length;
  const failed = pages.filter((p) => p.status === "failed").length;
  const working = pages.some((p) => IN_PROGRESS.has(p.status));
  const currentStatus = pages.find((p) => p.page_number === current)?.status ?? null;
  const index = pages.findIndex((p) => p.page_number === current);
  const level = paper?.level ?? null;

  const explanation = usePageExplanationQuery(paperId, current, level, currentStatus);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["paper-pages", paperId] }),
      queryClient.invalidateQueries({ queryKey: ["paper-status", paperId] }),
      queryClient.invalidateQueries({ queryKey: ["paper", paperId] }),
      queryClient.invalidateQueries({ queryKey: ["papers"] }),
      // A re-explained page must never show its previous cached text
      queryClient.removeQueries({ queryKey: ["paper-page", paperId] }),
    ]);

  const [busy, setBusy] = useState<"page" | "all" | "level" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setActionError(null), [current]);

  const run = async (kind: "page" | "all" | "level", action: () => Promise<unknown>) => {
    setBusy(kind);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const retryPage = () =>
    run("page", () =>
      apiClient(`/papers/${paperId}/pages/${current}/regenerate?level=${encodeURIComponent(level || "Medium")}`, { method: "POST" })
    );
  const retryAllFailed = () => run("all", () => apiClient(`/papers/${paperId}/retry-failed`, { method: "POST" }));
  const changeLevel = (next: string) => {
    if (next === level) return;
    const form = new FormData();
    form.append("level", next);
    return run("level", () => apiClient(`/papers/${paperId}`, { method: "PATCH", body: form }));
  };

  // The paper is gone, or isn't this user's
  if (paperQuery.error instanceof ApiError && paperQuery.error.status === 404) {
    return (
      <div className="flex h-full items-center justify-center px-5">
        <div className="animate-view-in max-w-[420px] text-center">
          <h1 className="font-display text-title font-semibold text-ink">This paper isn&rsquo;t available</h1>
          <p className="mt-2 text-[14.5px] text-ink-soft">It may have been removed. Upload it again to keep studying.</p>
          <Button className="mt-6" onClick={onStudyAnother}>
            <Plus size={15} /> Study a paper
          </Button>
        </div>
      </div>
    );
  }

  const loading = paperQuery.isLoading || (pagesQuery.isLoading && !pagesQuery.data);
  const pct = total ? Math.round(((ready + failed) / total) * 100) : 0;
  const needsOcr = status?.status === "needs_ocr";
  const showBanner = !!status && (needsOcr || status.status === "partial" || status.status === "failed");

  return (
    <div className="flex h-full flex-col">
      {/* Paper header with live progress */}
      <header className="flex-shrink-0 border-b border-line px-4 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface3 text-ink-soft">
            <FileText size={17} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14.5px] font-semibold text-ink">{paper?.title || (loading ? "Loading paper…" : "Paper")}</div>
            <div className="mono mt-0.5 text-[12px] text-ink-faint">
              {paper?.page_count ? `${paper.page_count} pages · ` : ""}
              {total ? `${ready} of ${total} explained${failed ? ` · ${failed} failed` : ""}` : loading ? "" : "No readable text"}
            </div>
          </div>
          {tab === "read" && !needsOcr && total > 0 && (
            <div role="radiogroup" aria-label="Explanation level" className="inline-flex items-center rounded-[10px] bg-ink/[0.05] p-[3px]">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  role="radio"
                  aria-checked={level === l}
                  disabled={busy !== null}
                  onClick={() => changeLevel(l)}
                  className={cn(
                    "pressable h-7 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-60",
                    level === l ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={onStudyAnother}>
            <Plus size={14} /> <span className="hidden sm:inline">Study another paper</span>
          </Button>
        </div>
        {total > 0 && (
          <div role="tablist" aria-label="Study sections" className="-mx-1 mt-3 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="study-panel"
                onClick={() => setTab(t.key)}
                className={cn(
                  "pressable relative h-8 flex-shrink-0 rounded-[9px] px-3 text-[13px] font-medium transition-colors",
                  tab === t.key ? "bg-surface2 text-ink" : "text-ink-soft hover:text-ink"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {total > 0 && <StudyStatusStrip paperId={paperId} />}
        {tab === "read" && total > 0 && working && (
          <div
            className="mt-3 h-1 overflow-hidden rounded-full bg-ink/[0.07]"
            role="progressbar"
            aria-label="Explaining pages"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
        )}
      </header>

      {tab !== "read" && total > 0 ? (
        <div id="study-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
          {tab === "summary" && <SummaryView paperId={paperId} onOpenPage={openPage} />}
          {tab === "flashcards" && <FlashcardsView paperId={paperId} onOpenPage={openPage} />}
          {tab === "qa" && <QuestionsView paperId={paperId} onOpenPage={openPage} />}
          {tab === "highlights" && <HighlightsView paperId={paperId} onOpenPage={openPage} />}
        </div>
      ) : (
      <>
      {showBanner && !needsOcr && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bad/[0.06] px-4 py-2.5 text-[13px] text-ink sm:px-6">
          <span className="flex items-center gap-2">
            <AlertCircle size={15} className="flex-shrink-0 text-bad" /> {status!.message}
          </span>
          <Button size="sm" variant="outline" onClick={retryAllFailed} disabled={busy !== null}>
            {busy === "all" ? <ThinkingMark active size={14} /> : <RotateCcw size={14} />} Retry failed pages
          </Button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="border-b border-line bg-bad/[0.06] px-4 py-2 text-[13px] text-bad sm:px-6">{actionError}</p>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-3 text-[13.5px] text-ink-soft" role="status">
          <ThinkingMark active size={20} /> Opening your paper…
        </div>
      ) : total === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5">
          <div className="max-w-[460px] text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-surface3 text-ink-soft">
              <ScanText size={20} strokeWidth={1.75} />
            </span>
            <h1 className="mt-4 font-display text-title font-semibold text-ink">No selectable text in this PDF</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
              {status?.message || "It looks like a scanned document. Run OCR on it, then upload it again."}
            </p>
            <Button className="mt-6" variant="outline" onClick={onStudyAnother}>
              <Plus size={15} /> Upload another PDF
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Page list */}
          <nav aria-label="Pages" className="flex-shrink-0 overflow-x-auto border-b border-line md:w-[188px] md:overflow-y-auto md:border-b-0 md:border-r">
            <ul className="flex gap-1 p-2 md:flex-col md:p-3">
              {pages.map((p) => (
                <li key={p.page_number}>
                  <button
                    onClick={() => setCurrent(p.page_number)}
                    aria-current={p.page_number === current ? "page" : undefined}
                    className={cn(
                      "pressable flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 text-left text-[13px] transition-colors",
                      p.page_number === current ? "bg-surface2 font-medium text-ink" : "text-ink-soft hover:bg-surface2 hover:text-ink"
                    )}
                  >
                    <StatusDot status={p.status} />
                    Page {p.page_number}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Current page */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <article key={`${current ?? 0}-${level}`} className="page-enter mx-auto max-w-[720px] px-5 pb-16 pt-8 sm:px-8">
              <div className="col-label">Page {current} · {level}</div>

              {currentStatus === "ready" && explanation.data?.status === "ready" ? (
                <>
                  <div className="report-prose chat-prose mt-3">
                    <ReactMarkdown>{explanation.data.summary || ""}</ReactMarkdown>
                  </div>
                  {!!explanation.data.key_points?.length && (
                    <section className="mt-8">
                      <h2 className="col-label mb-3">Key points</h2>
                      <ul className="grid gap-2.5">
                        {explanation.data.key_points.map((k, i) => (
                          <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
                            <span className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" aria-hidden />
                            <span>{k}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {explanation.data.terms && Object.keys(explanation.data.terms).length > 0 && (
                    <section className="mt-8">
                      <h2 className="col-label mb-3">Terms</h2>
                      <dl className="grid gap-3 rounded-2xl bg-surface p-5 shadow-sm">
                        {Object.entries(explanation.data.terms).map(([term, def]) => (
                          <div key={term}>
                            <dt className="text-[14px] font-semibold text-ink">{term}</dt>
                            <dd className="mt-0.5 text-[14px] leading-relaxed text-ink-soft">{def}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )}
                  {explanation.data.figures && Object.keys(explanation.data.figures).length > 0 && (
                    <section className="mt-8">
                      <h2 className="col-label mb-3">Figures and equations</h2>
                      <dl className="grid gap-3">
                        {Object.entries(explanation.data.figures).map(([fig, desc]) => (
                          <div key={fig}>
                            <dt className="text-[14px] font-semibold text-ink">{fig}</dt>
                            <dd className="mt-0.5 text-[14px] leading-relaxed text-ink-soft">{desc}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )}
                </>
              ) : currentStatus === "ready" ? (
                <div className="mt-6 flex items-center gap-3 text-[14px] text-ink-soft" role="status">
                  <ThinkingMark active size={18} /> Loading the explanation…
                </div>
              ) : currentStatus === "failed" ? (
                <div className="mt-6 rounded-2xl bg-surface p-5 shadow-sm">
                  <div className="flex items-start gap-2 text-[14px] text-bad">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{(explanation.data?.status === "failed" && explanation.data.error) || "This page couldn't be explained."}</span>
                  </div>
                  <Button className="mt-4" size="sm" variant="outline" onClick={retryPage} disabled={busy !== null}>
                    {busy === "page" ? <ThinkingMark active size={14} /> : <RotateCcw size={14} />} Retry this page
                  </Button>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl bg-surface p-5 shadow-sm" role="status" aria-live="polite">
                  <div className="flex items-center gap-3">
                    <ThinkingMark active size={20} />
                    <div>
                      <div className="text-[14.5px] font-medium text-ink">
                        {currentStatus === "processing" ? "Explaining this page now" : "Waiting its turn"}
                      </div>
                      <div className="mt-0.5 text-[13px] text-ink-soft">It appears here on its own; you can read other pages meanwhile.</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-12 flex items-center justify-between gap-3 border-t border-line pt-5">
                <Button variant="ghost" size="sm" disabled={index <= 0} onClick={() => setCurrent(pages[index - 1].page_number)}>
                  <ArrowLeft size={14} /> Previous
                </Button>
                <span className="mono text-[12px] text-ink-faint">
                  {index + 1} / {total}
                </span>
                <Button variant="ghost" size="sm" disabled={index < 0 || index >= total - 1} onClick={() => setCurrent(pages[index + 1].page_number)}>
                  Next <ArrowRight size={14} />
                </Button>
              </div>
            </article>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
