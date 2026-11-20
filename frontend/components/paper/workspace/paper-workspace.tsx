"use client";

/**
 * Paper Study workspace. Reading comes first: the page on a neutral desk, its
 * notes beside it, and an assistant that can rearrange the reader on request.
 * The study sections (overview, questions, insights, flashcards) sit in the
 * header; only the overview is written on upload, every other section the
 * first time it's opened, and never again unless the reader asks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { StudioBar } from "@/components/paper/studio-bar";
import { apiClient } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { useOutlineQuery, usePaperQuery, useStudyStatusQuery } from "@/lib/queries";
import { sectionState, type KitStatus, type OutputKind, type SectionState } from "@/lib/study-logic";
import { comparePages, focusedPanel, goToPage, initialLayout, restoreLayout, setPanelPage, type ReaderLayout } from "@/lib/reader-layout";
import { listPages, parseCommand, runCommand } from "@/lib/workspace-commands";
import { isTyping, renderedScale } from "@/lib/reader-runtime";
import { readWorkspace, updateWorkspace } from "@/lib/workspace";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { OverviewView } from "@/components/paper/study/overview-view";
import { QuestionsView } from "@/components/paper/study/questions-view";
import { InsightsView } from "@/components/paper/study/highlights-view";
import { FlashcardsView } from "@/components/paper/study/flashcards-view";
import { useStudyActions } from "@/components/paper/study/study-shared";
import { PageNotes } from "./page-notes";
import { NotesLevel } from "./notes-level";
import { ThinkWhileYouWait } from "@/components/research/think-while-you-wait";
import { AssistantPanel, useAssistant, type AssistantHandle } from "./assistant";
import { cn } from "@/lib/utils";

const Reader = dynamic(() => import("./reader").then((m) => m.Reader), {
  ssr: false,
  loading: () => <div className="reader-desk h-full" />,
});

type View = "reader" | "overview" | "questions" | "insights" | "flashcards";
type Companion = "notes" | "assistant";
const VIEWS: View[] = ["reader", "overview", "questions", "insights", "flashcards"];
const KIND: Partial<Record<View, OutputKind>> = { overview: "summary", questions: "questions", insights: "highlights", flashcards: "flashcards" };
const TABS: { view: View; label: string }[] = [
  { view: "reader", label: "Read paper" },
  { view: "overview", label: "Overview" },
  { view: "questions", label: "Questions" },
  { view: "insights", label: "Insights" },
  { view: "flashcards", label: "Flashcards" },
];

/** The page stepper's number: type a page and press Enter. */
function PageBox({ page, pageCount, onGo }: { page: number; pageCount: number; onGo: (p: number) => void }) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1 && n <= pageCount) { if (n !== page) onGo(n); } else setDraft(String(page));
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); commit(); }} className="mono flex items-center gap-1 text-[12px] text-ink">
      <input
        value={draft}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Page number"
        className="h-6 w-8 rounded-[2px] bg-transparent text-right outline-none transition-colors hover:bg-bg/60 focus:bg-bg"
      />
      <span className="text-ink-soft">/ {pageCount}</span>
    </form>
  );
}

/** A quiet dot after a section name: nothing once written, a ring before, a soft pulse while writing. */
function SectionMark({ state }: { state: SectionState }) {
  if (state === "ready") return null;
  const label = state === "generating" ? "being written" : state === "waiting" ? "queued" : state === "failed" ? "couldn't be written; open it to retry" : "not written yet; opening it writes it";
  return (
    <span title={label[0].toUpperCase() + label.slice(1)} className={cn("status-dot", `status-dot--${state}`)}>
      <span className="sr-only"> ({label})</span>
    </span>
  );
}

export function PaperWorkspace({ paperId, onStudyAnother }: { paperId: string; onStudyAnother: () => void }) {
  const queryClient = useQueryClient();
  const paperQuery = usePaperQuery(paperId);
  const outline = useOutlineQuery(paperId);
  const kit = useStudyStatusQuery(paperId).data;
  const actions = useStudyActions(paperId);
  const assistant = useAssistant(paperId);
  const assistantRef = useRef<AssistantHandle>(null);
  const paper = paperQuery.data;
  const pageCount = paper?.page_count ?? 1;

  // Restore this paper's workspace once
  const saved = useMemo(() => {
    const w = readWorkspace().paper;
    return w?.id === paperId ? w : null;
  }, [paperId]);
  const wide = typeof window !== "undefined" && window.innerWidth >= 1280;
  const [view, setView] = useState<View>(() => (VIEWS.includes(saved?.view as View) ? (saved!.view as View) : "reader"));
  const [layout, setLayoutState] = useState<ReaderLayout | null>(null);
  const [paneOpen, setPaneOpen] = useState<boolean>(() => (typeof saved?.assistant === "boolean" ? saved.assistant : wide));
  const [pane, setPane] = useState<Companion>(() => (saved?.companion === "notes" ? "notes" : "assistant"));
  const [railOpen, setRailOpen] = useState<boolean>(() => (typeof saved?.rail === "boolean" ? saved.rail : false));
  const [immersive, setImmersiveState] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!layout && paper?.page_count) setLayoutState(restoreLayout(saved?.reader, paper.page_count) ?? initialLayout(1));
  }, [layout, paper?.page_count, saved]);

  useEffect(() => {
    updateWorkspace((w) => ({
      ...w,
      paper: {
        ...(w.paper?.id === paperId ? w.paper : {}),
        id: paperId,
        view,
        reader: layout ?? (w.paper?.id === paperId ? w.paper.reader : undefined),
        assistant: paneOpen,
        companion: pane,
        rail: railOpen,
      },
    }));
  }, [paperId, view, layout, paneOpen, pane, railOpen]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const setLayout = useCallback((update: (l: ReaderLayout) => ReaderLayout) => setLayoutState((l) => (l ? update(l) : l)), []);

  // Below 1280px "Ask this paper" becomes an overlay: don't leave it covering the page when the window narrows
  useEffect(() => {
    const wideQuery = window.matchMedia("(min-width: 1280px)");
    const onChange = () => !wideQuery.matches && setPaneOpen(false);
    wideQuery.addEventListener("change", onChange);
    return () => wideQuery.removeEventListener("change", onChange);
  }, []);

  // On narrow screens the section tabs scroll: keep the current one in view
  useEffect(() => {
    document.querySelector('nav[aria-label="Paper sections"] [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view]);

  const outlinePages = outline.data?.pages;
  const pageInfo = useMemo(() => new Map((outlinePages ?? []).map((p) => [p.page_number, p])), [outlinePages]);
  const hasText = useCallback((p: number) => pageInfo.get(p)?.has_text ?? true, [pageInfo]);
  const explained = useCallback((p: number) => pageInfo.get(p)?.explanation === "ready", [pageInfo]);

  /* Full-screen reading: the reader covers the app, and the browser goes full screen when it allows it */
  const setImmersive = useCallback((on: boolean) => {
    setImmersiveState(on);
    if (on) {
      setView("reader");
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);
  useEffect(() => {
    const onChange = () => !document.fullscreenElement && setImmersiveState(false);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /** Citations, references and the page list all land here. */
  const openPage = useCallback((page: number) => {
    setView("reader");
    setLayoutState((l) => goToPage(l ?? initialLayout(page), page).layout);
  }, []);

  const showPane = (which: Companion) => {
    setPane(which);
    setPaneOpen(true);
  };

  const requestExplanations = async () => {
    await apiClient(`/papers/${paperId}/explain`, { method: "POST" });
    await Promise.all(["paper-outline", "paper-status", "paper-pages", "paper"].map((k) => queryClient.invalidateQueries({ queryKey: [k, paperId] })));
  };

  /** Opening a study section is what writes it, the first time only. */
  const openSection = async (next: View) => {
    setView(next);
    if (paper?.status === "needs_ocr") return; // nothing can be written from a scan
    const kind = KIND[next];
    if (!kind) return;
    // Decide from real data even if it hasn't loaded yet (e.g. clicked right after upload)
    const status = kit ?? (await queryClient.fetchQuery({ queryKey: ["study-status", paperId], queryFn: () => apiClient<KitStatus>(`/papers/${paperId}/study`) }).catch(() => null));
    if (status && sectionState(status, kind) === "not_started") await actions.generate(kind);
  };

  const runAi = (action: "compare_pages" | "explain_page" | "summarize_pages" | "explain_selection", pages: number[], selection?: string) => {
    showPane("assistant");
    const label =
      action === "compare_pages" ? `Comparing pages ${listPages(pages)}…`
      : action === "explain_page" ? `Explaining page ${pages[0]}…`
      : action === "summarize_pages" ? `Summarising page${pages.length > 1 ? "s" : ""} ${listPages(pages)}…`
      : `Explaining a passage on page ${pages[0]}…`;
    void assistant.run({ action, pages, selection }, label);
  };

  /** Everything typed to the assistant: a workspace command is applied to the reader; anything else is a question. */
  const submit = (text: string, attachedPage?: number | null) => {
    const cmd = parseCommand(text);
    if (!cmd) {
      // A question with a page attached is answered from that page; otherwise from the whole paper
      if (attachedPage) void assistant.run({ action: "ask", question: text, pages: [attachedPage] }, `Reading page ${attachedPage}…`);
      else void assistant.run({ action: "ask", question: text }, "Searching the paper…");
      return;
    }
    if (!layout || !paper) {
      assistant.note(text, "The reader is still loading. Try again in a moment.", false);
      return;
    }
    const res = runCommand(layout, cmd, { pageCount, hasText, scaleOf: (id) => renderedScale.get(id) ?? 1 });
    assistant.note(text, res.message, res.ok);
    if (!res.ok) return;
    if (res.layout) {
      setLayoutState(res.layout);
      setView("reader");
    }
    if (res.fullscreen !== undefined) setImmersive(res.fullscreen);
    if (res.ai) runAi(res.ai.action, res.ai.pages);
  };

  const askAboutPage = (question: string, page: number) => {
    showPane("assistant");
    void assistant.run({ action: "ask", question, pages: [page] }, `Reading page ${page}…`);
  };

  // Workspace shortcuts: N page notes, A assistant, / ask
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const toggle = (which: Companion) => {
        e.preventDefault();
        setPaneOpen((open) => !(open && pane === which));
        setPane(which);
      };
      if (e.key === "n" || e.key === "N") toggle("notes");
      else if (e.key === "a" || e.key === "A") toggle("assistant");
      else if (e.key === "/") {
        e.preventDefault();
        showPane("assistant");
        setTimeout(() => assistantRef.current?.focusInput(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (paperQuery.error instanceof ApiError && paperQuery.error.status === 404) {
    return (
      <div className="flex h-full items-center justify-center px-5">
        <div className="max-w-[420px] text-center">
          <h1 className="t-page-title !text-[28px]">This paper isn&rsquo;t available</h1>
          <p className="mt-2 text-[14.5px] text-ink-soft">It may have been removed. Upload it again to keep studying.</p>
          <button onClick={onStudyAnother} className="mt-6 font-medium text-ink underline decoration-accent/60 underline-offset-4">Study a paper</button>
        </div>
      </div>
    );
  }

  const focus = layout ? focusedPanel(layout) : undefined;
  const focusPage = focus?.page ?? 1;
  const openPages = layout ? [...new Set(layout.panels.map((p) => p.page))].sort((a, b) => a - b) : [];
  const textCount = (outlinePages ?? []).filter((p) => p.has_text).length;
  const displayTitle = (paper?.title ?? "").replace(/\.pdf$/i, "");
  const stepPage = (dir: 1 | -1) => {
    const to = focusPage + dir;
    if (to >= 1 && to <= pageCount) setLayout((l) => setPanelPage(l, focusedPanel(l)!.id, to));
  };

  const center = (() => {
    if (view === "reader") {
      if (!layout || !paper) return <div className="reader-desk h-full" />;
      return (
        <Reader
          paperId={paperId}
          pageCount={pageCount}
          hasText={hasText}
          explained={explained}
          layout={layout}
          setLayout={setLayout}
          immersive={immersive}
          onImmersive={setImmersive}
          railOpen={railOpen}
          onRailOpen={setRailOpen}
          onExplainSelection={(page, text) => runAi("explain_selection", [page], text)}
          onCompare={(pages) => runAi("compare_pages", pages)}
          onNotice={setNotice}
        />
      );
    }
    if (paper?.status === "needs_ocr") {
      return (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-[620px] px-6 pt-16 sm:px-10">
            <h1 className="t-page-title !text-[34px]">No selectable text in this PDF</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">It looks like a scanned document, so CogNexa can&rsquo;t summarise or explain it. Run OCR on the file (most PDF tools can), then upload it again. You can still read the pages.</p>
            <button onClick={() => setView("reader")} className="mt-5 font-medium text-ink underline decoration-accent/60 underline-offset-4">Back to the pages</button>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full overflow-y-auto">
        {view === "overview" && <OverviewView paperId={paperId} title={paper?.title ?? "Overview"} onOpenPage={openPage} />}
        {view === "questions" && <QuestionsView paperId={paperId} onOpenPage={openPage} />}
        {view === "insights" && <InsightsView paperId={paperId} onOpenPage={openPage} />}
        {view === "flashcards" && <FlashcardsView paperId={paperId} onOpenPage={openPage} />}
      </div>
    );
  })();

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-bg">
      <StudioBar onBack={onStudyAnother}>
        <NotesLevel paperId={paperId} />
        {!paneOpen && (
          <button
            type="button"
            onClick={() => showPane("assistant")}
            aria-label="Show notes and assistant"
            className="flex h-8 items-center gap-2 whitespace-nowrap rounded-[3px] bg-accent-soft px-3 text-[12.5px] text-ink transition-colors hover:bg-accent/[0.16]"
          >
            <span className="sm:hidden">Ask</span><span className="hidden sm:inline">Ask this paper</span> <ArrowLeft size={13} className="text-accent" />
          </button>
        )}
      </StudioBar>

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Paper: title, page stepper and sections. A column on desktop, a row of sections on small screens */}
        <aside aria-label="Paper" className="flex flex-shrink-0 flex-col border-b border-line bg-surface lg:w-[232px] lg:border-b-0 lg:border-r">
          <div className="hidden px-6 pt-8 lg:block">
            <h1 className="font-heading text-[27px] leading-[1.12] text-ink [overflow-wrap:anywhere] line-clamp-5" title={paper?.title}>{displayTitle || " "}</h1>
            {paper && (
              <p className="mt-3 text-[12px] text-ink-faint">
                {pageCount} {pageCount === 1 ? "page" : "pages"}{outlinePages && textCount < pageCount ? ` · ${textCount} with text` : ""}
              </p>
            )}
            <div className="mt-7 flex h-9 items-center justify-between rounded-[3px] bg-accent-soft px-1.5" role="group" aria-label="Page">
              <button type="button" onClick={() => stepPage(-1)} disabled={focusPage <= 1} aria-label="Previous page" className="flex h-7 w-7 items-center justify-center text-ink-soft transition-colors hover:text-ink disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <PageBox page={focusPage} pageCount={pageCount} onGo={(p) => setLayout((l) => setPanelPage(l, focusedPanel(l)!.id, p))} />
              <button type="button" onClick={() => stepPage(1)} disabled={focusPage >= pageCount} aria-label="Next page" className="flex h-7 w-7 items-center justify-center text-ink-soft transition-colors hover:text-ink disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="mt-7 border-t border-line" />
          </div>
          <nav
            aria-label="Paper sections"
            className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] lg:mt-5 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-4 lg:py-0"
          >
            {TABS.map(({ view: v, label }) => {
              const kind = KIND[v];
              const state: SectionState = !kind || paper?.status === "needs_ocr" ? "ready" : sectionState(kit, kind);
              const active = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => (v === "reader" ? setView("reader") : openSection(v))}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-[3px] px-3 text-[13px] transition-colors lg:w-full",
                    active ? "bg-accent-soft text-ink" : "text-ink-soft hover:bg-ink/[0.04] hover:text-ink"
                  )}
                >
                  <span className="flex-1 text-left">{label}</span>
                  <SectionMark state={state} />
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {paper?.status === "needs_ocr" && view === "reader" && !immersive && (
            <p role="note" className="flex-shrink-0 border-b border-line bg-surface px-4 py-2 text-[12.5px] leading-snug text-ink-soft">
              <span className="font-medium text-ink">No selectable text in this PDF.</span> It looks like a scan, so notes, study sections and the assistant can&rsquo;t work from it. Run OCR on the file, then upload it again.
            </p>
          )}
          <div className="relative min-h-0 flex-1">{center}</div>
          {/* Think while you wait, while the overview or a section is being written */}
          {paper?.status !== "needs_ocr" && !immersive && (
            <div className="pointer-events-none absolute bottom-3 right-3 z-30 w-[min(400px,calc(100%-1.5rem))] sm:bottom-4 sm:right-4">
              <div className="pointer-events-auto flex justify-end [&>section]:w-full [&>section]:shadow-panel">
                <ThinkWhileYouWait
                  target={{ kind: "paper", id: paperId }}
                  running={kit?.status === "processing"}
                  onOpenPage={openPage}
                  onAsk={(q) => submit(q)}
                />
              </div>
            </div>
          )}
          {notice && (
            <div role="status" className="absolute bottom-14 left-1/2 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-[4px] bg-primary px-3.5 py-2 text-[12.5px] text-on-primary shadow-[0_8px_24px_-8px_rgb(0_0_0/0.4)]">
              {notice}
              <button onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-70 transition-opacity hover:opacity-100"><X size={13} /></button>
            </div>
          )}
        </main>

        {paneOpen && (
          <>
            <button className="fixed inset-0 z-40 bg-black/30 xl:hidden" aria-label="Close notes and assistant" onClick={() => setPaneOpen(false)} />
            <aside
              aria-label="Page notes and assistant"
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-line bg-surface shadow-[0_0_40px_-12px_rgb(0_0_0/0.35)] xl:static xl:z-auto xl:w-[340px] xl:max-w-none xl:shadow-none"
            >
              <div className="flex flex-shrink-0 items-center gap-3 px-6 pb-4 pt-6">
                {pane === "notes" && (
                  <button type="button" onClick={() => setPane("assistant")} aria-label="Back to Ask this paper" title="Back to Ask this paper" className="-ml-1 flex h-7 w-7 items-center justify-center text-ink-soft transition-colors hover:text-ink">
                    <ArrowLeft size={15} />
                  </button>
                )}
                <h2 className="flex-1 font-heading text-[25px] leading-none text-ink">{pane === "notes" ? "Page notes" : "Ask this paper"}</h2>
                <button
                  type="button"
                  onClick={() => setPaneOpen(false)}
                  title="Hide (A)"
                  aria-label="Hide notes and assistant"
                  className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-accent-soft text-accent transition-colors hover:bg-accent/[0.18]"
                >
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                {pane === "notes" ? (
                  <PageNotes
                    paperId={paperId}
                    page={focusPage}
                    pageCount={pageCount}
                    onOpenPage={openPage}
                    onRequest={requestExplanations}
                    onAsk={askAboutPage}
                    asking={assistant.running !== null}
                  />
                ) : (
                  <AssistantPanel
                    ref={assistantRef}
                    paperId={paperId}
                    assistant={assistant}
                    focusedPage={focus?.page ?? null}
                    focusedHasText={focus ? hasText(focus.page) : false}
                    openPages={layout ? comparePages(layout) : openPages}
                    pageCount={pageCount}
                    onOpenPage={openPage}
                    onShowNotes={() => setPane("notes")}
                    onCompare={() => submit("compare these pages")}
                    onSubmit={submit}
                  />
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
